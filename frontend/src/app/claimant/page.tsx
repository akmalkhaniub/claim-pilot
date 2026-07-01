"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Claim {
  id: string;
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'more_info_needed';
  title: string;
  claimType: string;
  createdAt: string;
}

interface ClaimField {
  key: string;
  value: any;
  confidence: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ClaimantDashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  
  // Claims list
  const [claims, setClaims] = useState<Claim[]>([]);
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  
  // Selected claim details
  const [activeClaim, setActiveClaim] = useState<Claim | null>(null);
  const [fields, setFields] = useState<ClaimField[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  
  // UI states
  const [loadingClaims, setLoadingClaims] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [newClaimTitle, setNewClaimTitle] = useState('');
  const [newClaimType, setNewClaimType] = useState('Auto');
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // RAG Search states
  const [rightPanelTab, setRightPanelTab] = useState<'chat' | 'search'>('chat');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Voice & Hotline simulation states
  const [isCallActive, setIsCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState<'dialing' | 'ringing' | 'connected' | 'ended'>('dialing');
  const [callTimer, setCallTimer] = useState(0);
  const [callTranscript, setCallTranscript] = useState<{ role: 'ai' | 'claimant'; text: string }[]>([]);
  const [isMicListening, setIsMicListening] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // Authenticate user on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (!storedToken || !storedUser) {
      router.push('/');
      return;
    }
    
    setToken(storedToken);
    setUser(JSON.parse(storedUser));
  }, [router]);

  // Load claims once authenticated
  useEffect(() => {
    if (token) {
      fetchClaims();
    }
  }, [token]);

  // Load active claim details
  useEffect(() => {
    if (activeClaimId && token) {
      fetchClaimDetails(activeClaimId);
      // Reset search states on claim switch
      setSearchQuery('');
      setSearchResults([]);
      setRightPanelTab('chat');
    }
  }, [activeClaimId, token]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Call timer effect
  useEffect(() => {
    let interval: any = null;
    if (isCallActive && callStatus === 'connected') {
      interval = setInterval(() => {
        setCallTimer(prev => prev + 1);
      }, 1000);
    } else {
      setCallTimer(0);
    }
    return () => clearInterval(interval);
  }, [isCallActive, callStatus]);

  // Web Audio DTMF synthesis
  const playDTMF = (freq1: number, freq2: number, duration: number = 180) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc1.frequency.value = freq1;
      osc2.frequency.value = freq2;
      
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.04);
      gainNode.gain.setValueAtTime(0.08, ctx.currentTime + duration / 1000 - 0.04);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration / 1000);
      
      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc1.start();
      osc2.start();
      
      setTimeout(() => {
        osc1.stop();
        osc2.stop();
        ctx.close();
      }, duration + 50);
    } catch (e) {
      console.error(e);
    }
  };

  const playDialingSequence = async () => {
    const sequence = [
      [770, 1336], // 5
      [770, 1336], // 5
      [770, 1336], // 5
      [941, 1336], // 0
      [697, 1209], // 1
      [941, 1336], // 0
      [941, 1336]  // 0
    ];
    for (let i = 0; i < sequence.length; i++) {
      playDTMF(sequence[i][0], sequence[i][1], 150);
      await new Promise(r => setTimeout(r, 220));
    }
  };

  const playRingbackTone = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      const ctx = new AudioContextClass();
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.08, ctx.currentTime + 1.4);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      
      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc1.start();
      osc2.start();
      
      return { osc1, osc2, ctx };
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  // TTS Verbal synthesis
  const speakAI = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*#_]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Zira') || v.name.includes('Samantha'))) || 
                  voices.find(v => v.lang.startsWith('en')) || 
                  voices[0];
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  // Direct dictation toggle
  const toggleDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition API is not supported in this browser. Please try Chrome or Edge.");
      return;
    }

    if (isDictating) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsDictating(false);
    } else {
      try {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = 'en-US';
        
        rec.onstart = () => {
          setIsDictating(true);
        };
        
        rec.onresult = (event: any) => {
          const text = event.results[0][0].transcript;
          setInputText(prev => prev + (prev ? ' ' : '') + text);
        };
        
        rec.onerror = (e: any) => {
          console.error("Speech recognition error:", e);
          setIsDictating(false);
        };
        
        rec.onend = () => {
          setIsDictating(false);
        };
        
        recognitionRef.current = rec;
        rec.start();
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
        setIsDictating(false);
      }
    }
  };

  // Dial hotline call
  const startHotlineCall = async () => {
    if (!activeClaimId) return;
    setIsCallActive(true);
    setCallStatus('dialing');
    setCallTranscript([]);
    
    await playDialingSequence();
    
    setCallStatus('ringing');
    const ringback = playRingbackTone();
    await new Promise(r => setTimeout(r, 2000));
    if (ringback) {
      ringback.osc1.stop();
      ringback.osc2.stop();
      ringback.ctx.close();
    }
    
    setCallStatus('connected');
    const welcomeMsg = "Welcome to the ClaimPilot Intake Hotline. Please tell me about your incident, including what happened, the date, and any details on location or damages.";
    setCallTranscript([{ role: 'ai', text: welcomeMsg }]);
    speakAI(welcomeMsg);
  };

  const endHotlineCall = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsMicListening(false);
    setCallStatus('ended');
    setTimeout(() => {
      setIsCallActive(false);
    }, 1000);
  };

  // Real-time microphone listening inside active call
  const startCallMicListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser. Please use the simulated scenarios buttons.");
      return;
    }

    if (isMicListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsMicListening(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      
      rec.onstart = () => {
        setIsMicListening(true);
      };
      
      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        sendCallMessage(text);
      };
      
      rec.onerror = (e: any) => {
        console.error("Speech recognition error in call:", e);
        setIsMicListening(false);
      };
      
      rec.onend = () => {
        setIsMicListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (e) {
      console.error(e);
      setIsMicListening(false);
    }
  };

  const sendCallMessage = async (messageText: string) => {
    if (!messageText.trim() || !activeClaimId || !token) return;

    // Add claimant message to visual transcripts
    setCallTranscript(prev => [...prev, { role: 'claimant', text: messageText }]);
    setMessages(prev => [...prev, { role: 'user', content: messageText }]);
    setIsMicListening(false);
    
    try {
      const res = await fetch(`http://localhost:3001/api/claims/${activeClaimId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: messageText })
      });

      if (!res.ok) throw new Error('Failed to send call message');
      if (!res.body) throw new Error('Streaming body empty');

      // Placeholders for incoming stream response
      setCallTranscript(prev => [...prev, { role: 'ai', text: '' }]);
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'text') {
                completedText += parsed.text;
                
                // Update transcripts line
                setCallTranscript(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'ai') {
                    last.text = completedText;
                  }
                  return updated;
                });
                
                // Update main messages
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    last.content = completedText;
                  }
                  return updated;
                });
              } else if (parsed.type === 'fields_extracted') {
                const newFields = parsed.fields;
                setFields(prev => {
                  const updated = [...prev];
                  Object.keys(newFields).forEach(key => {
                    const existingIdx = updated.findIndex(f => f.key === key);
                    if (existingIdx >= 0) {
                      updated[existingIdx].value = newFields[key];
                    } else {
                      updated.push({ key, value: newFields[key], confidence: 0.95 });
                    }
                  });
                  return updated;
                });
              }
            } catch (e) {
              console.error("Error parsing stream inside call:", e);
            }
          }
        }
      }

      speakAI(completedText);

    } catch (err) {
      console.error(err);
      setCallTranscript(prev => [...prev, { role: 'ai', text: 'Sorry, I lost connection to the server.' }]);
    }
  };

  const fetchClaims = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/claims', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setClaims(data.claims);
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
        setActiveClaim(data.claim);
        setFields(data.fields);
        
        // Fetch chat history from audit logs
        const historyRes = await fetch(`http://localhost:3001/api/claims/${id}/chat-history`, {
          // Fallback if separate history endpoint isn't defined, but we can also fetch it 
          // directly or mock it. Wait, let's see. In claims.ts we retrieve chat history from 
          // audit logs when starting the chat. We can make a separate route in claims.ts or just
          // rely on audit logs. Actually, in claims.ts we log user/assistant messages.
          // Let's query an endpoint. We will define an endpoint on Express to return history.
        });
        
        // Since we don't have separate endpoint for message history list in frontend yet,
        // we can fetch from claims endpoint if it returns transcripts.
        // Wait, did GET /api/claims/:id return chat history?
        // Let's modify GET /api/claims/:id in backend or fetch it from audit logs.
        // To be safe, we can add a route to get chat logs in claims.ts, or we can just fetch history.
        // Let's write a simple GET /api/claims/:id/chat route to fetch history.
        // Let's check: did GET /api/claims/:id return history?
        // No, it returned claim, fields, documents, and riskScore.
        // We will add history to the claim details response or create an endpoint.
        // Let's fetch history from an endpoint `/api/claims/${id}/history`.
        const historyResponse = await fetch(`http://localhost:3001/api/claims/${id}/history`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (historyResponse.ok) {
          const histData = await historyResponse.json();
          setMessages(histData.history);
        } else {
          setMessages([]);
        }
      }
    } catch (err) {
      console.error('Error fetching details:', err);
    }
  };

  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClaimTitle.trim()) return;

    try {
      const res = await fetch('http://localhost:3001/api/claims/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: newClaimTitle,
          claimType: newClaimType
        })
      });

      if (res.ok) {
        const data = await res.json();
        setClaims([data.claim, ...claims]);
        setActiveClaimId(data.claim.id);
        setShowCreateModal(false);
        setNewClaimTitle('');
      }
    } catch (err) {
      console.error('Error creating claim:', err);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || chatLoading || !activeClaimId) return;

    const userMessageText = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', content: userMessageText }]);
    setChatLoading(true);

    try {
      const res = await fetch(`http://localhost:3001/api/claims/${activeClaimId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: userMessageText })
      });

      if (!res.body) {
        throw new Error('Streaming not supported');
      }

      // Add a placeholder message for the assistant response
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep partial line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.type === 'text') {
                // Update the last assistant message
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    last.content += parsed.text;
                  }
                  return updated;
                });
              } else if (parsed.type === 'fields_extracted') {
                // Update fields card
                const newFields = parsed.fields;
                setFields(prev => {
                  const updated = [...prev];
                  Object.keys(newFields).forEach(key => {
                    const existingIdx = updated.findIndex(f => f.key === key);
                    if (existingIdx >= 0) {
                      updated[existingIdx].value = newFields[key];
                    } else {
                      updated.push({ key, value: newFields[key], confidence: 0.95 });
                    }
                  });
                  return updated;
                });
              }
            } catch (err) {
              console.error('Error parsing SSE line:', err);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in chat request:', err);
    } finally {
      setChatLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeClaimId) return;

    setUploadingDoc(true);

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Content = (reader.result as string).split(',')[1];
        
        const res = await fetch(`http://localhost:3001/api/claims/${activeClaimId}/documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type,
            fileContent: base64Content
          })
        });

        if (res.ok) {
          console.log('[Documents]: Document uploaded and indexed successfully.');
          fetchClaimDetails(activeClaimId);
        } else {
          console.error('Upload failed');
        }
        setUploadingDoc(false);
      };
    } catch (err) {
      console.error('Error uploading doc:', err);
      setUploadingDoc(false);
    }
  };

  const handleSubmitClaim = async () => {
    if (!activeClaimId) return;
    if (!confirm('Are you sure you want to submit this claim for risk assessment and final triage?')) return;

    try {
      const res = await fetch(`http://localhost:3001/api/claims/${activeClaimId}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        console.log('[Claims]: Claim submitted.');
        fetchClaims();
        fetchClaimDetails(activeClaimId);
      }
    } catch (err) {
      console.error('Error submitting claim:', err);
    }
  };

  const handleRAGSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !activeClaimId) return;

    setSearchLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/claims/${activeClaimId}/search?q=${encodeURIComponent(searchQuery)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      } else {
        console.error('RAG Search failed');
        setSearchResults([]);
      }
    } catch (err) {
      console.error('Error during RAG Search:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
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
        <div className="nav-brand">
          <span>\u2708</span> ClaimPilot Claimant Portal
        </div>
        <div className="nav-links">
          {user && <span className="nav-user">{user.fullName} ({user.email})</span>}
          <button onClick={logout} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
            Logout
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="dashboard-grid">
        
        {/* Left Side: Claims List & Claim Fields Metadata */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Claims Selector card */}
          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.2rem' }}>Your Claims</h3>
              <button onClick={() => setShowCreateModal(true)} className="btn btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                + File New Claim
              </button>
            </div>
            
            {loadingClaims ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading claims...</div>
            ) : claims.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                No claims filed. Create one to start.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {claims.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setActiveClaimId(c.id)}
                    className="glass-card glass-card-interactive"
                    style={{
                      padding: '0.75rem 1rem',
                      cursor: 'pointer',
                      borderLeft: activeClaimId === c.id ? '4px solid var(--accent-cyan)' : '1px solid var(--border-card)',
                      background: activeClaimId === c.id ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                      borderRadius: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.title}</span>
                      <span className={`badge badge-${c.status}`}>{c.status.replace('_', ' ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Claim Fields Panel */}
          {activeClaim && (
            <div className="glass-card">
              <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Claim Details</h3>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>ID: {activeClaim.id.substring(0,8)}...</span>
                <span className={`badge badge-${activeClaim.status}`} style={{ fontSize: '0.8rem' }}>
                  {activeClaim.status.replace('_', ' ')}
                </span>
              </div>

              {/* Upload Document Panel */}
              <div style={{ marginBottom: '1.5rem', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-card)', padding: '1rem', borderRadius: '8px' }}>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Upload Document (PDF/DOCX)</h4>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  Upload policy terms or damage receipts to feed RAG analysis.
                </p>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".pdf,.docx"
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingDoc}
                  className="btn btn-secondary"
                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem' }}
                >
                  {uploadingDoc ? 'Uploading & Indexing...' : 'Choose File'}
                </button>
              </div>

              {/* Real-time Extracted Fields list */}
              <h4 style={{ fontSize: '0.95rem', borderBottom: '1px solid var(--border-card)', paddingBottom: '0.5rem' }}>
                Extracted Fields
              </h4>
              <div className="fields-list">
                {['policy_number', 'claim_type', 'incident_date', 'loss_amount', 'incident_description'].map((key) => {
                  const field = fields.find((f) => f.key === key);
                  let valDisplay = field ? field.value : null;

                  if (key === 'loss_amount' && valDisplay) {
                    valDisplay = `$${valDisplay}`;
                  }

                  return (
                    <div key={key} className="field-item">
                      <span className="field-key">{key.replace('_', ' ')}</span>
                      {valDisplay ? (
                        <span className="field-val">{valDisplay.toString()}</span>
                      ) : (
                        <span className="field-empty">Not found yet</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Submit Button */}
              {activeClaim.status === 'draft' && (
                <button
                  onClick={handleSubmitClaim}
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '1.5rem', background: 'var(--state-approved)', color: 'white' }}
                >
                  Submit Claim for Triage
                </button>
              )}
            </div>
          )}

        </section>

        {/* Right Side: Interactive AI Chat Console */}
        <section className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          {activeClaimId ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Tab Header */}
              <div className="search-tab-header" style={{ padding: '0.5rem 1rem 0 1rem', display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => setRightPanelTab('chat')}
                  className={`search-tab-btn ${rightPanelTab === 'chat' ? 'active' : ''}`}
                >
                  AI Chat Assistant
                </button>
                <button
                  onClick={() => setRightPanelTab('search')}
                  className={`search-tab-btn ${rightPanelTab === 'search' ? 'active' : ''}`}
                >
                  RAG Policy & Document Search
                </button>
              </div>

              {rightPanelTab === 'chat' ? (
                <div className="chat-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: 'auto' }}>
                  {/* Chat Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-card)', background: 'rgba(255,255,255,0.01)' }}>
                    <div>
                      <h3 style={{ fontSize: '1.1rem' }}>AI Claim Intake Copilot</h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Answer the agent's questions conversationally to automatically fill your claim report.
                      </p>
                    </div>
                    {activeClaim?.status === 'draft' && (
                      <button
                        type="button"
                        onClick={startHotlineCall}
                        className="hotline-btn"
                      >
                        <span>📞</span> Call AI Hotline
                      </button>
                    )}
                  </div>

                  {/* Messages Pane */}
                  <div className="chat-messages" style={{ flex: 1 }}>
                    {messages.length === 0 && (
                      <div className="chat-bubble chat-bubble-assistant">
                        Hello! I'm your ClaimPilot AI assistant. I'm here to file your insurance claim.
                        To start, could you please provide your policy number and tell me what type of claim this is (Auto, Property, Health, or General Liability)?
                      </div>
                    )}
                    {messages.map((msg, i) => (
                      <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
                        {msg.content}
                      </div>
                    ))}
                    {chatLoading && messages[messages.length - 1]?.role === 'user' && (
                      <div className="chat-bubble chat-bubble-assistant pulse-active">
                        AI is writing response...
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input Box */}
                  <form onSubmit={handleSendMessage} className="chat-input-area" style={{ gap: '0.5rem' }}>
                    {activeClaim?.status === 'draft' && (
                      <button
                        type="button"
                        onClick={toggleDictation}
                        className={`mic-toggle-btn ${isDictating ? 'recording' : ''}`}
                        title="Toggle Voice Dictation"
                      >
                        {isDictating ? '🛑' : '🎤'}
                      </button>
                    )}
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={isDictating ? "Listening... Speak now" : "Type details of your incident here..."}
                      disabled={chatLoading || activeClaim?.status !== 'draft'}
                      className="chat-input"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || activeClaim?.status !== 'draft' || !inputText.trim()}
                      className="btn btn-primary"
                    >
                      Send
                    </button>
                  </form>
                </div>
              ) : (
                <div className="rag-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1.25rem', overflow: 'hidden' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Document Vector Explorer (RAG)</h3>
                    <p className="rag-header-desc">
                      Ask questions directly to search indexed text chunks of your uploaded policy, estimates, or receipts.
                    </p>
                  </div>

                  <form onSubmit={handleRAGSearch} className="search-bar-group" style={{ marginBottom: '1rem' }}>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="e.g. Is water damage covered? What is the deductible?"
                      className="search-input"
                    />
                    <button type="submit" disabled={searchLoading} className="search-btn">
                      {searchLoading ? 'Searching...' : 'Search'}
                    </button>
                  </form>

                  <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {searchResults.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', minHeight: '200px' }}>
                        <span style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔍</span>
                        <p style={{ fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center' }}>
                          No results yet. Type a query above to retrieve relevant document chunks using vector embedding matching.
                        </p>
                      </div>
                    ) : (
                      <div className="search-results-list">
                        {searchResults.map((res, idx) => {
                          const simPct = Math.round(res.similarity * 100);
                          let badgeClass = 'badge-low';
                          if (simPct >= 75) badgeClass = 'badge-high';
                          else if (simPct >= 50) badgeClass = 'badge-mid';

                          return (
                            <div key={idx} className="search-result-card">
                              <div className="search-result-header">
                                <div className="search-result-title">
                                  <span>📄</span> {res.documentName}
                                </div>
                                <span className={`search-result-badge ${badgeClass}`}>
                                  {simPct}% Match
                                </span>
                              </div>
                              <p className="search-result-content">{res.content}</p>
                              <div className="search-result-meta">
                                <span>Chunk Index: {res.chunkIndex + 1}</span>
                                <span>pgvector similarity</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', padding: '3rem' }}>
              <span style={{ fontSize: '3rem' }}>\uD83D\uDCC4</span>
              <p style={{ marginTop: '1rem', fontStyle: 'italic' }}>Select a claim or file a new one on the left to start the intake process.</p>
            </div>
          )}
        </section>

      </main>

      {/* Create Claim Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center',
          alignItems: 'center', zIndex: 1000, padding: '1rem'
        }}>
          <div className="glass-card" style={{ maxWidth: '400px', width: '100%' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.25rem' }}>File New Claim</h3>
            <form onSubmit={handleCreateClaim}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Claim Title
                </label>
                <input
                  type="text"
                  value={newClaimTitle}
                  onChange={(e) => setNewClaimTitle(e.target.value)}
                  placeholder="e.g. Broken Water Pipe In Kitchen"
                  required
                  className="chat-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Insurance Type
                </label>
                <select
                  value={newClaimType}
                  onChange={(e) => setNewClaimType(e.target.value)}
                  className="chat-input"
                  style={{ width: '100%', appearance: 'none' }}
                >
                  <option value="Auto">Auto</option>
                  <option value="Property">Property</option>
                  <option value="Health">Health</option>
                  <option value="General Liability">General Liability</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyItems: 'flex-end', gap: '0.75rem' }}>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Draft
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hotline Call Simulation Overlay */}
      {isCallActive && (
        <div className="call-overlay">
          {/* Header */}
          <div className="call-header">
            <span className="call-badge">
              {callStatus === 'connected' ? '● Live Hotline Intake' : 'Connecting...'}
            </span>
            <div className="call-timer">
              {Math.floor(callTimer / 60).toString().padStart(2, '0')}:
              {(callTimer % 60).toString().padStart(2, '0')}
            </div>
          </div>

          {/* Center Agent Avatar / Visualizer */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="call-avatar-container">
              {callStatus === 'connected' && (
                <>
                  <div className="call-pulse-ring" />
                  <div className="call-pulse-ring" />
                  <div className="call-pulse-ring" />
                </>
              )}
              <div className="call-avatar">
                🤖
              </div>
            </div>
            <div className="call-status">
              {callStatus === 'dialing' ? 'Dialing ClaimPilot Intake...' :
               callStatus === 'ringing' ? 'Ringing Hotline...' :
               callStatus === 'connected' ? 'Agent Intake Connected' : 'Call Disconnected'}
            </div>
            
            {/* Visualizer Wave */}
            {callStatus === 'connected' && (
              <div className="call-visualizer-wave">
                <div className="call-visualizer-bar" />
                <div className="call-visualizer-bar" />
                <div className="call-visualizer-bar" />
                <div className="call-visualizer-bar" />
                <div className="call-visualizer-bar" />
                <div className="call-visualizer-bar" />
                <div className="call-visualizer-bar" />
                <div className="call-visualizer-bar" />
              </div>
            )}
          </div>

          {/* Transcripts Panel */}
          {callStatus === 'connected' && (
            <div className="call-transcript-box">
              {callTranscript.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem', textAlign: 'center', marginTop: '3rem' }}>
                  Establishing dialogue transcript...
                </div>
              ) : (
                callTranscript.map((t, idx) => (
                  <div key={idx} className="call-transcript-line">
                    <div className="call-transcript-role" style={{ color: t.role === 'ai' ? 'var(--accent-cyan)' : 'var(--accent-purple)' }}>
                      {t.role === 'ai' ? 'AI Agent' : 'You (Claimant)'}
                    </div>
                    <div style={{ color: 'var(--text-primary)' }}>{t.text}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Bottom Prompt Scenario Aids or Speech Indicators */}
          {callStatus === 'connected' && (
            <div className="call-scenarios-panel">
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>
                Simulator Tools & Mic Input
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', margin: '0.25rem 0' }}>
                <button
                  onClick={startCallMicListening}
                  className={`btn ${isMicListening ? 'btn-danger' : 'btn-primary'}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1.25rem',
                    fontSize: '0.85rem',
                    background: isMicListening ? '#ef4444' : 'var(--accent-cyan)',
                    color: '#070a13',
                    border: 'none',
                    fontWeight: 600
                  }}
                >
                  {isMicListening ? '🔴 Stop Listening' : '🎤 Click to Speak'}
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.25rem' }}>
                Or trigger one-click spoken scenario fallbacks:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <button
                  onClick={() => sendCallMessage("Hi, I crashed my Tesla Model 3 into a light pole on Broadway. My policy number is CP-9922. The bumper is destroyed and estimated damage is about $5,000.")}
                  className="call-scenario-btn"
                >
                  🚗 <strong>Auto Crash</strong>: Tesla Model 3 hits light pole ($5,000, Policy CP-9922)
                </button>
                <button
                  onClick={() => sendCallMessage("Yes, hello, a pipe burst in my kitchen and flooded the hardwood floor. My policy number is CP-4401. The plumber charged me $2,500 to patch it.")}
                  className="call-scenario-btn"
                >
                  🏠 <strong>Water Leak</strong>: Burst pipe floods hard floor ($2,500, Policy CP-4401)
                </button>
                <button
                  onClick={() => sendCallMessage("Hello, I am claiming for my emergency room visit last week for food poisoning. The total medical bill is $1,200, policy number CP-8787.")}
                  className="call-scenario-btn"
                >
                  🏥 <strong>Medical ER</strong>: Hospital visit for food poisoning ($1,200, Policy CP-8787)
                </button>
              </div>
            </div>
          )}

          {/* Action Bar */}
          <div>
            <button
              onClick={endHotlineCall}
              className="call-hangup-btn"
              title="Hang Up Call"
            >
              📞
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
