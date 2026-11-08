import React from 'react';
import { getRole, setRole } from '../api.js';

export default function TopBar({ currentProject, onGoHome }) {
  const role = getRole();

  const handleRoleChange = (e) => {
    setRole(e.target.value);
  };

  const getRoleBadgeClass = () => {
    if (role === 'lead') return 'badge-role-lead';
    if (role === 'incoming') return 'badge-role-incoming';
    return 'badge-role-restricted';
  };

  const getRoleDescription = () => {
    if (role === 'lead') return 'Full review & snapshot rights • Sees confidential evidence';
    if (role === 'incoming') return 'Handover review view • Sees team & leads-only evidence';
    return 'Audited view • Sees team evidence only (confidential redacted)';
  };

  return (
    <header className="topbar">
      <div className="topbar-container">
        <div className="topbar-left">
          <button 
            type="button" 
            onClick={onGoHome} 
            className="brand-button"
            aria-label="Return to Baton projects home"
          >
            <span className="brand-icon">🏃‍♂️</span>
            <span className="brand-name">Baton</span>
          </button>

          {currentProject && (
            <div className="breadcrumbs">
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-current" title={currentProject.name}>
                {currentProject.name}
              </span>
            </div>
          )}
        </div>

        <div className="topbar-right">
          <div className="role-switcher-container">
            <label htmlFor="role-select" className="role-label">
              Role:
            </label>
            <select
              id="role-select"
              value={role}
              onChange={handleRoleChange}
              className={`role-select ${getRoleBadgeClass()}`}
              aria-label="Active user role"
              title={getRoleDescription()}
            >
              <option value="lead">Lead (Full Access & Review)</option>
              <option value="incoming">Incoming Member (Team + Leads)</option>
              <option value="restricted">Restricted Newcomer (Team Only)</option>
            </select>
          </div>

          <div className={`role-badge ${getRoleBadgeClass()}`}>
            {role.toUpperCase()}
          </div>
        </div>
      </div>
    </header>
  );
}
