import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { query } from '../config/db.js';
import { streamIntakeConversation, ExtractedClaimFields } from '../services/claude.js';
import { runClaimsTriagePipeline } from '../services/triage.js';

const claimFieldsSchema = z.object({
  claim_type: z.enum(['Auto', 'Property', 'Health', 'General Liability']).optional(),
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  loss_amount: z.number().nonnegative().optional(),
  incident_description: z.string().optional(),
  parties_involved: z.array(z.string()).optional(),
  policy_number: z.string().optional(),
});

const router = Router();

// Create a new claim (Draft status)
router.post('/create', requireRole(['claimant']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const claimantId = req.user?.id;
    const { title, claimType } = req.body;

    const result = await query(
      `INSERT INTO claims (claimant_id, status, title, claim_type) 
       VALUES ($1, 'draft', $2, $3) 
       RETURNING id, status, title, claim_type as "claimType", created_at as "createdAt"`,
      [claimantId, title || 'New Insurance Claim', claimType || 'Auto']
    );

    const claim = result.rows[0];

    // Log action to audit log
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, 'CLAIM_DRAFT_CREATED', $3)`,
      [claimantId, claim.id, JSON.stringify({ title, claimType })]
    );

    res.status(201).json({ claim });
  } catch (error: any) {
    console.error('Error creating claim:', error);
    res.status(500).json({ error: 'Failed to create claim' });
  }
});

// Get all claims (Claimants get their own, Adjusters get all)
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    let result;
    if (role === 'adjuster') {
      result = await query(
        `SELECT c.id, c.status, c.title, c.claim_type as "claimType", c.created_at as "createdAt", 
                u.full_name as "claimantName", u.email as "claimantEmail", r.score as "riskScore"
         FROM claims c
         LEFT JOIN users u ON c.claimant_id = u.id
         LEFT JOIN risk_scores r ON c.id = r.claim_id
         ORDER BY c.created_at DESC`
      );
    } else {
      result = await query(
        `SELECT id, status, title, claim_type as "claimType", created_at as "createdAt"
         FROM claims
         WHERE claimant_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );
    }

    res.status(200).json({ claims: result.rows });
  } catch (error: any) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

// Get single claim details
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const claimId = req.params.id;
    const userId = req.user?.id;
    const role = req.user?.role;

    // Fetch claim
    const claimResult = await query(
      `SELECT c.id, c.claimant_id, c.status, c.title, c.claim_type as "claimType", c.created_at as "createdAt"
       FROM claims c WHERE c.id = $1`,
      [claimId]
    );

    if (claimResult.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const claim = claimResult.rows[0];

    // Check auth permission
    if (role !== 'adjuster' && claim.claimant_id !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Fetch claim fields
    const fieldsResult = await query(
      `SELECT field_key as "key", field_value as "value", confidence 
       FROM claim_fields WHERE claim_id = $1`,
      [claimId]
    );

    // Fetch documents
    const docsResult = await query(
      `SELECT id, file_name as "name", file_type as "type", created_at as "createdAt"
       FROM documents WHERE claim_id = $1`,
      [claimId]
    );

    // Fetch risk score
    const riskResult = await query(
      `SELECT score, risk_flags as "flags", rationale, similar_claim_ids as "similarClaims", evaluated_at as "evaluatedAt"
       FROM risk_scores WHERE claim_id = $1`,
      [claimId]
    );

    res.status(200).json({
      claim,
      fields: fieldsResult.rows,
      documents: docsResult.rows,
      riskScore: riskResult.rows[0] || null
    });
  } catch (error: any) {
    console.error('Error fetching claim details:', error);
    res.status(500).json({ error: 'Failed to fetch claim details' });
  }
});

