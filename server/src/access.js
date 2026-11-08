/**
 * Access Control Module for Baton
 * Enforces role-based visibility and server-side quote & claim redaction.
 * 
 * Roles:
 * - lead: sees 'team', 'leads-only', 'confidential'
 * - incoming: sees 'team', 'leads-only'
 * - restricted: sees 'team' only
 */

export const ROLE_PERMISSIONS = {
  lead: ['team', 'leads-only', 'confidential'],
  incoming: ['team', 'leads-only'],
  restricted: ['team']
};

export const VALID_ROLES = ['lead', 'incoming', 'restricted'];

/**
 * Normalises an incoming role string from headers or parameters.
 * Defaults to 'lead' if unspecified in development, but falls back safely to 'restricted'
 * if an unrecognized role is passed.
 */
export function normalizeRole(roleHeader) {
  if (!roleHeader) return 'lead';
  const lower = String(roleHeader).toLowerCase().trim();
  if (VALID_ROLES.includes(lower)) {
    return lower;
  }
  return 'restricted';
}

/**
 * Returns array of access labels a given role is allowed to see.
 */
export function getAllowedLabelsForRole(role) {
  const normRole = normalizeRole(role);
  return ROLE_PERMISSIONS[normRole] || ['team'];
}

/**
 * Checks whether a given role can see a specific access label.
 */
export function canRoleSeeLabel(role, label) {
  const allowed = getAllowedLabelsForRole(role);
  const normLabel = String(label || 'team').toLowerCase().trim();
  return allowed.includes(normLabel);
}

/**
 * Central access check:
 * A claim is visible to a role ONLY if the role can see ALL of its supporting evidence chunks.
 * If ANY supporting evidence chunk has an access label the role cannot see, returns false.
 * 
 * @param {string} role - 'lead' | 'incoming' | 'restricted'
 * @param {object} claim - Claim object with optional .evidence array
 * @returns {boolean}
 */
export function canSee(role, claim) {
  const normRole = normalizeRole(role);
  if (normRole === 'lead') return true;

  if (!claim) return false;

  const evidence = claim.evidence || [];
  if (evidence.length === 0) {
    // If no evidence is attached, check if claim object itself has an access label
    if (claim.access_label) {
      return canRoleSeeLabel(normRole, claim.access_label);
    }
    return true;
  }

  // All supporting evidence chunks must be visible to the role
  for (const ev of evidence) {
    const label = ev.access_label || 'team';
    if (!canRoleSeeLabel(normRole, label)) {
      return false; // Forbidden supporting evidence found
    }
  }

  return true;
}

/**
 * Returns either the full claim (with evidence filtered to visible labels)
 * or a redacted placeholder { id, redacted: true, reason: "restricted" }
 * with NO text, NO owner, and NO quote.
 * 
 * @param {string} role - 'lead' | 'incoming' | 'restricted'
 * @param {object} claim - Claim object with evidence array
 * @returns {object} Filtered or redacted claim
 */
export function filterOrRedactClaim(role, claim) {
  if (!claim) return null;

  const normRole = normalizeRole(role);

  // If role cannot see all supporting evidence, return strict redacted placeholder
  if (!canSee(normRole, claim)) {
    return {
      id: claim.id,
      redacted: true,
      reason: 'restricted'
    };
  }

  // Role is authorized to see the claim: filter evidence to visible labels
  const visibleEvidence = (claim.evidence || []).filter(ev => {
    return canRoleSeeLabel(normRole, ev.access_label || 'team');
  });

  return {
    ...claim,
    evidence: visibleEvidence
  };
}

export default {
  ROLE_PERMISSIONS,
  VALID_ROLES,
  normalizeRole,
  getAllowedLabelsForRole,
  canRoleSeeLabel,
  canSee,
  filterOrRedactClaim
};
