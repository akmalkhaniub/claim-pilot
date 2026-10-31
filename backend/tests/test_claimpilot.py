import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.schemas import ClaimSubmission, PolicyTerms, PerilType, ClaimStatus, RiskLevel
from src.policy_auditor import PolicyAuditorAgent
from fraud_detector import FraudDetector
from src.payout_engine import PayoutDecisionEngine


@pytest.fixture
def sample_policy():
    return PolicyTerms(
        policy_number="POL-TEST-1",
        holder_name="Jane Doe",
        active_start_date="2026-01-01",
        active_end_date="2026-12-31",
        deductible_usd=500.0,
        coverage_limit_usd=10000.0,
        covered_perils=[PerilType.WATER_DAMAGE, PerilType.FIRE_DAMAGE],
        excluded_perils=[PerilType.COLLISION],
    )


def test_auto_approved_claim(sample_policy):
    submission = ClaimSubmission(
        claim_id="CLM-001",
        policy_number=sample_policy.policy_number,
        claimant_name="Jane Doe",
        incident_date="2026-05-15",
        peril_type=PerilType.WATER_DAMAGE,
        claimed_amount_usd=2500.0,
        description="Burst pipe under kitchen sink causing cabinet water damage.",
    )

    auditor = PolicyAuditorAgent()
    fraud_detector = FraudDetector()
    engine = PayoutDecisionEngine()

    audit_res = auditor.audit_claim(submission, sample_policy)
    fraud_res = fraud_detector.evaluate_fraud_risk(submission, sample_policy)
    decision = engine.determine_payout(submission, sample_policy, audit_res, fraud_res)

    assert decision.status == ClaimStatus.AUTO_APPROVED
    assert decision.claimed_amount_usd == 2500.0
    assert decision.deductible_applied_usd == 500.0
    assert decision.net_payout_usd == 2000.0  # 2500 - 500 deductible


def test_excluded_peril_denied_claim(sample_policy):
    submission = ClaimSubmission(
        claim_id="CLM-002",
        policy_number=sample_policy.policy_number,
        claimant_name="Jane Doe",
        incident_date="2026-05-15",
        peril_type=PerilType.COLLISION,  # Excluded peril
        claimed_amount_usd=3000.0,
        description="Car bumper collision in driveway.",
    )

    auditor = PolicyAuditorAgent()
    fraud_detector = FraudDetector()
    engine = PayoutDecisionEngine()

    audit_res = auditor.audit_claim(submission, sample_policy)
    fraud_res = fraud_detector.evaluate_fraud_risk(submission, sample_policy)
    decision = engine.determine_payout(submission, sample_policy, audit_res, fraud_res)

    assert decision.status == ClaimStatus.DENIED
    assert decision.net_payout_usd == 0.0


def test_high_fraud_manual_review_claim(sample_policy):
    submission = ClaimSubmission(
        claim_id="CLM-003",
        policy_number=sample_policy.policy_number,
        claimant_name="Jane Doe",
        incident_date="2026-01-01",  # Inception date -> high fraud trigger
        peril_type=PerilType.FIRE_DAMAGE,
        claimed_amount_usd=60000.0,  # > $50,000 -> high fraud trigger
        description="Unwitnessed cash payment for repairs.",
    )

    auditor = PolicyAuditorAgent()
    fraud_detector = FraudDetector()
    engine = PayoutDecisionEngine()

    audit_res = auditor.audit_claim(submission, sample_policy)
    fraud_res = fraud_detector.evaluate_fraud_risk(submission, sample_policy)
    decision = engine.determine_payout(submission, sample_policy, audit_res, fraud_res)

    assert decision.status == ClaimStatus.MANUAL_REVIEW
    assert decision.fraud_evaluation.risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL]
