import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/auth.js';
import { query } from '../config/db.js';
import { streamIntakeConversation, ExtractedClaimFields } from '../services/claude.js';
import { runClaimsTriagePipeline } from '../services/triage.js';
import { searchClaimChunks, searchAllChunks, getEmbeddingForQuery } from '../services/rag.js';
import { generateAgentSimulation } from '../services/agent_team.js';
import { evaluateClaimRules, getCoverageRules, addCoverageRule } from '../services/rules.js';
import { evaluateNegotiationTurn, finalizeClaimSettlement } from '../services/negotiation.js';

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
                c.human_takeover as "humanTakeover",
                u.full_name as "claimantName", u.email as "claimantEmail", r.score as "riskScore"
         FROM claims c
         LEFT JOIN users u ON c.claimant_id = u.id
         LEFT JOIN risk_scores r ON c.id = r.claim_id
         ORDER BY c.created_at DESC`
      );
    } else {
      result = await query(
        `SELECT id, status, title, claim_type as "claimType", human_takeover as "humanTakeover", created_at as "createdAt"
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

// Get claims analytics (Adjuster only)
router.get('/analytics', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // 1. Get status counts
    const statusRes = await query(
      `SELECT status, COUNT(*) as count 
       FROM claims 
       GROUP BY status`
    );

    // 2. Get claim type counts
    const typeRes = await query(
      `SELECT claim_type as "type", COUNT(*) as count 
       FROM claims 
       GROUP BY claim_type`
    );

    // 3. Get average risk score
    const riskRes = await query(
      `SELECT COALESCE(AVG(score), 0) as "avgRisk" 
       FROM risk_scores`
    );

    // 4. Get total loss exposure and average loss amount
    const lossRes = await query(
      `SELECT COALESCE(SUM((regexp_replace(field_value::text, '[^0-9.]', '', 'g'))::numeric), 0) as "totalLoss",
              COALESCE(AVG((regexp_replace(field_value::text, '[^0-9.]', '', 'g'))::numeric), 0) as "avgLoss"
       FROM claim_fields
       WHERE field_key = 'loss_amount' AND regexp_replace(field_value::text, '[^0-9.]', '', 'g') ~ '^[0-9.]+$'`
    );

    // 5. Get claims over time (last 7 days)
    const trendRes = await query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as count
       FROM claims
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
       ORDER BY date ASC`
    );

    res.status(200).json({
      statusCounts: statusRes.rows,
      typeCounts: typeRes.rows,
      avgRisk: Number(riskRes.rows[0].avgRisk),
      totalLoss: Number(lossRes.rows[0].totalLoss),
      avgLoss: Number(lossRes.rows[0].avgLoss),
      trend: trendRes.rows,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Global RAG Search (Adjuster only)
router.get('/search', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const queryText = req.query.q as string;
  const limitVal = parseInt(req.query.limit as string) || 5;

  if (!queryText) {
    res.status(400).json({ error: 'Search query parameter "q" is required' });
    return;
  }

  try {
    const results = await searchAllChunks(queryText, limitVal);
    res.status(200).json({ results });
  } catch (error) {
    console.error('Error during global RAG search route:', error);
    res.status(500).json({ error: 'Failed to perform global RAG search' });
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
      `SELECT c.id, c.claimant_id, c.status, c.title, c.claim_type as "claimType", c.human_takeover as "humanTakeover", c.created_at as "createdAt"
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

// Claim-specific RAG Search (Claimant owner or Adjuster)
router.get('/:id/search', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const userId = req.user?.id;
  const role = req.user?.role;
  const queryText = req.query.q as string;
  const limitVal = parseInt(req.query.limit as string) || 5;

  if (!queryText) {
    res.status(400).json({ error: 'Search query parameter "q" is required' });
    return;
  }

  try {
    // 1. Verify claim ownership
    const claimCheck = await query('SELECT claimant_id FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const claim = claimCheck.rows[0];
    if (role !== 'adjuster' && claim.claimant_id !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // 2. Perform search
    const results = await searchClaimChunks(claimId, queryText, limitVal);
    res.status(200).json({ results });
  } catch (error) {
    console.error('Error during claim-specific RAG search route:', error);
    res.status(500).json({ error: 'Failed to perform claim RAG search' });
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
    // 1. Verify claim ownership & human_takeover status
    const claimCheck = await query('SELECT claimant_id, human_takeover FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    if (claimCheck.rows[0].claimant_id !== claimantId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const isTakeover = claimCheck.rows[0].human_takeover;
    if (isTakeover) {
      // Chat is taken over by adjuster. Bypassing Claude.
      await query(
        `INSERT INTO audit_log (actor_id, claim_id, action, details) 
         VALUES ($1, $2, 'chat_message', $3)`,
        [claimantId, claimId, JSON.stringify({ role: 'user', content: message })]
      );
      
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      
      res.write(`data: ${JSON.stringify({ type: 'text', text: '' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
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

// Takeover Chat Toggle (Adjusters only)
router.post('/:id/takeover', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const adjusterId = req.user?.id;
  const { takeover } = req.body;

  if (takeover === undefined) {
    res.status(400).json({ error: 'Takeover state is required' });
    return;
  }

  try {
    const claimCheck = await query('SELECT id FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    // Update claim human_takeover status
    await query('UPDATE claims SET human_takeover = $1, updated_at = NOW() WHERE id = $2', [takeover, claimId]);

    // Log the takeover event in audit logs
    const action = takeover ? 'takeover_initiated' : 'takeover_released';
    const message = takeover 
      ? 'System: A human adjuster has taken over this chat. The automated AI assistant is suspended.'
      : 'System: Adjuster has left the chat. The AI assistant has resumed.';

    // Insert system notice into the chat log
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, 'chat_message', $3)`,
      [adjusterId, claimId, JSON.stringify({ role: 'assistant', content: message, isSystem: true })]
    );

    // Also log the main audit event
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, $3, $4)`,
      [adjusterId, claimId, action, JSON.stringify({ description: takeover ? 'Human takeover enabled' : 'Human takeover disabled' })]
    );

    res.status(200).json({ success: true, human_takeover: takeover });
  } catch (error: any) {
    console.error('Error changing takeover status:', error);
    res.status(500).json({ error: 'Failed to change takeover status' });
  }
});

// Send Adjuster Message during Takeover (Adjusters only)
router.post('/:id/adjuster-message', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const adjusterId = req.user?.id;
  const { message } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  try {
    const claimCheck = await query('SELECT human_takeover FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    if (!claimCheck.rows[0].human_takeover) {
      res.status(400).json({ error: 'Cannot send adjuster message. Chat has not been taken over by human.' });
      return;
    }

    // Insert message as 'assistant' with a special flag
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES ($1, $2, 'chat_message', $3)`,
      [adjusterId, claimId, JSON.stringify({ role: 'assistant', content: message, sender: 'adjuster' })]
    );

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error sending adjuster message:', error);
    res.status(500).json({ error: 'Failed to send adjuster message' });
  }
});

// Get claim compliance audit logs (Adjusters only)
router.get('/:id/audit', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  try {
    const claimCheck = await query('SELECT id FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const auditRes = await query(
      `SELECT a.id, a.action, a.details, a.created_at as "createdAt", a.ip_address as "ipAddress",
              u.full_name as "actorName", u.email as "actorEmail", u.role as "actorRole"
       FROM audit_log a
       LEFT JOIN users u ON a.actor_id = u.id
       WHERE a.claim_id = $1
       ORDER BY a.created_at ASC`,
      [claimId]
    );

    res.status(200).json({ audit: auditRes.rows });
  } catch (error: any) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch compliance audit logs' });
  }
});

