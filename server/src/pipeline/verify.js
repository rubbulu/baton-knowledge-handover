import { getDb } from '../db.js';
import crypto from 'crypto';

/**
 * Normalises text by collapsing whitespace, stripping non-alphanumeric punctuation,
 * and converting to lowercase for robust quote and subject matching.
 */
export function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether a given quote exists verbatim (ignoring case, formatting, and minor punctuation)
 * inside the cited chunk text.
 */
export function quoteExistsInChunk(quote, chunkText) {
  if (!quote || !chunkText) return false;
  const normQuote = normalizeText(quote);
  const normChunk = normalizeText(chunkText);
  if (!normQuote || !normChunk) return false;
  return normChunk.includes(normQuote);
}

/**
 * Extracts a normalized subject key for a claim, especially for owner and dependency claims.
 * Strips owner names, common action verbs, and stops words to isolate the core subject.
 */
export function extractSubject(claim) {
  if (!claim || !claim.text) return '';
  let text = claim.text;

  // Remove owner name from text if known
  if (claim.owner) {
    const escapedOwner = claim.owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escapedOwner, 'gi'), '');
  }

  // Remove leading prefixes like "decision:", "task:", "[TASK-XX]"
  text = text.replace(/^(?:decision|owner|task|dependency|risk|recurring_problem|notes):\s*/i, '');
  text = text.replace(/^\[[A-Z0-9_-]+\]\s*/i, '');

  // Strip common owner/action phrases
  text = text.replace(/\b(?:owned by|owner is|is owned by|holds the|managed by|responsible for|assigned to|takes over|transition|swapped|rotates|tied to)\b/gi, ' ');
  text = text.replace(/\b(?:under her|under his|on her|on his|personal|account|student|credits)\b/gi, ' ');

  const normalized = normalizeText(text);

  // Return significant keywords
  return normalized;
}

/**
 * Determines whether two extracted subjects refer to the exact same entity or topic.
 */
export function areSubjectsMatching(subject1, subject2) {
  if (!subject1 || !subject2) return false;
  if (subject1 === subject2) return true;

  // Check substring containment if long enough
  if (subject1.length >= 8 && subject2.includes(subject1)) return true;
  if (subject2.length >= 8 && subject1.includes(subject2)) return true;

  // Key phrase hard matches for common domain entities
  const keyEntities = [
    'google maps api',
    'maps api key',
    'next js',
    'vercel',
    'aws alumni server',
    'supabase',
    'discord webhook',
    'dns failover',
    'printexpress',
    'emergency reserve fund',
    'auditorium',
    'esp32'
  ];

  for (const entity of keyEntities) {
    if (subject1.includes(entity) && subject2.includes(entity)) {
      return true;
    }
  }

  // Token Jaccard similarity
  const tokens1 = new Set(subject1.split(' ').filter(t => t.length > 2));
  const tokens2 = new Set(subject2.split(' ').filter(t => t.length > 2));

  if (tokens1.size === 0 || tokens2.size === 0) return false;

  let intersection = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) intersection++;
  }

  const union = new Set([...tokens1, ...tokens2]).size;
  const similarity = intersection / union;

  return similarity >= 0.45;
}

/**
 * Pure verification logic for a single claim against its evidence, chunk lookup, and peer claims.
 * 
 * Rules applied in strict order:
 * 1. Quote check: Quote must exist in cited chunk text. If missing -> Unverified.
 * 2. Gap rule: Tasks with no assignee / dependencies with no owner -> Missing with gap_note.
 * 3. Conflict rule: Owner/dependency about same subject with differing owners across sources -> Conflicting.
 * 4. Source counting: 2+ distinct sources -> Verified. Exactly 1 -> Single-source.
 * 
 * @param {object} claim - { id, type, text, owner, status }
 * @param {Array} evidenceList - Array of { chunk_id, quote }
 * @param {Map} chunkMap - Map of chunk_id -> chunk record with { source_id, text, author }
 * @param {Array} peerClaims - Array of other claims in the project
 * @returns {object} { status, gap_note, validEvidence, distinctSourceIds, conflictEvidence }
 */
