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
 * POST /api/projects/load-demo
 * Also aliased as POST /api/demo/load
 * Creates a project from /demo-data with:
 *   meeting-notes-0314.md = team
 *   team-chat.txt         = leads-only
 *   tasks.csv             = team
 *   confidential-chat.txt = confidential
 */
async function handleLoadDemo(req, res) {
  try {
    const db = getDb();
    const demoDir = path.resolve(__dirname, '../../demo-data');

    if (!fs.existsSync(demoDir)) {
      return res.status(404).json({ error: `Demo data directory not found at ${demoDir}` });
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

    res.status(201).json({
      message: 'Demo project loaded and chunked successfully',
      project,
      sources: createdSources,
      totalChunks: totalChunksCount
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
 * GET /api/projects/:id/timeline
 * Decisions and open discussions ordered chronologically by chunk timestamp.
 * Optional query: ?access_label=...
 */
router.get('/projects/:id/timeline', (req, res) => {
  try {
    const { id } = req.params;
    const { access_label } = req.query;
    const db = getDb();

    let query = `
      SELECT c.id, c.source_id, c.author, c.timestamp, c.text, c.access_label, c.line_ref,
             s.name as source_name, s.type as source_type
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ? AND c.timestamp IS NOT NULL AND c.timestamp != ''
    `;
    const params = [id];

    if (access_label) {
      query += ` AND c.access_label = ?`;
      params.push(access_label);
    }

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
      total: timeline.length,
      timeline
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects/:id/claims
 * Returns claims for a project with their attached claim_evidence citations
 */
router.get('/projects/:id/claims', (req, res) => {
  try {
    const { id } = req.params;
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
      summary,
      total: formatted.length,
      claims: formatted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/load-demo', handleLoadDemo);
router.post('/demo/load', handleLoadDemo);

export default router;
