"use client";

import { useState, useEffect, useRef } from 'react';
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
  humanTakeover?: boolean;
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
  const [splitBTab, setSplitBTab] = useState<'transcript' | 'search' | 'audit' | 'sandbox' | 'agents'>('transcript');

  // Multi-Agent Simulation states
  const [simTimeline, setSimTimeline] = useState<any[]>([]);
  const [simConsensus, setSimConsensus] = useState<any | null>(null);
  const [simActiveCount, setSimActiveCount] = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const [simLoading, setSimLoading] = useState(false);

  // RAG Triage Sandbox states
  const [sandboxQuery, setSandboxQuery] = useState('');
  const [sandboxLimit, setSandboxLimit] = useState(5);
  const [sandboxThreshold, setSandboxThreshold] = useState(0.3);
  const [sandboxResults, setSandboxResults] = useState<any[]>([]);
  const [sandboxLoading, setSandboxLoading] = useState(false);

  // Batch operations states
  const [selectedClaimIds, setSelectedClaimIds] = useState<string[]>([]);
  const [batchStatusAction, setBatchStatusAction] = useState<'approved' | 'rejected' | 'under_review' | ''>('');
  const [batchRationale, setBatchRationale] = useState('');
  const [batchReEvaluate, setBatchReEvaluate] = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  
  // SOC 2 Audit states
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Historical similarity heatmap states
  const [similarClaims, setSimilarClaims] = useState<any[]>([]);
  const [hoveredDot, setHoveredDot] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Document verification states
  const [verifications, setVerifications] = useState<any[]>([]);
  const [expandedDocVerifyId, setExpandedDocVerifyId] = useState<string | null>(null);

  // Smartphone notification simulator states
  const [isPhoneOpen, setIsPhoneOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [activeNotifId, setActiveNotifId] = useState<string | null>(null);
  const [toastNotif, setToastNotif] = useState<{ visible: boolean; title: string; text: string; id: string } | null>(null);
  const lastSeenNotifCountRef = useRef<number>(0);
  
  // Takeover message state
  const [adjusterInput, setAdjusterInput] = useState('');
  
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

  // Live Takeover Polling for Adjuster
  useEffect(() => {
    let interval: any = null;
    if (selectedClaimId && token) {
      const pollDetails = async () => {
        try {
          // 1. Poll claim details
          const detailsRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (detailsRes.ok) {
            const data = await detailsRes.json();
            setSelectedClaim(data.claim);
            setFields(data.fields);
            setDocuments(data.documents);
            setRiskDetails(data.riskScore);
          }
          
          // 2. Poll history
          const historyRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/history`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (historyRes.ok) {
            const histData = await historyRes.json();
            setMessages(histData.history);
          }

          // 3. Poll compliance audit logs
          const auditRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/audit`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (auditRes.ok) {
            const auditData = await auditRes.json();
            setAuditLogs(auditData.audit || []);
          }

          // 4. Poll notifications
          const notifRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/notifications`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (notifRes.ok) {
            const notifData = await notifRes.json();
            const list = notifData.notifications || [];
            setNotifications(list);
            
            const prevCount = lastSeenNotifCountRef.current;
            if (list.length > prevCount) {
              const latestItem = list[list.length - 1];
              setToastNotif({
                visible: true,
                title: latestItem.type === 'email' ? '📧 New Email Received' : '💬 New SMS Alert',
                text: latestItem.type === 'email' ? latestItem.subject : latestItem.body,
                id: latestItem.id
              });
              
              // Play a quick synth chime tone
              try {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioContextClass) {
                  const ctx = new AudioContextClass();
                  const osc = ctx.createOscillator();
                  const gainNode = ctx.createGain();
                  osc.type = 'sine';
                  osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
                  osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
                  gainNode.gain.setValueAtTime(0, ctx.currentTime);
                  gainNode.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
                  gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
                  osc.connect(gainNode);
                  gainNode.connect(ctx.destination);
                  osc.start();
                  setTimeout(() => {
                    try {
                      osc.stop();
                      ctx.close();
                    } catch (e) {}
                  }, 400);
                }
              } catch (soundErr) {}

              setTimeout(() => {
                setToastNotif(prev => prev && prev.id === latestItem.id ? { ...prev, visible: false } : prev);
              }, 4000);
            }
            lastSeenNotifCountRef.current = list.length;
          }

          // 5. Poll similar claims
          const similarRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/similar`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (similarRes.ok) {
            const simData = await similarRes.json();
            setSimilarClaims(simData.similar || []);
          }

          // 6. Poll document verifications
          const verifyRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/document-verification`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (verifyRes.ok) {
            const verifyData = await verifyRes.json();
            setVerifications(verifyData.verifications || []);
          }
        } catch (e) {
          console.error("Adjuster polling error:", e);
        }
      };

      // Poll every 3 seconds
      interval = setInterval(pollDetails, 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedClaimId, token]);

  const handleToggleTakeover = async () => {
    if (!selectedClaimId || !token) return;
    const currentTakeover = selectedClaim?.humanTakeover;
    
    try {
      const res = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/takeover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ takeover: !currentTakeover })
      });
      
      if (res.ok) {
        const data = await res.json();
        setSelectedClaim(prev => prev ? { ...prev, humanTakeover: data.human_takeover } : null);
        
        // Refresh chat logs immediately
        const historyRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/history`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (historyRes.ok) {
          const histData = await historyRes.json();
          setMessages(histData.history);
        }
      }
    } catch (err) {
      console.error("Error toggling takeover:", err);
    }
  };

  const handleSendAdjusterMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjusterInput.trim() || !selectedClaimId || !token) return;

    const messageText = adjusterInput;
    setAdjusterInput('');

    try {
      const res = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/adjuster-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: messageText })
      });

      if (res.ok) {
        // Refresh chat history immediately
        const historyRes = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/history`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (historyRes.ok) {
          const histData = await historyRes.json();
          setMessages(histData.history);
        }
      }
    } catch (err) {
      console.error("Error sending adjuster message:", err);
    }
  };

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

        // Fetch compliance audit logs
        const auditRes = await fetch(`http://localhost:3001/api/claims/${id}/audit`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (auditRes.ok) {
          const auditData = await auditRes.json();
          setAuditLogs(auditData.audit || []);
        }

        // Fetch initial notifications
        const notifRes = await fetch(`http://localhost:3001/api/claims/${id}/notifications`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (notifRes.ok) {
          const notifData = await notifRes.json();
          const list = notifData.notifications || [];
          setNotifications(list);
          lastSeenNotifCountRef.current = list.length;
        }

        // Fetch similar claims
        const similarRes = await fetch(`http://localhost:3001/api/claims/${id}/similar`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (similarRes.ok) {
          const simData = await similarRes.json();
          setSimilarClaims(simData.similar || []);
        }

        // Fetch document verification
        const verifyRes = await fetch(`http://localhost:3001/api/claims/${id}/document-verification`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          setVerifications(verifyData.verifications || []);
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

  const handleSimulateTriage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sandboxQuery.trim() || !selectedClaimId) return;

    setSandboxLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/simulate-triage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          q: sandboxQuery,
          limit: sandboxLimit,
          threshold: sandboxThreshold
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSandboxResults(data.results || []);
      }
    } catch (err) {
      console.error('Error simulating RAG triage search:', err);
    } finally {
      setSandboxLoading(false);
    }
  };

  const handleBatchUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedClaimIds.length === 0 || !batchStatusAction) return;

    setSubmittingBatch(true);
    try {
      const res = await fetch(`http://localhost:3001/api/claims/batch-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          claimIds: selectedClaimIds,
          status: batchStatusAction,
          rationale: batchRationale,
          reEvaluate: batchReEvaluate
        })
      });

      if (res.ok) {
        alert(`Successfully processed batch updates for ${selectedClaimIds.length} claims.`);
        setSelectedClaimIds([]);
        setBatchStatusAction('');
        setBatchRationale('');
        setBatchReEvaluate(false);
        fetchClaims();
      } else {
        const data = await res.json();
        alert(`Failed to update batch: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error submitting batch triage:', err);
    } finally {
      setSubmittingBatch(false);
    }
  };

  const handleInitiateAgentSimulation = async () => {
    if (!selectedClaimId || simRunning || simLoading) return;

    setSimLoading(true);
    setSimTimeline([]);
    setSimConsensus(null);
    setSimActiveCount(0);

    try {
      const res = await fetch(`http://localhost:3001/api/claims/${selectedClaimId}/agent-simulation`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setSimTimeline(data.timeline || []);
        setSimConsensus(data.consensusReport || null);
        setSimLoading(false);
        setSimRunning(true);

        // Play sequence message by message
        let idx = 0;
        const total = data.timeline?.length || 0;
        const interval = setInterval(() => {
          idx++;
          setSimActiveCount(idx);
          if (idx >= total) {
            clearInterval(interval);
            setSimRunning(false);
          }
        }, 1200);
      } else {
        alert('Failed to initiate agent collaboration simulation');
        setSimLoading(false);
      }
    } catch (err) {
      console.error('Error simulating agent team collaboration:', err);
      setSimLoading(false);
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
                    <th style={{ width: '40px', padding: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={claims.length > 0 && selectedClaimIds.length === claims.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedClaimIds(claims.map(c => c.id));
                          } else {
                            setSelectedClaimIds([]);
                          }
                        }}
                      />
                    </th>
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
                        <td onClick={(e) => e.stopPropagation()} style={{ width: '40px', padding: '0.5rem' }}>
                          <input
                            type="checkbox"
                            checked={selectedClaimIds.includes(c.id)}
                            onChange={() => {
                              if (selectedClaimIds.includes(c.id)) {
                                setSelectedClaimIds(selectedClaimIds.filter(id => id !== c.id));
                              } else {
                                setSelectedClaimIds([...selectedClaimIds, c.id]);
                              }
                            }}
                          />
                        </td>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{selectedClaim.title}</h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Submitted by {selectedClaim.claimantName} ({selectedClaim.claimantEmail})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => window.open(`/adjuster/reports/${selectedClaim.id}`, '_blank')}
                  className="btn btn-primary"
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'var(--accent-cyan)',
                    color: '#070a13',
                    fontWeight: 700,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(0, 180, 216, 0.2)'
                  }}
                >
                  📄 Export Report
                </button>
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

              {/* Historical Claim Similarity Clustering Heatmap */}
              {similarClaims && similarClaims.length > 0 && (
                <div className="similarity-heatmap-card">
                  <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Historical Similarity Cluster</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                      (pgvector Match Space)
                    </span>
                  </h4>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    Bubble sizes represent semantic match index. Glowing dot marks current active claim.
                  </p>

                  <div className="similarity-scatter-container">
                    {hoveredDot && tooltipPos && (
                      <div className="scatter-tooltip" style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}>
                        <div className="scatter-tooltip-title">{hoveredDot.title}</div>
                        <div><strong>Type:</strong> <span style={{ textTransform: 'uppercase' }}>{hoveredDot.claimType}</span></div>
                        <div><strong>Loss Evaluated:</strong> ${Number(hoveredDot.lossAmount).toLocaleString()}</div>
                        <div><strong>Risk Score:</strong> {Math.round(hoveredDot.riskScore * 100)}%</div>
                        <div><strong>Vector Match Index:</strong> {Math.round(hoveredDot.similarity * 100)}%</div>
                        {hoveredDot.isActive && <div style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '0.2rem' }}>★ CURRENT ACTIVE CLAIM</div>}
                      </div>
                    )}

                    {(() => {
                      const paddingX = 45;
                      const paddingY = 30;
                      const width = 390;
                      const height = 180;

                      const losses = similarClaims.map(c => c.lossAmount || 0);
                      const maxLoss = Math.max(...losses, 5000);
                      const minLoss = Math.min(...losses, 0);

                      const getX = (loss: number) => {
                        const range = maxLoss - minLoss || 1;
                        return paddingX + ((loss - minLoss) / range) * (width - 2 * paddingX);
                      };

                      const getY = (risk: number) => {
                        return height - paddingY - (risk * (height - 2 * paddingY));
                      };

                      const getTypeColor = (type: string) => {
                        switch (type?.toLowerCase()) {
                          case 'property': return '#00b4d8';
                          case 'auto': return '#f59e0b';
                          case 'liability': return '#ef4444';
                          default: return '#10b981';
                        }
                      };

                      return (
                        <svg className="similarity-scatter-svg" viewBox={`0 0 ${width} ${height}`}>
                          {/* Grid ticks for Y-axis (Risk) */}
                          {[0, 0.25, 0.5, 0.75, 1.0].map((tick) => (
                            <g key={`y-tick-${tick}`}>
                              <line
                                x1={paddingX}
                                y1={getY(tick)}
                                x2={width - paddingX}
                                y2={getY(tick)}
                                className="scatter-grid-line"
                              />
                              <text
                                x={paddingX - 8}
                                y={getY(tick) + 3}
                                textAnchor="end"
                                style={{ fill: 'var(--text-muted)', fontSize: '0.55rem', fontFamily: 'monospace' }}
                              >
                                {Math.round(tick * 100)}%
                              </text>
                            </g>
                          ))}

                          {/* Grid ticks for X-axis (Loss) */}
                          {[0.1, 0.5, 0.9].map((ratio) => {
                            const lossVal = minLoss + ratio * (maxLoss - minLoss);
                            return (
                              <g key={`x-tick-${ratio}`}>
                                <line
                                  x1={getX(lossVal)}
                                  y1={paddingY}
                                  x2={getX(lossVal)}
                                  y2={height - paddingY}
                                  className="scatter-grid-line"
                                />
                                <text
                                  x={getX(lossVal)}
                                  y={height - paddingY + 12}
                                  textAnchor="middle"
                                  style={{ fill: 'var(--text-muted)', fontSize: '0.55rem', fontFamily: 'monospace' }}
                                >
                                  ${Math.round(lossVal / 1000)}k
                                </text>
                              </g>
                            );
                          })}

                          {/* X & Y Axes labels */}
                          <text
                            x={width / 2}
                            y={height - 2}
                            textAnchor="middle"
                            className="scatter-axis-label"
                          >
                            LOSS AMOUNT (USD)
                          </text>

                          <text
                            x={4}
                            y={12}
                            textAnchor="start"
                            className="scatter-axis-label"
                          >
                            RISK SCORE
                          </text>

                          {/* Dots */}
                          {similarClaims.map((c) => {
                            const cx = getX(c.lossAmount);
                            const cy = getY(c.riskScore);
                            const baseRadius = 5;
                            const r = baseRadius + (c.similarity * 8);

                            return (
                              <g key={c.id}>
                                {c.isActive && (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={r + 8}
                                    fill="none"
                                    stroke="#ef4444"
                                    strokeWidth="1.5"
                                    className="scatter-active-glow"
                                  />
                                )}
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={r}
                                  fill={getTypeColor(c.claimType)}
                                  className="scatter-dot"
                                  style={{
                                    filter: c.isActive ? 'drop-shadow(0 0 6px #ef4444)' : 'none',
                                    stroke: c.isActive ? '#fff' : 'rgba(7, 10, 19, 0.8)',
                                    strokeWidth: c.isActive ? 2 : 1
                                  }}
                                  onMouseEnter={(e) => {
                                    const rect = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                                    if (rect) {
                                      setHoveredDot(c);
                                      setTooltipPos({
                                        x: e.clientX - rect.left + 10,
                                        y: e.clientY - rect.top - 95
                                      });
                                    }
                                  }}
                                  onMouseLeave={() => setHoveredDot(null)}
                                />
                              </g>
                            );
                          })}
                        </svg>
                      );
                    })()}
                  </div>

                  {/* Legend */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '0.5rem', justifyContent: 'center' }}>
                    <div className="scatter-legend-item">
                      <div className="scatter-legend-color" style={{ background: '#00b4d8' }} />
                      <span>Property</span>
                    </div>
                    <div className="scatter-legend-item">
                      <div className="scatter-legend-color" style={{ background: '#f59e0b' }} />
                      <span>Auto</span>
                    </div>
                    <div className="scatter-legend-item">
                      <div className="scatter-legend-color" style={{ background: '#ef4444' }} />
                      <span>Liability</span>
                    </div>
                    <div className="scatter-legend-item">
                      <div className="scatter-legend-color" style={{ background: '#10b981' }} />
                      <span>Other</span>
                    </div>
                    <div className="scatter-legend-item" style={{ marginLeft: 'auto', fontSize: '0.6rem', opacity: 0.7 }}>
                      ★ Active Target
                    </div>
                  </div>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {documents.map((doc) => {
                      const verify = verifications.find(v => v.documentId === doc.id);
                      
                      return (
                        <div
                          key={doc.id}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '0.75rem 0.875rem',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--border-card)',
                            borderRadius: '6px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.825rem', fontWeight: 600 }}>📄 {doc.name}</span>
                              {verify && (
                                <span className={`verification-badge verification-badge-${verify.overallStatus}`}>
                                  {verify.overallStatus === 'pass' ? '✓ Verified' : (verify.overallStatus === 'fail' ? '❌ Invalid' : '⚠ Warning')}
                                </span>
                              )}
                              {verify && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedDocVerifyId(expandedDocVerifyId === doc.id ? null : doc.id)}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--accent-cyan)',
                                    cursor: 'pointer',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    textDecoration: 'underline',
                                    padding: 0
                                  }}
                                >
                                  {expandedDocVerifyId === doc.id ? 'Hide Details' : 'Verify Checklist'}
                                </button>
                              )}
                            </div>
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

                          {/* Expanded Checklist details */}
                          {verify && expandedDocVerifyId === doc.id && (
                            <div className="verification-checklist">
                              {verify.checks.map((c: any, i: number) => (
                                <div key={i} className="verification-check-item">
                                  <span className="verification-check-icon">
                                    {c.status === 'pass' ? '🟢' : (c.status === 'fail' ? '🔴' : '🟡')}
                                  </span>
                                  <div className="verification-check-details">
                                    <div className="verification-check-name">{c.name}</div>
                                    <div className="verification-check-text">{c.details}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Split B: Transcript, Claim Documents RAG Search & Human Triage Decision */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', maxHeight: 'calc(100vh - 160px)' }}>
              
              {/* Tab Header with Handoff Toggle */}
              <div className="search-tab-header" style={{ padding: '0.5rem 1rem 0 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                  <button
                    onClick={() => setSplitBTab('audit')}
                    className={`search-tab-btn ${splitBTab === 'audit' ? 'active' : ''}`}
                  >
                    🛡️ Compliance Audit Trail
                  </button>
                  <button
                    onClick={() => setSplitBTab('sandbox')}
                    className={`search-tab-btn ${splitBTab === 'sandbox' ? 'active' : ''}`}
                  >
                    🧪 RAG Sandbox
                  </button>
                  <button
                    onClick={() => setSplitBTab('agents')}
                    className={`search-tab-btn ${splitBTab === 'agents' ? 'active' : ''}`}
                  >
                    🤖 Multi-Agent Team
                  </button>
                </div>
                {selectedClaim?.status === 'draft' && (
                  <button
                    type="button"
                    onClick={handleToggleTakeover}
                    style={{
                      background: selectedClaim?.humanTakeover ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0, 180, 216, 0.12)',
                      color: selectedClaim?.humanTakeover ? '#ef4444' : 'var(--accent-cyan)',
                      border: `1px solid ${selectedClaim?.humanTakeover ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0, 180, 216, 0.3)'}`,
                      padding: '0.25rem 0.65rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {selectedClaim?.humanTakeover ? (
                      <>👤 Takeover Active (Release AI)</>
                    ) : (
                      <>🤖 AI Copilot (Take Over Chat)</>
                    )}
                  </button>
                )}
              </div>

              {/* Tab Content */}
              {splitBTab === 'transcript' ? (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <div className="chat-messages" style={{ padding: '1rem', flex: 1, overflowY: 'auto' }}>
                    {messages.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                        No messages recorded.
                      </div>
                    ) : (
                      messages.map((msg, i) => {
                        const isSystem = (msg as any).isSystem;
                        const senderName = isSystem ? 'System' : msg.role === 'user' ? 'Claimant' : ((msg as any).sender === 'adjuster' ? 'You (Adjuster)' : 'Intake AI');
                        const bubbleClass = isSystem ? 'system' : msg.role;
                        
                        return (
                          <div key={i} className={`chat-bubble chat-bubble-${bubbleClass}`} style={{ fontSize: '0.85rem', padding: '0.75rem', borderLeft: (msg as any).sender === 'adjuster' ? '3px solid var(--accent-cyan)' : undefined }}>
                            <strong>{senderName}:</strong>
                            <div style={{ marginTop: '0.25rem' }}>{msg.content}</div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Adjuster Takeover Message Input */}
                  {selectedClaim?.humanTakeover && (
                    <form onSubmit={handleSendAdjusterMessage} style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--border-card)', background: 'rgba(0, 180, 216, 0.03)' }}>
                      <input
                        type="text"
                        value={adjusterInput}
                        onChange={(e) => setAdjusterInput(e.target.value)}
                        placeholder="Type message directly to claimant..."
                        className="chat-input"
                        style={{ flex: 1 }}
                      />
                      <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>Send</button>
                    </form>
                  )}
                </div>
              ) : splitBTab === 'search' ? (
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
              ) : splitBTab === 'audit' ? (
                <div className="compliance-timeline-container">
                  <div style={{ marginBottom: '1.25rem' }}>
                    <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>SOC 2 Compliance Audit Timeline</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Strict, cryptographic ledger tracking of all system and user operations for this claim.
                    </p>
                  </div>
                  
                  {auditLogs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                      No audit events recorded yet.
                    </div>
                  ) : (
                    <div className="compliance-timeline" style={{ flex: 1, overflowY: 'auto' }}>
                      {auditLogs.map((log) => {
                        const isExpanded = expandedLogId === log.id;
                        const dateStr = new Date(log.createdAt).toLocaleString();
                        
                        let parsedDetails: any = {};
                        try {
                          parsedDetails = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                        } catch (e) {
                          parsedDetails = log.details;
                        }

                        // Skip raw system warnings in chat logs to keep ledger focused
                        if (log.action === 'chat_message' && parsedDetails.isSystem) {
                          return null;
                        }

                        let actionDisplay = log.action;
                        let summary = '';
                        let markerClass = '';
                        
                        switch (log.action) {
                          case 'CLAIM_DRAFT_CREATED':
                            actionDisplay = '📝 Draft Claim Created';
                            summary = `Claimant created draft titled "${parsedDetails.title || 'Untitled'}" (${parsedDetails.claimType || 'General'})`;
                            markerClass = 'draft';
                            break;
                          case 'DOCUMENT_UPLOADED':
                            actionDisplay = '📎 Document Uploaded & Indexed';
                            summary = `File "${parsedDetails.fileName || 'document'}" uploaded. Vector chunks indexed in pgvector.`;
                            markerClass = 'uploaded';
                            break;
                          case 'CLAIM_SUBMITTED':
                            actionDisplay = '🚀 Claim Submitted for Triage';
                            summary = `Claim submitted by claimant. Original status: "${parsedDetails.originalStatus || 'draft'}".`;
                            markerClass = 'submit';
                            break;
                          case 'AUTOMATED_RISK_EVALUATED':
                            actionDisplay = '🤖 Automated Risk Evaluation';
                            summary = `AI copilot assessed claim risk at ${Math.round(parsedDetails.score * 100)}%. Risk flags: ${parsedDetails.risk_flags?.join(', ') || 'None'}.`;
                            markerClass = 'triage';
                            break;
                          case 'takeover_initiated':
                          case 'TAKEOVER_INITIATED':
                            actionDisplay = '👤 Human Takeover Initiated';
                            summary = `Adjuster took over active chat, suspending automated AI agent responses.`;
                            markerClass = 'takeover';
                            break;
                          case 'takeover_released':
                          case 'TAKEOVER_RELEASED':
                            actionDisplay = '🤖 AI Intake Resumed';
                            summary = `Adjuster released chat takeover. AI copilot responses resumed.`;
                            markerClass = 'draft';
                            break;
                          case 'HUMAN_TRIAGE_DECISION':
                            actionDisplay = '⚖️ Human Triage Decision';
                            summary = `Adjuster triaged claim. Action: "${parsedDetails.action}", Next Status: "${parsedDetails.nextStatus}".`;
                            markerClass = 'triage';
                            break;
                          case 'chat_message':
                            actionDisplay = '💬 Chat Message Exchanged';
                            summary = `${parsedDetails.role === 'user' ? 'Claimant' : (parsedDetails.sender === 'adjuster' ? 'Adjuster' : 'AI Copilot')}: "${parsedDetails.content?.substring(0, 60)}${parsedDetails.content?.length > 60 ? '...' : ''}"`;
                            markerClass = 'uploaded';
                            break;
                          default:
                            summary = `Event trigger logged: ${log.action}`;
                        }

                        return (
                          <div key={log.id} className="timeline-item">
                            <div className={`timeline-marker ${markerClass}`}>
                              {log.action === 'AUTOMATED_RISK_EVALUATED' ? '🤖' : '✓'}
                            </div>
                            <div className="timeline-card">
                              <div className="timeline-header">
                                <span className="timeline-action">{actionDisplay}</span>
                                <span className="timeline-time">{dateStr}</span>
                              </div>
                              <div className="timeline-actor">
                                <span>Actor:</span>
                                <strong>{log.actorEmail || 'System/AI'}</strong>
                                {log.actorRole && <span className="role-badge">{log.actorRole}</span>}
                              </div>
                              <p className="timeline-summary">{summary}</p>
                              {log.ipAddress && (
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                  IP Address: {log.ipAddress}
                                </div>
                              )}
                              
                              <button
                                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                className="timeline-toggle-details"
                              >
                                {isExpanded ? '▼ Hide Audit Payload' : '▶ Show Audit Payload'}
                              </button>
                              
                              {isExpanded && (
                                <div className="timeline-payload-container">
                                  <pre className="timeline-payload">
                                    {JSON.stringify(parsedDetails, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : splitBTab === 'sandbox' ? (
                <div className="rag-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem', overflow: 'hidden' }}>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>🧪 RAG Triage Sandbox</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Simulate vector matches by adjusting similarity thresholds and chunk limit sizes.
                    </p>
                  </div>

                  <form onSubmit={handleSimulateTriage} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: '0.75rem 0' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        value={sandboxQuery}
                        onChange={(e) => setSandboxQuery(e.target.value)}
                        placeholder="Type test query to match vector embeddings..."
                        className="search-input"
                        style={{ flex: 1 }}
                      />
                      <button type="submit" disabled={sandboxLoading} className="search-btn" style={{ padding: '0 1rem' }}>
                        {sandboxLoading ? 'Simulating...' : 'Run Simulation'}
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-card)', padding: '0.75rem', borderRadius: '6px' }}>
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span>Similarity Threshold</span>
                          <strong>{Math.round(sandboxThreshold * 100)}%</strong>
                        </label>
                        <input
                          type="range"
                          min="0.0"
                          max="1.0"
                          step="0.05"
                          value={sandboxThreshold}
                          onChange={(e) => setSandboxThreshold(parseFloat(e.target.value))}
                          style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span>Chunk Retrieve Count Limit</span>
                          <strong>{sandboxLimit} Chunks</strong>
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="15"
                          step="1"
                          value={sandboxLimit}
                          onChange={(e) => setSandboxLimit(parseInt(e.target.value))}
                          style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
                        />
                      </div>
                    </div>
                  </form>

                  <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {sandboxResults.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', minHeight: '150px' }}>
                        <span style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>🧪</span>
                        <p style={{ fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center' }}>
                          Enter search query and run simulation to preview matched embeddings chunks.
                        </p>
                      </div>
                    ) : (
                      <div className="search-results-list" style={{ gap: '0.75rem' }}>
                        {sandboxResults.map((res, idx) => {
                          const simPct = Math.round(res.similarity * 100);
                          let badgeClass = 'badge-low';
                          if (simPct >= 75) badgeClass = 'badge-high';
                          else if (simPct >= 50) badgeClass = 'badge-mid';

                          return (
                            <div key={idx} className="search-result-card" style={{ padding: '0.875rem' }}>
                              <div className="search-result-header" style={{ marginBottom: '0.35rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>📄 {res.documentName}</span>
                                <span className={`search-result-badge ${badgeClass}`} style={{ fontSize: '0.65rem' }}>
                                  {simPct}% Match
                                </span>
                              </div>
                              <p className="search-result-content" style={{ fontSize: '0.775rem', padding: '0.4rem', background: 'rgba(255,255,255,0.01)', borderLeft: '2px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)' }}>
                                {res.content}
                              </p>
                              <div className="search-result-meta" style={{ marginTop: '0.35rem', fontSize: '0.65rem', display: 'flex', justifyContent: 'space-between' }}>
                                <span>Chunk Reference Index: {res.chunkIndex}</span>
                                <span style={{ opacity: 0.7 }}>Score: {res.similarity.toFixed(4)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div>
                      <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>🤖 Multi-Agent Underwriting Team</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Observe specialized AI agents analyze parameters, check limits, and compile a consensus logs report.
                      </p>
                    </div>
                    <button
                      onClick={handleInitiateAgentSimulation}
                      disabled={simRunning || simLoading}
                      className="search-btn"
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', background: 'var(--accent-cyan)', color: '#070a13', fontWeight: 700 }}
                    >
                      {simLoading ? 'Ingesting data...' : simRunning ? 'Simulating...' : 'Initiate Collaboration'}
                    </button>
                  </div>

                  {/* Agent Avatars Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    {[
                      { role: 'FraudAuditor', title: 'Auditor Vance', desc: 'Fraud & Risk Assessment', icon: '🛡️', color: '#f59e0b' },
                      { role: 'PolicyAnalyst', title: 'Analyst Jenkins', desc: 'Policy Coverage & Limits', icon: '📜', color: '#6366f1' },
                      { role: 'ComplianceOfficer', title: 'Inspector Holt', desc: 'SOC 2 & Checklist Audit', icon: '⚖️', color: '#10b981' }
                    ].map((agent, i) => {
                      const nextMsg = simTimeline[simActiveCount];
                      const isActive = nextMsg && nextMsg.agent === agent.role;
                      
                      return (
                        <div
                          key={i}
                          style={{
                            padding: '0.5rem 0.75rem',
                            background: 'rgba(255,255,255,0.02)',
                            border: `1.5px solid ${isActive ? 'var(--accent-cyan)' : 'var(--border-card)'}`,
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            transition: 'all 0.2s ease',
                            transform: isActive ? 'scale(1.02)' : 'scale(1.0)',
                            boxShadow: isActive ? '0 0 10px rgba(0, 180, 216, 0.25)' : 'none'
                          }}
                        >
                          <span style={{ fontSize: '1.5rem' }}>{agent.icon}</span>
                          <div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{agent.title}</div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{agent.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Dialogue Timeline list */}
                  <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-card)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    {simTimeline.length === 0 && !simLoading && (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
                        <span style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🤖</span>
                        <p style={{ fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center', maxWidth: '300px' }}>
                          Click the button above to run the automated multi-agent underwriting diagnostic.
                        </p>
                      </div>
                    )}

                    {simLoading && (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)' }}>
                        <div style={{ width: '30px', height: '30px', border: '3px solid var(--accent-cyan)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '0.75rem' }} />
                        <p style={{ fontSize: '0.8rem', fontStyle: 'italic' }}>Ingesting claim PostgreSQL indices & verifications logs...</p>
                      </div>
                    )}

                    {simTimeline.slice(0, simActiveCount).map((msg: any, i: number) => {
                      const isSystem = msg.agent === 'System';
                      
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: '0.5rem',
                            alignItems: 'flex-start',
                            background: isSystem ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.02)',
                            padding: '0.5rem 0.75rem',
                            borderRadius: '6px',
                            borderLeft: isSystem ? '3px solid #818cf8' : `3px solid ${msg.agent === 'FraudAuditor' ? '#f59e0b' : (msg.agent === 'PolicyAnalyst' ? '#6366f1' : '#10b981')}`,
                            animation: 'fadeInUp 0.25s ease'
                          }}
                        >
                          <span style={{ fontSize: '1.25rem' }}>{msg.avatar}</span>
                          <div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>{msg.name}</div>
                            <div style={{ fontSize: '0.775rem', marginTop: '0.15rem', color: 'var(--text-secondary)', lineHeight: '1.35' }}>
                              {msg.text}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {simRunning && simActiveCount < simTimeline.length && (
                      <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', opacity: 0.6 }}>
                        <span style={{ animation: 'bounce 1s infinite' }}>●</span>
                        <span style={{ animation: 'bounce 1s infinite 0.2s' }}>●</span>
                        <span style={{ animation: 'bounce 1s infinite 0.4s' }}>●</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>Agent team consulting...</span>
                      </div>
                    )}

                    {/* Consensus Report Card */}
                    {simActiveCount >= simTimeline.length && simConsensus && (
                      <div
                        style={{
                          background: 'rgba(0, 180, 216, 0.03)',
                          border: '2px dashed var(--accent-cyan)',
                          borderRadius: '8px',
                          padding: '1rem',
                          marginTop: '0.5rem',
                          animation: 'fadeInUp 0.4s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <h5 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Consensus Triage Report
                          </h5>
                          <span
                            className={`badge badge-${simConsensus.consensus === 'approve' ? 'approved' : (simConsensus.consensus === 'reject' ? 'rejected' : 'review')}`}
                            style={{ fontSize: '0.75rem', fontWeight: 700 }}
                          >
                            {simConsensus.consensus === 'approve' ? 'Approved (Consensus)' : (simConsensus.consensus === 'reject' ? 'Rejected (Consensus)' : 'Manual Review Referral')}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '6px', marginBottom: '0.75rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Confidence Indicator:</span>
                          <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${simConsensus.confidence}%`, height: '100%', background: 'var(--accent-cyan)' }} />
                          </div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>{simConsensus.confidence}%</span>
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                          <strong>Consensus Rationale:</strong>
                          <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            {simConsensus.rationale.map((r: string, idx: number) => (
                              <li key={idx} style={{ lineHeight: '1.3' }}>{r}</li>
                            ))}
                          </ul>
                        </div>

                        {simConsensus.flags?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                            {simConsensus.flags.map((flag: string, idx: number) => (
                              <span key={idx} style={{ fontSize: '0.65rem', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.15rem 0.35rem', borderRadius: '4px' }}>
                                ⚠ {flag}
                              </span>
                            ))}
                          </div>
                        )}

                        <button
                          onClick={() => {
                            const rationaleText = `[Multi-Agent Consensus - Confidence ${simConsensus.confidence}%]\n` +
                              simConsensus.rationale.map((r: string) => `- ${r}`).join('\n');
                            setAdjusterRationale(rationaleText);
                          }}
                          style={{
                            width: '100%',
                            background: 'rgba(0, 180, 216, 0.12)',
                            color: 'var(--accent-cyan)',
                            border: '1px solid rgba(0, 180, 216, 0.3)',
                            padding: '0.45rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          Adopt Agent Recommendation to Decision Pad
                        </button>
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
      {/* Real-time Push Notification Viewport Toast Banner */}
      <div 
        className={`viewport-notification-banner ${toastNotif && toastNotif.visible ? 'visible' : ''}`}
        onClick={() => {
          setIsPhoneOpen(true);
          if (toastNotif) {
            setActiveNotifId(toastNotif.id);
          }
          setToastNotif(prev => prev ? { ...prev, visible: false } : null);
        }}
      >
        <span className="banner-icon">
          {toastNotif?.title.includes('Email') ? '📧' : '💬'}
        </span>
        <div className="banner-content">
          <div className="banner-title">{toastNotif?.title}</div>
          <div className="banner-text">{toastNotif?.text}</div>
        </div>
      </div>

      {/* Floating Toggle Device Button */}
      {selectedClaimId && (
        <button 
          onClick={() => {
            setIsPhoneOpen(!isPhoneOpen);
            setActiveNotifId(null);
          }} 
          className="phone-toggle-btn"
          title="Toggle Mock Mobile Device"
        >
          📱
        </button>
      )}

      {/* Slide-out Mock Smartphone Drawer */}
      <div className={`phone-sidebar-drawer ${isPhoneOpen ? 'open' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: '320px', marginBottom: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Mock Device Inspector (Claimant Copy)
          </span>
          <button 
            onClick={() => setIsPhoneOpen(false)}
            style={{ background: 'transparent', border: 'none', color: '#ff4d4d', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
          >
            Close ✕
          </button>
        </div>

        <div className="smartphone-mock">
          <div className="phone-notch">
            <div className="phone-camera" />
          </div>
          
          <div className="phone-status-bar">
            <div>9:41</div>
            <div className="status-bar-icons">
              <span>📶</span>
              <span>📶</span>
              <span>🔋 85%</span>
            </div>
          </div>
          
          <div className="phone-screen">
            {activeNotifId ? (
              (() => {
                const notif = notifications.find(n => n.id === activeNotifId);
                if (!notif) return null;
                
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                    <div className="phone-app-header">
                      <button
                        onClick={() => setActiveNotifId(null)}
                        className="phone-back-btn"
                      >
                        ◀ Inbox
                      </button>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, marginLeft: '0.5rem' }}>
                        {notif.type === 'email' ? 'Mail Message' : 'SMS Chat'}
                      </span>
                    </div>
                    
                    {notif.type === 'email' ? (
                      <div className="phone-email-view">
                        <h2 className="email-view-subject">{notif.subject}</h2>
                        <div className="email-view-header">
                          <div><strong>From:</strong> {notif.sender}</div>
                          <div><strong>To:</strong> {notif.recipient}</div>
                          <div style={{ fontSize: '0.6rem', color: '#666', marginTop: '0.1rem' }}>
                            {new Date(notif.timestamp).toLocaleString()}
                          </div>
                        </div>
                        <div className="email-view-body">{notif.body}</div>
                      </div>
                    ) : (
                      <div className="phone-sms-view">
                        <div className="phone-app-header" style={{ background: '#111', borderBottom: '1px solid #222' }}>
                          <strong>{notif.sender}</strong>
                        </div>
                        <div className="sms-chat-box">
                          <div className="sms-bubble incoming">
                            {notif.body}
                            <div style={{ fontSize: '0.55rem', color: '#999', marginTop: '0.2rem', textAlign: 'right' }}>
                              {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <div className="phone-app-header" style={{ justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                    Notification Center
                  </span>
                </div>
                
                <div className="phone-inbox">
                  {notifications.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#555', fontSize: '0.7rem', gap: '0.5rem', textAlign: 'center', padding: '1rem' }}>
                      <span>🔔</span>
                      <span>No alerts. Initiate actions (draft, upload, submit) to trigger notifications.</span>
                    </div>
                  ) : (
                    [...notifications].reverse().map((notif) => {
                      const isSMS = notif.type === 'sms';
                      const timeStr = new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      
                      return (
                        <div
                          key={notif.id}
                          onClick={() => setActiveNotifId(notif.id)}
                          className="phone-inbox-item"
                        >
                          <div className="inbox-item-header">
                            <span>{isSMS ? '💬 SMS' : '📧 EMAIL'}</span>
                            <span>{timeStr}</span>
                          </div>
                          <div className="inbox-item-sender">{notif.sender}</div>
                          <div className="inbox-item-preview">
                            {isSMS ? notif.body : notif.subject}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Floating Bottom Batch Operations Drawer */}
      {selectedClaimIds.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '90%',
            maxWidth: '900px',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '2px solid var(--accent-cyan)',
            borderRadius: '12px',
            padding: '1.25rem 1.5rem',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
            backdropFilter: 'blur(12px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            animation: 'fadeInUp 0.3s ease'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>⚖️</span>
              <div>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  Batch Underwriting Simulator
                </h4>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Applying bulk status triage decision to <strong>{selectedClaimIds.length}</strong> selected claims.
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedClaimIds([])}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: 'none',
                color: 'var(--text-primary)',
                padding: '0.35rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
            >
              Clear Selection
            </button>
          </div>

          <form onSubmit={handleBatchUpdate} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                Batch Action Status
              </label>
              <select
                value={batchStatusAction}
                onChange={(e) => setBatchStatusAction(e.target.value as any)}
                required
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-card)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem'
                }}
              >
                <option value="" disabled style={{ background: '#0f172a' }}>Select action...</option>
                <option value="approved" style={{ background: '#0f172a' }}>Approve Claims (Bulk)</option>
                <option value="rejected" style={{ background: '#0f172a' }}>Reject Claims (Bulk)</option>
                <option value="under_review" style={{ background: '#0f172a' }}>Set to Under Review (Bulk)</option>
              </select>
            </div>

            <div style={{ flex: 2, minWidth: '300px' }}>
              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                Triage Rationale Details
              </label>
              <input
                type="text"
                value={batchRationale}
                onChange={(e) => setBatchRationale(e.target.value)}
                placeholder="Required justification rationale comment for audit trails..."
                required
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-card)',
                  borderRadius: '6px',
                  padding: '0.5rem',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem'
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', height: '36px', paddingBottom: '8px' }}>
              <input
                type="checkbox"
                id="batchReEvaluate"
                checked={batchReEvaluate}
                onChange={(e) => setBatchReEvaluate(e.target.checked)}
                style={{ accentColor: 'var(--accent-cyan)' }}
              />
              <label htmlFor="batchReEvaluate" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Run AI Assessment
              </label>
            </div>

            <button
              type="submit"
              disabled={submittingBatch}
              style={{
                background: 'var(--accent-cyan)',
                color: '#070a13',
                border: 'none',
                padding: '0.5rem 1.25rem',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                height: '36px'
              }}
            >
              {submittingBatch ? 'Executing...' : 'Apply Batch Decisions'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
