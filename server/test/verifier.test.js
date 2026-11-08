import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizeText,
  quoteExistsInChunk,
  extractSubject,
  areSubjectsMatching,
  verifyClaim
} from '../src/pipeline/verify.js';

describe('Baton Deterministic Verifier Unit Tests', () => {

  // Test 1: Quote Present
  it('1. Quote present: normalises whitespace/case and finds verbatim quote in chunk', () => {
    const chunkText = `[2026-03-03 14:11:32] Arjun Mehta: The consensus was solid: We decided to migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel to handle traffic spikes during HackSprint.`;
    const quote = `We decided to migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel to handle traffic spikes during HackSprint.`;

    const exists = quoteExistsInChunk(quote, chunkText);
    assert.strictEqual(exists, true, 'Quote should be found inside chunk');

    // Case and extra whitespace tolerance check
    const noisyQuote = `  WE DECIDED   TO MIGRATE THE CLUB REGISTRATION and project showcase portal from Django to Next.js hosted on Vercel\n to handle traffic spikes during HackSprint.  `;
    assert.strictEqual(quoteExistsInChunk(noisyQuote, chunkText), true, 'Noisy quote with whitespace/case differences should match');

    const claim = {
      id: 'claim-1',
      type: 'decision',
      text: 'Migrate portal from Django to Next.js on Vercel',
      owner: null
    };
    const evidenceList = [{ chunk_id: 'chunk-1', quote }];
    const chunkMap = new Map([
      ['chunk-1', { id: 'chunk-1', source_id: 'source-chat', text: chunkText }]
    ]);

    const result = verifyClaim(claim, evidenceList, chunkMap, []);
    assert.strictEqual(result.status, 'Single-source');
    assert.strictEqual(result.validEvidence.length, 1);
  });

  // Test 2: Quote Missing
  it('2. Quote missing: marks claim Unverified when quote cannot be found in chunk text', () => {
    const chunkText = `The attendance bot crashes whenever Discord rate limits webhooks with HTTP 429 during announcements.`;
    const fabricatedQuote = `We installed RabbitMQ queue to buffer all Discord webhooks completely.`;

    const exists = quoteExistsInChunk(fabricatedQuote, chunkText);
    assert.strictEqual(exists, false, 'Fabricated quote should not exist in chunk');

    const claim = {
      id: 'claim-2',
      type: 'decision',
      text: 'Installed RabbitMQ queue for Discord webhooks',
      owner: 'Vikram Aditya'
    };
    const evidenceList = [{ chunk_id: 'chunk-2', quote: fabricatedQuote }];
    const chunkMap = new Map([
      ['chunk-2', { id: 'chunk-2', source_id: 'source-notes', text: chunkText }]
    ]);

    const result = verifyClaim(claim, evidenceList, chunkMap, []);
    assert.strictEqual(result.status, 'Unverified', 'Status must be Unverified when quote is missing');
    assert.strictEqual(result.validEvidence.length, 0);
    assert.match(result.gap_note, /quote does not exist/i);
  });

  // Test 3: 2 Sources -> Verified (and 1 source -> Single-source)
  it('3. 2 sources: marks claim Verified when substantiated by 2 or more distinct sources', () => {
    const chunk1Text = `Meeting Notes: Migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel.`;
    const chunk2Text = `Chat Log: We decided to migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel.`;

    const claim = {
      id: 'claim-3',
      type: 'decision',
      text: 'Migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel',
      owner: 'Priya Sharma'
    };

    const evidenceList = [
      { chunk_id: 'chunk-notes', quote: 'Migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel.' },
      { chunk_id: 'chunk-chat', quote: 'We decided to migrate the club registration and project showcase portal from Django to Next.js hosted on Vercel.' }
    ];

    const chunkMap = new Map([
      ['chunk-notes', { id: 'chunk-notes', source_id: 'source-1-notes', text: chunk1Text }],
      ['chunk-chat', { id: 'chunk-chat', source_id: 'source-2-chat', text: chunk2Text }]
    ]);

    const result = verifyClaim(claim, evidenceList, chunkMap, []);
    assert.strictEqual(result.status, 'Verified', 'Claim supported by 2 distinct sources must be Verified');
    assert.strictEqual(result.distinctSourceIds.length, 2);

    // If only 1 source was provided:
    const singleSourceEvidence = [evidenceList[0]];
    const singleResult = verifyClaim(claim, singleSourceEvidence, chunkMap, []);
    assert.strictEqual(singleResult.status, 'Single-source', 'Claim supported by 1 source must be Single-source');
  });

  // Test 4: Conflict (Differing owners across sources)
  it('4. Conflict: detects differing owners across sources for the same subject and marks Conflicting', () => {
    const chunkNotes = `Google Maps API billing account and API key is owned and managed by Priya under her Google Cloud Student account.`;
    const chunkChat = `Just confirming, the Google Maps API key is on my personal GCP console and credit card, so whoever takes over needs to swap it before I lose university email access.`;

    const claimPriya = {
      id: 'claim-priya',
      type: 'owner',
      text: 'Priya Sharma owns and manages the Google Maps API billing account and key',
      owner: 'Priya Sharma'
    };

    const claimArjun = {
      id: 'claim-arjun',
      type: 'owner',
      text: 'Arjun Mehta holds the Google Maps API key on his personal GCP console and credit card',
      owner: 'Arjun Mehta',
      evidence: [
        { chunk_id: 'chunk-chat', quote: 'Google Maps API key is on my personal GCP console and credit card' }
      ]
    };

    const evidenceList = [
      { chunk_id: 'chunk-notes', quote: 'Google Maps API billing account and API key is owned and managed by Priya' }
    ];

    const chunkMap = new Map([
      ['chunk-notes', { id: 'chunk-notes', source_id: 'source-notes', text: chunkNotes }],
      ['chunk-chat', { id: 'chunk-chat', source_id: 'source-chat', text: chunkChat }]
    ]);

    const result = verifyClaim(claimPriya, evidenceList, chunkMap, [claimPriya, claimArjun]);
    assert.strictEqual(result.status, 'Conflicting', 'Owner conflict across sources must be marked Conflicting');
    assert.match(result.gap_note, /Priya Sharma/);
    assert.match(result.gap_note, /Arjun Mehta/);
    assert.strictEqual(result.conflictEvidence.length > 0, true, 'Conflict evidence must be linked');
  });

  // Test 5: Missing Owner (Gap Rule)
  it('5. Missing owner: marks task with no assignee or dependency without owner as Missing with gap note', () => {
    const chunkCsv = `[TASK-12] Automate DNS failover and SSL renewals for codecraftclub.org | Category: DevOps | Status: Todo | Owner: Unassigned | Notes: Crucial floating infrastructure task with no designated owner assigned`;
    const quote = `[TASK-12] Automate DNS failover and SSL renewals for codecraftclub.org | Category: DevOps | Status: Todo | Owner: Unassigned`;

    // 5a. Task with null/unassigned owner
    const taskClaim = {
      id: 'claim-task-12',
      type: 'task',
      text: 'Automate DNS failover and SSL renewals for codecraftclub.org',
      owner: null // No assignee
    };

    const evidenceList = [{ chunk_id: 'chunk-task-12', quote }];
    const chunkMap = new Map([
      ['chunk-task-12', { id: 'chunk-task-12', source_id: 'source-csv', text: chunkCsv }]
    ]);

    const taskResult = verifyClaim(taskClaim, evidenceList, chunkMap, []);
    assert.strictEqual(taskResult.status, 'Missing', 'Task with no owner must be marked Missing');
    assert.strictEqual(taskResult.gap_note, 'Task has no assigned owner/assignee');

    // 5b. Dependency with null/unassigned owner
    const depClaim = {
      id: 'claim-dep-1',
      type: 'dependency',
      text: 'Namecheap domain renewal and automated DNS failover',
      owner: 'Unassigned'
    };

    const depResult = verifyClaim(depClaim, evidenceList, chunkMap, []);
    assert.strictEqual(depResult.status, 'Missing', 'Dependency with no owner must be marked Missing');
    assert.strictEqual(depResult.gap_note, 'Dependency has no designated owner or contact point');
  });

});
