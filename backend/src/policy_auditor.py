from typing import List
from src.schemas import PolicyTerms, ClaimSubmission, AuditResult


class PolicyAuditorAgent:
    """Agent responsible for validating claim compliance against insurance policy terms."""

    def audit_claim(self, claim: ClaimSubmission, policy: PolicyTerms) -> AuditResult:
        notes: List[str] = []

        # 1. Check Policy Active Date Window
        policy_active = (policy.active_start_date <= claim.incident_date <= policy.active_end_date)
        if not policy_active:
            notes.append(f"Incident date {claim.incident_date} outside policy term ({policy.active_start_date} to {policy.active_end_date}).")
        else:
            notes.append("Incident occurred within active policy term window.")

        # 2. Check Covered Perils
        peril_covered = claim.peril_type in policy.covered_perils
        if not peril_covered:
            notes.append(f"Peril '{claim.peril_type.value}' is not listed under covered perils.")
        else:
            notes.append(f"Peril '{claim.peril_type.value}' is covered under policy.")

        # 3. Check Explicit Exclusions
        exclusion_triggered = claim.peril_type in policy.excluded_perils
        if exclusion_triggered:
            notes.append(f"Peril '{claim.peril_type.value}' triggers explicit policy exclusion clause.")

        return AuditResult(
            claim_id=claim.claim_id,
            policy_number=policy.policy_number,
            policy_active=policy_active,
            peril_covered=peril_covered,
            exclusion_triggered=exclusion_triggered,
            audit_notes=notes,
        )
