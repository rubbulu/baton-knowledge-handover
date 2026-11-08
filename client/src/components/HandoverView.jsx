import React, { useState, useEffect } from 'react';
import api, { getRole } from '../api.js';

export default function HandoverView({ projectId }) {
  const [handoverData, setHandoverData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const role = getRole();

  useEffect(() => {
    loadHandover();
  }, [projectId]);

  const loadHandover = async () => {
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

  const handleAcknowledge = async () => {
    try {
      setAcknowledging(true);
      await api.acknowledgeHandover(projectId, {
        notes: `Acknowledged handover by ${role}`
      });
      setAcknowledged(true);
    } catch (err) {
      console.error('Acknowledge error:', err);
    } finally {
      setAcknowledging(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <span className="spinner"></span> Loading role-based handover package...
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  const { groups = {}, nextActions = [], version, totalApprovedClaims = 0 } = handoverData || {};

  return (
    <div className="handover-container">
      {/* Handover Header */}
      <div className="handover-banner">
        <div>
          <span className="handover-version-pill">
            {version ? `Handover Snapshot v${version}` : 'Working Draft (Unversioned)'}
          </span>
          <h2 className="handover-title">Official Project Handover Document</h2>
          <p className="handover-desc">
            Showing approved claims tailored for role <strong>{role.toUpperCase()}</strong>. Confidential evidence has been verified and server-redacted where appropriate.
          </p>
        </div>

        <div>
          {acknowledged ? (
            <span className="badge-acknowledged">✓ Handover Acknowledged</span>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAcknowledge}
              disabled={acknowledging}
            >
              {acknowledging ? 'Recording...' : '📝 Sign & Acknowledge Handover'}
            </button>
          )}
        </div>
      </div>

      {/* Code-Generated Next Actions */}
      <section className="handover-section">
        <h3 className="section-title">
          <span>🚀</span> Recommended Immediate Next Actions ({nextActions.length})
        </h3>
        <p className="section-subtitle">
          Code-generated priorities derived from open tasks, unassigned gaps, and disputed ownership.
        </p>

        {nextActions.length === 0 ? (
          <div className="empty-subcard">No urgent next actions required. All items assigned and resolved!</div>
        ) : (
          <div className="next-actions-grid">
            {nextActions.map((action, idx) => (
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
          <h3 className="group-title">🎯 Approved Decisions ({groups.decisions?.length || 0})</h3>
          <ul className="group-list">
            {(groups.decisions || []).map((c, i) => (
              <li key={i} className="group-item">
                {c.redacted ? (
                  <span className="redacted-inline">🔒 [Confidential Decision Redacted]</span>
                ) : (
                  <>
                    <p className="group-item-text">{c.text}</p>
                    {c.owner && <span className="group-item-sub">Decided with: {c.owner}</span>}
                  </>
                )}
              </li>
            ))}
            {(groups.decisions || []).length === 0 && (
              <li className="group-item empty">No approved decisions yet.</li>
            )}
          </ul>
        </section>

        {/* Owners & Key Contacts */}
        <section className="handover-group-card">
          <h3 className="group-title">👥 Key Owners & Contacts ({groups.owners?.length || 0})</h3>
          <ul className="group-list">
            {(groups.owners || []).map((c, i) => (
              <li key={i} className="group-item">
                {c.redacted ? (
                  <span className="redacted-inline">🔒 [Confidential Owner Redacted]</span>
                ) : (
                  <>
                    <p className="group-item-text">{c.text}</p>
                    <span className="group-item-sub">👤 Owner: <strong>{c.owner || 'Unassigned'}</strong></span>
                  </>
                )}
              </li>
            ))}
            {(groups.owners || []).length === 0 && (
              <li className="group-item empty">No approved owners recorded.</li>
            )}
          </ul>
        </section>

        {/* Open Tasks */}
        <section className="handover-group-card">
          <h3 className="group-title">📋 Open Tasks ({groups.tasks?.length || 0})</h3>
          <ul className="group-list">
            {(groups.tasks || []).map((c, i) => (
              <li key={i} className="group-item">
                {c.redacted ? (
                  <span className="redacted-inline">🔒 [Confidential Task Redacted]</span>
                ) : (
                  <>
                    <p className="group-item-text">{c.text}</p>
                    <span className="group-item-sub">Assignee: {c.owner || '⚠️ Unassigned'}</span>
                  </>
                )}
              </li>
            ))}
            {(groups.tasks || []).length === 0 && (
              <li className="group-item empty">No open tasks recorded.</li>
            )}
          </ul>
        </section>

        {/* Dependencies */}
        <section className="handover-group-card">
          <h3 className="group-title">🔗 Dependencies ({groups.dependencies?.length || 0})</h3>
          <ul className="group-list">
            {(groups.dependencies || []).map((c, i) => (
              <li key={i} className="group-item">
                {c.redacted ? (
                  <span className="redacted-inline">🔒 [Confidential Dependency Redacted]</span>
                ) : (
                  <>
                    <p className="group-item-text">{c.text}</p>
                    {c.owner && <span className="group-item-sub">Contact: {c.owner}</span>}
                  </>
                )}
              </li>
            ))}
            {(groups.dependencies || []).length === 0 && (
              <li className="group-item empty">No dependencies recorded.</li>
            )}
          </ul>
        </section>

        {/* Risks */}
        <section className="handover-group-card">
          <h3 className="group-title">⚠️ Identified Risks ({groups.risks?.length || 0})</h3>
          <ul className="group-list">
            {(groups.risks || []).map((c, i) => (
              <li key={i} className="group-item">
                {c.redacted ? (
                  <span className="redacted-inline">🔒 [Confidential Risk Redacted]</span>
                ) : (
                  <>
                    <p className="group-item-text">{c.text}</p>
                    {c.gap_note && <span className="group-item-sub">{c.gap_note}</span>}
                  </>
                )}
              </li>
            ))}
            {(groups.risks || []).length === 0 && (
              <li className="group-item empty">No risks recorded.</li>
            )}
          </ul>
        </section>

        {/* Recurring Problems */}
        <section className="handover-group-card">
          <h3 className="group-title">🔄 Recurring Problems ({groups.recurring_problems?.length || 0})</h3>
          <ul className="group-list">
            {(groups.recurring_problems || []).map((c, i) => (
              <li key={i} className="group-item">
                {c.redacted ? (
                  <span className="redacted-inline">🔒 [Confidential Problem Redacted]</span>
                ) : (
                  <>
                    <p className="group-item-text">{c.text}</p>
                    {c.owner && <span className="group-item-sub">Reported by: {c.owner}</span>}
                  </>
                )}
              </li>
            ))}
            {(groups.recurring_problems || []).length === 0 && (
              <li className="group-item empty">No recurring problems recorded.</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
