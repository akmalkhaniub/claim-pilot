import os
import json
import time
import requests

API_URL = os.getenv("API_URL", "http://localhost:3001/api")

def run_evaluations():
    print("==================================================")
    print("      ClaimPilot AI Triage Evaluation Harness     ")
    print("==================================================")
    
    # 1. Load test cases
    try:
        with open("data/extraction_cases.json", "r") as f:
            cases = json.load(f)
    except Exception as e:
        print(f"Error loading test cases: {e}")
        return
        
    print(f"Loaded {len(cases)} test cases.")

    # 2. Register / Login test claimant
    token = None
    email = f"eval_runner_{int(time.time())}@claimpilot.com"
    password = "password123"
    
    try:
        # Register
        reg_res = requests.post(f"{API_URL}/auth/register", json={
            "email": email,
            "password": password,
            "role": "claimant",
            "fullName": "Eval Runner"
        })
        if reg_res.status_code == 201:
            token = reg_res.json()["token"]
            print("[Setup]: Registered new evaluation user.")
        else:
            # Try login if already registered
            log_res = requests.post(f"{API_URL}/auth/login", json={
                "email": "claimant@claimpilot.com",
                "password": "password123"
            })
            token = log_res.json()["token"]
            print("[Setup]: Logged in with default claimant credentials.")
    except Exception as e:
        print(f"Could not connect to API server at {API_URL}. Ensure Express backend is running.")
        print(f"Details: {e}")
        return

    headers = {"Authorization": f"Bearer {token}"}
    total_fields_expected = 0
    total_fields_correct = 0
    triage_correct = 0

    # 3. Iterate through cases
    for case in cases:
        print(f"\nEvaluating Case: {case['name']} ({case['id']})")
        print("-" * 40)
        
        # A. Create claim draft
        claim_res = requests.post(f"{API_URL}/claims/create", json={
            "title": f"Eval: {case['name']}",
            "claimType": case["expected_fields"].get("claim_type", "Auto")
        }, headers=headers)
        
        if claim_res.status_code != 201:
            print(f"Error creating claim: {claim_res.text}")
            continue
            
        claim_id = claim_res.json()["claim"]["id"]
        print(f"[Claim]: Created draft ID: {claim_id}")

        # B. Send transcript messages
        for msg in case["transcript"]:
            if msg["role"] == "user":
                print(f"User: {msg['content']}")
                # We send the user message to the chat endpoint
                # In standard requests, this blocks and reads the final SSE stream closure
                chat_res = requests.post(
                    f"{API_URL}/claims/{claim_id}/chat",
                    json={"message": msg["content"]},
                    headers=headers,
                    stream=True
                )
                
                # Consume stream to let backend finish processing
                for line in chat_res.iter_lines():
                    pass

        # C. Query final claim state and evaluate field extraction accuracy
        details_res = requests.get(f"{API_URL}/claims/{claim_id}", headers=headers)
        details = details_res.json()
        
        extracted_fields = {f["key"]: f["value"] for f in details.get("fields", [])}
        expected = case["expected_fields"]
        
        print("\n[Extraction Comparison]:")
        for key, val in expected.items():
            total_fields_expected += 1
            got = extracted_fields.get(key)
            
            # Match list/array or value
            is_match = False
            if isinstance(val, list):
                is_match = sorted([str(x) for x in val]) == sorted([str(x) for x in (got or [])])
            else:
                is_match = str(val) == str(got) if got is not None else False
                
            if is_match:
                total_fields_correct += 1
                print(f"  {key}: {val} == {got} [OK]")
            else:
                print(f"  {key}: {val} != {got} [FAIL]")

        # D. Submit claim and verify risk scoring
        print("\n[Triage]: Submitting claim for risk triage analysis...")
        submit_res = requests.post(f"{API_URL}/claims/{claim_id}/submit", headers=headers)
        if submit_res.status_code == 200:
            # Wait for async background worker
            time.sleep(2)
            
            # Fetch details again to get risk scoring
            details_res = requests.get(f"{API_URL}/claims/{claim_id}", headers=headers)
            details = details_res.json()
            risk_info = details.get("riskScore")
            
            if risk_info:
                score = risk_info["score"]
                flags = risk_info["flags"]
                print(f"  Risk Score: {score}")
                print(f"  Risk Flags: {flags}")
                print(f"  Rationale: {risk_info['rationale']}")
                
                # Check if risk profile matches expectations
                expected_risk = case["expected_risk"]
                is_correct = False
                if expected_risk == "high" and score >= 0.5:
                    is_correct = True
                elif expected_risk == "low" and score < 0.5:
                    is_correct = True
                    
                if is_correct:
                    triage_correct += 1
                    print(f"  Triage Validation: PASS [OK] (Expected: {expected_risk.upper()} risk)")
                else:
                    print(f"  Triage Validation: FAIL [FAIL] (Expected: {expected_risk.upper()} risk)")
            else:
                print("  Triage Validation: FAIL [FAIL] (No risk score generated)")
        else:
             print(f"  Failed to submit claim: {submit_res.text}")

    # 4. Report metrics
    print("\n" + "=" * 50)
    print("                 EVALUATION METRICS REPORT        ")
    print("=" * 50)
    
    accuracy = (total_fields_correct / total_fields_expected) * 100 if total_fields_expected > 0 else 0
    triage_acc = (triage_correct / len(cases)) * 100 if len(cases) > 0 else 0
    
    print(f"Total Fields Expected: {total_fields_expected}")
    print(f"Total Fields Correct:  {total_fields_correct}")
    print(f"Extraction Accuracy:   {accuracy:.1f}%")
    print(f"Risk Triage Accuracy:  {triage_acc:.1f}%")
    
    if accuracy >= 80 and triage_acc >= 80:
        print("\nOverall Status: PASS [OK]")
        return True
    else:
        print("\nOverall Status: FAIL [FAIL] (Accuracy below 80% gate threshold)")
        return False

if __name__ == "__main__":
    run_evaluations()
