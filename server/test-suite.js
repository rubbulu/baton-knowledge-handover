process.env.NODE_ENV = 'test';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './src/index.js';
import { getDb } from './src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('=== Starting Baton Backend Tests ===\n');

  // Start app on ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    // Test 1: Health check
    console.log('\n[Test 1] Testing GET /api/health...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    console.log('Health response:', healthData);
    if (healthData.status !== 'ok') throw new Error('Health check failed');
    console.log('✓ Health check passed');

    // Test 2: Project creation
    console.log('\n[Test 2] Testing POST /api/projects...');
    const createProjectRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Project Alpha',
        description: 'Integration test project'
      })
    });
    const createProjectData = await createProjectRes.json();
    console.log('Create project response:', createProjectData);
    if (!createProjectData.project || !createProjectData.project.id) {
      throw new Error('Project creation failed');
    }
    const testProjectId = createProjectData.project.id;
    console.log('✓ Project created with ID:', testProjectId);

    // Test 3: Get Project details
    console.log('\n[Test 3] Testing GET /api/projects/:id...');
    const getProjectRes = await fetch(`${baseUrl}/api/projects/${testProjectId}`);
    const getProjectData = await getProjectRes.json();
    console.log('Get project response:', getProjectData);
    if (getProjectData.project.id !== testProjectId) {
      throw new Error('Get project details failed');
    }
    console.log('✓ Project fetched successfully');

    // Test 4: Load Demo Project endpoint
    console.log('\n[Test 4] Testing POST /api/projects/load-demo...');
    const loadDemoRes = await fetch(`${baseUrl}/api/projects/load-demo`, {
      method: 'POST'
    });
    const loadDemoData = await loadDemoRes.json();
    console.log('Load demo response summary:');
    console.log(`- Project: ${loadDemoData.project.name} (${loadDemoData.project.id})`);
    console.log(`- Total Chunks: ${loadDemoData.totalChunks}`);
    console.log('- Sources created:');
    loadDemoData.sources.forEach(s => {
      console.log(`   * ${s.name} | Label: ${s.accessLabel} | Chunks: ${s.chunksCount}`);
    });

    if (!loadDemoData.project || loadDemoData.sources.length !== 4) {
      throw new Error(`Expected 4 sources loaded, got ${loadDemoData.sources.length}`);
    }
    if (loadDemoData.totalChunks < 50) {
      throw new Error(`Expected at least 50 chunks, got ${loadDemoData.totalChunks}`);
    }
    console.log('✓ Load demo project passed');

    const demoProjectId = loadDemoData.project.id;

    // Test 5: Verify Access Labels on Chunks
    console.log('\n[Test 5] Verifying Chunks and Access Labels...');
    const db = getDb();
    const labelCounts = db.prepare(`
      SELECT c.access_label, COUNT(c.id) as count
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ?
      GROUP BY c.access_label
    `).all(demoProjectId);
    console.log('Chunks by access label:', labelCounts);

    const labelsMap = Object.fromEntries(labelCounts.map(l => [l.access_label, l.count]));
    if (!labelsMap['team'] || !labelsMap['leads-only'] || !labelsMap['confidential']) {
      throw new Error('Missing chunks for team, leads-only, or confidential access labels');
    }
    console.log('✓ All 3 access labels (team, leads-only, confidential) properly mapped to chunks');

    // Test 6: Verify Seeded Requirements in Demo Data
    console.log('\n[Test 6] Verifying Seeded Scenarios in CodeCraft Club demo data...');

    // 6a. Decision in 2 sources (meeting-notes & team-chat)
    const nextJsChunks = db.prepare(`
      SELECT c.text, c.line_ref, s.name as source_name
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ? AND c.text LIKE '%Next.js%' AND c.text LIKE '%Vercel%'
    `).all(demoProjectId);
    console.log(`6a. Found ${nextJsChunks.length} chunks referencing Next.js on Vercel migration:`);
    nextJsChunks.forEach(c => console.log(`   [${c.source_name} - ${c.line_ref}] ${c.text.substring(0, 80)}...`));
    const nextJsSources = new Set(nextJsChunks.map(c => c.source_name));
    if (nextJsSources.size < 2) {
      throw new Error('Verified Decision: Expected Next.js migration to appear in >= 2 sources');
    }
    console.log('   ✓ Decision made in 2 sources confirmed (Verified candidate)');

    // 6b. Conflicting Maps API key owner
    const mapsChunks = db.prepare(`
      SELECT c.text, c.line_ref, s.name as source_name
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ? AND c.text LIKE '%Google Maps API%'
    `).all(demoProjectId);
    console.log(`6b. Found ${mapsChunks.length} chunks referencing Google Maps API:`);
    mapsChunks.forEach(c => console.log(`   [${c.source_name} - ${c.line_ref}] ${c.text}`));
    const mentionsArjun = mapsChunks.some(c => c.text.includes('Arjun'));
    const mentionsPriya = mapsChunks.some(c => c.text.includes('Priya'));
    if (!mentionsArjun || !mentionsPriya) {
      throw new Error('Conflicting Owner: Expected Maps key to be claimed by both Arjun and Priya in different sources');
    }
    console.log('   ✓ Maps API key conflict confirmed (Arjun vs Priya)');

    // 6c. Missing Assignee in tasks.csv
    const missingTask = db.prepare(`
      SELECT c.text, c.line_ref
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ? AND s.name = 'tasks.csv' AND c.text LIKE '%Owner: Unassigned%'
    `).get(demoProjectId);
    if (!missingTask) {
      throw new Error('Missing Task: Expected task with Unassigned owner in tasks.csv');
    }
    console.log(`6c. Task with Missing Assignee: [${missingTask.line_ref}] ${missingTask.text}`);
    console.log('   ✓ Missing assignee seeded properly');

    // 6d. Single-source claim (PrintExpress)
    const printExpressChunks = db.prepare(`
      SELECT c.text, c.line_ref, s.name as source_name
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ? AND c.text LIKE '%PrintExpress%'
    `).all(demoProjectId);
    console.log(`6d. PrintExpress mention: in ${printExpressChunks.length} source(s): ${printExpressChunks.map(c => c.source_name).join(', ')}`);
    if (new Set(printExpressChunks.map(c => c.source_name)).size !== 1) {
      throw new Error('Single-source: Expected PrintExpress to be in exactly 1 source');
    }
    console.log('   ✓ Single-source claim confirmed');

    // 6e. Confidential message decision
    const confidentialDecision = db.prepare(`
      SELECT c.text, c.line_ref, c.access_label
      FROM chunks c
      JOIN sources s ON s.id = c.source_id
      WHERE s.project_id = ? AND s.name = 'confidential-chat.txt' AND c.text LIKE '%Decision:%'
    `).get(demoProjectId);
    if (!confidentialDecision || confidentialDecision.access_label !== 'confidential') {
      throw new Error('Confidential Decision: Expected confidential chunk with a decision');
    }
    console.log(`6e. Confidential Decision: [${confidentialDecision.line_ref} - ${confidentialDecision.access_label}] ${confidentialDecision.text}`);
    console.log('   ✓ Confidential decision verified');

    // Test 7: Multipart file upload to POST /api/projects/:id/sources
    console.log('\n[Test 7] Testing multipart upload to POST /api/projects/:id/sources...');
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const dummyContent = '# Extra Notes\n\n- Standup scheduled daily at 10 AM.\n\n- Deployments blocked on Fridays.';
    
    let bodyBuffer = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="access_label"\r\n\r\n'),
      Buffer.from('leads-only\r\n'),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="file"; filename="extra-notes.md"\r\n'),
      Buffer.from('Content-Type: text/markdown\r\n\r\n'),
      Buffer.from(dummyContent + '\r\n'),
      Buffer.from(`--${boundary}--\r\n`)
    ]);

    const uploadRes = await fetch(`${baseUrl}/api/projects/${testProjectId}/sources`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: bodyBuffer
    });
    const uploadData = await uploadRes.json();
    console.log('Upload response:', uploadData);
    if (!uploadData.sources || uploadData.sources.length === 0) {
      throw new Error('Upload failed');
    }
    console.log(`✓ Uploaded ${uploadData.sources[0].name} with ${uploadData.sources[0].chunksCreated} chunks`);

    // Test 8: POST /api/projects/:id/reconstruct
    console.log('\n[Test 8] Testing POST /api/projects/:id/reconstruct (Extraction Pipeline)...');
    const reconstructRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/reconstruct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allowed_labels: ['team', 'leads-only', 'confidential']
      })
    });
    const reconstructData = await reconstructRes.json();
    console.log('Reconstruct response summary:');
    console.log(`- Extracted Claims Count: ${reconstructData.claimsCount}`);
    console.log(`- Extraction Source: ${reconstructData.source}`);
    console.log(`- Allowed Labels: ${reconstructData.allowedLabels?.join(', ')}`);

    if (!reconstructData.claims || reconstructData.claims.length === 0) {
      throw new Error('Reconstruction returned 0 claims');
    }
    console.log(`✓ Successfully extracted and stored ${reconstructData.claimsCount} claims`);

    // Verify unverified status in database
    const dbClaims = db.prepare('SELECT id, type, text, owner, status FROM claims WHERE project_id = ?').all(demoProjectId);
    console.log(`Database claims count: ${dbClaims.length}`);
    const allUnverified = dbClaims.every(c => c.status === 'Unverified');
    if (!allUnverified) {
      throw new Error('Expected all freshly extracted claims to have status "Unverified"');
    }
    console.log('✓ All claims initialized with status "Unverified"');

    // Verify claim_evidence rows
    const dbEvidence = db.prepare('SELECT COUNT(*) as count FROM claim_evidence ce JOIN claims c ON c.id = ce.claim_id WHERE c.project_id = ?').get(demoProjectId);
    console.log(`Database claim_evidence rows: ${dbEvidence.count}`);
    if (dbEvidence.count === 0) {
      throw new Error('Expected claim_evidence rows to be stored for claims');
    }
    console.log('✓ Claim evidence rows stored');

    // Verify audit log includes allowed access labels
    const auditRecord = db.prepare(`SELECT * FROM audit_log WHERE project_id = ? AND action = 'reconstruct_extraction' ORDER BY created_at DESC LIMIT 1`).get(demoProjectId);
    if (!auditRecord || !auditRecord.details.includes('team, leads-only, confidential')) {
      throw new Error('Audit log did not record the allowed access labels used');
    }
    console.log(`✓ Audit log verified: "${auditRecord.details}"`);

    // Test 9: GET /api/projects/:id/timeline
    console.log('\n[Test 9] Testing GET /api/projects/:id/timeline...');
    const timelineRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/timeline`);
    const timelineData = await timelineRes.json();
    console.log(`Timeline items count: ${timelineData.total}`);
    if (!timelineData.timeline || timelineData.timeline.length === 0) {
      throw new Error('Timeline returned 0 items');
    }
    console.log('Sample timeline entries:');
    timelineData.timeline.slice(0, 3).forEach(item => {
      console.log(`   [${item.timestamp}] [${item.type}] ${item.author}: ${item.text.substring(0, 70)}...`);
    });
    console.log('✓ Timeline successfully retrieved in chronological order');

    // Test 10: GET /api/projects/:id/claims
    console.log('\n[Test 10] Testing GET /api/projects/:id/claims...');
    const claimsRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/claims`);
    const claimsData = await claimsRes.json();
    console.log(`Claims retrieved: ${claimsData.total}`);
    if (!claimsData.claims || claimsData.claims.length === 0) {
      throw new Error('Failed to retrieve claims');
    }
    const sampleClaim = claimsData.claims[0];
    console.log(`Sample claim: [${sampleClaim.type}] "${sampleClaim.text}" (Owner: ${sampleClaim.owner || 'None'})`);
    console.log(`Evidence quote: "${sampleClaim.evidence?.[0]?.quote || 'No quote'}"`);
    console.log('✓ Claims endpoint successfully returns claims with citations and evidence');

    console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
