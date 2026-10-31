import datetime
from enum import Enum
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class PerilType(str, Enum):
    WATER_DAMAGE = "water_damage"
    FIRE_DAMAGE = "fire_damage"
    THEFT = "theft"
    COLLISION = "collision"
    STORM_DAMAGE = "storm_damage"


class ClaimStatus(str, Enum):
    AUTO_APPROVED = "auto_approved"
    MANUAL_REVIEW = "manual_review"
    DENIED = "denied"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class PolicyTerms(BaseModel):
    policy_number: str
    holder_name: str
    active_start_date: str
    active_end_date: str
    deductible_usd: float
    coverage_limit_usd: float
    covered_perils: List[PerilType]
    excluded_perils: List[PerilType] = Field(default_factory=list)


class ClaimSubmission(BaseModel):
    claim_id: str
    policy_number: str
    claimant_name: str
    incident_date: str
    peril_type: PerilType
    claimed_amount_usd: float
    description: str
    submitted_at: str = Field(default_factory=lambda: datetime.datetime.utcnow().isoformat())


class FraudEvaluation(BaseModel):
    score: float = Field(ge=0.0, le=100.0)  # 0 (lowest risk) to 100 (extreme fraud risk)
    risk_level: RiskLevel
    red_flags: List[str] = Field(default_factory=list)


class AuditResult(BaseModel):
    claim_id: str
    policy_number: str
    policy_active: bool
    peril_covered: bool
    exclusion_triggered: bool
    audit_notes: List[str] = Field(default_factory=list)


class PayoutDecision(BaseModel):
    claim_id: str
    claimant_name: str
    status: ClaimStatus
    claimed_amount_usd: float
    deductible_applied_usd: float
    eligible_amount_usd: float
    net_payout_usd: float
    fraud_evaluation: FraudEvaluation
    audit_result: AuditResult
    decision_reason: str
    processed_at: str = Field(default_factory=lambda: datetime.datetime.utcnow().isoformat())
