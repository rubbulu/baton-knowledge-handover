import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { chunkSource } from './chunker.js';
import { extractProjectClaims } from './pipeline/extract.js';
import { verifyProjectClaims } from './pipeline/verify.js';
import {
  normalizeRole,
  getAllowedLabelsForRole,
  canRoleSeeLabel,
  canSee,
  filterOrRedactClaim
} from './access.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

/**
 * Valid access labels
 */
const VALID_ACCESS_LABELS = ['team', 'leads-only', 'confidential'];

function sanitizeAccessLabel(label) {
  if (!label) return 'team';
  const lower = String(label).toLowerCase().trim();
  return VALID_ACCESS_LABELS.includes(lower) ? lower : 'team';
}

/**
 * GET /api/projects
 * List all projects
 */
router.get('/projects', (req, res) => {
  try {
    const db = getDb();
    const projects = db.prepare(`
      SELECT p.*,
        COUNT(DISTINCT s.id) as sources_count,
        COUNT(DISTINCT c.id) as chunks_count,
        COUNT(DISTINCT cl.id) as claims_count
      FROM projects p
      LEFT JOIN sources s ON s.project_id = p.id
      LEFT JOIN chunks c ON c.source_id = s.id
      LEFT JOIN claims cl ON cl.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all();

    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/projects', (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const projectName = name.trim();
    const projectDesc = description ? description.trim() : '';

    db.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(id, projectName, projectDesc);

    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(crypto.randomUUID(), id, 'project_created', 'system', `Created project "${projectName}"`);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id
 * Get project details, sources count, chunks count, claims
 */
router.get('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const sources = db.prepare(`
      SELECT s.*, COUNT(c.id) as chunks_count
      FROM sources s
      LEFT JOIN chunks c ON c.source_id = s.id
      WHERE s.project_id = ?
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `).all(id);

    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT c.id) as total_chunks,
        COUNT(DISTINCT cl.id) as total_claims
      FROM projects p
      LEFT JOIN sources s ON s.project_id = p.id
      LEFT JOIN chunks c ON c.source_id = s.id
      LEFT JOIN claims cl ON cl.project_id = p.id
      WHERE p.id = ?
    `).get(id);

    res.json({
      project,
      sources,
      stats: {
        totalSources: sources.length,
        totalChunks: stats ? stats.total_chunks : 0,
        totalClaims: stats ? stats.total_claims : 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects/:id/sources
 * Multipart upload of .md, .txt, .csv with access_label: team | leads-only | confidential
 */
router.post('/projects/:id/sources', upload.any(), (req, res) => {
  try {
    const { id: projectId } = req.params;
    const db = getDb();

    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided for upload' });
    }

    const globalAccessLabel = sanitizeAccessLabel(req.body.access_label);
    const results = [];

    const insertTx = db.transaction(() => {
      for (const file of files) {
        const originalName = file.originalname || 'uploaded-file.txt';
        const fileContent = file.buffer.toString('utf-8');
        const accessLabel = sanitizeAccessLabel(req.body.access_label || globalAccessLabel);

        // Determine source type from extension/name
        let type = 'notes';
        const lower = originalName.toLowerCase();
        if (lower.endsWith('.csv')) {
          type = 'tasks';
        } else if (lower.includes('chat') || lower.endsWith('.chat.txt')) {
          type = 'chat';
        } else if (req.body.type) {
          type = req.body.type;
        }

        const sourceId = crypto.randomUUID();

        // 1. Insert Source
        db.prepare(`
          INSERT INTO sources (id, project_id, name, type, access_label, raw_content, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(sourceId, projectId, originalName, type, accessLabel, fileContent);

        // 2. Chunk Source
        const chunks = chunkSource({
          content: fileContent,
          filename: originalName,
          type,
          accessLabel,
          sourceId
        });

        // 3. Insert Chunks
        const insertChunkStmt = db.prepare(`
          INSERT INTO chunks (id, source_id, author, timestamp, text, access_label, line_ref, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `);

        for (const chunk of chunks) {
          insertChunkStmt.run(
            chunk.id,
            chunk.source_id,
            chunk.author || null,
            chunk.timestamp || null,
            chunk.text,
            chunk.access_label,
            chunk.line_ref
          );
        }

        // 4. Audit Log
        db.prepare(`
          INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(
          crypto.randomUUID(),
          projectId,
          'source_uploaded',
          'user',
          `Uploaded "${originalName}" (${accessLabel}) resulting in ${chunks.length} chunks`
        );

        results.push({
          sourceId,
          name: originalName,
          type,
          accessLabel,
          chunksCreated: chunks.length
        });
      }
    });

    insertTx();

    res.status(201).json({
      message: 'Sources uploaded and chunked successfully',
      sources: results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/sources
 * List sources with chunk counts
 */
router.get('/projects/:id/sources', (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const sources = db.prepare(`
      SELECT s.id, s.project_id, s.name, s.type, s.access_label, s.created_at,
             COUNT(c.id) as chunks_count
      FROM sources s
      LEFT JOIN chunks c ON c.source_id = s.id
      WHERE s.project_id = ?
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `).all(id);

    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/chunks
 * List chunks for a project with optional filters: ?source_id=...&access_label=...
 */
router.get('/projects/:id/chunks', (req, res) => {
  try {
    const { id } = req.params;
    const { source_id, access_label } = req.query;
    const db = getDb();

    let query = `
      SELECT c.*, s.name as source_name, s.type as source_type
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ?
    `;
    const params = [id];

    if (source_id) {
      query += ` AND c.source_id = ?`;
      params.push(source_id);
    }
    if (access_label) {
      query += ` AND c.access_label = ?`;
      params.push(access_label);
    }

    query += ` ORDER BY s.name ASC, c.rowid ASC`;

    const chunks = db.prepare(query).all(...params);
    res.json({ chunks, total: chunks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Core Demo Data Seeding Logic
 * Creates the CodeCraft Club project from /demo-data
 */
export function runDemoSeeding(db) {
  const demoDir = path.resolve(__dirname, '../../demo-data');

  if (!fs.existsSync(demoDir)) {
    throw new Error(`Demo data directory not found at ${demoDir}`);
  }

  const demoFilesConfig = [
    {
      filename: 'meeting-notes-0314.md',
      accessLabel: 'team',
      type: 'notes'
    },
    {
      filename: 'team-chat.txt',
      accessLabel: 'leads-only',
      type: 'chat'
    },
    {
      filename: 'tasks.csv',
      accessLabel: 'team',
      type: 'tasks'
    },
    {
      filename: 'confidential-chat.txt',
      accessLabel: 'confidential',
      type: 'chat'
    }
  ];

  const projectId = crypto.randomUUID();
  const projectName = 'CodeCraft Club Handover (Arjun -> Priya)';
  const projectDesc = 'Comprehensive knowledge handover for CodeCraft Club. Arjun Mehta (outgoing lead) transferring architecture, API keys, credentials, event planning, and private club finances to incoming president Priya Sharma.';

  let totalChunksCount = 0;
  const createdSources = [];

  const loadDemoTx = db.transaction(() => {
    // 1. Create Project
    db.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(projectId, projectName, projectDesc);

    // 2. Ingest and Chunk each demo file
    for (const config of demoFilesConfig) {
      const filePath = path.join(demoDir, config.filename);
      if (!fs.existsSync(filePath)) {
        console.warn(`[DemoLoader] Warning: File ${config.filename} not found in ${demoDir}`);
        continue;
      }

      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const sourceId = crypto.randomUUID();

      db.prepare(`
        INSERT INTO sources (id, project_id, name, type, access_label, raw_content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(sourceId, projectId, config.filename, config.type, config.accessLabel, rawContent);

      const chunks = chunkSource({
        content: rawContent,
        filename: config.filename,
        type: config.type,
        accessLabel: config.accessLabel,
        sourceId
      });

      const insertChunkStmt = db.prepare(`
        INSERT INTO chunks (id, source_id, author, timestamp, text, access_label, line_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      for (const chunk of chunks) {
        insertChunkStmt.run(
          chunk.id,
          chunk.source_id,
          chunk.author || null,
          chunk.timestamp || null,
          chunk.text,
          chunk.access_label,
          chunk.line_ref
        );
      }

      totalChunksCount += chunks.length;
      createdSources.push({
        sourceId,
        name: config.filename,
        type: config.type,
        accessLabel: config.accessLabel,
        chunksCount: chunks.length
      });
    }

    // 3. Audit Log
    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      projectId,
      'load_demo_project',
      'system',
      `Loaded CodeCraft Club demo data: ${createdSources.length} sources, ${totalChunksCount} chunks`
    );
  });

  loadDemoTx();

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

  return {
    project,
    projectId,
    projectName,
    sources: createdSources,
    totalChunks: totalChunksCount
  };
}

/**
 * Seeds the demo project on startup if database has no projects
 */
export function seedDemoProjectIfEmpty(db) {
  try {
    const existing = db.prepare('SELECT COUNT(*) as count FROM projects').get();
    if (existing && existing.count > 0) {
      return null;
    }

    console.log('[Baton Auto-Seed] Database is empty. Auto-seeding CodeCraft Club demo project...');
    const result = runDemoSeeding(db);
    console.log(`[Baton Auto-Seed] Done! Auto-seeded demo project "${result.projectName}" (${result.totalChunks} chunks).`);
    return result;
  } catch (err) {
    console.warn('[Baton Auto-Seed] Startup seeding notice:', err.message);
    return null;
  }
}

/**
 * Endpoint handler: Load demo project
 * Also aliased as POST /api/demo/load
 */
async function handleLoadDemo(req, res) {
  try {
    const db = getDb();
    const result = runDemoSeeding(db);

    res.status(201).json({
      message: 'Demo project loaded and chunked successfully',
      project: result.project,
      sources: result.sources,
      totalChunks: result.totalChunks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/projects/:id/reconstruct
 * Runs extraction and automatically executes the deterministic verifier.
 * Stores verified/conflicting/single-source/missing/unverified claims plus evidence and status summary.
 */
router.post('/projects/:id/reconstruct', async (req, res) => {
  try {
    const { id } = req.params;
    const { allowed_labels, use_cache, batch_size } = req.body || {};

    const extractResult = await extractProjectClaims(id, {
      allowedLabels: allowed_labels,
      useCache: use_cache,
      batchSize: batch_size
    });

    // Run deterministic plain-code verifier automatically
    const verification = verifyProjectClaims(id);

    res.json({
      message: 'Reconstruction and verification complete',
      projectId: id,
      claimsCount: verification.total,
      source: extractResult.source,
      allowedLabels: extractResult.allowedLabels,
      totalChunksAnalyzed: extractResult.totalChunksAnalyzed,
      summary: verification.summary,
      claims: verification.claims
    });
  } catch (err) {
    console.error('[Reconstruct Error]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Helper to get normalized role from request header
 */
function getRole(req) {
  return normalizeRole(req.headers['x-role'] || 'lead');
}

/**
 * Middleware: Lead role required for review/approval operations
 */
function requireLead(req, res, next) {
  const role = getRole(req);
  if (role !== 'lead') {
    return res.status(403).json({ error: 'Forbidden: Lead role required for this action' });
  }
  next();
}

/**
 * GET /api/projects/:id/timeline
 * Decisions and open discussions ordered chronologically by chunk timestamp.
 * Server-enforces access labels: restricted role only sees team chunks.
 */
router.get('/projects/:id/timeline', (req, res) => {
  try {
    const { id } = req.params;
    const role = getRole(req);
    const db = getDb();

    const allowedLabels = getAllowedLabelsForRole(role);
    const labelPlaceholders = allowedLabels.map(() => '?').join(',');

    let query = `
      SELECT c.id, c.source_id, c.author, c.timestamp, c.text, c.access_label, c.line_ref,
             s.name as source_name, s.type as source_type
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ? AND c.timestamp IS NOT NULL AND c.timestamp != ''
        AND c.access_label IN (${labelPlaceholders})
    `;
    const params = [id, ...allowedLabels];

    query += ` ORDER BY c.timestamp ASC, c.rowid ASC`;

    const chunks = db.prepare(query).all(...params);

    const timeline = chunks.map(chunk => {
      let itemType = 'discussion';
      const lower = chunk.text.toLowerCase();
      if (lower.includes('decision:') || lower.includes('decided') || lower.includes('consensus')) {
        itemType = 'decision';
      } else if (chunk.source_type === 'notes') {
        itemType = 'meeting';
      } else if (chunk.source_type === 'tasks') {
        itemType = 'task';
      }

      return {
        id: chunk.id,
        timestamp: chunk.timestamp,
        author: chunk.author || 'Team',
        type: itemType,
        text: chunk.text,
        source: chunk.source_name,
        line_ref: chunk.line_ref,
        access_label: chunk.access_label
      };
    });

    res.json({
      projectId: id,
      role,
      total: timeline.length,
      timeline
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/claims
 * Returns claims for a project with role-based redaction enforced on server.
 * If caller cannot see all supporting evidence, returns redacted placeholder:
 *   { id, redacted: true, reason: "restricted" }
 */
router.get('/projects/:id/claims', (req, res) => {
  try {
    const { id } = req.params;
    const role = getRole(req);
    const db = getDb();

    const claims = db.prepare(`
      SELECT c.*,
        (
          SELECT json_group_array(
            json_object(
              'chunk_id', ce.chunk_id,
              'quote', ce.quote,
              'source_id', ch.source_id,
              'source_name', s.name,
              'author', ch.author,
              'line_ref', ch.line_ref,
              'access_label', ch.access_label
            )
          )
          FROM claim_evidence ce
          JOIN chunks ch ON ch.id = ce.chunk_id
          JOIN sources s ON s.id = ch.source_id
          WHERE ce.claim_id = c.id
        ) as evidence_json
      FROM claims c
      WHERE c.project_id = ?
      ORDER BY c.created_at ASC
    `).all(id);

    const formatted = claims.map(c => ({
      ...c,
      evidence: c.evidence_json ? JSON.parse(c.evidence_json) : []
    }));

    // Server-side role-based claim & quote redaction
    const roleFilteredClaims = formatted.map(c => filterOrRedactClaim(role, c));

    const summary = {
      total: formatted.length,
      verified: formatted.filter(c => c.status === 'Verified').length,
      single_source: formatted.filter(c => c.status === 'Single-source').length,
      conflicting: formatted.filter(c => c.status === 'Conflicting').length,
      missing: formatted.filter(c => c.status === 'Missing').length,
      unverified: formatted.filter(c => c.status === 'Unverified').length
    };

    res.json({
      projectId: id,
      role,
      summary,
      total: roleFilteredClaims.length,
      claims: roleFilteredClaims
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/claims/:id
 * Edit claim text and/or owner (Lead role only)
 */
router.patch('/claims/:id', requireLead, (req, res) => {
  try {
    const { id } = req.params;
    const { text, owner } = req.body;
    const db = getDb();

    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const newText = text !== undefined ? String(text).trim() : claim.text;
    const newOwner = owner !== undefined ? (owner ? String(owner).trim() : null) : claim.owner;

    db.prepare(`
      UPDATE claims
      SET text = ?, owner = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newText, newOwner, id);

    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'claim_edited', 'lead', ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      claim.project_id,
      `Lead edited claim "${claim.id.substring(0, 8)}..."`
    );

    const updated = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    res.json({ message: 'Claim updated successfully', claim: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/claims/:id/reject
 * Reject a claim (Lead role only)
 */
router.post('/claims/:id/reject', requireLead, (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body || {};
    const db = getDb();

    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    db.prepare(`
      UPDATE claims
      SET review_state = 'rejected', updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    db.prepare(`
      INSERT INTO reviews (id, claim_id, reviewer, status_decision, comment, created_at)
      VALUES (?, ?, 'lead', 'rejected', ?, datetime('now'))
    `).run(crypto.randomUUID(), id, comment || null);

    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'claim_rejected', 'lead', ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      claim.project_id,
      `Lead rejected claim "${claim.text.substring(0, 50)}..."`
    );

    res.json({ message: 'Claim rejected', claimId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/claims/:id/confirm
 * Confirm and approve a claim (Lead role only)
 */
router.post('/claims/:id/confirm', requireLead, (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body || {};
    const db = getDb();

    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    db.prepare(`
      UPDATE claims
      SET review_state = 'approved', updated_at = datetime('now')
      WHERE id = ?
    `).run(id);

    db.prepare(`
      INSERT INTO reviews (id, claim_id, reviewer, status_decision, comment, created_at)
      VALUES (?, ?, 'lead', 'approved', ?, datetime('now'))
    `).run(crypto.randomUUID(), id, comment || null);

    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'claim_confirmed', 'lead', ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      claim.project_id,
      `Lead approved claim "${claim.text.substring(0, 50)}..."`
    );

    res.json({ message: 'Claim confirmed and approved', claimId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/claims/:id/resolve-conflict
 * Resolve a conflicting claim by choosing which owner/evidence is right (Lead role only)
 */
router.post('/claims/:id/resolve-conflict', requireLead, (req, res) => {
  try {
    const { id } = req.params;
    const { chosen_owner, chosen_evidence_id, resolution_note } = req.body || {};
    const db = getDb();

    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const note = resolution_note || `Resolved by lead: chosen owner "${chosen_owner}"`;

    db.prepare(`
      UPDATE claims
      SET owner = ?, status = 'Verified', review_state = 'approved', gap_note = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(chosen_owner || claim.owner, note, id);

    db.prepare(`
      INSERT INTO reviews (id, claim_id, reviewer, status_decision, comment, created_at)
      VALUES (?, ?, 'lead', 'modified', ?, datetime('now'))
    `).run(crypto.randomUUID(), id, note);

    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'conflict_resolved', 'lead', ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      claim.project_id,
      `Lead resolved conflict on claim "${claim.id.substring(0, 8)}": ${note}`
    );

    const updated = db.prepare('SELECT * FROM claims WHERE id = ?').get(id);
    res.json({ message: 'Conflict resolved successfully', claim: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects/:id/approve
 * Lead approves the project handover, creating a version snapshot (Lead role only)
 */
router.post('/projects/:id/approve', requireLead, (req, res) => {
  try {
    const { id } = req.params;
    const { approve_all = true } = req.body || {};
    const db = getDb();

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Automatically mark all pending claims as approved if approve_all is true
    if (approve_all) {
      db.prepare(`
        UPDATE claims
        SET review_state = 'approved', updated_at = datetime('now')
        WHERE project_id = ? AND review_state = 'pending'
      `).run(id);
    }

    // Fetch next version number
    const verRow = db.prepare('SELECT COALESCE(MAX(version_num), 0) + 1 as next_ver FROM versions WHERE project_id = ?').get(id);
    const nextVersion = verRow ? verRow.next_ver : 1;

    // Fetch approved claims with evidence for snapshot
    const approvedClaims = db.prepare(`
      SELECT c.*,
        (
          SELECT json_group_array(
            json_object(
              'chunk_id', ce.chunk_id,
              'quote', ce.quote,
              'source_id', ch.source_id,
              'source_name', s.name,
              'author', ch.author,
              'line_ref', ch.line_ref,
              'access_label', ch.access_label
            )
          )
          FROM claim_evidence ce
          JOIN chunks ch ON ch.id = ce.chunk_id
          JOIN sources s ON s.id = ch.source_id
          WHERE ce.claim_id = c.id
        ) as evidence_json
      FROM claims c
      WHERE c.project_id = ? AND c.review_state = 'approved'
      ORDER BY c.type ASC, c.created_at ASC
    `).all(id).map(c => ({
      ...c,
      evidence: c.evidence_json ? JSON.parse(c.evidence_json) : []
    }));

    const snapshotPayload = {
      projectId: id,
      version: nextVersion,
      approvedAt: new Date().toISOString(),
      approvedBy: 'lead',
      claimsCount: approvedClaims.length,
      claims: approvedClaims
    };

    const versionId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO versions (id, project_id, version_num, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(versionId, id, nextVersion, JSON.stringify(snapshotPayload));

    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'project_approved', 'lead', ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      id,
      `Lead approved handover snapshot v${nextVersion} with ${approvedClaims.length} approved claims`
    );

    res.json({
      message: 'Project handover approved successfully',
      version: nextVersion,
      versionId,
      approvedClaimsCount: approvedClaims.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/versions
 * Returns version snapshot history list
 */
router.get('/projects/:id/versions', (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const versions = db.prepare(`
      SELECT id, project_id, version_num, created_at,
             json_extract(snapshot_json, '$.approvedBy') as approvedBy,
             json_extract(snapshot_json, '$.claimsCount') as claimsCount
      FROM versions
      WHERE project_id = ?
      ORDER BY version_num DESC
    `).all(id);
    res.json({ versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/handover
 * Returns role-filtered approved claims grouped by type + code-generated next actions.
 * Handover views show ONLY approved claims.
 */
router.get('/projects/:id/handover', (req, res) => {
  try {
    const { id } = req.params;
    const role = getRole(req);
    const db = getDb();

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Latest version
    const latestVersionRow = db.prepare('SELECT MAX(version_num) as ver FROM versions WHERE project_id = ?').get(id);
    const currentVersion = latestVersionRow ? latestVersionRow.ver : null;

    // Handover views show ONLY approved claims
    const approvedClaims = db.prepare(`
      SELECT c.*,
        (
          SELECT json_group_array(
            json_object(
              'chunk_id', ce.chunk_id,
              'quote', ce.quote,
              'source_id', ch.source_id,
              'source_name', s.name,
              'author', ch.author,
              'line_ref', ch.line_ref,
              'access_label', ch.access_label
            )
          )
          FROM claim_evidence ce
          JOIN chunks ch ON ch.id = ce.chunk_id
          JOIN sources s ON s.id = ch.source_id
          WHERE ce.claim_id = c.id
        ) as evidence_json
      FROM claims c
      WHERE c.project_id = ? AND c.review_state = 'approved'
      ORDER BY c.created_at ASC
    `).all(id).map(c => ({
      ...c,
      evidence: c.evidence_json ? JSON.parse(c.evidence_json) : []
    }));

    // Server-side role-based claim & quote redaction
    const roleClaims = approvedClaims.map(c => filterOrRedactClaim(role, c));

    // Group approved claims
    const groups = {
      decisions: [],
      owners: [],
      tasks: [],
      dependencies: [],
      risks: [],
      recurring_problems: []
    };

    roleClaims.forEach(c => {
      if (c.redacted) {
        // Redacted claims are categorized by their underlying type if preserved or decisions
        const underlying = approvedClaims.find(raw => raw.id === c.id);
        const targetGroup = underlying?.type === 'recurring_problem' ? 'recurring_problems' : `${underlying?.type || 'decision'}s`;
        if (groups[targetGroup]) {
          groups[targetGroup].push(c);
        } else {
          groups.decisions.push(c);
        }
      } else {
        const key = c.type === 'recurring_problem' ? 'recurring_problems' : `${c.type}s`;
        if (groups[key]) {
          groups[key].push(c);
        } else {
          groups.decisions.push(c);
        }
      }
    });

    // Generate code-ruled "Next Actions"
    // Open tasks + Missing items + Conflicting items
    const nextActions = [];

    roleClaims.forEach(c => {
      if (c.redacted) {
        // Never leak secrets in next_actions
        return;
      }

      if (c.type === 'task') {
        nextActions.push({
          claim_id: c.id,
          type: 'task',
          priority: c.status === 'Missing' ? 'High' : 'Medium',
          action: `Complete task: ${c.text}`,
          owner: c.owner || 'Needs Assignee',
          status: c.status
        });
      }

      if (c.status === 'Missing' && c.type !== 'task') {
        nextActions.push({
          claim_id: c.id,
          type: 'gap',
          priority: 'High',
          action: `Resolve gap: ${c.text}`,
          reason: c.gap_note || 'Missing required owner or contact point',
          owner: c.owner || 'Unassigned'
        });
      }

      if (c.status === 'Conflicting') {
        nextActions.push({
          claim_id: c.id,
          type: 'conflict',
          priority: 'Urgent',
          action: `Resolve ownership conflict: ${c.text}`,
          reason: c.gap_note || 'Conflicting owners found across independent sources',
          owner: c.owner || 'Contested'
        });
      }
    });

    res.json({
      projectId: id,
      projectName: project.name,
      role,
      version: currentVersion,
      totalApproved: roleClaims.length,
      groups,
      next_actions: nextActions,
      nextActions: nextActions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/projects/:id/acknowledge
 * Records who acknowledged which version and when
 */
router.post('/projects/:id/acknowledge', (req, res) => {
  try {
    const { id } = req.params;
    const role = req.headers['x-role'] || req.body.user_role || 'incoming';
    const { version_num, notes } = req.body || {};
    const db = getDb();

    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const ackId = crypto.randomUUID();
    const ackNotes = notes ? String(notes).trim() : `Handover acknowledged by ${role} role (version ${version_num || 'latest'})`;

    db.prepare(`
      INSERT INTO acknowledgements (id, project_id, user_role, acknowledged_at, notes)
      VALUES (?, ?, ?, datetime('now'), ?)
    `).run(ackId, id, role, ackNotes);

    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'handover_acknowledged', ?, ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      id,
      role,
      `Role "${role}" acknowledged handover version ${version_num || 'latest'}`
    );

    res.json({
      message: 'Handover acknowledged successfully',
      acknowledgementId: ackId,
      projectId: id,
      user_role: role,
      version_num: version_num || 'latest',
      acknowledged_at: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/acknowledgements
 * Retrieve all acknowledgements recorded for this project
 */
router.get('/projects/:id/acknowledgements', (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const acknowledgements = db.prepare(`
      SELECT * FROM acknowledgements
      WHERE project_id = ?
      ORDER BY acknowledged_at DESC
    `).all(id);
    res.json({ acknowledgements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/load-demo', handleLoadDemo);
router.post('/demo/load', handleLoadDemo);

export default router;
