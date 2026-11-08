import React, { useState, useEffect } from 'react';

export default function App() {
  const [serverHealth, setServerHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setServerHealth(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to connect to backend API:', err);
        setServerHealth(null);
        setLoading(false);
      });
  }, []);

  return (
    <>
      <header>
        <div className="header-content">
          <div className="logo">
            <span>🏃‍♂️</span>
            <span>Baton</span>
          </div>
          <div className="status-indicator">
            <span className={`status-dot ${serverHealth ? 'online' : ''}`}></span>
            <span>
              {loading
                ? 'Connecting to server...'
                : serverHealth
                ? `Server Online (v${serverHealth.version})`
                : 'Server Offline'}
            </span>
          </div>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <h1>Knowledge Handover, Verified</h1>
          <p>
            Baton parses project notes, chat exports, and task boards to extract
            decisions, owners, tasks, dependencies, risks, and recurring problems as structured claims grounded in exact source quotes.
          </p>
        </section>

        <div className="grid">
          <div className="card">
            <h2 className="card-title">📁 Ingestion Sources</h2>
            <p className="card-desc">
              Upload project handover notes (<code>.md</code> / <code>.txt</code>), team chat exports (<code>.txt</code>), and task boards (<code>.csv</code>) to automatically extract project realities.
            </p>
          </div>

          <div className="card">
            <h2 className="card-title">🔍 Claim Extraction</h2>
            <p className="card-desc">
              Identifies <strong>Decisions</strong>, <strong>Owners</strong>, <strong>Tasks</strong>, <strong>Dependencies</strong>, <strong>Risks</strong>, and <strong>Recurring Problems</strong>—each cited with an exact source quote.
            </p>
          </div>

          <div className="card">
            <h2 className="card-title">🏷️ Verification Statuses</h2>
            <div style={{ marginTop: '0.5rem' }}>
              <span className="status-pill status-verified">Verified</span>
              <span className="status-pill status-single">Single-source</span>
              <span className="status-pill status-conflict">Conflicting</span>
              <span className="status-pill status-unverified">Unverified</span>
              <span className="status-pill status-missing">Missing</span>
            </div>
            <p className="card-desc" style={{ marginTop: '0.5rem' }}>
              Every claim is assessed for consistency across multiple source artifacts.
            </p>
          </div>

          <div className="card">
            <h2 className="card-title">🛡️ Role-Based Redaction</h2>
            <p className="card-desc">
              Incoming team members receive a clean, role-tailored view with confidential quotes redacted securely on the Express server.
            </p>
          </div>
        </div>
      </main>

      <footer>
        Baton &bull; Structured Knowledge Handover Tool &bull; Powered by Gemini LLM Adapter & SQLite
      </footer>
    </>
  );
}
