from typing import List
from src.schemas import ClaimSubmission, PolicyTerms, FraudEvaluation, RiskLevel


class FraudDetector:
    """AI Fraud Anomaly Scoring Engine evaluating claim red flags & suspicious patterns."""

    def evaluate_fraud_risk(self, claim: ClaimSubmission, policy: PolicyTerms) -> FraudEvaluation:
        score = 10.0  # Base risk score
        red_flags: List[str] = []

        # 1. Proximity to policy inception (claim within 7 days of policy start)
        if claim.incident_date == policy.active_start_date:
            score += 35.0
            red_flags.append("Incident occurred on exact policy inception date.")

        # 2. Unusually high claim amount relative to standard benchmarks (> $50,000)
        if claim.claimed_amount_usd > 50000.0:
            score += 25.0
            red_flags.append(f"High-value claim amount (${claim.claimed_amount_usd:,.2f}) triggers manual fraud audit.")

        # 3. Suspicious keywords in description
        suspicious_keywords = ["cash", "unwitnessed", "pre-existing", "lost receipt", "verbal agreement"]
        for kw in suspicious_keywords:
            if kw in claim.description.lower():
                score += 15.0
                red_flags.append(f"Suspicious claim keyword detected: '{kw}'.")

        # 4. Claimed amount near policy limit (within 5% of limit)
        if claim.claimed_amount_usd >= 0.95 * policy.coverage_limit_usd:
            score += 20.0
            red_flags.append("Claimed amount is near 100% of policy coverage limit.")

        final_score = max(0.0, min(100.0, score))

        if final_score >= 70.0:
            level = RiskLevel.CRITICAL
        elif final_score >= 45.0:
            level = RiskLevel.HIGH
        elif final_score >= 25.0:
            level = RiskLevel.MEDIUM
        else:
            level = RiskLevel.LOW

        return FraudEvaluation(
            score=final_score,
            risk_level=level,
            red_flags=red_flags,
        )
