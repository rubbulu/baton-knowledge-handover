import React, { useState, useEffect } from 'react';
import api from '../api.js';

export default function TimelineView({ projectId }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    loadTimeline();
  }, [projectId]);

  const loadTimeline = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getTimeline(projectId);
      setTimeline(data.timeline || []);
    } catch (err) {
      console.error('Failed to load timeline:', err);
      setError(err.message || 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  };

  const filteredTimeline = timeline.filter((item) => {
    if (typeFilter === 'all') return true;
    if (typeFilter === 'decision') return item.type === 'decision';
    if (typeFilter === 'discussion') return item.type === 'discussion';
    if (typeFilter === 'meeting') return item.type === 'meeting';
    return true;
  });

  return (
    <div className="timeline-container">
      <div className="timeline-header-bar">
        <div>
          <h3 className="section-title">Chronological Project Timeline</h3>
          <p className="section-subtitle">
            Decisions, meeting milestones, and open discussions ordered by timestamp from source artifacts.
          </p>
        </div>

        <div className="timeline-filter-buttons">
          <button
            type="button"
            className={`btn btn-small ${typeFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTypeFilter('all')}
          >
            All Events ({timeline.length})
          </button>
          <button
            type="button"
            className={`btn btn-small ${typeFilter === 'decision' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTypeFilter('decision')}
          >
            Decisions Only
          </button>
          <button
            type="button"
            className={`btn btn-small ${typeFilter === 'discussion' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTypeFilter('discussion')}
          >
            Open Discussions
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <span className="spinner"></span> Loading chronological timeline...
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : filteredTimeline.length === 0 ? (
        <div className="empty-state">
          <p>No timeline events available for this project or filter.</p>
        </div>
      ) : (
        <div className="timeline-track">
          {filteredTimeline.map((item, idx) => (
            <div key={item.id || idx} className={`timeline-entry timeline-type-${item.type}`}>
              <div className="timeline-marker">
                <span className="marker-icon">
                  {item.type === 'decision' ? '🎯' : item.type === 'meeting' ? '📅' : '💬'}
                </span>
              </div>

              <div className="timeline-card">
                <div className="timeline-card-header">
                  <div className="timeline-card-meta">
                    <span className="timeline-time">🕒 {item.timestamp}</span>
                    <span className="timeline-author">👤 {item.author}</span>
                    <span className={`timeline-badge badge-event-${item.type}`}>
                      {item.type.toUpperCase()}
                    </span>
                  </div>

                  <div className="timeline-source-tag">
                    <span>📄 {item.source}</span>
                    {item.line_ref && <span className="timeline-ref">📍 {item.line_ref}</span>}
                    {item.access_label && (
                      <span className={`evidence-label-badge label-${item.access_label}`}>
                        {item.access_label}
                      </span>
                    )}
                  </div>
                </div>

                <div className="timeline-text">
                  {item.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
