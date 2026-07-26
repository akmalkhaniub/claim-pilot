"""
Insurance Claim Fraud Detection & Anomaly Evaluator for ClaimPilot
Evaluates claim amount ratios, submission velocity, and duplicate invoice flags.
"""
from typing import Dict, Any, List

class ClaimFraudDetector:
    """Evaluates insurance claim risk profiles for fraudulent patterns."""

    @staticmethod
    def evaluate_claim_risk(
        claimed_amount_usd: float,
        policy_coverage_limit_usd: float,
        days_since_incident: int,
        has_prior_claims: bool = False,
        duplicate_receipt_matches: int = 0
    ) -> Dict[str, Any]:
        """Compute fraud risk score (0..100) and recommendation."""
        risk_score = 0.0
        reasons = []

        # Rule 1: High claim amount relative to limit (>90%)
        coverage_ratio = claimed_amount_usd / max(1.0, policy_coverage_limit_usd)
        if coverage_ratio > 0.90:
            risk_score += 35.0
            reasons.append(f"High claim coverage ratio ({round(coverage_ratio * 100, 1)}%)")

        # Rule 2: Delayed submission anomaly (>60 days after incident)
        if days_since_incident > 60:
            risk_score += 25.0
            reasons.append(f"Significant claim reporting delay ({days_since_incident} days)")

        # Rule 3: Duplicate receipt match flags
        if duplicate_receipt_matches > 0:
            risk_score += 40.0 * duplicate_receipt_matches
            reasons.append(f"Duplicate receipt match detected ({duplicate_receipt_matches} instances)")

        final_score = min(100.0, round(risk_score, 1))

        if final_score >= 60.0:
            risk_level = "HIGH_ALERT"
            action = "MANUAL_AUDIT_REQUIRED"
        elif final_score >= 30.0:
            risk_level = "MEDIUM_RISK"
            action = "SECONDARY_DOCUMENTATION_REQUESTED"
        else:
            risk_level = "LOW_RISK"
            action = "AUTO_APPROVE"

        return {
            "claimed_amount_usd": claimed_amount_usd,
            "policy_coverage_limit_usd": policy_coverage_limit_usd,
            "fraud_risk_score": final_score,
            "risk_level": risk_level,
            "recommended_action": action,
            "flagged_reasons": reasons
        }
