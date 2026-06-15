import { query } from '../config/db.js';
import { anthropic } from './claude.js';
import { retrieveRelevantContext } from './rag.js';

const PARSER_SERVICE_URL = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';

interface TriageResult {
  score: number;
  risk_flags: string[];
  rationale: string;
}

/**
 * Executes the full automated claims triage pipeline:
 * 1. Narrative embedding extraction.
 * 2. pgvector historical claim similarity check.
 * 3. pgvector RAG document clause retrieval.
 * 4. LLM-based risk reasoning and flags.
 * 5. Update claim state and save risk scores.
 */
export async function runClaimsTriagePipeline(claimId: string): Promise<void> {
  console.log(`[Pipeline]: Starting background triage for claim ${claimId}`);

  try {
    // 1. Fetch claim details and extracted fields
    const claimRes = await query('SELECT title, claim_type FROM claims WHERE id = $1', [claimId]);
    if (claimRes.rows.length === 0) {
      throw new Error(`Claim ${claimId} not found`);
    }
    const claim = claimRes.rows[0];

    const fieldsRes = await query(
      "SELECT field_key, field_value FROM claim_fields WHERE claim_id = $1",
      [claimId]
    );

    const claimDetails: Record<string, any> = {};
    fieldsRes.rows.forEach((row) => {
      claimDetails[row.field_key] = row.field_value;
    });

    const narrative = claimDetails.incident_description || claim.title;
    const lossAmount = claimDetails.loss_amount || 0;

    // 2. Generate embedding for the narrative via Python service
    console.log('[Pipeline]: Generating narrative embedding...');
    let narrativeEmbedding: number[] | null = null;
    try {
      const embedResponse = await fetch(`${PARSER_SERVICE_URL}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: narrative }),
      });

      if (embedResponse.ok) {
        const embedData = (await embedResponse.json()) as {
          chunks: Array<{ embedding: number[] }>;
        };
        if (embedData.chunks && embedData.chunks.length > 0) {
          narrativeEmbedding = embedData.chunks[0].embedding;
          
          // Save embedding to claims table
          await query(
            'UPDATE claims SET narrative_embedding = $1::vector WHERE id = $2',
            [JSON.stringify(narrativeEmbedding), claimId]
          );
          console.log('[Pipeline]: Narrative embedding saved.');
        }
      }
    } catch (err) {
      console.error('[Pipeline] Warning: Could not generate narrative embedding:', err);
    }

    // 3. Perform pgvector similarity search against other claims
    let similarClaims: Array<{ id: string; title: string; similarity: number }> = [];
    if (narrativeEmbedding) {
      console.log('[Pipeline]: Searching for similar claims in database...');
      const similarityRes = await query(
        `SELECT id, title, 1 - (narrative_embedding <=> $1::vector) as similarity
         FROM claims
         WHERE id != $2 AND narrative_embedding IS NOT NULL
         ORDER BY narrative_embedding <=> $1::vector ASC
         LIMIT 3`,
        [JSON.stringify(narrativeEmbedding), claimId]
      );
      similarClaims = similarityRes.rows.map((row) => ({
        id: row.id,
        title: row.title,
        similarity: Number(row.similarity),
      }));
      console.log(`[Pipeline]: Found ${similarClaims.length} similar claims.`);
    }

    // 4. Retrieve matching policy clauses via RAG
    console.log('[Pipeline]: Retrieving policy context via RAG...');
    const retrievedContext = await retrieveRelevantContext(claimId, narrative, 3);
    const contextContent = retrievedContext.map((c) => c.content).join('\n---\n');
    console.log(`[Pipeline]: Retrieved RAG context size: ${contextContent.length} chars.`);

    // 5. Run LLM Risk Assessment Reasoning
    let triageData: TriageResult;

    if (anthropic) {
      console.log('[Pipeline]: Prompting Claude for risk scoring...');
      const prompt = `
You are the ClaimPilot Risk Assessment and Triage Engine. Your goal is to evaluate a submitted insurance claim for potential fraud, complexity, and risk, outputting a structured evaluation.

CLAIM DETAILS:
- Type: ${claim.claim_type}
- Title: ${claim.title}
- Extracted Fields: ${JSON.stringify(claimDetails)}
- Loss Amount: $${lossAmount}

SIMILAR CASES FOUND:
${JSON.stringify(similarClaims, null, 2)}

RETRIEVED POLICY DETAILS (RAG):
${contextContent || 'No policy context found.'}

INSTRUCTIONS:
1. Score the claim from 0.0 (no risk, auto-approvable) to 1.0 (extremely high risk, potential fraud).
2. Generate risk flags (e.g., HIGH_LOSS_AMOUNT, RECENT_POLICY, MATCHING_HISTORICAL_CASE).
3. Provide a clear, detailed rationale explaining your decision.
4. Output your response STRICTLY as a JSON object of this structure:
{
  "score": 0.45,
  "risk_flags": ["HIGH_AMOUNT"],
  "rationale": "Description of details..."
}
Do not output any markdown code blocks or surrounding text. Output only the raw JSON.
`;

      try {
        const response = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        });

        const textContent = response.content[0].type === 'text' ? response.content[0].text : '';
        triageData = JSON.parse(textContent) as TriageResult;
      } catch (err) {
        console.error('[Pipeline] Claude risk assessment failed, running fallback:', err);
        triageData = generateDeterministicTriage(lossAmount, similarClaims);
      }
    } else {
      console.log('[Pipeline]: Running local deterministic triage fallback...');
      triageData = generateDeterministicTriage(lossAmount, similarClaims);
    }

    // 6. Save results to database
    const similarClaimIds = similarClaims.map((c) => c.id);
    await query(
      `INSERT INTO risk_scores (claim_id, score, risk_flags, rationale, similar_claim_ids) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (claim_id) 
       DO UPDATE SET score = EXCLUDED.score, risk_flags = EXCLUDED.risk_flags, 
                     rationale = EXCLUDED.rationale, similar_claim_ids = EXCLUDED.similar_claim_ids`,
      [claimId, triageData.score, triageData.risk_flags, triageData.rationale, similarClaimIds]
    );

    // 7. Update status to 'under_review' (Adjuster will triage)
    await query(
      "UPDATE claims SET status = 'under_review', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [claimId]
    );

    // 8. Log pipeline run to audit logs (SOC 2)
    await query(
      `INSERT INTO audit_log (actor_id, claim_id, action, details) 
       VALUES (NULL, $1, 'AUTOMATED_RISK_EVALUATED', $2)`,
      [claimId, JSON.stringify(triageData)]
    );

    console.log(`[Pipeline]: Finished triage for claim ${claimId}. Score: ${triageData.score}`);
  } catch (error) {
    console.error(`[Pipeline]: Critical error in triage pipeline for claim ${claimId}:`, error);
  }
}

/**
 * Helper to generate a deterministic mock risk score for testing/fallback.
 */
function generateDeterministicTriage(
  lossAmount: number,
  similarClaims: Array<{ similarity: number }>
): TriageResult {
  const flags: string[] = [];
  let score = 0.1; // base score

  if (lossAmount > 10000) {
    score += 0.4;
    flags.push('HIGH_LOSS_AMOUNT');
  } else if (lossAmount > 2500) {
    score += 0.2;
    flags.push('MEDIUM_LOSS_AMOUNT');
  }

  // Check if any past claim is highly similar
  const duplicates = similarClaims.filter((c) => c.similarity > 0.85);
  if (duplicates.length > 0) {
    score += 0.4;
    flags.push('POTENTIAL_DUPLICATE_CLAIM');
  }

  // Cap score at 1.0
  score = Math.min(score, 1.0);

  const rationale = flags.length > 0
    ? `Fallback Risk Scoring: Flagged due to: ${flags.join(', ')}.`
    : 'Fallback Risk Scoring: Claim falls within standard thresholds. Low risk profile.';

  return {
    score,
    risk_flags: flags,
    rationale,
  };
}
