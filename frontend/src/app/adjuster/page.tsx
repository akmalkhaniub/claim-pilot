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

  // Split B Tab state
  const [splitBTab, setSplitBTab] = useState<'transcript' | 'search'>('transcript');
  
  // Claim-specific search states
  const [claimSearchQuery, setClaimSearchQuery] = useState('');
  const [claimSearchResults, setClaimSearchResults] = useState<any[]>([]);
  const [claimSearchLoading, setClaimSearchLoading] = useState(false);

  // Global search states (for landing dashboard)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);

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
      // Reset claim search states on claim switch
      setClaimSearchQuery('');
      setClaimSearchResults([]);
      setSplitBTab('transcript');
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

  const handleClaimSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimSearchQuery.trim() || !selectedClaimId) return;

    setClaimSearchLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/search?q=${encodeURIComponent(claimSearchQuery)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setClaimSearchResults(data.results || []);
      } else {
        console.error('Claim RAG Search failed');
        setClaimSearchResults([]);
      }
    } catch (err) {
      console.error('Error during claim search:', err);
      setClaimSearchResults([]);
    } finally {
      setClaimSearchLoading(false);
    }
  };

  const handleGlobalSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalSearchQuery.trim()) return;

    setGlobalSearchLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/claims/search?q=${encodeURIComponent(globalSearchQuery)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGlobalSearchResults(data.results || []);
      } else {
        console.error('Global RAG Search failed');
        setGlobalSearchResults([]);
      }
    } catch (err) {
      console.error('Error during global search:', err);
      setGlobalSearchResults([]);
    } finally {
      setGlobalSearchLoading(false);
    }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <div className="nav-brand">
            <span>\u2708</span> ClaimPilot Adjuster Portal
          </div>
          {user && (
            <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.03)', padding: '0.25rem', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
              <button
                onClick={() => setActiveView('queue')}
                style={{
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.8rem',
                  background: activeView === 'queue' ? 'var(--accent-cyan)' : 'transparent',
                  color: activeView === 'queue' ? '#070a13' : 'var(--text-secondary)',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'all 0.2s ease'
                }}
              >
                Claims Queue
              </button>
              <button
                onClick={() => setActiveView('analytics')}
                style={{
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.8rem',
                  background: activeView === 'analytics' ? 'var(--accent-cyan)' : 'transparent',
                  color: activeView === 'analytics' ? '#070a13' : 'var(--text-secondary)',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  transition: 'all 0.2s ease'
                }}
              >
                Analytics & Trends
              </button>
            </div>
          )}
        </div>
        <div className="nav-links">
          {user && <span className="nav-user">{user.fullName} ({user.email})</span>}
          <button onClick={logout} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
            Logout
          </button>
        </div>
      </header>

      {activeView === 'queue' ? (

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

            {/* Split B: Transcript, Claim Documents RAG Search & Human Triage Decision */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', maxHeight: 'calc(100vh - 160px)' }}>
              
              {/* Tab Header */}
              <div className="search-tab-header" style={{ padding: '0.5rem 1rem 0 1rem', display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setSplitBTab('transcript')}
                  className={`search-tab-btn ${splitBTab === 'transcript' ? 'active' : ''}`}
                >
                  Intake Transcript
                </button>
                <button
                  onClick={() => setSplitBTab('search')}
                  className={`search-tab-btn ${splitBTab === 'search' ? 'active' : ''}`}
                >
                  Document RAG Search
                </button>
              </div>

              {/* Tab Content */}
              {splitBTab === 'transcript' ? (
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
              ) : (
                <div className="rag-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem', overflow: 'hidden' }}>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>Claim Document Search</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Search within this claim's attached documents using vector similarity.
                    </p>
                  </div>

                  <form onSubmit={handleClaimSearch} className="search-bar-group" style={{ marginBottom: '1rem' }}>
                    <input
                      type="text"
                      value={claimSearchQuery}
                      onChange={(e) => setClaimSearchQuery(e.target.value)}
                      placeholder="e.g. Is water damage covered? What is the deductible?"
                      className="search-input"
                    />
                    <button type="submit" disabled={claimSearchLoading} className="search-btn">
                      {claimSearchLoading ? 'Searching...' : 'Search'}
                    </button>
                  </form>

                  <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {claimSearchResults.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', minHeight: '150px' }}>
                        <span style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</span>
                        <p style={{ fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center' }}>
                          No matches found. Enter a search query to scan document chunks.
                        </p>
                      </div>
                    ) : (
                      <div className="search-results-list" style={{ gap: '0.75rem' }}>
                        {claimSearchResults.map((res, idx) => {
                          const simPct = Math.round(res.similarity * 100);
                          let badgeClass = 'badge-low';
                          if (simPct >= 75) badgeClass = 'badge-high';
                          else if (simPct >= 50) badgeClass = 'badge-mid';

                          return (
                            <div key={idx} className="search-result-card" style={{ padding: '1rem' }}>
                              <div className="search-result-header" style={{ marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>📄 {res.documentName}</span>
                                <span className={`search-result-badge ${badgeClass}`} style={{ fontSize: '0.7rem' }}>
                                  {simPct}% Match
                                </span>
                              </div>
                              <p className="search-result-content" style={{ fontSize: '0.8rem', padding: '0.5rem' }}>{res.content}</p>
                              <div className="search-result-meta" style={{ marginTop: '0.5rem', fontSize: '0.7rem' }}>
                                <span>Chunk {res.chunkIndex + 1}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Triage Decision Pad (Always Visible) */}
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
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '2rem', minHeight: '400px' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem', color: 'var(--accent-cyan)' }}>
                Global Policy & Precedent RAG Search
              </h2>
              <p className="rag-header-desc">
                Adjuster-only access to query all uploaded policy directives, liability guidelines, and claimant evidence across the entire ClaimPilot database.
              </p>
            </div>

            <form onSubmit={handleGlobalSearch} className="search-bar-group" style={{ marginBottom: '1.5rem' }}>
              <input
                type="text"
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                placeholder="e.g. water damage limits, vehicle collision liability, deductibles..."
                className="search-input"
                style={{ fontSize: '0.95rem', padding: '0.85rem 1.25rem' }}
              />
              <button type="submit" disabled={globalSearchLoading} className="search-btn" style={{ padding: '0.85rem 2rem' }}>
                {globalSearchLoading ? 'Retrieving Chunks...' : 'Global Query'}
              </button>
            </form>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {globalSearchResults.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', padding: '3rem 0' }}>
                  <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>🌐</span>
                  <p style={{ fontSize: '0.9rem', fontStyle: 'italic', textAlign: 'center', maxWidth: '450px' }}>
                    Type a question above to perform a global vector similarity search across all claims, policies, and supporting documents.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <h4 style={{ fontSize: '0.95rem', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                    Top Vector Chunk Matches ({globalSearchResults.length})
                  </h4>
                  <div className="search-results-list">
                    {globalSearchResults.map((res, idx) => {
                      const simPct = Math.round(res.similarity * 100);
                      let badgeClass = 'badge-low';
                      if (simPct >= 75) badgeClass = 'badge-high';
                      else if (simPct >= 50) badgeClass = 'badge-mid';

                      return (
                        <div key={idx} className="search-result-card">
                          <div className="search-result-header">
                            <div className="search-result-title">
                              <span style={{ color: 'var(--accent-cyan)' }}>📄</span> {res.documentName}
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                                (Claim: {res.claimTitle} &middot; Owner: {res.claimantName})
                              </span>
                            </div>
                            <span className={`search-result-badge ${badgeClass}`}>
                              {simPct}% Similarity
                            </span>
                          </div>
                          <p className="search-result-content">{res.content}</p>
                          <div className="search-result-meta">
                            <span>Chunk Index: {res.chunkIndex + 1}</span>
                            <button
                              onClick={() => {
                                if (res.claimId) {
                                  setSelectedClaimId(res.claimId);
                                }
                              }}
                              className="btn btn-secondary"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)' }}
                            >
                              Inspect Claim &rarr;
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
      ) : (
        <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h2 style={{ fontSize: '1.75rem', color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
                System-Wide Insights & Analytics
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Real-time operational metrics, estimated claim liability exposures, and AI risk distribution vectors.
              </p>
            </div>
            <button onClick={fetchAnalytics} disabled={loadingAnalytics} className="search-btn" style={{ padding: '0.6rem 1.2rem', fontSize: '0.8rem' }}>
              {loadingAnalytics ? 'Refreshing...' : '🔄 Refresh Data'}
            </button>
          </div>

          {loadingAnalytics || !analytics ? (
            <div className="glass-card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '350px', color: 'var(--text-muted)', fontSize: '0.95rem', fontStyle: 'italic' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--accent-cyan)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem auto' }} />
                Retrieving and aggregating database metrics...
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {/* Analytics Summary Cards Grid */}
              <div className="analytics-grid">
                <div className="analytics-card" style={{ '--card-accent': 'var(--accent-cyan)' } as any}>
                  <div className="analytics-card-title">Total Claims Submitted</div>
                  <div className="analytics-card-value">
                    {analytics.statusCounts.reduce((acc: number, curr: any) => acc + Number(curr.count), 0)}
                  </div>
                  <div className="analytics-card-sub">Active in ClaimPilot Database</div>
                </div>

                <div className="analytics-card" style={{ '--card-accent': 'var(--accent-purple)' } as any}>
                  <div className="analytics-card-title">Estimated Loss Exposure</div>
                  <div className="analytics-card-value">
                    ${analytics.totalLoss.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="analytics-card-sub">Cumulative claims exposure sum</div>
                </div>

                <div className="analytics-card" style={{ '--card-accent': 'var(--state-review)' } as any}>
                  <div className="analytics-card-title">Average Risk Score</div>
                  <div className="analytics-card-value">
                    {Math.round(analytics.avgRisk * 100)}%
                  </div>
                  <div className="analytics-card-sub">Average AI risk scoring vector</div>
                </div>

                <div className="analytics-card" style={{ '--card-accent': 'var(--state-approved)' } as any}>
                  <div className="analytics-card-title">Average Claim Loss</div>
                  <div className="analytics-card-value">
                    ${Math.round(analytics.avgLoss).toLocaleString('en-US')}
                  </div>
                  <div className="analytics-card-sub">Calculated average per claim</div>
                </div>
              </div>

              {/* Main Charts Grid */}
              <div className="charts-grid">
                {/* 1. Status distribution */}
                <div className="chart-card">
                  <div className="chart-title">
                    <span>Claims Distribution</span>
                    <span className="chart-subtitle">By status state</span>
                  </div>
                  <BarChart
                    data={['draft', 'submitted', 'under_review', 'approved', 'rejected', 'more_info_needed'].map(status => {
                      const found = analytics.statusCounts.find((s: any) => s.status === status);
                      return {
                        status,
                        count: found ? Number(found.count) : 0
                      };
                    })}
                  />
                </div>

                {/* 2. Type distribution */}
                <div className="chart-card">
                  <div className="chart-title">
                    <span>Insurance Type Mix</span>
                    <span className="chart-subtitle">By claim category</span>
                  </div>
                  <DonutChart
                    data={['Auto', 'Property', 'Health', 'General Liability'].map(type => {
                      const found = analytics.typeCounts.find((t: any) => t.type === type);
                      return {
                        type,
                        count: found ? Number(found.count) : 0
                      };
                    })}
                  />
                </div>
              </div>

              {/* Full Width Line Chart */}
              <div className="chart-card" style={{ width: '100%' }}>
                <div className="chart-title">
                  <span>Intake Frequency Trend</span>
                  <span className="chart-subtitle">Daily claim submission volume (last 7 days)</span>
                </div>
                <div style={{ padding: '0.5rem 1rem' }}>
                  <LineChart data={getTrendData()} />
                </div>
              </div>

            </div>
          )}
        </main>
      )}
    </div>
  );
}
