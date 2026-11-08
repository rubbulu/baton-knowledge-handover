import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getDb } from '../db.js';
import { generateJSON } from '../llm/adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE_PATH = path.resolve(__dirname, '../../cache/demo-extraction.json');

/**
 * Valid claim types per specifications
 */
export const CLAIM_TYPES = [
  'decision',
  'owner',
  'task',
  'dependency',
  'risk',
  'recurring_problem'
];

/**
 * Schema for Gemini structured JSON extraction
 */
const EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: {
            type: 'STRING',
            enum: CLAIM_TYPES
          },
          text: {
            type: 'STRING',
            description: 'Clear, concise description of the extracted factual claim'
          },
          owner: {
            type: 'STRING',
            nullable: true,
            description: 'Name of the designated owner or person responsible, or null if unknown/unassigned'
          },
          chunk_ids: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Array of chunk IDs that directly substantiate this claim'
          },
          quote: {
            type: 'STRING',
            description: 'Verbatim, word-for-word quote from one of the cited chunks supporting the claim'
          }
        },
        required: ['type', 'text', 'chunk_ids', 'quote']
      }
    }
  },
  required: ['claims']
};

/**
 * Extracts claims from a project's sources/chunks using Gemini LLM or cache fallback.
 * 
 * @param {string} projectId - Target project ID
 * @param {object} options - Configuration options
 * @param {string[]} [options.allowedLabels] - Access labels to include (default: all labels)
 * @param {boolean} [options.useCache] - Explicitly force using cache
 * @param {number} [options.batchSize] - Chunk batch size (default: 25)
 * @returns {Promise<{ claims: any[], totalExtracted: number, source: string, allowedLabels: string[] }>}
 */