// Get claim chat history
router.get('/:id/history', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const userId = req.user?.id;
  const role = req.user?.role;

  try {
    const claimCheck = await query('SELECT claimant_id FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    if (role !== 'adjuster' && claimCheck.rows[0].claimant_id !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const historyCheck = await query(
      `SELECT details->>'role' as role, details->>'content' as content 
       FROM audit_log 
       WHERE claim_id = $1 AND action = 'chat_message' 
       ORDER BY created_at ASC`,
      [claimId]
    );
    
    res.status(200).json({ history: historyCheck.rows });
  } catch (error: any) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// SSE streaming chat intake agent
router.post('/:id/chat', requireRole(['claimant']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const claimantId = req.user?.id;
  const { message } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  try {
    // 1. Verify claim ownership
    const claimCheck = await query('SELECT claimant_id FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    if (claimCheck.rows[0].claimant_id !== claimantId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // 2. Fetch current claim fields to pass as current state to LLM
    const fieldsCheck = await query('SELECT field_key, field_value FROM claim_fields WHERE claim_id = $1', [claimId]);
    const currentFields: ExtractedClaimFields = {};
    fieldsCheck.rows.forEach((row) => {
      (currentFields as any)[row.field_key] = row.field_value;
    });

    // 3. Log user message to audit log
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, 'chat_message', $3)`,
      [claimantId, claimId, JSON.stringify({ role: 'user', content: message })]
    );

    // 4. Fetch full chat history for Claude context
    const historyCheck = await query(
      `SELECT details->>'role' as role, details->>'content' as content 
       FROM audit_log 
       WHERE claim_id = $1 AND action = 'chat_message' 
       ORDER BY created_at ASC`,
      [claimId]
    );
    
    const messages = historyCheck.rows.map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content
    }));

    // 5. Establish Server-Sent Events headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish connection

    let fullResponseText = '';

    // 6. Run Claude stream
    await streamIntakeConversation(
      messages,
      currentFields,
      (textChunk) => {
        // Stream text delta to client
        fullResponseText += textChunk;
        res.write(`data: ${JSON.stringify({ type: 'text', text: textChunk })}\n\n`);
      },
      async (extractedFields) => {
        // Handle tool call: Save fields to database
        console.log(`[Claims Chat]: Extracting fields for claim ${claimId}:`, extractedFields);
        
        // Zod validation on extracted fields
        const parseResult = claimFieldsSchema.safeParse(extractedFields);
        if (!parseResult.success) {
          console.error('[Claims Chat] Tool call validation error:', parseResult.error.format());
          return;
        }

        const validatedFields = parseResult.data;
        const keys = Object.keys(validatedFields) as Array<keyof ExtractedClaimFields>;
        for (const key of keys) {
          const value = validatedFields[key];
          if (value !== undefined) {
            await query(
              `INSERT INTO claim_fields (claim_id, field_key, field_value, confidence) 
               VALUES ($1, $2, $3, $4) 
               ON CONFLICT (claim_id, field_key) 
               DO UPDATE SET field_value = EXCLUDED.field_value, confidence = EXCLUDED.confidence`,
              [claimId, key, JSON.stringify(value), 0.95] // Set high confidence for direct tools
            );
          }
        }

        // Notify client about updated fields
        res.write(`data: ${JSON.stringify({ type: 'fields_extracted', fields: validatedFields })}\n\n`);
      }
    );

    // 7. Save assistant's reply to audit log
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES (NULL, $1, 'chat_message', $2)`,
      [claimId, JSON.stringify({ role: 'assistant', content: fullResponseText })]
    );

    // Complete the SSE stream
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Error in intake chat stream:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Internal server error' })}\n\n`);
    res.end();
  }
});

// Submit claim (Trigger async triage processing)
router.post('/:id/submit', requireRole(['claimant']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const claimId = req.params.id as string;
    const userId = req.user?.id;

    // Verify claim exists and belongs to user
    const checkResult = await query('SELECT status, claimant_id FROM claims WHERE id = $1', [claimId]);
    if (checkResult.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    const claim = checkResult.rows[0];
    if (claim.claimant_id !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (claim.status !== 'draft') {
      res.status(400).json({ error: 'Claim has already been submitted' });
      return;
    }

    // Update claim status to 'submitted'
    await query(
      `UPDATE claims SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [claimId]
    );

    // Log to audit log
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, 'CLAIM_SUBMITTED', $3)`,
      [userId, claimId, JSON.stringify({ originalStatus: claim.status })]
    );

    // Trigger async processing (BullMQ / In-Process fallback)
    // We will import and call this asynchronously. If Redis isn't running, it triggers local events.
    triggerAsyncTriagePipeline(claimId);

    res.status(200).json({ message: 'Claim submitted successfully', status: 'submitted' });
  } catch (error: any) {
    console.error('Error submitting claim:', error);
    res.status(500).json({ error: 'Failed to submit claim' });
  }
});

// Adjuster Triage Decision
router.post('/:id/triage', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const claimId = req.params.id;
    const adjusterId = req.user?.id;
    const { action, rationale } = req.body; // action: 'approve' or 'reject' or 'more_info'

    if (!action || !['approve', 'reject', 'more_info'].includes(action)) {
      res.status(400).json({ error: 'Invalid triage action. Must be approve, reject, or more_info' });
      return;
    }

    let nextStatus: string;
    if (action === 'approve') nextStatus = 'approved';
    else if (action === 'reject') nextStatus = 'rejected';
    else nextStatus = 'more_info_needed';

    // Update claim status
    const result = await query(
      `UPDATE claims 
       SET status = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, status`,
      [nextStatus, claimId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    // Log adjuster decision to audit log (SOC 2)
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, 'HUMAN_TRIAGE_DECISION', $3)`,
      [adjusterId, claimId, JSON.stringify({ action, nextStatus, rationale })]
    );

    res.status(200).json({ message: `Claim successfully updated to ${nextStatus}`, status: nextStatus });
  } catch (error: any) {
    console.error('Error updating claim triage decision:', error);
    res.status(500).json({ error: 'Failed to triage claim' });
  }
});

// A simple local async event processor for risk/similarity scoring
// This runs in background immediately on submit. We will define it in detail in Phase 4.
function triggerAsyncTriagePipeline(claimId: string) {
  console.log(`[Pipeline]: Triggering async triage pipeline for claim ${claimId}`);
  
  // Asynchronously execute scoring
  setTimeout(async () => {
    try {
      await runClaimsTriagePipeline(claimId);
    } catch (err) {
      console.error(`[Pipeline]: Failed background analysis for claim ${claimId}:`, err);
    }
  }, 1000);
}

export default router;