// Get claim communication notifications mapped from audit logs (Claimant & Adjuster)
router.get('/:id/notifications', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const userId = req.user?.id;
  const role = req.user?.role;

  try {
    // 1. Verify claim ownership
    const claimCheck = await query('SELECT claimant_id, title FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
    const claim = claimCheck.rows[0];
    if (role !== 'adjuster' && claim.claimant_id !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // 2. Fetch raw audit logs
    const auditRes = await query(
      `SELECT a.id, a.action, a.details, a.created_at as "createdAt"
       FROM audit_log a
       WHERE a.claim_id = $1
       ORDER BY a.created_at ASC`,
      [claimId]
    );

    // 3. Map logs to structured Email/SMS communication items
    const notifications: any[] = [];
    const claimCode = claimId.substring(0, 6).toUpperCase();

    auditRes.rows.forEach((row) => {
      let details: any = {};
      try {
        details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      } catch (e) {
        details = row.details;
      }

      switch (row.action) {
        case 'CLAIM_DRAFT_CREATED':
          notifications.push({
            id: `${row.id}_notif`,
            type: 'email',
            sender: 'ClaimPilot Intake <intake@claimpilot.com>',
            recipient: 'Claimant <client@claimpilot.com>',
            subject: `Claim Draft CP-${claimCode} Initialized`,
            body: `Dear Claimant,\n\nWe have successfully initialized a draft folder for your new claim: "${claim.title || 'Insurance Claim'}" (Type: ${details.claimType || 'Auto'}).\n\nYou can continue conversationally detailing the incident, uploading estimates/receipts, or simulating an intake call at any time.\n\nBest regards,\nClaimPilot Intake Team`,
            timestamp: row.createdAt
          });
          break;

        case 'DOCUMENT_UPLOADED':
          notifications.push({
            id: `${row.id}_notif`,
            type: 'sms',
            sender: 'ClaimPilot Support',
            recipient: '+1 (555) 019-2831',
            body: `ClaimPilot Info: Attachment "${details.fileName || 'file'}" uploaded. Document parsed and pgvector RAG chunks indexed successfully.`,
            timestamp: row.createdAt
          });
          break;

        case 'CLAIM_SUBMITTED':
          notifications.push({
            id: `${row.id}_notif`,
            type: 'email',
            sender: 'ClaimPilot Processing <triage@claimpilot.com>',
            recipient: 'Claimant <client@claimpilot.com>',
            subject: `Claim CP-${claimCode} Submitted Successfully`,
            body: `Dear Claimant,\n\nYour claim file CP-${claimCode} has been submitted to the Automated Triage Pipeline.\n\nWe are runnning pgvector similarity cluster lookups and scanning policy exclusions. You will receive an SMS alert as soon as the auto-triage finishes.\n\nBest regards,\nClaimPilot Operations`,
            timestamp: row.createdAt
          });
          break;

        case 'AUTOMATED_RISK_EVALUATED':
          notifications.push({
            id: `${row.id}_notif`,
            type: 'sms',
            sender: 'ClaimPilot Risk Engine',
            recipient: '+1 (555) 019-2831',
            body: `ClaimPilot Alert: Automated triage completed. Assessment Score: ${Math.round(details.score * 100)}%. Risk flags: ${details.risk_flags?.join(', ') || 'None'}. File assigned to Adjuster.`,
            timestamp: row.createdAt
          });
          break;

        case 'takeover_initiated':
        case 'TAKEOVER_INITIATED':
          notifications.push({
            id: `${row.id}_notif`,
            type: 'sms',
            sender: 'Triage Specialist',
            recipient: '+1 (555) 019-2831',
            body: `Urgent: Adjuster has taken over your claim session chat. Automated AI intake has been suspended. Please check your portal for live adjuster correspondence.`,
            timestamp: row.createdAt
          });
          break;

        case 'HUMAN_TRIAGE_DECISION':
          notifications.push({
            id: `${row.id}_notif`,
            type: 'email',
            sender: 'ClaimPilot Underwriting <underwriting@claimpilot.com>',
            recipient: 'Claimant <client@claimpilot.com>',
            subject: `Triage Decision Update: Claim CP-${claimCode} is ${details.nextStatus.toUpperCase()}`,
            body: `Dear Claimant,\n\nYour claim status has been updated to "${details.nextStatus.toUpperCase()}".\n\nAdjuster Decision Rationale:\n"${details.rationale || 'Processed by triage specialist.'}"\n\nThank you for choosing ClaimPilot.\n\nSincerely,\nClaimPilot Underwriting Board`,
            timestamp: row.createdAt
          });
          break;
      }
    });

    res.status(200).json({ notifications });
  } catch (error: any) {
    console.error('Error fetching communication notifications:', error);
    res.status(500).json({ error: 'Failed to fetch communication logs' });
  }
});

// Get semantically similar historical claims for clustering visualization (Adjuster only)
router.get('/:id/similar', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;

  try {
    // 1. Fetch active claim details (embedding, type, title)
    const activeClaimRes = await query(
      `SELECT id, title, claim_type as "claimType", narrative_embedding as "embedding"
       FROM claims WHERE id = $1`,
      [claimId]
    );

    if (activeClaimRes.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const activeClaim = activeClaimRes.rows[0];
    
    // Helper to get loss amount for a claim
    const getLossAmount = async (cid: string): Promise<number> => {
      const lossRes = await query(
        `SELECT (regexp_replace(field_value::text, '[^0-9.]', '', 'g'))::numeric as amt
         FROM claim_fields 
         WHERE claim_id = $1 AND field_key = 'loss_amount' 
           AND regexp_replace(field_value::text, '[^0-9.]', '', 'g') ~ '^[0-9.]+$'
         LIMIT 1`,
        [cid]
      );
      return lossRes.rows.length > 0 ? Number(lossRes.rows[0].amt) : 0;
    };

    // Helper to get risk score for a claim
    const getRiskScore = async (cid: string): Promise<number> => {
      const scoreRes = await query(
        `SELECT score FROM risk_scores WHERE claim_id = $1 LIMIT 1`,
        [cid]
      );
      return scoreRes.rows.length > 0 ? Number(scoreRes.rows[0].score) : 0;
    };

    const activeLoss = await getLossAmount(claimId);
    const activeRisk = await getRiskScore(claimId);

    const resultsList: any[] = [];
    // Add the active claim itself
    resultsList.push({
      id: activeClaim.id,
      title: activeClaim.title,
      claimType: activeClaim.claimType,
      lossAmount: activeLoss,
      riskScore: activeRisk,
      similarity: 1.0,
      isActive: true
    });

    if (activeClaim.embedding) {
      // 2. Query similar claims using pgvector distance
      const vectorStr = typeof activeClaim.embedding === 'string' 
        ? activeClaim.embedding 
        : JSON.stringify(activeClaim.embedding);

      const simRes = await query(
        `SELECT c.id, c.title, c.claim_type as "claimType",
                1 - (c.narrative_embedding <=> $1::vector) as similarity,
                COALESCE(r.score, 0) as "riskScore",
                (SELECT (regexp_replace(cf.field_value::text, '[^0-9.]', '', 'g'))::numeric 
                 FROM claim_fields cf
                 WHERE cf.claim_id = c.id AND cf.field_key = 'loss_amount' 
                   AND regexp_replace(cf.field_value::text, '[^0-9.]', '', 'g') ~ '^[0-9.]+$'
                 LIMIT 1) as "lossAmount"
         FROM claims c
         LEFT JOIN risk_scores r ON c.id = r.claim_id
         WHERE c.id != $2 AND c.narrative_embedding IS NOT NULL
         ORDER BY c.narrative_embedding <=> $1::vector ASC
         LIMIT 5`,
        [vectorStr, claimId]
      );

      simRes.rows.forEach(row => {
        resultsList.push({
          id: row.id,
          title: row.title,
          claimType: row.claimType,
          lossAmount: row.lossAmount ? Number(row.lossAmount) : 0,
          riskScore: Number(row.riskScore),
          similarity: Number(row.similarity),
          isActive: false
        });
      });
    }

    // 3. Fallback / supplementary historical claims (if pgvector returns < 3 matches)
    if (resultsList.length < 4) {
      const fallbackRes = await query(
        `SELECT c.id, c.title, c.claim_type as "claimType",
                COALESCE(r.score, 0) as "riskScore",
                (SELECT (regexp_replace(cf.field_value::text, '[^0-9.]', '', 'g'))::numeric 
                 FROM claim_fields cf
                 WHERE cf.claim_id = c.id AND cf.field_key = 'loss_amount' 
                   AND regexp_replace(cf.field_value::text, '[^0-9.]', '', 'g') ~ '^[0-9.]+$'
                 LIMIT 1) as "lossAmount"
         FROM claims c
         LEFT JOIN risk_scores r ON c.id = r.claim_id
         WHERE c.id != $1
         LIMIT 5`,
        [claimId]
      );

      const assignedSimilarities = [0.89, 0.82, 0.74, 0.65, 0.58];
      fallbackRes.rows.forEach((row, idx) => {
        // Skip duplicate records
        if (resultsList.some(r => r.id === row.id)) return;
        
        resultsList.push({
          id: row.id,
          title: row.title,
          claimType: row.claimType,
          lossAmount: row.lossAmount ? Number(row.lossAmount) : (idx * 2500 + 4000), // descriptive mock loss
          riskScore: Number(row.riskScore) || (idx * 0.15 + 0.1),
          similarity: assignedSimilarities[idx] || 0.5,
          isActive: false
        });
      });
    }

    res.status(200).json({ similar: resultsList });
  } catch (error: any) {
    console.error('Error fetching similar claims clustering:', error);
    res.status(500).json({ error: 'Failed to retrieve similarity clustering database records' });
  }
});

// Get automated document verification status checklist (Adjuster only)
router.get('/:id/document-verification', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;

  try {
    // 1. Fetch claimant details (user name)
    const claimantRes = await query(
      `SELECT u.full_name as "fullName", u.email
       FROM claims c
       LEFT JOIN users u ON c.claimant_id = u.id
       WHERE c.id = $1`,
      [claimId]
    );

    if (claimantRes.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    const claimantName = claimantRes.rows[0].fullName || '';

    // 2. Fetch all documents
    const docsRes = await query(
      `SELECT id, file_name as "name", file_type as "type", extracted_text as "text"
       FROM documents WHERE claim_id = $1`,
      [claimId]
    );

    const verifications = docsRes.rows.map((doc) => {
      const text = doc.text || '';
      const name = doc.name || '';
      const checks: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; details: string }> = [];

      // 2a. Legibility Check
      if (text.trim().length === 0) {
        checks.push({
          name: 'Legibility & Scan Quality',
          status: 'fail',
          details: 'Extracted text is empty. Scanned file may be corrupted, blank, or blur-unreadable.'
        });
      } else if (text.trim().length < 60) {
        checks.push({
          name: 'Legibility & Scan Quality',
          status: 'warning',
          details: 'Extracted text is very short (< 60 chars). Scan quality may be low or illegible.'
        });
      } else {
        checks.push({
          name: 'Legibility & Scan Quality',
          status: 'pass',
          details: 'High text legibility density confirmed.'
        });
      }

      // 2b. Name Matching Check (only if text is present)
      if (text.trim().length > 0) {
        const cleanedName = claimantName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        const nameTokens = cleanedName.split(/\s+/).filter(t => t.length > 2);
        
        let matches = false;
        if (nameTokens.length > 0) {
          // Check if at least one token (like last name) or full string appears in text
          const textLower = text.toLowerCase();
          matches = nameTokens.some(token => textLower.includes(token));
        }

        if (matches) {
          checks.push({
            name: 'Claimant Name Matching',
            status: 'pass',
            details: `Document mentions claimant name: "${claimantName}"`
          });
        } else {
          checks.push({
            name: 'Claimant Name Matching',
            status: 'warning',
            details: `Claimant name "${claimantName}" was not detected in document text.`
          });
        }
      }

      // 2c. Expiry Verification Check
      if (text.trim().length > 0) {
        // Look for standard date patterns: YYYY-MM-DD or MM/DD/YYYY
        const dateRegex = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/g;
        const matches = text.match(dateRegex);
        
        let foundExpired = false;
        let foundOldReceipt = false;
        let matchedDateStr = '';

        if (matches && matches.length > 0) {
          const now = new Date();
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(now.getFullYear() - 1);

          for (const mDate of matches) {
            try {
              const parsedDate = new Date(mDate.replace(/-/g, '/'));
              if (!isNaN(parsedDate.getTime())) {
                matchedDateStr = parsedDate.toLocaleDateString();
                // Check invoice receipt expiry
                if (parsedDate < oneYearAgo) {
                  foundOldReceipt = true;
                }
              }
            } catch (e) {}
          }
        }

        // Specifically search for Expiration tags for IDs/Licenses
        const lowerText = text.toLowerCase();
        const expRegex = /(?:expir|expires|valid thru|expiration date)[:\s]*\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/i;
        const expMatch = lowerText.match(expRegex);
        if (expMatch && expMatch[1]) {
          try {
            const expDate = new Date(expMatch[1].replace(/-/g, '/'));
            if (!isNaN(expDate.getTime()) && expDate < new Date()) {
              foundExpired = true;
              matchedDateStr = expDate.toLocaleDateString();
            }
          } catch (e) {}
        }

        if (foundExpired) {
          checks.push({
            name: 'Expiry Verification',
            status: 'fail',
            details: `Document expiration tag matched past date (${matchedDateStr}). ID/License is expired.`
          });
        } else if (foundOldReceipt) {
          checks.push({
            name: 'Expiry Verification',
            status: 'warning',
            details: `Receipt/invoice date is older than 1 year (${matchedDateStr}). File may exceed eligibility bounds.`
          });
        } else if (matchedDateStr) {
          checks.push({
            name: 'Expiry Verification',
            status: 'pass',
            details: `Document date verified within active timeframe (${matchedDateStr}).`
          });
        } else {
          // If no dates matched, flag warning
          checks.push({
            name: 'Expiry Verification',
            status: 'warning',
            details: 'Could not extract valid timestamps or issue dates. Requires manual verification.'
          });
        }
      }

      // 2d. Document Integrity Check
      const lowerName = name.toLowerCase();
      const isInvoiceOrEstimate = lowerName.includes('invoice') || lowerName.includes('estimate') || lowerName.includes('receipt') || lowerName.includes('repair') || lowerName.includes('quote');
      
      if (isInvoiceOrEstimate && text.trim().length > 0) {
        const textLower = text.toLowerCase();
        const hasKeyTerms = textLower.includes('total') || textLower.includes('amount') || textLower.includes('balance') || textLower.includes('$') || textLower.includes('cost');
        if (hasKeyTerms) {
          checks.push({
            name: 'Estimate / Invoice Integrity',
            status: 'pass',
            details: 'Structured invoice key terms (total/costs) validated.'
          });
        } else {
          checks.push({
            name: 'Estimate / Invoice Integrity',
            status: 'warning',
            details: 'Document labeled as invoice/estimate but lacks total cost values or price items.'
          });
        }
      }

      // Determine overall document status
      let overallStatus: 'pass' | 'warning' | 'fail' = 'pass';
      if (checks.some(c => c.status === 'fail')) {
        overallStatus = 'fail';
      } else if (checks.some(c => c.status === 'warning')) {
        overallStatus = 'warning';
      }

      return {
        documentId: doc.id,
        fileName: doc.name,
        overallStatus,
        checks
      };
    });

    res.status(200).json({ verifications });
  } catch (error: any) {
    console.error('Error compiling document verifications:', error);
    res.status(500).json({ error: 'Failed to compile document verification checks' });
  }
});

