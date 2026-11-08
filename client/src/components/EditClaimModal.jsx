import React, { useState } from 'react';
import api from '../api.js';

export default function EditClaimModal({ claim, onClose, onSaved }) {
  const [text, setText] = useState(claim.text || '');
  const [owner, setOwner] = useState(claim.owner || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Claim text cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await api.editClaim(claim.id, {
        text: text.trim(),
        owner: owner.trim() || null
      });
      onSaved();
    } catch (err) {
      console.error('Failed to edit claim:', err);
      setError(err.message || 'Failed to edit claim.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-claim-title">
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="edit-claim-title" className="modal-title">
            ✏️ Edit Claim
          </h2>
          <button type="button" onClick={onClose} className="modal-close-btn" aria-label="Close modal">
            &times;
          </button>
        </div>

        <form onSubmit={handleSave} className="modal-body">
          <div className="form-group">
            <label htmlFor="edit-claim-text" className="form-label">
              Claim Text <span className="text-danger">*</span>
            </label>
            <textarea
              id="edit-claim-text"
              className="form-textarea"
              rows="3"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-claim-owner" className="form-label">
              Owner / Assignee
            </label>
            <input
              id="edit-claim-owner"
              type="text"
              className="form-input"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="e.g. Priya Sharma (or leave blank if unassigned)"
            />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || !text.trim()}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
