let currentRole = localStorage.getItem('baton_role') || 'lead';
const roleListeners = new Set();

export function getRole() {
  return currentRole;
}

export function setRole(newRole) {
  currentRole = newRole;
  localStorage.setItem('baton_role', newRole);
  roleListeners.forEach(listener => listener(newRole));
}

export function subscribeRole(listener) {
  roleListeners.add(listener);
  return () => roleListeners.delete(listener);
}

/**
 * Universal fetch wrapper that injects X-Role and handles errors
 */
export async function apiFetch(endpoint, options = {}) {
  const headers = {
    'X-Role': currentRole,
    ...(options.headers || {})
  };

  // If body is object and not FormData, stringify to JSON
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    body
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}: ${res.statusText}`);
  }

  return data;
}

export const api = {
  getProjects: () => apiFetch('/api/projects'),
  getProject: (id) => apiFetch(`/api/projects/${id}`),
  createProject: (data) => apiFetch('/api/projects', { method: 'POST', body: data }),
  loadDemoProject: () => apiFetch('/api/projects/load-demo', { method: 'POST' }),

  uploadSources: (projectId, filesWithLabels) => {
    const formData = new FormData();
    filesWithLabels.forEach(({ file, accessLabel }) => {
      formData.append('files', file);
      formData.append('access_label', accessLabel);
    });
    return apiFetch(`/api/projects/${projectId}/sources`, {
      method: 'POST',
      body: formData
    });
  },

  reconstructProject: (id, options = {}) =>
    apiFetch(`/api/projects/${id}/reconstruct`, { method: 'POST', body: options }),

  getClaims: (id) => apiFetch(`/api/projects/${id}/claims`),
  getTimeline: (id) => apiFetch(`/api/projects/${id}/timeline`),
  getVersions: (id) => apiFetch(`/api/projects/${id}/versions`),
  getHandover: (id) => apiFetch(`/api/projects/${id}/handover`),

  editClaim: (claimId, data) =>
    apiFetch(`/api/claims/${claimId}`, { method: 'PATCH', body: data }),

  confirmClaim: (claimId, comment = '') =>
    apiFetch(`/api/claims/${claimId}/confirm`, { method: 'POST', body: { comment } }),

  rejectClaim(claimId, comment = '') {
    return apiFetch(`/api/claims/${claimId}/reject`, { method: 'POST', body: { comment } });
  },

  resolveConflict: (claimId, data) =>
    apiFetch(`/api/claims/${claimId}/resolve-conflict`, { method: 'POST', body: data }),

  approveHandover: (projectId, approveAll = true) =>
    apiFetch(`/api/projects/${projectId}/approve`, { method: 'POST', body: { approve_all: approveAll } }),

  acknowledgeHandover: (projectId, data = {}) =>
    apiFetch(`/api/projects/${projectId}/acknowledge`, { method: 'POST', body: data }),

  getAcknowledgements: (projectId) =>
    apiFetch(`/api/projects/${projectId}/acknowledgements`)
};

export default api;