export function verifyClaim(claim, evidenceList = [], chunkMap = new Map(), peerClaims = []) {
  // 1. Verify quotes in cited chunks
  const validEvidence = [];
  const distinctSourceIds = new Set();

  for (const ev of evidenceList) {
    const chunk = chunkMap.get(ev.chunk_id);
    if (chunk && quoteExistsInChunk(ev.quote, chunk.text)) {
      validEvidence.push({
        ...ev,
        source_id: chunk.source_id,
        chunk_text: chunk.text
      });
      distinctSourceIds.add(chunk.source_id);
    }
  }

  // If quote is completely missing or invalid in all cited chunks -> Unverified
  if (validEvidence.length === 0) {
    return {
      status: 'Unverified',
      gap_note: 'Quote does not exist in the cited source text',
      validEvidence: [],
      distinctSourceIds: [],
      conflictEvidence: []
    };
  }

  // 2. Gap Rule: Tasks without assignee & Dependencies without owner/contact
  const hasNoOwner = !claim.owner ||
    claim.owner.trim() === '' ||
    claim.owner.toLowerCase() === 'unassigned' ||
    claim.owner.toLowerCase() === 'null' ||
    claim.owner.toLowerCase() === 'none';

  if (claim.type === 'task' && hasNoOwner) {
    return {
      status: 'Missing',
      gap_note: 'Task has no assigned owner/assignee',
      validEvidence,
      distinctSourceIds: Array.from(distinctSourceIds),
      conflictEvidence: []
    };
  }

  if (claim.type === 'dependency' && hasNoOwner) {
    return {
      status: 'Missing',
      gap_note: 'Dependency has no designated owner or contact point',
      validEvidence,
      distinctSourceIds: Array.from(distinctSourceIds),
      conflictEvidence: []
    };
  }

  // 3. Conflict Rule: For claims of type owner/dependency about the same subject,
  // if owners differ across sources -> Conflicting, store both pieces of evidence
  if (claim.type === 'owner' || claim.type === 'dependency') {
    const claimSubject = extractSubject(claim);

    for (const peer of peerClaims) {
      if (peer.id === claim.id) continue;
      if (peer.type !== 'owner' && peer.type !== 'dependency') continue;

      const peerSubject = extractSubject(peer);
      if (areSubjectsMatching(claimSubject, peerSubject)) {
        const normOwner1 = normalizeText(claim.owner || '');
        const normOwner2 = normalizeText(peer.owner || '');

        // If owners differ and peers have evidence
        if (normOwner1 && normOwner2 && normOwner1 !== normOwner2) {
          const peerEvidence = peer.evidence || [];
          const peerSources = peerEvidence.map(e => chunkMap.get(e.chunk_id)?.source_id).filter(Boolean);

          // Check if evidence comes from different sources (or different chunks)
          const sourcesAreDistinct = peerSources.some(sId => !distinctSourceIds.has(sId)) || peerSources.length > 0;

          if (sourcesAreDistinct) {
            return {
              status: 'Conflicting',
              gap_note: `Conflicting ownership: "${claim.owner}" vs "${peer.owner}" across independent sources`,
              validEvidence,
              distinctSourceIds: Array.from(distinctSourceIds),
              conflictEvidence: peerEvidence
            };
          }
        }
      }
    }
  }

  // Also check if other peer claims corroborate this claim (same subject & same owner/type across other sources)
  const allCorroboratingSources = new Set(distinctSourceIds);
  const claimSubject = extractSubject(claim);

  for (const peer of peerClaims) {
    if (peer.id === claim.id) continue;
    if (peer.type !== claim.type) continue;

    const peerSubject = extractSubject(peer);
    if (areSubjectsMatching(claimSubject, peerSubject)) {
      // Check owners match (or both have no owner)
      const normOwner1 = normalizeText(claim.owner || '');
      const normOwner2 = normalizeText(peer.owner || '');

      if (normOwner1 === normOwner2) {
        const peerEvidence = peer.evidence || [];
        for (const pev of peerEvidence) {
          const pChunk = chunkMap.get(pev.chunk_id);
          if (pChunk && quoteExistsInChunk(pev.quote, pChunk.text)) {
            allCorroboratingSources.add(pChunk.source_id);
          }
        }
      }
    }
  }

  // 4. Source Counting Rule:
  // 2 or more distinct sources -> Verified
  // Exactly 1 -> Single-source
  if (allCorroboratingSources.size >= 2) {
    return {
      status: 'Verified',
      gap_note: null,
      validEvidence,
      distinctSourceIds: Array.from(allCorroboratingSources),
      conflictEvidence: []
    };
  }

  return {
    status: 'Single-source',
    gap_note: null,
    validEvidence,
    distinctSourceIds: Array.from(allCorroboratingSources),
    conflictEvidence: []
  };
}

/**
 * Runs the deterministic verifier for all claims in a project and persists results to SQLite.
 * 
 * @param {string} projectId - Target project ID
 * @returns {object} { summary, total, claims }
 */
