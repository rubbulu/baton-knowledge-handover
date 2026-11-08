import React, { useState, useEffect } from 'react';
import api from '../api.js';

export default function HomeView({ onSelectProject }) {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Demo loading state
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState(null);

  // Create project form state
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProgress, setCreateProgress] = useState('');
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoadingProjects(true);
      const data = await api.getProjects();
      setProjects(data.projects || []);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleLoadDemo = async () => {
    try {
      setLoadingDemo(true);
      setDemoError(null);
      const data = await api.loadDemoProject();
      if (data.project) {
        onSelectProject(data.project);
      }
    } catch (err) {
      console.error('Demo load error:', err);
      setDemoError(err.message || 'Failed to load demo project');
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Default label: if filename includes 'confidential' -> confidential, 'chat' -> leads-only, else team
    const newItems = files.map((file) => {
      let defaultLabel = 'team';
      const lower = file.name.toLowerCase();
      if (lower.includes('confidential') || lower.includes('secret') || lower.includes('private')) {
        defaultLabel = 'confidential';
      } else if (lower.includes('chat') || lower.includes('slack') || lower.includes('leads')) {
        defaultLabel = 'leads-only';
      }

      return {
        id: Math.random().toString(36).substring(2),
        file,
        accessLabel: defaultLabel
      };
    });

    setSelectedFiles((prev) => [...prev, ...newItems]);
    e.target.value = '';
  };

  const handleLabelChange = (id, newLabel) => {
    setSelectedFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, accessLabel: newLabel } : item))
    );
  };

  const handleRemoveFile = (id) => {
    setSelectedFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!projectName.trim()) {
      setCreateError('Please enter a project name.');
      return;
    }

    try {
      setCreatingProject(true);
      setCreateError(null);
      setCreateProgress('Creating project workspace...');

      const createRes = await api.createProject({
        name: projectName.trim(),
        description: projectDesc.trim()
      });

      const newProject = createRes.project;

      if (selectedFiles.length > 0) {
        setCreateProgress(`Uploading and chunking ${selectedFiles.length} source file(s)...`);
        await api.uploadSources(newProject.id, selectedFiles);
      }

      setCreateProgress('Done!');
      onSelectProject(newProject);
    } catch (err) {
      console.error('Create project error:', err);
      setCreateError(err.message || 'Failed to create project and upload files.');
    } finally {
      setCreatingProject(false);
      setCreateProgress('');
    }
  };

  return (
    <div className="home-container">
      {/* Hero Banner */}
      <section className="home-hero">
        <h1 className="home-title">Knowledge Handover, Verified</h1>
        <p className="home-subtitle">
          Turn project notes, chat exports, and task boards into structured, verified claims with exact source quotes.
        </p>

        {/* Demo Project CTA */}
        <div className="demo-cta-card">
          <div className="demo-cta-content">
            <span className="demo-cta-badge">Hackathon Demo Dataset</span>
            <h2 className="demo-cta-title">CodeCraft Club Transition (Arjun → Priya)</h2>
            <p className="demo-cta-desc">
              Pre-seeded with 4 multi-source files: 3 meeting notes, 54 team chat messages, 15 task board rows, and confidential leadership channels with verified decisions, conflicting API owners, and unassigned gaps.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-large"
            onClick={handleLoadDemo}
            disabled={loadingDemo}
          >
            {loadingDemo ? (
              <>
                <span className="spinner"></span>
                <span>Loading Demo (108 Chunks)...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Load Demo Project</span>
              </>
            )}
          </button>
        </div>
        {demoError && <div className="alert alert-error">{demoError}</div>}
      </section>

      {/* Main Grid: Create Project & Project List */}
      <div className="home-grid">
        {/* Create Project Card */}
        <section className="card create-project-card">
          <h2 className="card-header-title">
            <span>➕</span> Create New Project
          </h2>

          <form onSubmit={handleCreateProject}>
            <div className="form-group">
              <label htmlFor="project-name" className="form-label">
                Project Name <span className="text-danger">*</span>
              </label>
              <input
                id="project-name"
                type="text"
                className="form-input"
                placeholder="e.g. Mobile App v2 Handover"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={creatingProject}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="project-desc" className="form-label">
                Description (Optional)
              </label>
              <textarea
                id="project-desc"
                className="form-textarea"
                rows="2"
                placeholder="Transition context, team members, scope..."
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                disabled={creatingProject}
              />
            </div>

            {/* File Upload Area */}
            <div className="form-group">
              <label className="form-label">Upload Source Files (.md, .txt, .csv)</label>
              <div className="file-dropzone">
                <input
                  id="source-files-input"
                  type="file"
                  multiple
                  accept=".md,.txt,.csv"
                  onChange={handleFileChange}
                  className="file-input-hidden"
                  disabled={creatingProject}
                />
                <label htmlFor="source-files-input" className="file-dropzone-label">
                  <span className="file-upload-icon">📁</span>
                  <span>Click to select Project Notes (.md), Chat Export (.txt), or Task Board (.csv)</span>
                </label>
              </div>
            </div>

            {/* Selected Files with Access Label Pickers */}
            {selectedFiles.length > 0 && (
              <div className="selected-files-list">
                <h3 className="files-list-title">Configure Access Labels per File:</h3>
                {selectedFiles.map((item) => (
                  <div key={item.id} className="file-item-card">
                    <div className="file-item-info">
                      <span className="file-item-name">{item.file.name}</span>
                      <span className="file-item-size">
                        {(item.file.size / 1024).toFixed(1)} KB
                      </span>
                    </div>

                    <div className="file-item-controls">
                      <label htmlFor={`label-${item.id}`} className="sr-only">
                        Access Label
                      </label>
                      <select
                        id={`label-${item.id}`}
                        value={item.accessLabel}
                        onChange={(e) => handleLabelChange(item.id, e.target.value)}
                        className={`label-select label-select-${item.accessLabel}`}
                        disabled={creatingProject}
                      >
                        <option value="team">Team (All members)</option>
                        <option value="leads-only">Leads Only (Incoming & Lead)</option>
                        <option value="confidential">Confidential (Current Lead Only)</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => handleRemoveFile(item.id)}
                        className="btn-icon-danger"
                        title="Remove file"
                        aria-label={`Remove ${item.file.name}`}
                        disabled={creatingProject}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {createProgress && (
              <div className="alert alert-info">
                <span className="spinner"></span> {createProgress}
              </div>
            )}

            {createError && <div className="alert alert-error">{createError}</div>}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={creatingProject || !projectName.trim()}
            >
              {creatingProject ? 'Creating & Chunking...' : 'Create Project'}
            </button>
          </form>
        </section>

        {/* Existing Projects List */}
        <section className="card existing-projects-card">
          <div className="card-header-row">
            <h2 className="card-header-title">
              <span>📋</span> Existing Projects
            </h2>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={loadProjects}
              disabled={loadingProjects}
              title="Refresh projects list"
            >
              ↻ Refresh
            </button>
          </div>

          {loadingProjects ? (
            <div className="loading-state">
              <span className="spinner"></span> Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <p>No projects yet. Click "Load Demo Project" above or create one.</p>
            </div>
          ) : (
            <div className="project-cards-stack">
              {projects.map((proj) => (
                <div
                  key={proj.id}
                  className="project-item-card"
                  onClick={() => onSelectProject(proj)}
                  tabIndex="0"
                  role="button"
                  onKeyDown={(e) => e.key === 'Enter' && onSelectProject(proj)}
                >
                  <div className="project-item-header">
                    <h3 className="project-item-title">{proj.name}</h3>
                    <span className="project-date">
                      {proj.created_at?.substring(0, 10)}
                    </span>
                  </div>
                  {proj.description && (
                    <p className="project-item-desc">{proj.description}</p>
                  )}
                  <div className="project-item-stats">
                    <span className="stat-pill">📁 {proj.sources_count || 0} sources</span>
                    <span className="stat-pill">🧩 {proj.chunks_count || 0} chunks</span>
                    <span className="stat-pill">🏷️ {proj.claims_count || 0} claims</span>
                    <span className="btn-link">Open &rarr;</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