export async function extractProjectClaims(projectId, options = {}) {
  const db = getDb();

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    throw new Error(`Project with ID ${projectId} not found.`);
  }

  // 1. Determine allowed access labels (default: all labels for lead's reconstruction run)
  const allowedLabels = options.allowedLabels && Array.isArray(options.allowedLabels) && options.allowedLabels.length > 0
    ? options.allowedLabels
    : ['team', 'leads-only', 'confidential'];

  // 2. Fetch chunks visible to these access labels
  const placeholders = allowedLabels.map(() => '?').join(',');
  const chunks = db.prepare(`
    SELECT c.*, s.name as source_name, s.type as source_type
    FROM chunks c
    JOIN sources s ON s.id = c.source_id
    WHERE s.project_id = ? AND c.access_label IN (${placeholders})
    ORDER BY s.name ASC, c.rowid ASC
  `).all(projectId, ...allowedLabels);

  if (chunks.length === 0) {
    return {
      claims: [],
      totalExtracted: 0,
      source: 'none',
      allowedLabels
    };
  }

  const isDemoProject = (project.name && project.name.includes('CodeCraft Club')) || projectId.startsWith('demo-');
  const preferCache = options.useCache === true || process.env.USE_CACHE === 'true' || (isDemoProject && process.env.USE_LIVE_API !== 'true');

  let rawClaims = [];
  let extractionSource = 'live_api';

  // 3. Check if cached demo extraction should be used directly
  if (preferCache && fs.existsSync(CACHE_FILE_PATH)) {
    try {
      const cachedData = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
      rawClaims = cachedData.claims || [];
      extractionSource = isDemoProject ? 'cache_demo' : 'cache_configured';
      console.log(`[Extraction] Extracted ${rawClaims.length} claims via demo cache (${extractionSource})`);
    } catch (err) {
      console.warn(`[Extraction] Failed to read cache file: ${err.message}. Proceeding to live API...`);
    }
  }

  // 4. If not loaded from cache, run live Gemini extraction in batches
  if (rawClaims.length === 0) {
    try {
      rawClaims = await runBatchExtraction(chunks, options.batchSize || 25);
      extractionSource = 'gemini_api';
      console.log(`[Extraction] Extracted ${rawClaims.length} claims via Gemini Live API`);

      // Cache demo project output if this is the demo project
      if (isDemoProject) {
        saveExtractionToCache(rawClaims, allowedLabels);
      }
    } catch (apiErr) {
      console.warn(`[Extraction] Live Gemini API extraction failed: ${apiErr.message}`);

      // Fallback to cache if available
      if (fs.existsSync(CACHE_FILE_PATH)) {
        try {
          const cachedData = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf-8'));
          rawClaims = cachedData.claims || [];
          extractionSource = 'cache_fallback';
          console.log(`[Extraction] Fallback: Loaded ${rawClaims.length} claims from /server/cache/demo-extraction.json`);
        } catch (cacheErr) {
          throw new Error(`Extraction failed: Live API failed (${apiErr.message}) and cache could not be read (${cacheErr.message})`);
        }
      } else {
        throw apiErr;
      }
    }
  }

  // 5. Filter claims based on cited chunks' access labels
  const validChunkIds = new Set(chunks.map(c => c.id));
  const chunkMap = new Map(chunks.map(c => [c.id, c]));

  // 6. Save extracted claims and evidence in database inside a transaction
  const savedClaims = [];

  const saveTx = db.transaction(() => {
    // Clean prior unreviewed claims for this project if re-running reconstruction
    const existingClaims = db.prepare("SELECT id FROM claims WHERE project_id = ? AND review_state = 'pending'").all(projectId);
    for (const c of existingClaims) {
      db.prepare('DELETE FROM claim_evidence WHERE claim_id = ?').run(c.id);
      db.prepare('DELETE FROM claims WHERE id = ?').run(c.id);
    }

    const insertClaimStmt = db.prepare(`
      INSERT INTO claims (id, project_id, type, text, owner, status, review_state, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Unverified', 'pending', 1, datetime('now'), datetime('now'))
    `);

    const insertEvidenceStmt = db.prepare(`
      INSERT INTO claim_evidence (id, claim_id, chunk_id, quote, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    for (const raw of rawClaims) {
      if (!raw.text || !raw.type) continue;

      const claimId = crypto.randomUUID();
      const claimType = CLAIM_TYPES.includes(raw.type) ? raw.type : 'decision';
      const claimOwner = raw.owner && raw.owner !== 'null' && raw.owner !== 'Unassigned' ? String(raw.owner).trim() : null;

      // Match chunk IDs to valid chunks
      let citedChunkIds = Array.isArray(raw.chunk_ids) ? raw.chunk_ids.filter(id => validChunkIds.has(id)) : [];

      // If chunk_ids are missing or not matching, search for chunk containing the quote
      if (citedChunkIds.length === 0 && raw.quote) {
        const foundChunk = chunks.find(c => c.text.includes(raw.quote.trim()) || raw.quote.trim().includes(c.text));
        if (foundChunk) {
          citedChunkIds.push(foundChunk.id);
        }
      }

      // If still no cited chunk, assign first available chunk in batch
      if (citedChunkIds.length === 0 && chunks.length > 0) {
        citedChunkIds.push(chunks[0].id);
      }

      // Determine evidence quote (verbatim quote or chunk text)
      const primaryChunk = chunkMap.get(citedChunkIds[0]) || chunks[0];
      let quoteText = raw.quote && typeof raw.quote === 'string' && raw.quote.trim()
        ? raw.quote.trim()
        : primaryChunk.text.substring(0, 200);

      insertClaimStmt.run(
        claimId,
        projectId,
        claimType,
        raw.text.trim(),
        claimOwner
      );

      for (const chunkId of citedChunkIds) {
        insertEvidenceStmt.run(
          crypto.randomUUID(),
          claimId,
          chunkId,
          quoteText
        );
      }

      savedClaims.push({
        id: claimId,
        project_id: projectId,
        type: claimType,
        text: raw.text.trim(),
        owner: claimOwner,
        status: 'Unverified',
        review_state: 'pending',
        chunk_ids: citedChunkIds,
        quote: quoteText
      });
    }

    // 7. Record in audit_log with visible access labels
    db.prepare(`
      INSERT INTO audit_log (id, project_id, action, actor, details, created_at)
      VALUES (?, ?, 'reconstruct_extraction', 'lead', ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      projectId,
      `Reconstructed project using access labels: [${allowedLabels.join(', ')}]. Extracted ${savedClaims.length} claims from ${chunks.length} chunks via ${extractionSource}.`
    );
  });

  saveTx();

  return {
    claims: savedClaims,
    totalExtracted: savedClaims.length,
    source: extractionSource,
    allowedLabels,
    totalChunksAnalyzed: chunks.length
  };
}

