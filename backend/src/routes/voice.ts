import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';

const router = Router();

// Re-use the same Zod schema for validating voice extraction
const claimFieldsSchema = z.object({
  claim_type: z.enum(['Auto', 'Property', 'Health', 'General Liability']).optional(),
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  loss_amount: z.number().nonnegative().optional(),
  incident_description: z.string().optional(),
  parties_involved: z.array(z.string()).optional(),
  policy_number: z.string().optional(),
});

/**
 * Webhook for Voice Intake tool calls (Vapi or Retell).
 * Configured in Vapi/Retell as: http://<server>/api/voice/webhook/<claim_id>
 */
router.post('/webhook/:claimId', async (req: Request, res: Response): Promise<void> => {
  const claimId = req.params.claimId;
  const payload = req.body;

  console.log(`[Voice Webhook]: Received webhook for claim ${claimId}:`, JSON.stringify(payload, null, 2));

  try {
    // 1. Verify claim exists
    const claimCheck = await query('SELECT status FROM claims WHERE id = $1', [claimId]);
    if (claimCheck.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }

    // 2. Parse tool call name and arguments (support both Vapi and Retell formats)
    let toolName = '';
    let toolArgs: any = {};

    // Vapi payload parsing
    if (payload.message && payload.message.type === 'tool-calls') {
      const toolCall = payload.message.toolCalls?.[0];
      if (toolCall) {
        toolName = toolCall.function?.name || '';
        const rawArgs = toolCall.function?.arguments;
        toolArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      }
    } 
    // Retell payload parsing
    else if (payload.type === 'tool_call' || payload.name) {
      toolName = payload.name || '';
      toolArgs = payload.arguments || {};
    }
    // General direct tool call payload fallback
    else {
      toolName = payload.toolName || payload.function?.name || '';
      toolArgs = payload.arguments || payload.function?.arguments || payload;
    }

    if (toolName !== 'update_claim_fields') {
      console.warn(`[Voice Webhook]: Ignored unknown tool call: ${toolName}`);
      res.status(200).json({ success: true, message: `Tool ${toolName} ignored.` });
      return;
    }

    // 3. Zod validation
    const parseResult = claimFieldsSchema.safeParse(toolArgs);
    if (!parseResult.success) {
      console.error('[Voice Webhook] Validation failed:', parseResult.error.format());
      res.status(400).json({ error: 'Invalid field extraction format' });
      return;
    }

    const validatedFields = parseResult.data;

    // 4. Save validated fields to DB
    const keys = Object.keys(validatedFields) as Array<keyof typeof validatedFields>;
    for (const key of keys) {
      const value = validatedFields[key];
      if (value !== undefined) {
        await query(
          `INSERT INTO claim_fields (claim_id, field_key, field_value, confidence) 
           VALUES ($1, $2, $3, $4) 
           ON CONFLICT (claim_id, field_key) 
           DO UPDATE SET field_value = EXCLUDED.field_value, confidence = EXCLUDED.confidence`,
          [claimId, key, JSON.stringify(value), 0.9] // Set slightly lower confidence for voice than chat
        );
      }
    }

    // Log update to audit log (SOC 2 compliance)
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES (NULL, $1, 'VOICE_INTAKE_FIELDS_EXTRACTED', $2)`,
      [claimId, JSON.stringify(validatedFields)]
    );

    console.log(`[Voice Webhook]: Successfully updated fields for claim ${claimId}`);

    // 5. Return response format expected by voice platforms
    // Vapi expects: { results: [...] } or direct result object
    // Retell expects: { success: true } or direct return
    res.status(200).json({
      success: true,
      results: [
        {
          toolCallId: payload.message?.toolCalls?.[0]?.id || payload.tool_call_id || 'voice_call',
          result: 'Fields updated successfully in ClaimPilot database.'
        }
      ],
      message: 'Claim fields updated.'
    });
  } catch (error: any) {
    console.error('[Voice Webhook] Critical error:', error);
    res.status(500).json({ error: 'Failed to process voice webhook' });
  }
});

export default router;
