import os
import sys
import datetime
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.schemas import ClaimSubmission, PolicyTerms, PerilType, PayoutDecision, ClaimStatus, RiskLevel
from src.policy_auditor import PolicyAuditorAgent
from fraud_detector import FraudDetector
from src.payout_engine import PayoutDecisionEngine

app = FastAPI(
    title="ClaimPilot - AI Insurance Claim Processing Engine",
    description="Automated Policy Auditing, Fraud Risk Scoring & Payout Determination API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

policy_auditor = PolicyAuditorAgent()
fraud_detector = FraudDetector()
payout_engine = PayoutDecisionEngine()

# Sample Policies Store
sample_policies: Dict[str, PolicyTerms] = {
    "POL-1001": PolicyTerms(
        policy_number="POL-1001",
        holder_name="Alice Smith",
        active_start_date="2026-01-01",
        active_end_date="2026-12-31",
        deductible_usd=500.0,
        coverage_limit_usd=25000.0,
        covered_perils=[PerilType.WATER_DAMAGE, PerilType.FIRE_DAMAGE, PerilType.THEFT],
        excluded_perils=[PerilType.COLLISION],
    ),
    "POL-2002": PolicyTerms(
        policy_number="POL-2002",
        holder_name="Bob Jones",
        active_start_date="2026-06-01",
        active_end_date="2027-05-31",
        deductible_usd=1000.0,
        coverage_limit_usd=100000.0,
        covered_perils=[PerilType.COLLISION, PerilType.STORM_DAMAGE, PerilType.FIRE_DAMAGE],
        excluded_perils=[],
    ),
}

# Claims In-Memory Database
claims_db: Dict[str, PayoutDecision] = {}


class ProcessClaimRequest(BaseModel):
    policy_number: str
    claimant_name: str
    incident_date: str
    peril_type: PerilType
    claimed_amount_usd: float
    description: str


@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "system": "ClaimPilot AI Processing Engine",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "total_processed_claims": len(claims_db),
    }


@app.get("/api/policies")
def list_policies():
    return {"policies": list(sample_policies.values())}


@app.get("/api/claims")
def list_claims():
    return {"claims": list(claims_db.values())}


@app.post("/api/claims/process")
def process_claim(req: ProcessClaimRequest):
    policy = sample_policies.get(req.policy_number)
    if not policy:
        # Fallback default policy if custom number entered
        policy = PolicyTerms(
            policy_number=req.policy_number,
            holder_name=req.claimant_name,
            active_start_date="2026-01-01",
            active_end_date="2026-12-31",
            deductible_usd=500.0,
            coverage_limit_usd=50000.0,
            covered_perils=[req.peril_type],
            excluded_perils=[],
        )

    claim_id = f"CLM-{len(claims_db) + 1001}"
    submission = ClaimSubmission(
        claim_id=claim_id,
        policy_number=req.policy_number,
        claimant_name=req.claimant_name,
        incident_date=req.incident_date,
        peril_type=req.peril_type,
        claimed_amount_usd=req.claimed_amount_usd,
        description=req.description,
    )

    audit_res = policy_auditor.audit_claim(submission, policy)
    fraud_res = fraud_detector.evaluate_fraud_risk(submission, policy)
    decision = payout_engine.determine_payout(submission, policy, audit_res, fraud_res)

    claims_db[claim_id] = decision
    return decision
