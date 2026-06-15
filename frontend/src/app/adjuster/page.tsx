"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Claim {
  id: string;
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'more_info_needed';
  title: string;
  claimType: string;
  createdAt: string;
  claimantName?: string;
  claimantEmail?: string;
  riskScore?: number | null;
}

interface ClaimField {
  key: string;
  value: any;
  confidence: number;
}

interface Document {
  id: string;
  name: string;
  type: string;
}

interface RiskScoreDetails {
  score: number;
  flags: string[];
  rationale: string;
  similarClaims: string[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AdjusterDashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  
  // Claims list
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  // Selected claim detail state
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [fields, setFields] = useState<ClaimField[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [riskDetails, setRiskDetails] = useState<RiskScoreDetails | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Triage form state
  const [adjusterRationale, setAdjusterRationale] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [loadingClaims, setLoadingClaims] = useState(true);

  // Authenticate user on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (!storedToken || !storedUser) {
      router.push('/');
      return;
    }
    
    const parsedUser = JSON.parse(storedUser);
    if (parsedUser.role !== 'adjuster') {
      router.push('/');
      return;
    }

    setToken(storedToken);
    setUser(parsedUser);
  }, [router]);

  // Fetch all claims once authenticated
  useEffect(() => {
    if (token) {
      fetchClaims();
    }
  }, [token]);

  // Fetch claim details on selection
  useEffect(() => {
    if (selectedClaimId && token) {
      fetchClaimDetails(selectedClaimId);
    }
  }, [selectedClaimId, token]);

  const fetchClaims = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/claims', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        
        // Sort claims by risk score descending (null values go to bottom)
        const sortedClaims = data.claims.sort((a: Claim, b: Claim) => {
          const scoreA = a.riskScore !== undefined && a.riskScore !== null ? a.riskScore : -1;
          const scoreB = b.riskScore !== undefined && b.riskScore !== null ? b.riskScore : -1;
          return scoreB - scoreA;
        });

        setClaims(sortedClaims);
      }
    } catch (err) {
      console.error('Error fetching claims:', err);
    } finally {
      setLoadingClaims(false);
    }
  };

  const fetchClaimDetails = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:3001/api/claims/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedClaim(data.claim);
        setFields(data.fields);
        setDocuments(data.documents);
        setRiskDetails(data.riskScore);
        
        // Fetch chat logs
        const historyRes = await fetch(`http://localhost:3001/api/claims/${id}/history`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (historyRes.ok) {
          const histData = await historyRes.json();
          setMessages(histData.history);
        }
      }
    } catch (err) {
      console.error('Error fetching claim details:', err);
    }
  };

  const handleTriageAction = async (action: 'approve' | 'reject' | 'more_info') => {
    if (!selectedClaimId || submittingDecision) return;
    if (!adjusterRationale.trim()) {
      alert('Please provide a brief rationale for your triage decision.');
      return;
    }

    setSubmittingDecision(true);
    try {
      const res = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/triage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action,
          rationale: adjusterRationale
        })
      });

      if (res.ok) {
        console.log(`[Triage]: Successfully processed action: ${action}`);
        setAdjusterRationale('');
        fetchClaims(); // reload list
        fetchClaimDetails(selectedClaimId); // reload details
      }
    } catch (err) {
      console.error('Error submitting triage decision:', err);
    } finally {
      setSubmittingDecision(false);
    }
  };

  const getRiskColor = (score: number) => {
    if (score >= 0.7) return 'var(--state-rejected)';
    if (score >= 0.4) return 'var(--state-review)';
    return 'var(--state-approved)';
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/');
  };

  return (
    <div className="app-container">
      {/* Navbar */}
      <header className="navbar">
        <div className="nav-brand">
          <span>\u2708</span> ClaimPilot Adjuster Portal
        </div>
        <div className="nav-links">
          {user && <span className="nav-user">{user.fullName} ({user.email})</span>}
          <button onClick={logout} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
            Logout
          </button>
        </div>
      </header>

      {/* Triage Workspace Grid */}
      <main className="dashboard-grid adjuster-grid" style={{ maxWidth: '1600px' }}>
        
        {/* Left column: Triage Queue Table */}
        <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1.25rem' }}>Claims Triage Queue</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Sorted by AI Fraud & Risk Score. Select a claim to inspect documents, similarity vectors, and chat history.
          </p>

          {loadingClaims ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading claims queue...</div>
          ) : claims.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontStyle: 'italic', padding: '1.5rem 0' }}>
              No claims submitted for review.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table className="triage-table">
                <thead>
                  <tr>
                    <th>Claim / Claimant</th>
                    <th>Risk</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => {
                    const hasRisk = c.riskScore !== undefined && c.riskScore !== null;
                    const score = c.riskScore || 0;
                    
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedClaimId(c.id)}
                        style={{
                          background: selectedClaimId === c.id ? 'var(--bg-card-hover)' : 'transparent',
                          borderLeft: selectedClaimId === c.id ? '3px solid var(--accent-cyan)' : 'none'
                        }}
                      >
                        <td>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.title}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {c.claimantName || 'Anonymous'}
                          </div>
                        </td>
                        <td>
                          {hasRisk ? (
                            <span style={{ fontWeight: 700, color: getRiskColor(score) }}>
                              {Math.round(score * 100)}%
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>--</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge badge-${c.status}`} style={{ fontSize: '0.7rem' }}>
                            {c.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right column: Split Triage View (Metadata & RAG / Transcript & Actions) */}
        {selectedClaim ? (
          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            
            {/* Split A: Claim Meta, Docs, and pgvector RAG assessment */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{selectedClaim.title}</h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Submitted by {selectedClaim.claimantName} ({selectedClaim.claimantEmail})
                </div>
              </div>

              {/* AI Risk Score Assessment Box */}
              {riskDetails ? (
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-card)', borderRadius: '8px', padding: '1rem' }}>
                  <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Automated Risk Profile</span>
                    <span style={{ fontWeight: 700, color: getRiskColor(riskDetails.score) }}>
                      {Math.round(riskDetails.score * 100)}% Risk
                    </span>
                  </h4>
                  
                  <div className="risk-meter-container" style={{ marginBottom: '1rem' }}>
                    <div className="risk-bar-bg">
                      <div
                        className={`risk-bar-fill ${
                          riskDetails.score >= 0.7 ? 'risk-fill-high' : riskDetails.score >= 0.4 ? 'risk-fill-medium' : 'risk-fill-low'
                        }`}
                        style={{ width: `${riskDetails.score * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Risk Flags */}
                  {riskDetails.flags && riskDetails.flags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                      {riskDetails.flags.map((flag) => (
                        <span
                          key={flag}
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            border: '1px solid rgba(239, 68, 68, 0.15)',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '4px',
                            textTransform: 'uppercase'
                          }}
                        >
                          {flag.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Rationale */}
                  <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    <strong>AI Rationale:</strong> {riskDetails.rationale}
                  </p>
                </div>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-card)', padding: '1rem', borderRadius: '8px', fontStyle: 'italic', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Automated risk scoring is pending. Submit the claim to trigger assessment.
                </div>
              )}

              {/* Extracted Fields */}
              <div>
                <h4 style={{ fontSize: '0.95rem', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
                  Extracted Data Fields
                </h4>
                <div className="fields-list" style={{ gap: '0.5rem' }}>
                  {fields.map((f) => (
                    <div key={f.key} className="field-item" style={{ padding: '0.5rem 0.75rem' }}>
                      <span className="field-key" style={{ fontSize: '0.8rem' }}>{f.key.replace('_', ' ')}</span>
                      <span className="field-val" style={{ fontSize: '0.8rem' }}>{f.value?.toString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Uploaded Documents List */}
              <div>
                <h4 style={{ fontSize: '0.95rem', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
                  Attached Documents (RAG Source)
                </h4>
                {documents.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                    No files attached.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.625rem 0.875rem',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--border-card)',
                          borderRadius: '6px'
                        }}
                      >
                        <span style={{ fontSize: '0.825rem', fontWeight: 500 }}>{doc.name}</span>
                        <a
                          href={`http://localhost:3001/api/claims/${selectedClaimId}/documents/${doc.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          View/Download
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Split B: Transcript & Human Triage Decision */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: 0, overflow: 'hidden', maxHeight: 'calc(100vh - 160px)' }}>
              
              {/* Chat Log Header */}
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-card)', background: 'rgba(255,255,255,0.01)' }}>
                <h4 style={{ fontSize: '0.95rem' }}>Intake Conversation Transcript</h4>
              </div>

              {/* Messages viewport */}
              <div className="chat-messages" style={{ padding: '1rem', flex: 1 }}>
                {messages.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                    No messages recorded.
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div key={i} className={`chat-bubble chat-bubble-${msg.role}`} style={{ fontSize: '0.85rem', padding: '0.75rem' }}>
                      <strong>{msg.role === 'user' ? 'Claimant' : 'Intake AI'}:</strong>
                      <div style={{ marginTop: '0.25rem' }}>{msg.content}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Triage Decision Pad */}
              <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border-card)', background: 'rgba(255,255,255,0.01)' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Human Adjuster Triage Decision</h4>
                
                <textarea
                  value={adjusterRationale}
                  onChange={(e) => setAdjusterRationale(e.target.value)}
                  placeholder="Provide details / rationale for approval or rejection..."
                  style={{
                    width: '100%',
                    height: '60px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '6px',
                    padding: '0.5rem',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    fontSize: '0.825rem',
                    outline: 'none',
                    resize: 'none',
                    marginBottom: '0.75rem'
                  }}
                />

                {selectedClaim.status === 'submitted' || selectedClaim.status === 'under_review' || selectedClaim.status === 'more_info_needed' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '0.5rem' }}>
                    <button
                      onClick={() => handleTriageAction('approve')}
                      disabled={submittingDecision}
                      className="btn btn-primary"
                      style={{ background: 'var(--state-approved)', color: 'white', padding: '0.5rem', fontSize: '0.8rem' }}
                    >
                      Approve
                    </button>
                    
                    <button
                      onClick={() => handleTriageAction('reject')}
                      disabled={submittingDecision}
                      className="btn btn-danger"
                      style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                    >
                      Reject
                    </button>
                    
                    <button
                      onClick={() => handleTriageAction('more_info')}
                      disabled={submittingDecision}
                      className="btn btn-secondary"
                      style={{ padding: '0.5rem', fontSize: '0.8rem', border: '1px solid #818cf8', color: '#818cf8' }}
                    >
                      Request Info
                    </button>
                  </div>
                ) : (
                  <div style={{
                    textAlign: 'center',
                    padding: '0.5rem',
                    background: selectedClaim.status === 'approved' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: selectedClaim.status === 'approved' ? 'var(--state-approved)' : 'var(--state-rejected)',
                    border: '1px solid',
                    borderColor: selectedClaim.status === 'approved' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}>
                    Claim is {selectedClaim.status.toUpperCase()} (Triage Closed)
                  </div>
                )}
              </div>

            </div>

          </section>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '300px', color: 'var(--text-muted)', padding: '3rem' }}>
            <span style={{ fontSize: '3.5rem' }}>\uD83D\uDCCB</span>
            <p style={{ marginTop: '1rem', fontStyle: 'italic' }}>Select a claim from the queue to start risk analysis and review.</p>
          </div>
        )}

      </main>
    </div>
  );
}
