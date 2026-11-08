import React, { useState } from 'react';
import api from '../api.js';

export default function ConflictResolveModal({ claim, onClose, onResolved }) {
  const [selectedOwner, setSelectedOwner] = useState(claim.owner || '');
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState(null);

  const evidence = claim.evidence || [];
  const ev1 = evidence[0] || null;
  const ev2 = evidence[1] || null;

  const handleResolve = async (e) => {
    e.preventDefault();
    if (!selectedOwner.trim()) {
      setError('Please specify or select the correct owner.');
      return;
    }

    try {
      setResolving(true);
      setError(null);

      await api.resolveConflict(claim.id, {
        chosen_owner: selectedOwner.trim(),
        resolution_note: resolutionNote.trim() || `Conflict resolved by lead: verified owner is ${selectedOwner.trim()}`
      });

      onResolved();
    } catch (err) {
      console.error('Failed to resolve conflict:', err);
      setError(err.message || 'Failed to resolve conflict.');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-card modal-large">
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            <span className="badge-status-conflicting">Conflicting</span> Resolve Ownership Conflict
          </h2>
          <button type="button" onClick={onClose} className="modal-close-btn" aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className="modal-body">
          <div className="conflict-claim-summary">
            <span className="claim-type-pill">{claim.type.toUpperCase()}</span>
            <p className="conflict-claim-text">{claim.text}</p>
          </div>

          <h3 className="section-subtitle">Conflicting Evidence from Independent Sources (Side by Side)</h3>

          <div className="conflict-evidence-grid">
            {/* Evidence 1 */}
            <div className={`conflict-evidence-card ${selectedOwner === ev1?.author ? 'selected' : ''}`}>
              <div className="conflict-ev-header">
                <span className="conflict-ev-source">📄 {ev1?.source_name || 'Source A'}</span>
                <span className="conflict-ev-ref">{ev1?.line_ref || ''}</span>
              </div>
              <div className="conflict-ev-author">
                Author / Cited: <strong>{ev1?.author || 'Unknown'}</strong>
              </div>
              <blockquote className="conflict-quote">
                "{ev1?.quote || 'No quote recorded'}"
              </blockquote>
              {ev1?.author && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-block"
                  onClick={() => setSelectedOwner(ev1.author)}
                >
                  Choose {ev1.author}
                </button>
              )}
            </div>

            {/* Evidence 2 */}
            <div className={`conflict-evidence-card ${selectedOwner === ev2?.author ? 'selected' : ''}`}>
              <div className="conflict-ev-header">
                <span className="conflict-ev-source">📄 {ev2?.source_name || 'Source B'}</span>
                <span className="conflict-ev-ref">{ev2?.line_ref || ''}</span>
              </div>
              <div className="conflict-ev-author">
                Author / Cited: <strong>{ev2?.author || 'Unknown'}</strong>
              </div>
              <blockquote className="conflict-quote">
                "{ev2?.quote || 'No quote recorded'}"
              </blockquote>
              {ev2?.author && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-block"
                  onClick={() => setSelectedOwner(ev2.author)}
                >
                  Choose {ev2.author}
                </button>
              )}
            </div>
          </div>

          <form onSubmit={handleResolve} style={{ marginTop: '1.25rem' }}>
            <div className="form-group">
              <label htmlFor="chosen-owner" className="form-label">
                Designated Verified Owner <span className="text-danger">*</span>
              </label>
              <input
                id="chosen-owner"
                type="text"
                className="form-input"
                value={selectedOwner}
                onChange={(e) => setSelectedOwner(e.target.value)}
                placeholder="e.g. Priya Sharma"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="resolution-note" className="form-label">
                Resolution Explanation & Audit Note
              </label>
              <textarea
                id="resolution-note"
                className="form-textarea"
                rows="2"
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="e.g. Confirmed with Arjun that GCP account was transitioned to Priya under student credits."
              />
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="modal-footer">
              <button type="button" onClick={onClose} className="btn btn-secondary" disabled={resolving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={resolving || !selectedOwner.trim()}>
                {resolving ? 'Resolving...' : 'Confirm Resolution & Approve Claim'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
