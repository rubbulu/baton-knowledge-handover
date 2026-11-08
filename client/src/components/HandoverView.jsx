import React, { useState, useEffect } from 'react';
import api, { getRole, subscribeRole } from '../api.js';

export default function HandoverView({ projectId }) {
  const [role, setRole] = useState(getRole());
  const [handoverData, setHandoverData] = useState(null);
  const [acknowledgements, setAcknowledgements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [ackConfirmation, setAckConfirmation] = useState(null);
  const [expandedTrace, setExpandedTrace] = useState({});

  useEffect(() => {
    loadHandover();
    loadAcknowledgements();

    // Listen to role changes from TopBar
    const unsubscribe = subscribeRole((newRole) => {
      setRole(newRole);
      loadHandover(newRole);
    });

    return unsubscribe;
  }, [projectId]);

  const loadHandover = async (activeRole) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getHandover(projectId);
      setHandoverData(data);
    } catch (err) {
      console.error('Failed to load handover view:', err);
      setError(err.message || 'Failed to load handover view');
    } finally {
      setLoading(false);
    }
  };

  const loadAcknowledgements = async () => {
    try {
      const data = await api.getAcknowledgements(projectId);
      setAcknowledgements(data.acknowledgements || []);
    } catch (err) {
      console.warn('Failed to load acknowledgements:', err);
    }
  };

  const handleAcknowledge = async () => {
    try {
      setAcknowledging(true);
      const currentVer = handoverData?.version || 1;
      const res = await api.acknowledgeHandover(projectId, {
        version_num: currentVer,
        notes: `Handover receipt acknowledged by ${role} role (v${currentVer})`
      });

      setAckConfirmation({
        role,
        version: currentVer,
        timestamp: res.acknowledged_at || new Date().toISOString()
      });

      await loadAcknowledgements();
    } catch (err) {
      console.error('Acknowledge error:', err);
      alert(`Failed to acknowledge handover: ${err.message}`);
    } finally {
      setAcknowledging(false);
    }
  };

  const toggleTrace = (claimId) => {
    setExpandedTrace((prev) => ({
      ...prev,
      [claimId]: !prev[claimId]
    }));
  };

  if (loading) {
    return (
      <div className="loading-state">
        <span className="spinner"></span> Loading role-based handover package for <strong>{role.toUpperCase()}</strong>...
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  const { groups = {}, nextActions = [], next_actions = [], version, totalApprovedClaims = 0 } = handoverData || {};
  const actionsList = nextActions.length > 0 ? nextActions : next_actions;

  const renderClaimItem = (c, idx) => {
    if (c.redacted) {
      return (
        <li key={c.id || idx} className="group-item group-item-redacted">
          <div className="redacted-handover-box">
            <div className="redacted-banner">
              <span className="redacted-icon">🔒</span>
              <strong className="redacted-title">Restricted - ask the project lead</strong>
              <span className="badge-restricted-server">SERVER REDACTED</span>
            </div>
            <p className="redacted-subtext">
              This item contains confidential evidence and is securely redacted on the server for role <code>{role}</code>.
            </p>
          </div>
        </li>
      );
    }

    const isTraceOpen = !!expandedTrace[c.id];
    const evidenceList = c.evidence || [];

    return (
      <li key={c.id || idx} className="group-item">
        <div className="claim-item-main">
          <p className="group-item-text">{c.text}</p>
          
          <div className="group-item-meta">
            {c.owner ? (
              <span className="group-item-sub">👤 Owner: <strong>{c.owner}</strong></span>
            ) : (
              <span className="group-item-sub text-warning">⚠️ <em>Unassigned</em></span>
            )}

            {c.status && (
              <span className={`badge-status badge-status-${c.status.toLowerCase().replace(' ', '-')}`}>
                {c.status}
              </span>
            )}

            {/* Trace Link */}
            <button
              type="button"
              className="btn-trace-link"
              onClick={() => toggleTrace(c.id)}
              aria-expanded={isTraceOpen}
              title="Inspect grounded verbatim evidence citations"
            >
              <span>{isTraceOpen ? '▼ Hide Evidence' : '🔍 Trace Evidence'}</span>
              <span className="trace-count-pill">{evidenceList.length}</span>
            </button>
          </div>
        </div>

        {/* Trace Evidence Panel */}
        {isTraceOpen && (
          <div className="handover-trace-panel">
            <h5 className="trace-panel-title">Grounded Evidence Citations ({evidenceList.length}):</h5>
            {evidenceList.length === 0 ? (
              <p className="trace-empty">No cited source chunks attached.</p>
            ) : (
              <div className="trace-items">
                {evidenceList.map((ev, evIdx) => (
                  <div key={evIdx} className="trace-item-card">
                    <div className="trace-item-meta">
                      <span>📄 <strong>{ev.source_name || 'Source File'}</strong></span>
                      {ev.line_ref && <span>📍 {ev.line_ref}</span>}
                      {ev.author && <span>👤 {ev.author}</span>}
                      {ev.access_label && (
                        <span className={`evidence-label-badge label-${ev.access_label}`}>
                          {ev.access_label}
                        </span>
                      )}
                    </div>
                    <blockquote className="trace-quote">
                      "{ev.quote}"
                    </blockquote>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="handover-container">
      {/* Handover Header */}
      <div className="handover-banner">
        <div className="handover-banner-info">
          <div className="handover-version-tags">
            <span className="handover-version-pill">
              {version ? `Handover Snapshot v${version}` : 'Working Draft (Unversioned)'}
            </span>
            <span className={`role-badge badge-role-${role}`}>
              VIEWING AS: {role.toUpperCase()}
            </span>
          </div>
          <h2 className="handover-title">Official Project Handover Document</h2>
          <p className="handover-desc">
            Approved claims package for <strong>{role.toUpperCase()}</strong>. Confidential evidence has been verified and server-redacted where appropriate.
          </p>
        </div>

        <div className="handover-banner-action">
          {ackConfirmation ? (
            <div className="ack-confirmed-badge">
              <span className="ack-icon">✓</span>
              <div>
                <strong>Receipt Acknowledged!</strong>
                <div className="ack-sub">
                  Role: {ackConfirmation.role.toUpperCase()} &bull; {new Date(ackConfirmation.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={handleAcknowledge}
              disabled={acknowledging}
            >
              {acknowledging ? (
                <>
                  <span className="spinner"></span> Recording Receipt...
                </>
              ) : (
                <>
                  <span>📝</span> Acknowledge Receipt
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Alert if just acknowledged */}
      {ackConfirmation && (
        <div className="alert alert-success">
          <span>✓ Handover receipt officially recorded for role <strong>{ackConfirmation.role}</strong> (Version v{ackConfirmation.version}). Audit trail updated.</span>
        </div>
      )}

      {/* Code-Generated Next Actions */}
      <section className="handover-section">
        <h3 className="section-title">
          <span>🚀</span> Recommended Immediate Next Actions ({actionsList.length})
        </h3>
        <p className="section-subtitle">
          Code-generated priorities derived from open tasks, unassigned gaps, and disputed ownership.
        </p>

        {actionsList.length === 0 ? (
          <div className="empty-subcard">No urgent next actions required. All items assigned and resolved!</div>
        ) : (
          <div className="next-actions-grid">
            {actionsList.map((action, idx) => (
              <div key={idx} className={`next-action-card priority-${action.priority?.toLowerCase()}`}>
                <div className="next-action-header">
                  <span className={`priority-badge priority-${action.priority?.toLowerCase()}`}>
                    {action.priority}
                  </span>
                  <span className="next-action-owner">👤 {action.owner}</span>
                </div>
                <p className="next-action-text">{action.action}</p>
                {action.reason && <p className="next-action-reason">{action.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Structured Handover Groups */}
      <div className="handover-groups-grid">
        {/* Decisions */}
        <section className="handover-group-card">
          <h3 className="group-title">🎯 Decisions ({groups.decisions?.length || 0})</h3>
          <ul className="group-list">
            {(groups.decisions || []).map(renderClaimItem)}
            {(groups.decisions || []).length === 0 && (
              <li className="group-item empty">No approved decisions yet.</li>
            )}
          </ul>
        </section>

        {/* Owners & Key Contacts */}
        <section className="handover-group-card">
          <h3 className="group-title">👥 Key Owners & Contacts ({groups.owners?.length || 0})</h3>
          <ul className="group-list">
            {(groups.owners || []).map(renderClaimItem)}
            {(groups.owners || []).length === 0 && (
              <li className="group-item empty">No approved owners recorded.</li>
            )}
          </ul>
        </section>

        {/* Open Tasks */}
        <section className="handover-group-card">
          <h3 className="group-title">📋 Open Tasks ({groups.tasks?.length || 0})</h3>
          <ul className="group-list">
            {(groups.tasks || []).map(renderClaimItem)}
            {(groups.tasks || []).length === 0 && (
              <li className="group-item empty">No open tasks recorded.</li>
            )}
          </ul>
        </section>

        {/* Dependencies */}
        <section className="handover-group-card">
          <h3 className="group-title">🔗 Dependencies ({groups.dependencies?.length || 0})</h3>
          <ul className="group-list">
            {(groups.dependencies || []).map(renderClaimItem)}
            {(groups.dependencies || []).length === 0 && (
              <li className="group-item empty">No dependencies recorded.</li>
            )}
          </ul>
        </section>

        {/* Risks */}
        <section className="handover-group-card">
          <h3 className="group-title">⚠️ Risks ({groups.risks?.length || 0})</h3>
          <ul className="group-list">
            {(groups.risks || []).map(renderClaimItem)}
            {(groups.risks || []).length === 0 && (
              <li className="group-item empty">No risks recorded.</li>
            )}
          </ul>
        </section>

        {/* Recurring Problems */}
        <section className="handover-group-card">
          <h3 className="group-title">🔄 Recurring Problems ({groups.recurring_problems?.length || 0})</h3>
          <ul className="group-list">
            {(groups.recurring_problems || []).map(renderClaimItem)}
            {(groups.recurring_problems || []).length === 0 && (
              <li className="group-item empty">No recurring problems recorded.</li>
            )}
          </ul>
        </section>
      </div>

      {/* Acknowledgements History */}
      {acknowledgements.length > 0 && (
        <section className="acknowledgements-section">
          <h4 className="section-title">📜 Handover Receipt Acknowledgements ({acknowledgements.length})</h4>
          <div className="acknowledgements-list">
            {acknowledgements.map((ack) => (
              <div key={ack.id} className="ack-item-card">
                <div className="ack-item-header">
                  <span className={`role-badge badge-role-${ack.user_role}`}>
                    {ack.user_role?.toUpperCase()}
                  </span>
                  <span className="ack-date">
                    {new Date(ack.acknowledged_at).toLocaleString()}
                  </span>
                </div>
                <p className="ack-notes">{ack.notes}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
