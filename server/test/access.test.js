process.env.NODE_ENV = 'test';
import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import app from '../src/index.js';
import { canSee, filterOrRedactClaim, getAllowedLabelsForRole } from '../src/access.js';

describe('Baton Server-Side Access Control & Review Tests', () => {

  let server;
  let baseUrl;
  let demoProjectId;
  let sampleClaimId;

  before(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    // Load demo project
    const loadRes = await fetch(`${baseUrl}/api/projects/load-demo`, { method: 'POST' });
    const loadData = await loadRes.json();
    demoProjectId = loadData.project.id;

    // Run reconstruct with cache enabled
    const reconRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/reconstruct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ use_cache: true })
    });
    const reconData = await reconRes.json();
    sampleClaimId = reconData.claims[0].id;
  });

  after(() => {
    if (server) server.close();
  });

  // Test 1: Unit tests for canSee and filterOrRedactClaim
  it('1. canSee and filterOrRedactClaim enforce strict evidence visibility', () => {
    const confidentialClaim = {
      id: 'claim-secret',
      type: 'decision',
      text: 'Draw 15,000 from emergency reserve fund',
      owner: 'Arjun Mehta',
      evidence: [
        { chunk_id: 'c1', access_label: 'confidential', quote: 'emergency reserve fund' }
      ]
    };

    const leadsOnlyClaim = {
      id: 'claim-leads',
      type: 'decision',
      text: 'Migrate to Next.js on Vercel',
      owner: 'Priya Sharma',
      evidence: [
        { chunk_id: 'c2', access_label: 'leads-only', quote: 'Next.js on Vercel' }
      ]
    };

    const teamClaim = {
      id: 'claim-team',
      type: 'task',
      text: 'Reserve university auditorium',
      owner: 'Rohan Verma',
      evidence: [
        { chunk_id: 'c3', access_label: 'team', quote: 'auditorium booked' }
      ]
    };

    // Lead permissions
    assert.strictEqual(canSee('lead', confidentialClaim), true);
    assert.strictEqual(canSee('lead', leadsOnlyClaim), true);
    assert.strictEqual(canSee('lead', teamClaim), true);

    // Incoming permissions
    assert.strictEqual(canSee('incoming', confidentialClaim), false, 'Incoming role must not see confidential claim');
    assert.strictEqual(canSee('incoming', leadsOnlyClaim), true, 'Incoming role can see leads-only');
    assert.strictEqual(canSee('incoming', teamClaim), true, 'Incoming role can see team');

    // Restricted permissions
    assert.strictEqual(canSee('restricted', confidentialClaim), false, 'Restricted role must not see confidential claim');
    assert.strictEqual(canSee('restricted', leadsOnlyClaim), false, 'Restricted role must not see leads-only claim');
    assert.strictEqual(canSee('restricted', teamClaim), true, 'Restricted role can see team');

    // Redaction placeholder validation
    const redactedConfidential = filterOrRedactClaim('restricted', confidentialClaim);
    assert.deepStrictEqual(redactedConfidential, {
      id: 'claim-secret',
      redacted: true,
      reason: 'restricted'
    });
    assert.strictEqual(redactedConfidential.text, undefined);
    assert.strictEqual(redactedConfidential.owner, undefined);
    assert.strictEqual(redactedConfidential.quote, undefined);

    const redactedLeadsOnly = filterOrRedactClaim('restricted', leadsOnlyClaim);
    assert.deepStrictEqual(redactedLeadsOnly, {
      id: 'claim-leads',
      redacted: true,
      reason: 'restricted'
    });
  });

  // Test 2: GET /api/projects/:id/claims role-based redaction
  it('2. GET /api/projects/:id/claims: restricted role never receives confidential or leads-only text', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${demoProjectId}/claims`, {
      headers: { 'X-Role': 'restricted' }
    });
    assert.strictEqual(res.status, 200);
    const bodyText = await res.text();
    const data = JSON.parse(bodyText);

    // Confidential text must not exist anywhere in restricted response
    assert.strictEqual(bodyText.includes('15,000'), false, 'Restricted response must not contain confidential 15,000');
    assert.strictEqual(bodyText.includes('18,400'), false, 'Restricted response must not contain confidential 18,400 bill');
    assert.strictEqual(bodyText.includes('dispute'), false, 'Restricted response must not contain confidential dispute');

    // Check that at least some claims were redacted
    const redactedCount = data.claims.filter(c => c.redacted === true).length;
    assert.strictEqual(redactedCount > 0, true, 'At least 1 claim must be redacted for restricted role');

    // Incoming role test
    const incomingRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/claims`, {
      headers: { 'X-Role': 'incoming' }
    });
    const incomingText = await incomingRes.text();
    assert.strictEqual(incomingText.includes('15,000'), false, 'Incoming role must not see confidential text');
  });

  // Test 3: Review endpoints lead authorization
  it('3. Review endpoints strictly enforce lead role (403 for other roles)', async () => {
    // 3a. PATCH claim
    const forbiddenPatch = await fetch(`${baseUrl}/api/claims/${sampleClaimId}`, {
      method: 'PATCH',
      headers: { 'X-Role': 'incoming', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hacked text' })
    });
    assert.strictEqual(forbiddenPatch.status, 403, 'Incoming role must be rejected with 403 on PATCH');

    const leadPatch = await fetch(`${baseUrl}/api/claims/${sampleClaimId}`, {
      method: 'PATCH',
      headers: { 'X-Role': 'lead', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Updated title by lead' })
    });
    assert.strictEqual(leadPatch.status, 200);

    // 3b. POST confirm & reject
    const forbiddenConfirm = await fetch(`${baseUrl}/api/claims/${sampleClaimId}/confirm`, {
      method: 'POST',
      headers: { 'X-Role': 'restricted' }
    });
    assert.strictEqual(forbiddenConfirm.status, 403);

    const leadConfirm = await fetch(`${baseUrl}/api/claims/${sampleClaimId}/confirm`, {
      method: 'POST',
      headers: { 'X-Role': 'lead' },
      body: JSON.stringify({ comment: 'Approved by lead' })
    });
    assert.strictEqual(leadConfirm.status, 200);

    // 3c. POST resolve-conflict
    const leadResolve = await fetch(`${baseUrl}/api/claims/${sampleClaimId}/resolve-conflict`, {
      method: 'POST',
      headers: { 'X-Role': 'lead', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chosen_owner: 'Priya Sharma',
        resolution_note: 'Resolved by Lead: Priya manages billing account'
      })
    });
    assert.strictEqual(leadResolve.status, 200);
  });

  // Test 4: Project handover approval & version snapshotting
  it('4. POST /api/projects/:id/approve creates a new version snapshot and approves claims', async () => {
    const approveRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/approve`, {
      method: 'POST',
      headers: { 'X-Role': 'lead', 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve_all: true })
    });
    assert.strictEqual(approveRes.status, 200);
    const approveData = await approveRes.json();
    assert.strictEqual(approveData.version, 1, 'First snapshot should be version 1');
    assert.strictEqual(approveData.approvedClaimsCount > 0, true, 'Approved claims count should be > 0');
  });

  // Test 5: Handover view grouping and security redaction
  it('5. GET /api/projects/:id/handover returns approved grouped claims with redaction and next actions', async () => {
    // Lead view
    const leadHandoverRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/handover`, {
      headers: { 'X-Role': 'lead' }
    });
    assert.strictEqual(leadHandoverRes.status, 200);
    const leadHandover = await leadHandoverRes.json();

    assert.strictEqual(leadHandover.version, 1);
    assert.strictEqual(Array.isArray(leadHandover.groups.decisions), true);
    assert.strictEqual(Array.isArray(leadHandover.groups.owners), true);
    assert.strictEqual(Array.isArray(leadHandover.groups.tasks), true);
    assert.strictEqual(Array.isArray(leadHandover.next_actions), true);
    assert.strictEqual(leadHandover.next_actions.length > 0, true, 'Next actions list should be populated');

    // Restricted view
    const restrictedRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/handover`, {
      headers: { 'X-Role': 'restricted' }
    });
    const restrictedText = await restrictedRes.text();
    const restrictedHandover = JSON.parse(restrictedText);

    // Verify restricted handover never exposes confidential chunks
    assert.strictEqual(restrictedText.includes('15,000'), false);
    assert.strictEqual(restrictedText.includes('18,400'), false);

    // Verify next actions exist but do not leak secrets
    assert.strictEqual(Array.isArray(restrictedHandover.next_actions), true);
    for (const action of restrictedHandover.next_actions) {
      assert.strictEqual(action.action.includes('15,000'), false);
    }
  });

  // Test 6: POST /api/projects/:id/acknowledge
  it('6. POST /api/projects/:id/acknowledge records acknowledgement details', async () => {
    const ackRes = await fetch(`${baseUrl}/api/projects/${demoProjectId}/acknowledge`, {
      method: 'POST',
      headers: { 'X-Role': 'incoming', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_num: 1,
        notes: 'Incoming lead Priya Sharma reviewed and acknowledged handover version 1'
      })
    });

    assert.strictEqual(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.strictEqual(ackData.user_role, 'incoming');
    assert.strictEqual(ackData.version_num, 1);
    assert.strictEqual(ackData.acknowledgementId !== undefined, true);
  });

});
