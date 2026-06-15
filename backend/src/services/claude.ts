import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.ANTHROPIC_API_KEY;

// Initialize Anthropic client if key is available
export const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

if (!anthropic) {
  console.warn(
    '\x1b[33m%s\x1b[0m',
    '[Claude Service] WARNING: ANTHROPIC_API_KEY is not defined. The service will run in SIMULATED MOCK mode.'
  );
}

// Structured fields schema definition
export interface ExtractedClaimFields {
  claim_type?: 'Auto' | 'Property' | 'Health' | 'General Liability';
  incident_date?: string;
  loss_amount?: number;
  incident_description?: string;
  parties_involved?: string[];
  policy_number?: string;
}

// System instructions for ClaimPilot Intake Agent
export const INTAKE_SYSTEM_PROMPT = `
You are the ClaimPilot AI Insurance Claim Intake Assistant. Your goal is to guide the claimant through a conversational intake process to collect information required to register their insurance claim.

The fields we need to extract are:
1. claim_type: Must be one of 'Auto', 'Property', 'Health', or 'General Liability'.
2. incident_date: The date of the incident in YYYY-MM-DD format.
3. loss_amount: Estimated monetary loss amount.
4. incident_description: A description of what happened.
5. parties_involved: Any other parties or individuals involved in the incident (as a list/array).
6. policy_number: The insurance policy number of the claimant.

INSTRUCTIONS:
- Be empathetic, professional, and clear.
- Do NOT provide medical or legal advice. If asked, gently explain that you are an intake assistant and redirect them to standard services.
- Gather information conversationally. Do not ask for all fields at once; ask for them one or two at a time in a natural flow.
- As soon as the user provides any of the required fields, immediately invoke the "update_claim_fields" tool to save them to the database.
- Once all fields are successfully extracted, summarize the claim details and let the claimant know their claim is being submitted for triage and risk assessment.
`;

// Tools definition for Anthropic API
export const INTAKE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_claim_fields',
    description: 'Update one or more extracted claim fields in the database as they are gathered during the conversation.',
    input_schema: {
      type: 'object',
      properties: {
        claim_type: {
          type: 'string',
          enum: ['Auto', 'Property', 'Health', 'General Liability'],
          description: 'Type of insurance claim.'
        },
        incident_date: {
          type: 'string',
          description: 'Date when the incident occurred (YYYY-MM-DD).'
        },
        loss_amount: {
          type: 'number',
          description: 'Estimated financial loss/damage amount in USD.'
        },
        incident_description: {
          type: 'string',
          description: 'Detailed description of the event causing the claim.'
        },
        parties_involved: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of individuals or entities involved in the incident.'
        },
        policy_number: {
          type: 'string',
          description: 'Insurance policy number.'
        }
      }
    }
  }
];

/**
 * Handle streaming conversation with Claude.
 * Fallbacks to Mock Stream if API Key is not set.
 */
export async function streamIntakeConversation(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentFields: ExtractedClaimFields,
  onTextChunk: (text: string) => void,
  onToolCall: (fields: ExtractedClaimFields) => void
): Promise<void> {
  if (!anthropic) {
    // RUN IN SIMULATED MODE
    await simulateMockStream(messages, currentFields, onTextChunk, onToolCall);
    return;
  }

  // Inject claim state in system prompt so Claude knows what is already extracted
  const systemPrompt = `${INTAKE_SYSTEM_PROMPT}\n\nCURRENT EXTRACTED FIELDS STATE:\n${JSON.stringify(
    currentFields,
    null,
    2
  )}`;

  // Convert messages to Anthropic format
  const formattedMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }));

  try {
    const stream = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: formattedMessages,
      tools: INTAKE_TOOLS,
      stream: true
    });

    let toolInputBuffer = '';
    let isToolCalling = false;

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta') {
          onTextChunk(chunk.delta.text);
        } else if (chunk.delta.type === 'input_json_delta') {
          toolInputBuffer += chunk.delta.partial_json;
          isToolCalling = true;
        }
      } else if (chunk.type === 'message_delta') {
        // End of stream checking
      }
    }

    if (isToolCalling && toolInputBuffer) {
      try {
        const parsedFields = JSON.parse(toolInputBuffer) as ExtractedClaimFields;
        onToolCall(parsedFields);
      } catch (err) {
        console.error('Error parsing streaming tool call JSON:', err);
      }
    }
  } catch (error) {
    console.error('Anthropic API streaming error:', error);
    throw error;
  }
}

/**
 * Simulates a Claude stream locally with mock responses.
 * Simulates tool calls to fill fields over the course of the chat.
 */