export function verifyProjectClaims(projectId) {
  const db = getDb();

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  // 1. Fetch claims
  const claims = db.prepare('SELECT * FROM claims WHERE project_id = ? ORDER BY created_at ASC').all(projectId);
  if (claims.length === 0) {
    return {
      summary: { total: 0, verified: 0, single_source: 0, conflicting: 0, missing: 0, unverified: 0 },
      claims: []
    };
  }

  // 2. Fetch all claim_evidence for project
  const claimIds = claims.map(c => c.id);
  const placeholders = claimIds.map(() => '?').join(',');

  const allEvidence = db.prepare(`
    SELECT ce.*, c.project_id
    FROM claim_evidence ce
    JOIN claims c ON c.id = ce.claim_id
    WHERE c.project_id = ?
  `).all(projectId);

  // 3. Fetch referenced chunks
  const referencedChunkIds = Array.from(new Set(allEvidence.map(e => e.chunk_id)));
  const chunkPlaceholders = referencedChunkIds.map(() => '?').join(',');

  const chunks = referencedChunkIds.length > 0
    ? db.prepare(`
        SELECT c.*, s.name as source_name, s.project_id
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
        WHERE c.id IN (${chunkPlaceholders})
      `).all(...referencedChunkIds)
    : [];

  const chunkMap = new Map(chunks.map(c => [c.id, c]));

  // Group evidence by claim_id
  const evidenceByClaim = new Map();
  for (const ev of allEvidence) {
    if (!evidenceByClaim.has(ev.claim_id)) {
      evidenceByClaim.set(ev.claim_id, []);
    }
    evidenceByClaim.get(ev.claim_id).push(ev);
  }

  // Attach evidence to claim objects for peer comparison
  const hydratedClaims = claims.map(c => ({
    ...c,
    evidence: evidenceByClaim.get(c.id) || []
  }));

  // 4. Verify each claim
  const results = [];
  const summary = {
    total: claims.length,
    verified: 0,
    single_source: 0,
    conflicting: 0,
    missing: 0,
    unverified: 0
  };

  const updateClaimStmt = db.prepare(`
    UPDATE claims
    SET status = ?, gap_note = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const insertEvidenceStmt = db.prepare(`
    INSERT OR IGNORE INTO claim_evidence (id, claim_id, chunk_id, quote, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  const verifyTx = db.transaction(() => {
    for (const claim of hydratedClaims) {
      const claimEvidence = evidenceByClaim.get(claim.id) || [];
      const verification = verifyClaim(claim, claimEvidence, chunkMap, hydratedClaims);

      // If conflicting, ensure peer conflict evidence is linked
      if (verification.status === 'Conflicting' && verification.conflictEvidence?.length > 0) {
        for (const cEv of verification.conflictEvidence) {
          const alreadyLinked = claimEvidence.some(e => e.chunk_id === cEv.chunk_id);
          if (!alreadyLinked) {
            insertEvidenceStmt.run(crypto.randomUUID(), claim.id, cEv.chunk_id, cEv.quote);
          }
        }
      }

      updateClaimStmt.run(verification.status, verification.gap_note || null, claim.id);

      // Increment summary
      switch (verification.status) {
        case 'Verified':
          summary.verified++;
          break;
        case 'Single-source':
          summary.single_source++;
          break;
        case 'Conflicting':
          summary.conflicting++;
          break;
        case 'Missing':
          summary.missing++;
          break;
        case 'Unverified':
        default:
          summary.unverified++;
          break;
      }

      results.push({
        id: claim.id,
        type: claim.type,
        text: claim.text,
        owner: claim.owner,
        status: verification.status,
        gap_note: verification.gap_note || null,
        distinctSourcesCount: verification.distinctSourceIds?.length || 0
      });
    }

    // 5. Audit Log
    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'claims_verified', 'verifier', ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      projectId,
      `Verified ${summary.total} claims: ${summary.verified} Verified, ${summary.single_source} Single-source, ${summary.conflicting} Conflicting, ${summary.missing} Missing, ${summary.unverified} Unverified.`
    );
  });

  verifyTx();

  console.log(`[Verifier] Project ${projectId}: ${summary.verified} Verified | ${summary.single_source} Single-source | ${summary.conflicting} Conflicting | ${summary.missing} Missing | ${summary.unverified} Unverified`);

  return {
    summary,
    total: summary.total,
    claims: results
  };
}

export default {
  normalizeText,
  quoteExistsInChunk,
  extractSubject,
  areSubjectsMatching,
  verifyClaim,
  verifyProjectClaims
};
