import React, { useState, useEffect } from 'react';
import api from '../api.js';

export default function VersionHistoryModal({ projectId, onClose, onVersionCreated }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState(null);
  const [newVersionNotice, setNewVersionNotice] = useState(null);

  useEffect(() => {
    loadVersions();
  }, [projectId]);

  const loadVersions = async () => {
    try {
      setLoading(true);
      const data = await api.getVersions(projectId);
      setVersions(data.versions || []);
    } catch (err) {
      console.error('Failed to load version history:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    try {
      setApproving(true);
      setError(null);
      const res = await api.approveHandover(projectId, true);
      setNewVersionNotice(`Successfully snapshot version v${res.version} with ${res.approvedClaimsCount} approved claims!`);
      await loadVersions();
      if (onVersionCreated) onVersionCreated(res.version);
    } catch (err) {
      console.error('Approve handover error:', err);
      setError(err.message || 'Failed to approve handover.');
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="versions-title">
      <div className="modal-card modal-large">
        <div className="modal-header">
          <h2 id="versions-title" className="modal-title">
            📜 Handover Approval & Version History
          </h2>
          <button type="button" onClick={onClose} className="modal-close-btn" aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {newVersionNotice && <div className="alert alert-success">{newVersionNotice}</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <div className="approve-action-box">
            <div>
              <h3 className="approve-action-title">Approve & Snapshot Current State</h3>
              <p className="approve-action-desc">
                Creates an immutable version snapshot of all currently approved claims for the handover recipient.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={approving}
            >
              {approving ? (
                <>
                  <span className="spinner"></span> Approving...
                </>
              ) : (
                <>
                  <span>✅</span> Approve Handover Snapshot
                </>
              )}
            </button>
          </div>

          <h3 className="section-subtitle" style={{ marginTop: '1.5rem' }}>
            Version History
          </h3>

          {loading ? (
            <div className="loading-state">
              <span className="spinner"></span> Loading version history...
            </div>
          ) : versions.length === 0 ? (
            <div className="empty-state">
              <p>No approved handover versions recorded yet. Click the button above to create version 1.</p>
            </div>
          ) : (
            <div className="versions-table-wrapper">
              <table className="versions-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Approved At</th>
                    <th>Approved By</th>
                    <th>Approved Claims</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((ver) => (
                    <tr key={ver.id}>
                      <td>
                        <span className="version-pill">v{ver.version_num}</span>
                      </td>
                      <td>{ver.created_at ? new Date(ver.created_at).toLocaleString() : 'N/A'}</td>
                      <td>
                        <span className="badge-role-lead">{ver.approvedBy || 'lead'}</span>
                      </td>
                      <td>{ver.claimsCount || 0} claims</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="modal-footer" style={{ marginTop: '1.5rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
