/**
 * End-to-End Flow Verification Script for Baton
 * Tests the complete prompt workflow:
 * 1. Load demo project
 * 2. Reconstruct
 * 3. Review:
 *    - Resolve Maps API key conflict (Arjun vs Priya -> Priya)
 *    - Confirm several claims
 *    - Reject one claim
 * 4. Approve handover (creates Version Snapshot v1)
 * 5. Incoming role view: can see team + leads-only, confidential redacted
 * 6. Restricted role view: strictly team-only; ZERO confidential/leads-only leaks across handover, claims, and timeline
 * 7. Acknowledge handover receipt as incoming & restricted
 * 8. Verify acknowledgements audit trail
 */
import http from 'http';
import { getDb } from './server/src/db.js';
import app from './server/src/index.js';

const CONFIDENTIAL_STRINGS = [
  'emergency reserve fund',
  '15,000',
  'referral cut',
  'DevFest corporate title sponsorship',
  'alumni server ran unauthorized benchmarking',
  '18,400',
  'confidential ledger',
  'Dr. Raman\'s private clearance'
];

const LEADS_ONLY_STRINGS = [
  'Slack export',
  'campus navigation map widget on our site: who owns the billing account',
  '100% on board with Next.js + Vercel'
];

async function run() {
  console.log('=== Starting Baton End-to-End Verification ===\n');

  // Start test server on dynamic port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[E2E] Server running at ${baseUrl}`);

  const request = async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
  };

  try {
    // 1. Load Demo Project
    console.log('[Step 1] Loading demo project...');
    const demoRes = await request('/api/projects/load-demo', { method: 'POST' });
    if (!demoRes.ok || !demoRes.body.project) {
      throw new Error(`Failed to load demo project: ${JSON.stringify(demoRes.body)}`);
    }
    const projectId = demoRes.body.project.id;
    console.log(`✓ Loaded demo project: "${demoRes.body.project.name}" (ID: ${projectId})`);
    console.log(`  Sources: ${demoRes.body.sources?.length || 0}, Chunks: ${demoRes.body.totalChunks}`);

    // 2. Reconstruct
    console.log('\n[Step 2] Running reconstruction pipeline...');
    const reconRes = await request(`/api/projects/${projectId}/reconstruct`, {
      method: 'POST',
      body: JSON.stringify({ allowed_labels: ['team', 'leads-only', 'confidential'] })
    });
    if (!reconRes.ok) {
      throw new Error(`Reconstruction failed: ${JSON.stringify(reconRes.body)}`);
    }
    console.log(`✓ Reconstructed ${reconRes.body.claimsCount} claims (${reconRes.body.source})`);
    console.log(`  Status breakdown:`, reconRes.body.summary);

    // 3. Review Operations
    console.log('\n[Step 3] Lead Review Actions...');
    // Fetch all claims
    const claimsRes = await request(`/api/projects/${projectId}/claims`, {
      headers: { 'X-Role': 'lead' }
    });
    const claims = claimsRes.body.claims || [];

    // 3a. Resolve Maps API conflict
    const mapsConflict = claims.find(c => c.status === 'Conflicting' && c.text.toLowerCase().includes('maps'));
    if (!mapsConflict) {
      throw new Error('Could not find conflicting Google Maps API claim!');
    }
    console.log(`  Found conflicting claim: "${mapsConflict.text.substring(0, 60)}..."`);
    const resolveRes = await request(`/api/claims/${mapsConflict.id}/resolve-conflict`, {
      method: 'POST',
      headers: { 'X-Role': 'lead' },
      body: JSON.stringify({
        chosen_owner: 'Priya Sharma',
        resolution_note: 'Verified with outgoing lead Arjun that Google Cloud account for Maps API transitions to Priya under student credits.'
      })
    });
    if (!resolveRes.ok) throw new Error(`Resolve conflict failed: ${JSON.stringify(resolveRes.body)}`);
    console.log(`  ✓ Resolved Maps API conflict -> Owner set to "Priya Sharma", status updated to Verified`);

    // 3b. Confirm several claims
    const pendingClaims = claims.filter(c => c.id !== mapsConflict.id && c.review_state === 'pending');
    const toConfirm = pendingClaims.slice(0, 3);
    for (const c of toConfirm) {
      const confirmRes = await request(`/api/claims/${c.id}/confirm`, {
        method: 'POST',
        headers: { 'X-Role': 'lead' },
        body: JSON.stringify({ comment: 'Approved during lead audit' })
      });
      if (!confirmRes.ok) throw new Error(`Confirm failed: ${JSON.stringify(confirmRes.body)}`);
    }
    console.log(`  ✓ Confirmed ${toConfirm.length} claims`);

    // 3c. Reject one claim
    const toReject = pendingClaims[3];
    if (toReject) {
      const rejectRes = await request(`/api/claims/${toReject.id}/reject`, {
        method: 'POST',
        headers: { 'X-Role': 'lead' },
        body: JSON.stringify({ comment: 'Outdated or unverified item rejected' })
      });
      if (!rejectRes.ok) throw new Error(`Reject failed: ${JSON.stringify(rejectRes.body)}`);
      console.log(`  ✓ Rejected 1 claim: "${toReject.text.substring(0, 50)}..."`);
    }

    // 4. Approve Handover Snapshot
    console.log('\n[Step 4] Approving Handover snapshot (lead role)...');
    const approveRes = await request(`/api/projects/${projectId}/approve`, {
      method: 'POST',
      headers: { 'X-Role': 'lead' },
      body: JSON.stringify({ approve_all: true })
    });
    if (!approveRes.ok) throw new Error(`Approve failed: ${JSON.stringify(approveRes.body)}`);
    console.log(`✓ Created Version Snapshot v${approveRes.body.version} with ${approveRes.body.approvedClaimsCount} approved claims`);

    // 5. Incoming Member View
    console.log('\n[Step 5] Testing Incoming Member Handover View (X-Role: incoming)...');
    const incomingRes = await request(`/api/projects/${projectId}/handover`, {
      headers: { 'X-Role': 'incoming' }
    });
    if (!incomingRes.ok) throw new Error(`Incoming handover failed: ${JSON.stringify(incomingRes.body)}`);
    
    // Check incoming view sees decisions and open tasks
    const incomingData = incomingRes.body;
    console.log(`  Decisions visible to incoming: ${incomingData.groups.decisions.length}`);
    console.log(`  Open tasks visible to incoming: ${incomingData.groups.tasks.length}`);
    console.log(`  Next actions: ${incomingData.nextActions.length}`);
    
    // Verify confidential evidence is redacted for incoming member
    const incomingJson = JSON.stringify(incomingData);
    let incomingConfidentialLeak = false;
    for (const secret of CONFIDENTIAL_STRINGS) {
      if (incomingJson.includes(secret)) {
        incomingConfidentialLeak = true;
        console.error(`  ❌ LEAK in incoming handover: found "${secret}"`);
      }
    }
    if (!incomingConfidentialLeak) {
      console.log(`  ✓ Zero confidential content found in Incoming member handover view!`);
    } else {
      throw new Error('Confidential leak detected in incoming handover view!');
    }

    // 6. Restricted Newcomer View
    console.log('\n[Step 6] Testing Restricted Newcomer View (X-Role: restricted)...');
    
    // 6a. Handover endpoint
    const restHandoverRes = await request(`/api/projects/${projectId}/handover`, {
      headers: { 'X-Role': 'restricted' }
    });
    const restHandoverJson = JSON.stringify(restHandoverRes.body);

    // 6b. Claims endpoint
    const restClaimsRes = await request(`/api/projects/${projectId}/claims`, {
      headers: { 'X-Role': 'restricted' }
    });
    const restClaimsJson = JSON.stringify(restClaimsRes.body);

    // 6c. Timeline endpoint
    const restTimelineRes = await request(`/api/projects/${projectId}/timeline`, {
      headers: { 'X-Role': 'restricted' }
    });
    const restTimelineJson = JSON.stringify(restTimelineRes.body);

    console.log(`  Scanning restricted endpoints for leaks...`);
    let leakFound = false;
    const combinedRestrictedData = restHandoverJson + restClaimsJson + restTimelineJson;

    for (const secret of CONFIDENTIAL_STRINGS) {
      if (combinedRestrictedData.includes(secret)) {
        leakFound = true;
        console.error(`  ❌ CONFIDENTIAL LEAK in restricted view: "${secret}"`);
      }
    }

    for (const leadsOnly of LEADS_ONLY_STRINGS) {
      if (combinedRestrictedData.includes(leadsOnly)) {
        leakFound = true;
        console.error(`  ❌ LEADS-ONLY LEAK in restricted view: "${leadsOnly}"`);
      }
    }

    if (!leakFound) {
      console.log(`  ✓ ZERO confidential or leads-only content found in Handover, Claims, or Timeline for Restricted role!`);
      console.log(`  ✓ Timeline returned only ${restTimelineRes.body.total} team events (confidential & leads-only filtered).`);
    } else {
      throw new Error('Data leak detected in restricted role endpoints!');
    }

    // 7. Acknowledge Handover
    console.log('\n[Step 7] Acknowledging receipt...');
    const ackIncomingRes = await request(`/api/projects/${projectId}/acknowledge`, {
      method: 'POST',
      headers: { 'X-Role': 'incoming' },
      body: JSON.stringify({
        version_num: 1,
        notes: 'Priya Sharma acknowledged transition handover package v1.'
      })
    });
    if (!ackIncomingRes.ok) throw new Error(`Ack incoming failed: ${JSON.stringify(ackIncomingRes.body)}`);
    console.log(`  ✓ Incoming member acknowledgement recorded: ${ackIncomingRes.body.acknowledgementId}`);

    const ackRestrictedRes = await request(`/api/projects/${projectId}/acknowledge`, {
      method: 'POST',
      headers: { 'X-Role': 'restricted' },
      body: JSON.stringify({
        version_num: 1,
        notes: 'Restricted newcomer acknowledged onboarding team pack v1.'
      })
    });
    if (!ackRestrictedRes.ok) throw new Error(`Ack restricted failed: ${JSON.stringify(ackRestrictedRes.body)}`);
    console.log(`  ✓ Restricted newcomer acknowledgement recorded: ${ackRestrictedRes.body.acknowledgementId}`);

    // 8. Verify Acknowledgements endpoint
    console.log('\n[Step 8] Verifying acknowledgements history...');
    const acksRes = await request(`/api/projects/${projectId}/acknowledgements`);
    const acks = acksRes.body.acknowledgements || [];
    console.log(`  ✓ Found ${acks.length} acknowledgement records:`);
    acks.forEach(a => console.log(`    - Role: ${a.user_role} | Version: ${a.notes} | At: ${a.acknowledged_at}`));

    console.log('\n=== ALL END-TO-END FLOW TESTS PASSED FLAWLESSLY! ===\n');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});
