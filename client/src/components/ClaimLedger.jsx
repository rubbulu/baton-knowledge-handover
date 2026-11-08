import React, { useState } from 'react';
import { getRole } from '../api.js';

export default function ClaimLedger({
  claims = [],
  activeStatusFilter = 'all',
  onStatusFilterChange,
  onEditClaim,
  onResolveConflict,
  onConfirmClaim,
  onRejectClaim
}) {
  const role = getRole();
  const isLead = role === 'lead';

  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedEvidence, setExpandedEvidence] = useState({});

  const toggleEvidence = (claimId) => {
    setExpandedEvidence((prev) => ({
      ...prev,
      [claimId]: !prev[claimId]
    }));
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Verified':
        return 'badge-status-verified';
      case 'Single-source':
        return 'badge-status-single';
      case 'Conflicting':
        return 'badge-status-conflicting';
      case 'Missing':
        return 'badge-status-missing';
      case 'Unverified':
        return 'badge-status-unverified';
      default:
        return 'badge-status-default';
    }
  };

  const getTypeBadgeClass = (type) => {
    return `badge-type-${type ? type.replace('_', '-') : 'default'}`;
  };

  // Filter claims
  const filteredClaims = claims.filter((claim) => {
    // Redacted claims are displayed with placeholder if not filtered out
    if (claim.redacted) {
      if (activeStatusFilter !== 'all') return false;
      if (typeFilter !== 'all') return false;
      return true;
    }

    // Status filter
    if (activeStatusFilter !== 'all' && claim.status !== activeStatusFilter) {
      return false;
    }

    // Type filter
    if (typeFilter !== 'all' && claim.type !== typeFilter) {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const textMatch = claim.text && claim.text.toLowerCase().includes(q);
      const ownerMatch = claim.owner && claim.owner.toLowerCase().includes(q);
      const typeMatch = claim.type && claim.type.toLowerCase().includes(q);
      if (!textMatch && !ownerMatch && !typeMatch) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="claim-ledger-container">
      {/* Filters Toolbar */}
      <div className="ledger-toolbar">
        <div className="toolbar-filters">
          {/* Status Filter */}
          <div className="filter-group">
            <label htmlFor="status-filter" className="filter-label">
              Status:
            </label>
            <select
              id="status-filter"
              value={activeStatusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Statuses ({claims.length})</option>
              <option value="Verified">Verified</option>
              <option value="Single-source">Single-source</option>
              <option value="Conflicting">Conflicting</option>
              <option value="Missing">Missing</option>
              <option value="Unverified">Unverified</option>
            </select>
          </div>

          {/* Type Filter */}
          <div className="filter-group">
            <label htmlFor="type-filter" className="filter-label">
              Type:
            </label>
            <select
              id="type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Types</option>
              <option value="decision">Decision</option>
              <option value="owner">Owner</option>
              <option value="task">Task</option>
              <option value="dependency">Dependency</option>
              <option value="risk">Risk</option>
              <option value="recurring_problem">Recurring Problem</option>
            </select>
          </div>

          {/* Search Input */}
          <div className="filter-group search-group">
            <label htmlFor="claim-search" className="sr-only">
              Search claims
            </label>
            <input
              id="claim-search"
              type="text"
              placeholder="Search claims or owners..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="clear-search-btn"
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        <div className="toolbar-stats">
          Showing <strong>{filteredClaims.length}</strong> of {claims.length} claims
        </div>
      </div>

      {/* Claims List */}
      {filteredClaims.length === 0 ? (
        <div className="empty-state">
          <p>No claims match the selected filters.</p>
          {(activeStatusFilter !== 'all' || typeFilter !== 'all' || searchQuery) && (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              style={{ marginTop: '0.5rem' }}
              onClick={() => {
                onStatusFilterChange('all');
                setTypeFilter('all');
                setSearchQuery('');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="claims-list">
          {filteredClaims.map((claim) => {
            if (claim.redacted) {
              return (
                <div key={claim.id} className="claim-card claim-card-redacted">
                  <div className="redacted-header">
                    <span className="redacted-icon">🔒</span>
                    <span className="redacted-title">Confidential / Leads-Only Claim</span>
                    <span className="badge-role-restricted">REDACTED ON SERVER</span>
                  </div>
                  <p className="redacted-notice">
                    This claim contains confidential or leads-only evidence. Details, verbatim quotes, and
                    ownership data are withheld from role <code>{role}</code>.
                  </p>
                </div>
              );
            }

            const isExpanded = !!expandedEvidence[claim.id];
            const evidenceCount = claim.evidence ? claim.evidence.length : 0;

            return (
              <div
                key={claim.id}
                className={`claim-card ${claim.status === 'Conflicting' ? 'claim-conflict' : ''} ${
                  claim.status === 'Missing' ? 'claim-missing' : ''
                }`}
              >
                {/* Claim Card Top Bar */}
                <div className="claim-header">
                  <div className="claim-badges">
                    <span className={`badge-status ${getStatusBadgeClass(claim.status)}`}>
                      {claim.status}
                    </span>
                    <span className={`badge-type ${getTypeBadgeClass(claim.type)}`}>
                      {claim.type ? claim.type.replace('_', ' ').toUpperCase() : 'CLAIM'}
                    </span>
                    {claim.review_state && (
                      <span className={`badge-review badge-review-${claim.review_state}`}>
                        {claim.review_state.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Owner Display */}
                  <div className="claim-owner-badge">
                    {claim.owner ? (
                      <span className="owner-assigned" title={`Assigned Owner: ${claim.owner}`}>
                        👤 <strong>{claim.owner}</strong>
                      </span>
                    ) : (
                      <span className="owner-missing" title="No owner assigned">
                        ⚠️ <em>Unassigned</em>
                      </span>
                    )}
                  </div>
                </div>

                {/* Claim Statement */}
                <div className="claim-body">
                  <p className="claim-text">{claim.text}</p>

                  {/* Gap or Conflict Notice */}
                  {claim.gap_note && (
                    <div className="claim-gap-alert">
                      <span className="alert-icon">
                        {claim.status === 'Conflicting' ? '⚡' : '⚠️'}
                      </span>
                      <span>{claim.gap_note}</span>
                    </div>
                  )}
                </div>

                {/* Evidence Toggle Button & Review Actions */}
                <div className="claim-footer">
                  <button
                    type="button"
                    onClick={() => toggleEvidence(claim.id)}
                    className="btn-evidence-toggle"
                    aria-expanded={isExpanded}
                  >
                    <span>{isExpanded ? '▼ Hide Evidence' : '▶ Show Evidence'}</span>
                    <span className="evidence-count-bubble">{evidenceCount}</span>
                  </button>

                  {/* Lead Review Actions */}
                  {isLead && (
                    <div className="claim-actions">
                      {claim.status === 'Conflicting' && (
                        <button
                          type="button"
                          className="btn btn-warning btn-small"
                          onClick={() => onResolveConflict(claim)}
                          title="Review conflicting sources and choose verified owner"
                        >
                          ⚡ Resolve Conflict
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => onEditClaim(claim)}
                        title="Edit claim text or owner"
                      >
                        ✏️ Edit
                      </button>

                      {claim.review_state !== 'approved' && (
                        <button
                          type="button"
                          className="btn btn-success btn-small"
                          onClick={() => onConfirmClaim(claim)}
                          title="Confirm and approve claim"
                        >
                          ✓ Confirm
                        </button>
                      )}

                      {claim.review_state !== 'rejected' && (
                        <button
                          type="button"
                          className="btn btn-danger-outline btn-small"
                          onClick={() => onRejectClaim(claim)}
                          title="Reject claim"
                        >
                          ✕ Reject
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Expandable Evidence Panel */}
                {isExpanded && (
                  <div className="claim-evidence-panel">
                    <h4 className="evidence-title">Exact Source Grounding & Citations:</h4>
                    {evidenceCount === 0 ? (
                      <p className="no-evidence-note">No source evidence attached to this claim.</p>
                    ) : (
                      <div className="evidence-items">
                        {claim.evidence.map((ev, idx) => (
                          <div key={idx} className="evidence-item-card">
                            <div className="evidence-meta">
                              <span className="evidence-source">
                                📄 {ev.source_name || 'Source File'}
                              </span>
                              {ev.line_ref && (
                                <span className="evidence-ref">📍 {ev.line_ref}</span>
                              )}
                              {ev.author && (
                                <span className="evidence-author">👤 {ev.author}</span>
                              )}
                              {ev.access_label && (
                                <span className={`evidence-label-badge label-${ev.access_label}`}>
                                  {ev.access_label}
                                </span>
                              )}
                            </div>
                            <blockquote className="evidence-quote">
                              "{ev.quote}"
                            </blockquote>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
