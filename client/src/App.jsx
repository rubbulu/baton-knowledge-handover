import React, { useState, useEffect } from 'react';
import TopBar from './components/TopBar.jsx';
import HomeView from './components/HomeView.jsx';
import ProjectView from './components/ProjectView.jsx';
import { subscribeRole } from './api.js';

export default function App() {
  const [currentProject, setCurrentProject] = useState(null);
  const [, setRoleState] = useState('lead');

  useEffect(() => {
    // Re-render when role changes in TopBar
    const unsubscribe = subscribeRole((newRole) => {
      setRoleState(newRole);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="app-layout">
      {/* TopBar with Role Switcher */}
      <TopBar
        currentProject={currentProject}
        onGoHome={() => setCurrentProject(null)}
      />

      {/* Main Content Area */}
      <main className="main-content">
        {currentProject ? (
          <ProjectView
            project={currentProject}
            onBack={() => setCurrentProject(null)}
          />
        ) : (
          <HomeView
            onSelectProject={(proj) => setCurrentProject(proj)}
          />
        )}
      </main>

      <footer className="app-footer">
        <div className="footer-inner">
          <span>🏃‍♂️ <strong>Baton</strong> &bull; Grounded Knowledge Handover</span>
          <span className="footer-separator">&bull;</span>
          <span>Deterministic Quote Verifier + Server-Enforced Redaction</span>
        </div>
      </footer>
    </div>
  );
}
