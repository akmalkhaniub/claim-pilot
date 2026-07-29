"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface Claim {
  id: string;
  status: string;
  title: string;
  claimType: string;
  createdAt: string;
  humanTakeover?: boolean;
  claimantName?: string;
  claimantEmail?: string;
}

interface ClaimField {
  key: string;
  value: any;
  confidence: number;
}

interface RiskScoreDetails {
  score: number;
  risk_flags: string[];
  rationale: string;
}

interface AuditLog {
  id: string;
  action: string;
  details: any;
  createdAt: string;
  actorEmail?: string;
  actorRole?: string;
  actorName?: string;
}

export default function ClaimReportPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Loaded report data
  const [claim, setClaim] = useState<Claim | null>(null);
  const [fields, setFields] = useState<ClaimField[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [riskDetails, setRiskDetails] = useState<RiskScoreDetails | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Authenticate adjuster on mount
  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");

    if (!storedToken || !storedUser) {
      router.push("/");
      return;
    }

    const parsedUser = JSON.parse(storedUser);
    if (parsedUser.role !== "adjuster") {
      setError("Unauthorized access. Adjuster authentication required.");
      setLoading(false);
      return;
    }

    setToken(storedToken);
  }, [router]);

  // Load all details in parallel
  useEffect(() => {
    if (!id || !token) return;

    const fetchAllReportData = async () => {
      try {
        // 1. Fetch details, fields, documents
        const detailsRes = await fetch(`http://localhost:3001/api/claims/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!detailsRes.ok) {
          throw new Error("Failed to fetch claim records.");
        }

        const detailsData = await detailsRes.json();
        setClaim(detailsData.claim);
        setFields(detailsData.fields);
        setDocuments(detailsData.documents);
        setRiskDetails(detailsData.riskScore);

        // 2. Fetch compliance audit logs
        const auditRes = await fetch(`http://localhost:3001/api/claims/${id}/audit`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (auditRes.ok) {
          const auditData = await auditRes.json();
          setAuditLogs(auditData.audit || []);
        }

        setLoading(false);
      } catch (err: any) {
        console.error("Report loading error:", err);
        setError(err.message || "Failed to compile claim records.");
        setLoading(false);
      }
    };

    fetchAllReportData();
  }, [id, token]);

  // Auto-launch printer dialog once fully loaded
  useEffect(() => {
    if (!loading && !error && claim) {
      const printTimer = setTimeout(() => {
        window.print();
      }, 1000);
      return () => clearTimeout(printTimer);
    }
  }, [loading, error, claim]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#070a13", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ width: "40px", height: "40px", border: "3px solid rgba(0,180,216,0.2)", borderTop: "3px solid #00b4d8", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <p style={{ marginTop: "1rem", fontSize: "0.95rem" }}>Compiling executive underwriting records...</p>
        <style>{`
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  if (error || !claim) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#070a13", color: "#ff4d4d", fontFamily: "sans-serif", padding: "1.5rem", textAlign: "center" }}>
        <h2>⚠️ Report Compilation Error</h2>
        <p style={{ color: "#ccc", marginTop: "0.5rem" }}>{error || "Claim details not found."}</p>
        <button onClick={() => window.close()} style={{ marginTop: "1.5rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "0.5rem 1rem", borderRadius: "6px", cursor: "pointer" }}>
          Close Tab
        </button>
      </div>
    );
  }

  const claimCode = claim.id.substring(0, 8).toUpperCase();
  const dateGenerated = new Date().toLocaleString();

  return (
    <div className="report-wrapper">
      <style>{`
        body {
          background: #f4f6f9;
          color: #333;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .no-print-bar {
          background: #0e1423;
          padding: 0.75rem 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          color: #fff;
        }

        .report-container {
          max-width: 800px;
          margin: 2rem auto;
          background: #fff;
          padding: 3rem;
          box-shadow: 0 4px 30px rgba(0,0,0,0.05);
          border-radius: 4px;
          box-sizing: border-box;
        }

        .report-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #00b4d8;
          padding-bottom: 1.5rem;
          margin-bottom: 2rem;
        }

        .company-logo {
          font-size: 1.5rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          color: #0f172a;
        }

        .company-logo span {
          color: #00b4d8;
        }

        .report-title-block {
          text-align: right;
        }

        .report-title {
          font-size: 1.25rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          color: #0f172a;
          margin: 0 0 0.5rem 0;
        }

        .report-meta-text {
          font-size: 0.75rem;
          color: #64748b;
          margin: 0.2rem 0;
        }

        .section-title {
          font-size: 1rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #0f172a;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 0.5rem;
          margin: 2.5rem 0 1rem 0;
        }

        .grid-2col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }

        .data-item {
          margin-bottom: 0.75rem;
        }

        .data-label {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 0.2rem;
        }

        .data-value {
          font-size: 0.85rem;
          color: #0f172a;
          line-height: 1.4;
        }

        /* Diagnostic Table */
        .report-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 0.5rem;
        }

        .report-table th {
          background: #f8fafc;
          border-bottom: 2px solid #e2e8f0;
          padding: 0.6rem 0.75rem;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          color: #475569;
          text-align: left;
        }

        .report-table td {
          border-bottom: 1px solid #f1f5f9;
          padding: 0.6rem 0.75rem;
          font-size: 0.8rem;
          color: #0f172a;
        }

        /* Risk score widget */
        .risk-gauge-container {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 1.25rem;
          display: flex;
          align-items: center;
          gap: 2rem;
          margin-bottom: 1rem;
        }

        .risk-score-value-box {
          text-align: center;
        }

        .risk-score-big {
          font-size: 2.25rem;
          font-weight: 800;
          color: #ef4444;
          line-height: 1;
        }

        .risk-score-bar-bg {
          flex: 1;
          height: 12px;
          background: #e2e8f0;
          border-radius: 6px;
          overflow: hidden;
          position: relative;
        }

        .risk-score-bar-fill {
          height: 100%;
          background: linear-gradient(to right, #eab308, #ef4444);
          border-radius: 6px;
        }

        .risk-flag-pill {
          display: inline-block;
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fca5a5;
          padding: 0.15rem 0.5rem;
          border-radius: 4px;
          font-size: 0.65rem;
          font-weight: 700;
          margin-right: 0.4rem;
          margin-bottom: 0.4rem;
        }

        .audit-timeline-print {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-top: 1rem;
        }

        .audit-timeline-row {
          border-left: 2px solid #cbd5e1;
          padding-left: 1.25rem;
          position: relative;
        }

        .audit-timeline-row::before {
          content: "";
          position: absolute;
          left: -5px;
          top: 4px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #64748b;
        }

        .audit-timeline-header {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 0.15rem;
        }

        .audit-timeline-meta {
          font-size: 0.65rem;
          color: #64748b;
          margin-bottom: 0.25rem;
        }

        .audit-timeline-summary {
          font-size: 0.75rem;
          color: #334155;
          line-height: 1.4;
        }

        /* Print Override */
        @media print {
          body {
            background: #fff !important;
            color: #000 !important;
          }

          .no-print-bar {
            display: none !important;
          }

          .report-container {
            max-width: 100% !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }

          .section-title {
            margin-top: 2rem !important;
          }

          .page-break {
            page-break-before: always !important;
          }
        }
      `}</style>

      {/* Top Header bar with action links (Only visible on screen) */}
      <div className="no-print-bar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>🛡️</span>
          <strong style={{ fontSize: "0.9rem" }}>Executive Underwriting Report Generated</strong>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={() => window.print()} style={{ background: "#00b4d8", color: "#070a13", border: "none", padding: "0.4rem 1rem", borderRadius: "6px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
            Print Report
          </button>
          <button onClick={() => window.close()} style={{ background: "transparent", color: "#ccc", border: "1px solid rgba(255,255,255,0.15)", padding: "0.4rem 1rem", borderRadius: "6px", fontSize: "0.8rem", cursor: "pointer" }}>
            Close Tab
          </button>
        </div>
      </div>

      {/* Main Report Container */}
      <div className="report-container">
        
        {/* Document Header */}
        <div className="report-header">
          <div className="company-logo">
            Claim<span>Pilot</span>
          </div>
          <div className="report-title-block">
            <h1 className="report-title">Claim Audit Summary</h1>
            <p className="report-meta-text">Report ID: CP-REP-{claimCode}</p>
            <p className="report-meta-text">Generated: {dateGenerated}</p>
          </div>
        </div>

        {/* Claim Overview */}
        <div className="section-title">Claim Overview</div>
        <div className="grid-2col">
          <div>
            <div className="data-item">
              <div className="data-label">Claim Title</div>
              <div className="data-value">{claim.title}</div>
            </div>
            <div className="data-item">
              <div className="data-label">Claim Type</div>
              <div className="data-value">{claim.claimType}</div>
            </div>
            <div className="data-item">
              <div className="data-label">Policy Reference</div>
              <div className="data-value">
                {fields.find((f) => f.key === "policy_number")?.value || "Unresolved"}
              </div>
            </div>
          </div>
          
          <div>
            <div className="data-item">
              <div className="data-label">Status Code</div>
              <div className="data-value" style={{ fontWeight: 700, textTransform: "uppercase" }}>
                {claim.status}
              </div>
            </div>
            <div className="data-item">
              <div className="data-label">Claimant Account</div>
              <div className="data-value">
                {claim.claimantName || "Client"} ({claim.claimantEmail || "No Email Available"})
              </div>
            </div>
            <div className="data-item">
              <div className="data-label">Loss Evaluated</div>
              <div className="data-value">
                {fields.find((f) => f.key === "loss_amount")?.value
                  ? `$${Number(fields.find((f) => f.key === "loss_amount")?.value).toLocaleString()}`
                  : "Unspecified"}
              </div>
            </div>
          </div>
        </div>

        <div className="data-item" style={{ marginTop: "1rem" }}>
          <div className="data-label">Incident Narrative Description</div>
          <div className="data-value" style={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>
            {fields.find((f) => f.key === "incident_description")?.value || "No detailed narrative uploaded."}
          </div>
        </div>

        {/* AI Extractions */}
        <div className="section-title">AI Intake Diagnostics</div>
        <table className="report-table">
          <thead>
            <tr>
              <th>Field Key</th>
              <th>Extracted Value</th>
              <th>Confidence Level</th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ fontStyle: "italic", textAlign: "center", color: "#666" }}>
                  No automated field extractions logged.
                </td>
              </tr>
            ) : (
              fields.map((f, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontFamily: "monospace" }}>{f.key}</td>
                  <td>
                    {typeof f.value === "object" ? JSON.stringify(f.value) : String(f.value)}
                  </td>
                  <td>
                    <span style={{ color: f.confidence >= 0.85 ? "#16a34a" : "#ca8a04", fontWeight: 700 }}>
                      {Math.round(f.confidence * 100)}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Risk Assessment Page Break */}
        <div className="page-break" />

        {/* Underwriting Diagnostics */}
        <div className="section-title" style={{ marginTop: 0 }}>Underwriting Risk Diagnostics</div>
        {riskDetails ? (
          <div>
            <div className="risk-gauge-container">
              <div className="risk-score-value-box">
                <div className="risk-score-big">{Math.round(riskDetails.score * 100)}%</div>
                <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginTop: "0.2rem" }}>
                  Triage Risk
                </div>
              </div>
              <div className="risk-score-bar-bg">
                <div className="risk-score-bar-fill" style={{ width: `${riskDetails.score * 100}%` }} />
              </div>
            </div>

            <div className="data-item">
              <div className="data-label">Automated Triage Risk Flags</div>
              <div style={{ marginTop: "0.35rem" }}>
                {riskDetails.risk_flags?.length === 0 ? (
                  <span style={{ fontSize: "0.8rem", color: "#666", fontStyle: "italic" }}>
                    No automated flags raised.
                  </span>
                ) : (
                  riskDetails.risk_flags?.map((flag, idx) => (
                    <span key={idx} className="risk-flag-pill">
                      {flag}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="data-item" style={{ marginTop: "1rem" }}>
              <div className="data-label">Automated Underwriting Rationale Narrative</div>
              <div className="data-value" style={{ padding: "0.75rem", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "0.8rem", lineHeight: "1.5" }}>
                {riskDetails.rationale}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontStyle: "italic", fontSize: "0.85rem", color: "#666" }}>
            Automated underwriting risk scoring evaluation has not run for this claim file.
          </div>
        )}

        {/* Document indexing */}
        <div className="section-title">pgvector Document Indexing & RAG Files</div>
        <table className="report-table">
          <thead>
            <tr>
              <th>Document Name</th>
              <th>Type</th>
              <th>Index Reference ID</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ fontStyle: "italic", textAlign: "center", color: "#666" }}>
                  No supporting files attached.
                </td>
              </tr>
            ) : (
              documents.map((doc, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 600 }}>📄 {doc.name || doc.file_name}</td>
                  <td style={{ fontSize: "0.75rem" }}>{doc.type || doc.file_type}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{doc.id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Compliance Ledger Page Break */}
        <div className="page-break" />

        {/* Compliance Audit Trail */}
        <div className="section-title" style={{ marginTop: 0 }}>Compliance Audit Ledger (SOC 2)</div>
        <div className="audit-timeline-print">
          {auditLogs.length === 0 ? (
            <div style={{ fontStyle: "italic", color: "#666", fontSize: "0.8rem" }}>
              No audit logs captured.
            </div>
          ) : (
            auditLogs.map((log) => {
              const dateStr = new Date(log.createdAt).toLocaleString();
              let parsedDetails: any = {};
              try {
                parsedDetails = typeof log.details === "string" ? JSON.parse(log.details) : log.details;
              } catch (e) {
                parsedDetails = log.details;
              }

              // Filter out system system messages to keep ledger pure
              if (log.action === "chat_message" && parsedDetails.isSystem) {
                return null;
              }

              let summary = "";
              let displayAction = log.action;

              switch (log.action) {
                case "CLAIM_DRAFT_CREATED":
                  displayAction = "Claim Draft Created";
                  summary = `Claimant initialized folder: "${parsedDetails.title || "Untitled"}" (${parsedDetails.claimType || "General"})`;
                  break;
                case "DOCUMENT_UPLOADED":
                  displayAction = "Attachment Uploaded";
                  summary = `File "${parsedDetails.fileName || "document"}" received and parsed to vector database.`;
                  break;
                case "CLAIM_SUBMITTED":
                  displayAction = "Claim Submitted";
                  summary = `Claimant locked file and submitted to automated processing.`;
                  break;
                case "AUTOMATED_RISK_EVALUATED":
                  displayAction = "Risk Evaluated";
                  summary = `AI assessment evaluated. Risk Score: ${Math.round(parsedDetails.score * 100)}%. Rationale logged.`;
                  break;
                case "takeover_initiated":
                case "TAKEOVER_INITIATED":
                  displayAction = "Takeover Enabled";
                  summary = "Adjuster assumed control of chat logs, suspending AI copilot responses.";
                  break;
                case "takeover_released":
                case "TAKEOVER_RELEASED":
                  displayAction = "Takeover Released";
                  summary = "Adjuster released chat takeover. AI copilot resumed.";
                  break;
                case "HUMAN_TRIAGE_DECISION":
                  displayAction = "Triage Decision";
                  summary = `Underwriter triaged status to: "${parsedDetails.nextStatus.toUpperCase()}". Adjuster rationale: "${parsedDetails.rationale}"`;
                  break;
                case "chat_message":
                  displayAction = "Message Exchanged";
                  summary = `${parsedDetails.role === "user" ? "Claimant" : (parsedDetails.sender === "adjuster" ? "Adjuster" : "AI Copilot")}: "${parsedDetails.content?.substring(0, 60)}${parsedDetails.content?.length > 60 ? "..." : ""}"`;
                  break;
                default:
                  summary = `Event log payload triggered.`;
              }

              return (
                <div key={log.id} className="audit-timeline-row">
                  <div className="audit-timeline-header">
                    <span>{displayAction}</span>
                    <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.65rem" }}>
                      {dateStr}
                    </span>
                  </div>
                  <div className="audit-timeline-meta">
                    Actor: {log.actorEmail || "System/AI"} {log.actorRole && `[${log.actorRole.toUpperCase()}]`}
                  </div>
                  <div className="audit-timeline-summary">{summary}</div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}
