import { query } from '../config/db.js';

export interface NegotiationTurnResult {
  claimId: string;
  claimantName: string;
  originalLossAmount: number;
  policyCapAmount: number;
  adjusterOffer: number;
  claimantCounterOffer: number;
  sentiment: 'Agreed on Settlement' | 'Open to Compromise' | 'Firm on Estimate' | 'Resistant';
  agreementReached: boolean;
  claimantResponse: string;
}

export async function evaluateNegotiationTurn(
  claimId: string,
  adjusterOffer: number,
  adjusterMessage?: string
): Promise<NegotiationTurnResult> {
  // 1. Ingest Claim details
  const claimRes = await query(
    `SELECT c.id, c.title, c.status, c.claim_type as "claimType",
            u.full_name as "claimantName",
            COALESCE(r.score, 0) as "riskScore"
     FROM claims c
     LEFT JOIN users u ON c.claimant_id = u.id
     LEFT JOIN risk_scores r ON c.id = r.claim_id
     WHERE c.id = $1`,
    [claimId]
  );

  if (claimRes.rows.length === 0) {
    throw new Error(`Claim ${claimId} not found`);
  }

  const claim = claimRes.rows[0];
  const claimantName = claim.claimantName || 'Claimant';

  // Ingest fields
  const fieldsRes = await query(
    `SELECT field_key as "key", field_value as "value" 
     FROM claim_fields WHERE claim_id = $1`,
    [claimId]
  );

  const fields: Record<string, any> = {};
  fieldsRes.rows.forEach(row => {
    fields[row.key] = row.value;
  });

  const originalLossAmount = fields.loss_amount ? parseFloat(fields.loss_amount.toString().replace(/[^0-9.]/g, '')) || 5000 : 5000;
  const policyCapAmount = Math.round(originalLossAmount * 0.9);

  // 2. Evaluate Claimant Reaction Ratio
  const ratio = originalLossAmount > 0 ? adjusterOffer / originalLossAmount : 1.0;

  let sentiment: 'Agreed on Settlement' | 'Open to Compromise' | 'Firm on Estimate' | 'Resistant' = 'Open to Compromise';
  let claimantCounterOffer = originalLossAmount;
  let agreementReached = false;
  let claimantResponse = '';

  if (ratio >= 0.90) {
    sentiment = 'Agreed on Settlement';
    claimantCounterOffer = adjusterOffer;
    agreementReached = true;
    claimantResponse = `Thank you. An offer of $${adjusterOffer.toLocaleString()} is fair and aligns with my repair estimates. I accept this settlement proposal!`;
  } else if (ratio >= 0.70) {
    sentiment = 'Open to Compromise';
    claimantCounterOffer = Math.round(originalLossAmount - ((originalLossAmount - adjusterOffer) * 0.45));
    agreementReached = false;
    claimantResponse = `I appreciate your offer of $${adjusterOffer.toLocaleString()}. However, my itemized repair receipts total $${originalLossAmount.toLocaleString()}. I am willing to compromise at $${claimantCounterOffer.toLocaleString()} to finalize this claim immediately.`;
  } else if (ratio >= 0.50) {
    sentiment = 'Firm on Estimate';
    claimantCounterOffer = Math.round(originalLossAmount - ((originalLossAmount - adjusterOffer) * 0.20));
    agreementReached = false;
    claimantResponse = `An offer of $${adjusterOffer.toLocaleString()} is significantly lower than my actual documented expenses ($${originalLossAmount.toLocaleString()}). The lowest settlement I can accept is $${claimantCounterOffer.toLocaleString()}.`;
  } else {
    sentiment = 'Resistant';
    claimantCounterOffer = originalLossAmount;
    agreementReached = false;
    claimantResponse = `Offer of $${adjusterOffer.toLocaleString()} is unacceptable. It covers less than half of my $${originalLossAmount.toLocaleString()} claim. Please re-evaluate based on attached contractor estimates.`;
  }

  return {
    claimId,
    claimantName,
    originalLossAmount,
    policyCapAmount,
    adjusterOffer,
    claimantCounterOffer,
    sentiment,
    agreementReached,
    claimantResponse
  };
}

export async function finalizeClaimSettlement(
  claimId: string,
  finalAmount: number,
  actorId: string
): Promise<{ success: boolean; status: string; finalAmount: number }> {
  // Update claim status to approved
  await query(
    `UPDATE claims SET status = 'approved', updated_at = NOW() WHERE id = $1`,
    [claimId]
  );

  // Store final approved payout amount in claim_fields
  await query(
    `INSERT INTO claim_fields (claim_id, field_key, field_value)
     VALUES ($1, 'approved_payout_amount', $2)
     ON CONFLICT (claim_id, field_key) 
     DO UPDATE SET field_value = EXCLUDED.field_value`,
    [claimId, finalAmount.toString()]
  );

  // Record audit log entry
  await query(
    `INSERT INTO audit_log (claim_id, actor_id, action, details)
     VALUES ($1, $2, 'SETTLEMENT_FINALIZED', $3)`,
    [claimId, actorId, JSON.stringify({ finalPayoutAmount: finalAmount })]
  );

  return {
    success: true,
    status: 'approved',
    finalAmount
  };
}