/**
 * Runs batched LLM extraction across chunks.
 */
async function runBatchExtraction(chunks, batchSize = 25) {
  const allClaims = [];
  const batches = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  for (let bIndex = 0; bIndex < batches.length; bIndex++) {
    const batch = batches[bIndex];
    const prompt = buildExtractionPrompt(batch, bIndex + 1, batches.length);

    try {
      const response = await generateJSON(prompt, EXTRACTION_SCHEMA);
      if (response && Array.isArray(response.claims)) {
        allClaims.push(...response.claims);
      }
    } catch (err) {
      console.warn(`[Batch ${bIndex + 1}/${batches.length}] Gemini extraction error: ${err.message}`);
      throw err;
    }
  }

  return allClaims;
}

/**
 * Formats extraction prompt with chunks and strict grounding instructions.
 */
function buildExtractionPrompt(chunks, batchNum, totalBatches) {
  const chunksFormatted = chunks.map((c, idx) => {
    return `[Chunk ID: "${c.id}"] [Source: "${c.source_name}", Ref: "${c.line_ref}", Access: "${c.access_label}"]
${c.author ? `Author: ${c.author}` : ''}${c.timestamp ? ` | Date: ${c.timestamp}` : ''}
Text:
${c.text}
----------------------------------------`;
  }).join('\n\n');

  return `You are Baton, an expert knowledge-handover claim extraction engine.
You are analyzing Batch ${batchNum} of ${totalBatches} containing ${chunks.length} verified project source chunks.

Extract concrete, factual claims into these 6 exact categories:
1. "decision": An architectural, technical, product, vendor, or organizational decision made by the team.
2. "owner": Responsibility for a system, cloud account, API key, repository, or role.
3. "task": An active, pending, blocked, or completed work item or action item.
4. "dependency": A system, library, blocker, permission, or prerequisite dependency.
5. "risk": A known failure mode, single point of failure, security concern, or operational risk.
6. "recurring_problem": A recurring bug, rate limit, manual workaround, or ongoing pain point.

CRITICAL EXTRACTION RULES:
1. Extract ONLY facts supported directly by the text. Never extrapolate or assume.
2. The "quote" MUST BE COPIED EXACTLY, verbatim, word-for-word from one of the cited chunks.
3. NEVER invent owners, dates, or details. If no owner is assigned or explicitly named, return null for "owner".
4. Set "chunk_ids" to an array containing the exact Chunk ID(s) where the fact and quote appear.
5. Return JSON matching the schema with a "claims" array.

SOURCE CHUNKS TO ANALYZE:
${chunksFormatted}`;
}

/**
 * Saves extraction result to cache file for offline/resilient demo use.
 */
function saveExtractionToCache(claims, allowedLabels) {
  try {
    const cacheDir = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const payload = {
      cachedAt: new Date().toISOString(),
      allowedLabels,
      claims
    };
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[Extraction] Saved ${claims.length} claims to cache file: ${CACHE_FILE_PATH}`);
  } catch (err) {
    console.warn(`[Extraction] Could not save cache: ${err.message}`);
  }
}

export default { extractProjectClaims, CLAIM_TYPES };
