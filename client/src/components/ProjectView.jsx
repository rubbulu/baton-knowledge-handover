import React, { useState, useEffect } from 'react';
import api, { getRole } from '../api.js';
import ClaimLedger from './ClaimLedger.jsx';
import TimelineView from './TimelineView.jsx';
import HandoverView from './HandoverView.jsx';
import EditClaimModal from './EditClaimModal.jsx';
import ConflictResolveModal from './ConflictResolveModal.jsx';
import VersionHistoryModal from './VersionHistoryModal.jsx';

export default function ProjectView({ project, onBack }) {
  const [projectData, setProjectData] = useState(project);
  const [claims, setClaims] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    verified: 0,
    single_source: 0,
    conflicting: 0,
    missing: 0,
    unverified: 0
  });

  const [activeTab, setActiveTab] = useState('ledger'); // 'ledger' | 'timeline' | 'handover'
  const [statusFilter, setStatusFilter] = useState('all');

  const [loading, setLoading] = useState(true);
  const [reconstructing, setReconstructing] = useState(false);
  const [reconstructNotice, setReconstructNotice] = useState(null);
  const [error, setError] = useState(null);

  // Modal states
  const [editingClaim, setEditingClaim] = useState(null);
  const [conflictedClaim, setConflictedClaim] = useState(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const role = getRole();
  const isLead = role === 'lead';

  useEffect(() => {
    loadProjectDetails();
  }, [project.id, role]);

  const loadProjectDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load project meta
      const projRes = await api.getProject(project.id);
      if (projRes.project) {
        setProjectData(projRes.project);
      }

      // Load claims
      const claimsRes = await api.getClaims(project.id);
      setClaims(claimsRes.claims || []);
      if (claimsRes.summary) {
        setSummary(claimsRes.summary);
      }
    } catch (err) {
      console.error('Failed to load project details:', err);
      setError(err.message || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  };

  const handleReconstruct = async () => {
    try {
      setReconstructing(true);
      setError(null);
      setReconstructNotice(null);

      const res = await api.reconstructProject(project.id);
      setReconstructNotice(
        `Extraction & Verification complete! ${res.claimsCount} claims extracted (${res.summary?.verified || 0} Verified, ${res.summary?.conflicting || 0} Conflicting, ${res.summary?.missing || 0} Missing). Source: ${res.source}`
      );

      await loadProjectDetails();
    } catch (err) {
      console.error('Reconstruction failed:', err);
      setError(err.message || 'Reconstruction failed. Please check Gemini API or cache.');
    } finally {
      setReconstructing(false);
    }
  };

  const handleConfirmClaim = async (claim) => {
    try {
      await api.confirmClaim(claim.id);
      await loadProjectDetails();
    } catch (err) {
      alert(`Failed to confirm claim: ${err.message}`);
    }
  };

  const handleRejectClaim = async (claim) => {
    try {
      await api.rejectClaim(claim.id);
      await loadProjectDetails();
    } catch (err) {
      alert(`Failed to reject claim: ${err.message}`);
    }
  };

  const handleFilterPillClick = (filterValue) => {
    setStatusFilter(filterValue);
    setActiveTab('ledger');
  };

  return (
    <div className="project-view-container">
      {/* Project Header Banner */}
      <div className="project-header">
        <div className="project-meta-col">
          <button type="button" onClick={onBack} className="back-link">
            &larr; Back to all projects
          </button>
          <h1 className="project-title">{projectData.name}</h1>
          {projectData.description && (
            <p className="project-description">{projectData.description}</p>
          )}
        </div>

        <div className="project-header-actions">
          {/* Reconstruct Button */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleReconstruct}
            disabled={reconstructing}
          >
            {reconstructing ? (
              <>
                <span className="spinner"></span>
                <span>Extracting & Verifying...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>Reconstruct Claims</span>
              </>
            )}
          </button>

          {/* Approve Handover / Version History */}
          {isLead && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowVersionHistory(true)}
              title="Snapshot approved handover version or view history"
            >
              📜 Approve & Versions
            </button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {reconstructNotice && (
        <div className="alert alert-success">
          <span>✓ {reconstructNotice}</span>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      {/* Verification Status Summary Pills (Interactive) */}
      <section className="status-summary-bar" aria-label="Verification status breakdown">
        <div
          className={`status-summary-card ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => handleFilterPillClick('all')}
          role="button"
          tabIndex="0"
          title="Filter all claims"
        >
          <span className="summary-count">{summary.total || claims.length}</span>
          <span className="summary-label">Total Claims</span>
        </div>

        <div
          className={`status-summary-card card-verified ${statusFilter === 'Verified' ? 'active' : ''}`}
          onClick={() => handleFilterPillClick('Verified')}
          role="button"
          tabIndex="0"
          title="Filter verified claims (supported in 2+ independent sources)"
        >
          <span className="summary-count">{summary.verified || 0}</span>
          <span className="summary-label">Verified (2+ Sources)</span>
        </div>

        <div
          className={`status-summary-card card-single ${statusFilter === 'Single-source' ? 'active' : ''}`}
          onClick={() => handleFilterPillClick('Single-source')}
          role="button"
          tabIndex="0"
          title="Filter single-source claims"
        >
          <span className="summary-count">{summary.single_source || 0}</span>
          <span className="summary-label">Single-source</span>
        </div>

        <div
          className={`status-summary-card card-conflicting ${statusFilter === 'Conflicting' ? 'active' : ''}`}
          onClick={() => handleFilterPillClick('Conflicting')}
          role="button"
          tabIndex="0"
          title="Filter conflicting claims"
        >
          <span className="summary-count">{summary.conflicting || 0}</span>
          <span className="summary-label">Conflicting</span>
        </div>

        <div
          className={`status-summary-card card-missing ${statusFilter === 'Missing' ? 'active' : ''}`}
          onClick={() => handleFilterPillClick('Missing')}
          role="button"
          tabIndex="0"
          title="Filter missing items (unassigned tasks or contacts)"
        >
          <span className="summary-count">{summary.missing || 0}</span>
          <span className="summary-label">Missing (Gaps)</span>
        </div>

        <div
          className={`status-summary-card card-unverified ${statusFilter === 'Unverified' ? 'active' : ''}`}
          onClick={() => handleFilterPillClick('Unverified')}
          role="button"
          tabIndex="0"
          title="Filter unverified claims (grounding quote missing from source text)"
        >
          <span className="summary-count">{summary.unverified || 0}</span>
          <span className="summary-label">Unverified</span>
        </div>
      </section>

      {/* Main Tabs Navigation */}
      <div className="project-tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'ledger' ? 'active' : ''}`}
          onClick={() => setActiveTab('ledger')}
        >
          📋 Claim Ledger ({claims.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          ⏳ Timeline of Decisions & Discussions
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'handover' ? 'active' : ''}`}
          onClick={() => setActiveTab('handover')}
        >
          📦 Handover Document & Next Actions
        </button>
      </div>

      {/* Tab Panels */}
      <div className="project-tab-content">
        {loading ? (
          <div className="loading-state">
            <span className="spinner"></span> Loading project claims...
          </div>
        ) : claims.length === 0 ? (
          <div className="empty-state">
            <h3>No Claims Extracted Yet</h3>
            <p>
              Click <strong>"Reconstruct Claims"</strong> above to parse all sources with Gemini LLM
              grounding and run the deterministic quote verifier.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleReconstruct}
              disabled={reconstructing}
              style={{ marginTop: '1rem' }}
            >
              {reconstructing ? 'Extracting & Verifying...' : '⚡ Run Reconstruction Now'}
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'ledger' && (
              <ClaimLedger
                claims={claims}
                activeStatusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                onEditClaim={(c) => setEditingClaim(c)}
                onResolveConflict={(c) => setConflictedClaim(c)}
                onConfirmClaim={handleConfirmClaim}
                onRejectClaim={handleRejectClaim}
              />
            )}

            {activeTab === 'timeline' && <TimelineView projectId={project.id} />}

            {activeTab === 'handover' && <HandoverView projectId={project.id} />}
          </>
        )}
      </div>

      {/* Modals */}
      {editingClaim && (
        <EditClaimModal
          claim={editingClaim}
          onClose={() => setEditingClaim(null)}
          onSaved={() => {
            setEditingClaim(null);
            loadProjectDetails();
          }}
        />
      )}

      {conflictedClaim && (
        <ConflictResolveModal
          claim={conflictedClaim}
          onClose={() => setConflictedClaim(null)}
          onResolved={() => {
            setConflictedClaim(null);
            loadProjectDetails();
          }}
        />
      )}

      {showVersionHistory && (
        <VersionHistoryModal
          projectId={project.id}
          onClose={() => setShowVersionHistory(false)}
          onVersionCreated={() => {
            loadProjectDetails();
          }}
        />
      )}
    </div>
  );
}