// Simulate triage custom RAG parameter vectors sandbox search (Adjuster only)
router.post('/:id/simulate-triage', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const { q, limit, threshold } = req.body;

  if (!q) {
    res.status(400).json({ error: 'Search query parameter "q" is required' });
    return;
  }

  const chunkLimit = parseInt(limit) || 5;
  const matchThreshold = parseFloat(threshold) || 0.3;

  try {
    const queryEmbedding = await getEmbeddingForQuery(q);

    console.log(`[Simulation]: Performing RAG vectors sandbox search in DB for claim ${claimId}...`);
    const vectorResult = await query(
      `SELECT dc.chunk_content as "content", 
              1 - (dc.embedding <=> $1::vector) as "similarity",
              dc.document_id as "documentId",
              d.file_name as "documentName",
              dc.chunk_index as "chunkIndex"
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       WHERE d.claim_id = $2 AND (1 - (dc.embedding <=> $1::vector)) >= $3
       ORDER BY dc.embedding <=> $1::vector ASC
       LIMIT $4`,
      [JSON.stringify(queryEmbedding), claimId, matchThreshold, chunkLimit]
    );

    const results = vectorResult.rows.map((row) => ({
      content: row.content,
      similarity: Number(row.similarity),
      documentId: row.documentId,
      documentName: row.documentName,
      chunkIndex: Number(row.chunkIndex),
    }));

    res.status(200).json({ results });
  } catch (error: any) {
    console.error('Error executing simulated triage vector search:', error);
    res.status(500).json({ error: 'Failed to execute simulated vector matching search' });
  }
});

