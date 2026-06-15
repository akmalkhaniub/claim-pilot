"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clear any existing auth state on landing
  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }, []);

  const handleLogin = async (role: 'claimant' | 'adjuster') => {
    setLoading(role);
    setError(null);

    const email = role === 'claimant' ? 'claimant@claimpilot.com' : 'adjuster@claimpilot.com';
    const password = 'password123'; // Seeded default password

    try {
      const response = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to authenticate');
      }

      const { user, token } = await response.json();
      
      // Save credentials locally
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      console.log(`[Auth]: Logged in successfully as ${user.fullName}`);
      
      // Redirect based on role
      if (user.role === 'adjuster') {
        router.push('/adjuster');
      } else {
        router.push('/claimant');
      }
    } catch (err: any) {
      console.error('[Auth Error]:', err);
      setError(err.message || 'Connection to backend failed. Make sure server is running on port 3001.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
      <div className="glass-card" style={{ maxWidth: '480px', width: '100%', textAlign: 'center', padding: '3rem 2.5rem' }}>
        <h1 className="nav-brand" style={{ fontSize: '2.5rem', justifyContent: 'center', marginBottom: '1rem' }}>
          <span>\u2708</span> ClaimPilot
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.975rem', marginBottom: '2.5rem', lineHeight: '1.6' }}>
          AI-Powered Insurance Claim Intake, Risk Triage & Policy Retrieval Platform. Experience production-grade paperwork automation.
        </p>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            fontSize: '0.875rem',
            marginBottom: '1.5rem',
            textAlign: 'left'
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
            onClick={() => handleLogin('claimant')}
            disabled={loading !== null}
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.875rem', fontSize: '1rem' }}
          >
            {loading === 'claimant' ? 'Connecting to Claimant...' : 'Enter Claimant Portal'}
          </button>

          <button
            onClick={() => handleLogin('adjuster')}
            disabled={loading !== null}
            className="btn btn-secondary"
            style={{ width: '100%', padding: '0.875rem', fontSize: '1rem' }}
          >
            {loading === 'adjuster' ? 'Connecting to Adjuster...' : 'Enter Adjuster Portal'}
          </button>
        </div>

        <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--border-card)', paddingTop: '1.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            SOC 2 Compliance Guardrails Enabled &middot; pgvector RAG Triage
          </span>
        </div>
      </div>
    </div>
  );
}
