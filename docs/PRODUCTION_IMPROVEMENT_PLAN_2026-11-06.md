# Google Cloud Professional Agentic Architect: Production Improvement Plan
## Repository: claim-pilot
**Audit Date:** November 6, 2026  
**Target Standard:** Google Cloud Professional Agentic Architect (Domain 4: Evals & Deployments)

---

### Current Assessment
An automated insurance claim adjudication engine featuring multi-document parsing, fraud risk heuristics, and structured LLM evaluation pipelines with automated fallback handling across frontend, backend, parser-service, and evals.

### Critical Gaps
1. **Dormant CI/CD:** GitHub Actions workflows are stored under `claim-pilot/ci/ci.yml` instead of `.github/workflows/ci.yml`.
2. **Custom Evaluation Schema:** The evaluation pipeline uses an ad-hoc JSON structure instead of conforming to the official Google Cloud ADK `evalset.json` schema.
3. **No Cloud Run Deployment Manifest:** Lacks a production Dockerfile and Cloud Run service YAML with health check probes (`/healthz`).

---

### Actionable Implementation Steps

#### 1. Activate GitHub Actions CI
Relocate and activate the dormant workflow:
```bash
mkdir -p .github/workflows
mv ci/ci.yml .github/workflows/ci.yml
```

#### 2. Convert Eval Suites to ADK `evalset.json` Standard
Reformat evaluation datasets in `evals/` to match Google Cloud ADK specifications:
```json
[
  {
    "id": "claim-fraud-eval-01",
    "conversation": [
      {
        "role": "user",
        "content": "Evaluate claim CLM-9921 for water damage with repair estimate of $45,000."
      }
    ],
    "expected_trajectory": [
      {
        "tool_call": "run_fraud_heuristic",
        "expected_arguments": { "claim_id": "CLM-9921", "amount": 45000.0 }
      }
    ]
  }
]
```

#### 3. Containerize for Cloud Run Deployment
Add a multi-stage Dockerfile for `backend/` and `parser-service/` with readiness/liveness probes and deploy to Cloud Run with IAM service account identity.