async function simulateMockStream(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentFields: ExtractedClaimFields,
  onTextChunk: (text: string) => void,
  onToolCall: (fields: ExtractedClaimFields) => void
): Promise<void> {
  let responseText = '';
  const triggeredFields: ExtractedClaimFields = {};

  // Scan all user messages in history to extract fields
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content.toLowerCase();
      
      // Extract Claim Type
      if (text.includes('auto') || text.includes('car') || text.includes('crash') || text.includes('accident')) {
        triggeredFields.claim_type = 'Auto';
      } else if (text.includes('property') || text.includes('house') || text.includes('leak') || text.includes('flood') || text.includes('basement') || text.includes('ruined')) {
        triggeredFields.claim_type = 'Property';
      } else if (text.includes('health') || text.includes('medical') || text.includes('doctor')) {
        triggeredFields.claim_type = 'Health';
      }
      
      // Extract Policy Number
      const policyRegex = /(pol\d+|[a-z]{3}\d{4,})/i;
      const policyMatch = msg.content.match(policyRegex);
      if (policyMatch) {
        triggeredFields.policy_number = policyMatch[0].toUpperCase();
      }
      
      // Extract Incident Date
      const dateRegex = /(\d{4}-\d{2}-\d{2})/;
      const dateMatch = msg.content.match(dateRegex);
      if (dateMatch) {
        triggeredFields.incident_date = dateMatch[0];
      } else {
        if (text.includes('june 13') || text.includes('yesterday')) {
          triggeredFields.incident_date = '2026-06-13';
        } else if (text.includes('june 10')) {
          triggeredFields.incident_date = '2026-06-10';
        }
      }
      
      // Extract Loss Amount
      const cleanText = text.replace(/,/g, '');
      // Match all numbers with 3+ digits and ignore common calendar years (e.g. 2024-2027)
      const amountRegex = /\$?(\d{3,})/g;
      let amountMatch;
      while ((amountMatch = amountRegex.exec(cleanText)) !== null) {
        const num = parseFloat(amountMatch[1]);
        if (num !== 2024 && num !== 2025 && num !== 2026 && num !== 2027) {
          triggeredFields.loss_amount = num;
          break; // take first non-year amount
        }
      }
      
      // Extract Parties Involved
      if (text.includes('dave miller')) {
        triggeredFields.parties_involved = ['Dave Miller'];
      } else if (text.includes('husband') && !triggeredFields.parties_involved) {
        triggeredFields.parties_involved = [];
      }
      
      if (msg.content.length > 20) {
        triggeredFields.incident_description = msg.content;
      }
    }
  }

  // Construct response text conversationally
  const finalType = currentFields.claim_type || triggeredFields.claim_type;
  const finalPolicy = currentFields.policy_number || triggeredFields.policy_number;
  const finalDate = currentFields.incident_date || triggeredFields.incident_date;
  const finalAmount = currentFields.loss_amount || triggeredFields.loss_amount;

  const missing: string[] = [];
  if (!finalType) missing.push('claim type');
  if (!finalPolicy) missing.push('policy number');
  if (!finalDate) missing.push('incident date');
  if (!finalAmount) missing.push('loss amount');

  const lastUserMsg = messages[messages.length - 1]?.content.toLowerCase() || '';
  if (messages.length <= 1 && lastUserMsg.length < 15) {
    responseText = "Hello! I am your ClaimPilot AI assistant. I'm here to help file your insurance claim. To start, could you please provide your policy number and tell me what type of claim this is?";
  } else if (missing.length > 0) {
    responseText = `Thanks for the details. [SIMULATION: Extracted fields: ${JSON.stringify({ ...currentFields, ...triggeredFields })}]. Let's keep going. Could you help me with the following: ${missing.join(', ')}?`;
  } else {
    responseText = `Perfect! I've successfully gathered all the necessary details. I've recorded a ${finalType} claim under policy ${finalPolicy} for an incident on ${finalDate} with a loss of $${finalAmount}. Your claim is now ready to be submitted for triage.`;
  }

  // Determine what new fields are being returned in this turn
  const newFields: ExtractedClaimFields = {};
  const allKeys = Object.keys(triggeredFields) as Array<keyof ExtractedClaimFields>;
  for (const k of allKeys) {
    const newVal = triggeredFields[k];
    const oldVal = currentFields[k];
    
    // Check if value is new or different
    if (newVal !== undefined) {
      if (Array.isArray(newVal)) {
        if (!oldVal || JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
          (newFields as any)[k] = newVal;
        }
      } else if (newVal !== oldVal) {
        (newFields as any)[k] = newVal;
      }
    }
  }

  // Stream response characters
  for (let i = 0; i < responseText.length; i += 5) {
    onTextChunk(responseText.substring(i, i + 5));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // Trigger tool call if there are new fields extracted in this turn
  if (Object.keys(newFields).length > 0) {
    onToolCall(newFields);
  }
}
