"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [claims, setClaims] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<any | null>(null);

  // Form State
  const [policyNumber, setPolicyNumber] = useState("POL-1001");
  const [claimantName, setClaimantName] = useState("Alice Smith");
  const [incidentDate, setIncidentDate] = useState("2026-05-15");
  const [perilType, setPerilType] = useState("water_damage");
  const [claimedAmount, setClaimedAmount] = useState(4500);
  const [description, setDescription] = useState("Burst pipe under kitchen sink causing cabinet and hardwood floor water damage.");
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // Theme Effect
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  // Fetch Claims & Policies
  const fetchClaims = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/claims");
      const data = await res.json();
      setClaims(data.claims || []);
    } catch (err) {
      console.error("Error fetching claims:", err);
    }
  };

  const fetchPolicies = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/policies");
      const data = await res.json();
      setPolicies(data.policies || []);
    } catch (err) {
      console.error("Error fetching policies:", err);
    }
  };

  useEffect(() => {
    fetchClaims();
    fetchPolicies();
  }, []);

  // Submit Claim Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSubmitMsg(null);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/claims/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_number: policyNumber,
          claimant_name: claimantName,
          incident_date: incidentDate,
          peril_type: perilType,
          claimed_amount_usd: Number(claimedAmount),
          description: description,
        }),
      });
      const data = await res.json();
      setSubmitMsg(`Claim ${data.claim_id} processed: Status ${data.status.toUpperCase()}`);
      fetchClaims();
    } catch (err) {
      setSubmitMsg(`Error processing claim: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-6 transition-colors duration-300 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* Header & Navbar */}
      <nav className="p-4 mb-6 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 backdrop-blur-md flex flex-wrap justify-between items-center shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-600/10 text-blue-600 dark:text-blue-400 rounded-xl">
            <i className="fa-solid fa-plane-departure text-2xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">ClaimPilot</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">AI Insurance Claim Intake, Policy Auditing & Fraud Detection</p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-sm font-semibold transition hover:scale-105"
          >
            {theme === "dark" ? (
              <>
                <i className="fa-solid fa-sun text-amber-400"></i> Light Mode
              </>
            ) : (
              <>
                <i className="fa-solid fa-moon text-indigo-500"></i> Dark Mode
              </>
            )}
          </button>
        </div>
      </nav>

      {/* Main Grid: Claim Intake & Claims Operations Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Claim Intake Form Panel */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md">
          <h2 className="text-base font-bold text-blue-600 dark:text-blue-400 mb-4 flex items-center gap-2">
            <i className="fa-solid fa-file-signature"></i> Submit New Insurance Claim
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold mb-1 text-slate-600 dark:text-slate-400">Select Policy Number</label>
              <select
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="POL-1001">POL-1001 - Alice Smith (Deductible $500)</option>
                <option value="POL-2002">POL-2002 - Bob Jones (Deductible $1,000)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1 text-slate-600 dark:text-slate-400">Claimant Full Name</label>
              <input
                type="text"
                value={claimantName}
                onChange={(e) => setClaimantName(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1 text-slate-600 dark:text-slate-400">Incident Date</label>
                <input
                  type="date"
                  value={incidentDate}
                  onChange={(e) => setIncidentDate(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-600 dark:text-slate-400">Peril Type</label>
                <select
                  value={perilType}
                  onChange={(e) => setPerilType(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="water_damage">Water Damage</option>
                  <option value="fire_damage">Fire Damage</option>
                  <option value="theft">Theft</option>
                  <option value="collision">Collision</option>
                  <option value="storm_damage">Storm Damage</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1 text-slate-600 dark:text-slate-400">Claimed Amount (USD)</label>
              <input
                type="number"
                value={claimedAmount}
                onChange={(e) => setClaimedAmount(Number(e.target.value))}
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                required
              />
            </div>

            <div>
              <label className="block font-semibold mb-1 text-slate-600 dark:text-slate-400">Incident Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                required
              ></textarea>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 transition shadow flex items-center justify-center gap-2"
            >
              {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-bolt"></i>}
              Process Claim via AI Pipeline
            </button>
          </form>

          {submitMsg && (
            <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-500 font-semibold text-xs">
              {submitMsg}
            </div>
          )}
        </div>

        {/* Claims Operations Table */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <i className="fa-solid fa-table-list text-blue-500"></i> Claims Operations Center
            </h2>
            <button onClick={fetchClaims} className="px-3 py-1.5 text-xs rounded-lg bg-slate-200 dark:bg-slate-800 font-semibold">
              <i className="fa-solid fa-rotate me-1"></i> Refresh
            </button>
          </div>

          {claims.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              <i className="fa-solid fa-inbox text-3xl mb-2 block"></i>
              No insurance claims submitted yet. Use the intake form to process a claim.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                    <th className="py-2">Claim ID</th>
                    <th className="py-2">Claimant</th>
                    <th className="py-2">Claimed</th>
                    <th className="py-2">Fraud Risk</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Net Payout</th>
                    <th className="py-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c, idx) => {
                    const statusClass = c.status === 'auto_approved' ? 'bg-emerald-500/20 text-emerald-500' : (c.status === 'denied' ? 'bg-rose-500/20 text-rose-500' : 'bg-amber-500/20 text-amber-500');
                    return (
                      <tr key={idx} className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-3 font-mono font-bold text-blue-500">{c.claim_id}</td>
                        <td className="py-3 font-semibold">{c.claimant_name}</td>
                        <td className="py-3">${c.claimed_amount_usd?.toLocaleString()}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded font-bold ${c.fraud_evaluation?.score > 50 ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {c.fraud_evaluation?.score}/100
                          </span>
                        </td>
                        <td className="py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${statusClass}`}>
                            {c.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 font-bold text-emerald-500">${c.net_payout_usd?.toLocaleString()}</td>
                        <td className="py-3">
                          <button
                            onClick={() => setSelectedClaim(c)}
                            className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-500 font-semibold hover:bg-blue-500/20"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Claim Detail Inspector Modal */}
      {selectedClaim && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="max-w-2xl w-full p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-lg text-blue-500">Claim Detail Audit - {selectedClaim.claim_id}</h3>
              <button onClick={() => setSelectedClaim(null)} className="text-slate-400 hover:text-slate-200 text-lg">
                &times;
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div><strong className="text-slate-400">Claimant:</strong> {selectedClaim.claimant_name}</div>
              <div><strong className="text-slate-400">Policy:</strong> {selectedClaim.audit_result?.policy_number}</div>
              <div><strong className="text-slate-400">Status:</strong> <span className="font-bold text-blue-400">{selectedClaim.status.toUpperCase()}</span></div>
              <div><strong className="text-slate-400">Net Payout:</strong> <span className="font-bold text-emerald-400">${selectedClaim.net_payout_usd?.toLocaleString()}</span></div>
            </div>

            <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
              <strong className="text-slate-400 block mb-1">Decision Reason:</strong>
              <p className="text-slate-300">{selectedClaim.decision_reason}</p>
            </div>

            <div>
              <h4 className="font-bold text-xs text-amber-500 mb-2">Fraud Risk Evaluation & Red Flags:</h4>
              <ul className="text-xs space-y-1 list-disc list-inside text-slate-400">
                {(selectedClaim.fraud_evaluation?.red_flags || []).map((rf: string, idx: number) => (
                  <li key={idx}>{rf}</li>
                ))}
                {(selectedClaim.fraud_evaluation?.red_flags || []).length === 0 && <li>No fraud red flags detected.</li>}
              </ul>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedClaim(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-semibold"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
