from src.schemas import ClaimSubmission, PolicyTerms, AuditResult, FraudEvaluation, PayoutDecision, ClaimStatus, RiskLevel


class PayoutDecisionEngine:
    """Engine calculating deductible deductions, coverage limits, and auto-approval status."""

    def determine_payout(
        self,
        claim: ClaimSubmission,
        policy: PolicyTerms,
        audit: AuditResult,
        fraud: FraudEvaluation,
    ) -> PayoutDecision:
        # 1. Check for immediate denial criteria
        if not audit.policy_active or not audit.peril_covered or audit.exclusion_triggered:
            return PayoutDecision(
                claim_id=claim.claim_id,
                claimant_name=claim.claimant_name,
                status=ClaimStatus.DENIED,
                claimed_amount_usd=claim.claimed_amount_usd,
                deductible_applied_usd=0.0,
                eligible_amount_usd=0.0,
                net_payout_usd=0.0,
                fraud_evaluation=fraud,
                audit_result=audit,
                decision_reason=f"Claim denied due to policy audit findings: {'; '.join(audit.audit_notes)}",
            )

        # 2. Check for Fraud Escalation criteria
        if fraud.risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL]:
            return PayoutDecision(
                claim_id=claim.claim_id,
                claimant_name=claim.claimant_name,
                status=ClaimStatus.MANUAL_REVIEW,
                claimed_amount_usd=claim.claimed_amount_usd,
                deductible_applied_usd=policy.deductible_usd,
                eligible_amount_usd=max(0.0, claim.claimed_amount_usd - policy.deductible_usd),
                net_payout_usd=min(max(0.0, claim.claimed_amount_usd - policy.deductible_usd), policy.coverage_limit_usd),
                fraud_evaluation=fraud,
                audit_result=audit,
                decision_reason=f"Claim escalated for manual review due to {fraud.risk_level.value.upper()} fraud risk score ({fraud.score}/100). Red flags: {'; '.join(fraud.red_flags)}",
            )

        # 3. Calculate Net Payout for Approved Claims
        deductible = policy.deductible_usd
        eligible = max(0.0, claim.claimed_amount_usd - deductible)
        net_payout = min(eligible, policy.coverage_limit_usd)

        return PayoutDecision(
            claim_id=claim.claim_id,
            claimant_name=claim.claimant_name,
            status=ClaimStatus.AUTO_APPROVED,
            claimed_amount_usd=claim.claimed_amount_usd,
            deductible_applied_usd=deductible,
            eligible_amount_usd=eligible,
            net_payout_usd=net_payout,
            fraud_evaluation=fraud,
            audit_result=audit,
            decision_reason=f"Auto-approved. Net payout ${net_payout:,.2f} calculated after applying ${deductible:,.2f} deductible.",
        )