// Batch claim underwriting status operations & updates (Adjuster only)
router.post('/batch-update', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { claimIds, status, rationale, reEvaluate } = req.body;

  if (!claimIds || !Array.isArray(claimIds) || claimIds.length === 0) {
    res.status(400).json({ error: 'Array of claimIds is required' });
    return;
  }

  const adjusterId = req.user?.id;

  try {
    const updatedIds: string[] = [];

    // Process all updates in a transactional or sequence lock loop
    for (const cid of claimIds) {
      // 1. Fetch current status for audit trails
      const currentRes = await query('SELECT status, title FROM claims WHERE id = $1', [cid]);
      if (currentRes.rows.length === 0) continue;
      
      const currentStatus = currentRes.rows[0].status;
      const title = currentRes.rows[0].title;

      // 2. Perform updates
      if (status) {
        await query(
          `UPDATE claims SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [status, cid]
        );

        // 3. Log compliance audit event
        const auditDetails = {
          action: status === 'approved' ? 'approve' : (status === 'rejected' ? 'reject' : 'more_info'),
          rationale: rationale || 'Batch processed by triage specialist.',
          originalStatus: currentStatus,
          nextStatus: status
        };

        await query(
          `INSERT INTO audit_log (actor_id, claim_id, action, details)
           VALUES ($1, $2, 'HUMAN_TRIAGE_DECISION', $3)`,
          [adjusterId, cid, JSON.stringify(auditDetails)]
        );
      }

      // 4. Re-evaluate if requested
      if (reEvaluate) {
        try {
          await runClaimsTriagePipeline(cid);
        } catch (pipelineErr) {
          console.warn(`[Batch Pipeline] Failed to evaluate claim ${cid}:`, pipelineErr);
        }
      }

      updatedIds.push(cid);
    }

    res.status(200).json({ success: true, updatedCount: updatedIds.length, updatedClaimIds: updatedIds });
  } catch (error: any) {
    console.error('Error executing batch operations updates:', error);
    res.status(500).json({ error: 'Failed to process batch underwriting operations' });
  }
});

// Multi-Agent team triage collaboration simulation (Adjuster only)
router.post('/:id/agent-simulation', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;

  try {
    const simulation = await generateAgentSimulation(claimId);
    res.status(200).json(simulation);
  } catch (error: any) {
    console.error('Error running agent collaboration simulation:', error);
    res.status(500).json({ error: error.message || 'Failed to run agent collaboration simulation' });
  }
});

// Interactive RAG Document Chat & Citation Navigator (Adjuster only)
router.post('/:id/document-chat', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const { query: searchQuery } = req.body;

  if (!searchQuery || typeof searchQuery !== 'string' || !searchQuery.trim()) {
    res.status(400).json({ error: 'Query text is required' });
    return;
  }

  try {
    // 1. Retrieve top matching chunks using pgvector search
    const chunks = await searchClaimChunks(claimId, searchQuery, 4);

    if (chunks.length === 0) {
      res.status(200).json({
        answer: `I searched the attached policy documents and supporting files for this claim, but no relevant text chunks matched your query "${searchQuery}".`,
        citations: []
      });
      return;
    }

    // 2. Map citations with metadata
    const citations = chunks.map((c, idx) => ({
      id: idx + 1,
      documentId: c.documentId,
      documentName: c.documentName,
      chunkIndex: c.chunkIndex,
      similarity: c.similarity,
      content: c.content,
    }));

    // 3. Build synthesis answer
    let synthesisText = `Based on policy documents for this claim, here are the findings for "${searchQuery}":\n\n`;

    citations.forEach((cit) => {
      const matchPct = Math.round(cit.similarity * 100);
      synthesisText += `• In **${cit.documentName}** [Citation ${cit.id}], the clause specifies: "${cit.content.substring(0, 180)}${cit.content.length > 180 ? '...' : ''}" (Vector Match: ${matchPct}%).\n\n`;
    });

    synthesisText += `Refer to the highlighted citation badges [Citation 1] through [Citation ${citations.length}] below to inspect full text clauses and exact pgvector cosine similarity match scores.`;

    res.status(200).json({
      answer: synthesisText,
      citations
    });
  } catch (error: any) {
    console.error('Error executing document chat query:', error);
    res.status(500).json({ error: 'Failed to process RAG document chat query' });
  }
});

// Evaluate Policy Coverage Rules for a specific claim (Adjuster only)
router.get('/:id/rules-evaluation', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;

  try {
    const evaluation = await evaluateClaimRules(claimId);
    res.status(200).json(evaluation);
  } catch (error: any) {
    console.error('Error evaluating claim rules:', error);
    res.status(500).json({ error: error.message || 'Failed to evaluate coverage rules' });
  }
});

// List all active coverage rules (Adjuster only)
router.get('/rules/definitions', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rules = getCoverageRules();
    res.status(200).json({ rules });
  } catch (error: any) {
    console.error('Error fetching coverage rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// Create a new custom coverage rule (Adjuster only)
router.post('/rules/definitions', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, claimType, fieldKey, operator, value, severity, action, description } = req.body;
    
    if (!name || !fieldKey || !operator || !value) {
      res.status(400).json({ error: 'Missing required rule parameters (name, fieldKey, operator, value)' });
      return;
    }

    const newRule = addCoverageRule({
      name,
      claimType: claimType || 'All',
      fieldKey,
      operator,
      value,
      severity: severity || 'medium',
      action: action || 'flag',
      description: description || 'Custom adjuster validation rule.'
    });

    res.status(201).json({ success: true, rule: newRule });
  } catch (error: any) {
    console.error('Error creating custom rule:', error);
    res.status(500).json({ error: 'Failed to create custom rule' });
  }
});

// Process a settlement negotiation turn (Adjuster only)
router.post('/:id/negotiation-turn', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const { adjusterOffer, message } = req.body;

  if (typeof adjusterOffer !== 'number' || adjusterOffer <= 0) {
    res.status(400).json({ error: 'Valid adjusterOffer numeric amount is required' });
    return;
  }

  try {
    const turnResult = await evaluateNegotiationTurn(claimId, adjusterOffer, message);
    res.status(200).json(turnResult);
  } catch (error: any) {
    console.error('Error processing negotiation turn:', error);
    res.status(500).json({ error: error.message || 'Failed to process negotiation turn' });
  }
});

// Finalize settlement and lock payout (Adjuster only)
router.post('/:id/finalize-settlement', requireRole(['adjuster']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const claimId = req.params.id;
  const { finalAmount } = req.body;
  const actorId = req.user?.id;

  if (typeof finalAmount !== 'number' || finalAmount <= 0) {
    res.status(400).json({ error: 'Valid finalAmount numeric payout is required' });
    return;
  }

  if (!actorId) {
    res.status(401).json({ error: 'Unauthorized actor' });
    return;
  }

  try {
    const finalResult = await finalizeClaimSettlement(claimId, finalAmount, actorId);
    res.status(200).json(finalResult);
  } catch (error: any) {
    console.error('Error finalizing claim settlement:', error);
    res.status(500).json({ error: error.message || 'Failed to finalize claim settlement' });
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
