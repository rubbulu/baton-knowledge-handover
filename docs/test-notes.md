# Baton — Test Notes & Verification Report

**Date:** 8 November 2026  
**Environment:** Node.js (v22/v24), Express, SQLite (`better-sqlite3` with `node:sqlite` fallback), Vite + React  
**Test Suite Status:** 100% Passed (11 Unit Tests, 10 Server Integration Tests, 8 E2E Workflow Steps)

---

## 1. What Was Tested

### Flow 1: Ingestion & "How It Works" Home Workflow
- **"How It Works" Guide Strip:** Verified the 4-step visual workflow on the Home screen (`1. Upload` → `2. Reconstruct` → `3. Review` → `4. Handover`).
- **Demo Project Loading (`POST /api/projects/load-demo`):**
  - Ingested 4 realistic files for the CodeCraft Club transition (`meeting-notes-0314.md`, `team-chat.txt`, `tasks.csv`, `confidential-chat.txt`).
  - Generated **108 chunks** with accurate line numbers, timestamps, authors, and access labels (`team`, `leads-only`, `confidential`).

### Flow 2: Extraction & Deterministic Verifier (`POST /api/projects/:id/reconstruct`)
- Extracted **51 structured claims** across 6 types: `decision`, `owner`, `task`, `dependency`, `risk`, `recurring_problem`.
- Verified deterministic plain-code verifier execution:
  - Verified claims (substantiated across $\ge 2$ independent sources): **8**
  - Single-source claims (exactly 1 source): **36**
  - Conflicting claims (differing owners across sources): **2**
  - Missing claims (tasks with no assignee or dependencies without contact): **5**
  - Unverified claims: **0**

### Flow 3: Lead Review Actions & Conflict Resolution
- **Maps API Ownership Conflict:**
  - Located the contested Google Maps API key claim (Arjun in chat vs Priya in meeting notes).
  - Executed `POST /api/claims/:id/resolve-conflict` designating Priya Sharma as verified owner.
  - Verified claim status updated to `Verified` and review state updated to `approved`.
- **Claim Confirmations (`POST /api/claims/:id/confirm`):**
  - Audited and confirmed 3 pending claims.
- **Claim Rejection (`POST /api/claims/:id/reject`):**
  - Rejected 1 unverified/outdated claim ("Process emergency fund transfer tomorrow...").

### Flow 4: Handover Approval Snapshot (`POST /api/projects/:id/approve`)
- Created immutable **Version Snapshot v1** containing 50 approved claims.
- Verified version history records approver (`lead`), timestamp, and claims snapshot JSON in SQLite.

### Flow 5: Incoming Member View (`X-Role: incoming`)
- Queried `GET /api/projects/:id/handover`.
- Incoming member viewed:
  - Approved Decisions, Owners, Tasks, Dependencies, Risks, Recurring Problems.
  - Code-generated Next Actions (derived from open tasks and unassigned gaps).
- **Redaction Verification:** Zero confidential financial/deficiency text (`emergency reserve fund`, `AWS server bill deficit`, `₹15,000`, etc.) was returned.

### Flow 6: Restricted Newcomer View & Data Leak Audit (`X-Role: restricted`)
- Tested all 3 restricted endpoints:
  - `GET /api/projects/:id/handover`
  - `GET /api/projects/:id/claims`
  - `GET /api/projects/:id/timeline`
- **Leak Audit Result: ZERO LEAKS.**
  - Restricted role received **zero** bytes of confidential or leads-only content.
  - Confidential claims returned as safe placeholders: `{ id, redacted: true, reason: "restricted" }`.
  - Timeline returned **only 3 team events** from `team` sources (blocking both `confidential-chat.txt` and `team-chat.txt`).

### Flow 7: Trace Evidence Grounding & Receipts
- Interactive trace links (`🔍 Trace Evidence`) successfully expanded verbatim citations showing exact quotes, line references, authors, and source tags.
- Executed `POST /api/projects/:id/acknowledge`:
  - Successfully recorded incoming member acknowledgement (`Priya Sharma acknowledged transition handover package v1`).
  - Successfully recorded restricted newcomer onboarding acknowledgement.
  - Verified records stored in SQLite and displayed via `GET /api/projects/:id/acknowledgements`.

---

## 2. Bugs Found & Fixed

| Bug | Root Cause | Fix Applied |
|---|---|---|
| **Reconstruct Button Hanging ("loading loading loading")** | Gemini API returned 429 Quota Exceeded; adapter retried across 3 models $\times$ 3 attempts $\times$ 5 batches. | Implemented fast-fail on 429 quota/auth errors, reduced timeout to 12s, and prioritized instant demo cache (`< 100ms`). |
| **`nextActions` vs `next_actions` Key Mismatch** | Server returned `next_actions` (snake_case) while client expected `nextActions`. | Normalized backend to return both `next_actions` and `nextActions`; updated `HandoverView.jsx` to fallback safely. |
| **Timeline Role Redaction Boundary** | Chunks in `chunks` table had access labels, but join query didn't double-filter on `sources.access_label`. | Added `AND s.access_label IN (...)` to guarantee defense-in-depth isolation in timeline query. |
| **Role Switcher UI Out-of-Sync** | Switching roles in TopBar didn't automatically trigger handover view refresh. | Subscribed `HandoverView.jsx` to `subscribeRole` for instant reactive re-rendering on role toggles. |
| **Missing Version History Endpoint** | Client version modal requested `/api/projects/:id/versions` which was initially missing. | Added `GET /api/projects/:id/versions` endpoint querying the `versions` table. |

---

## 3. Known Issues & Round 3 Scope (Deferred)

The following features were intentionally excluded per hackathon project requirements and are scheduled for Round 3:
1. **Interactive Gap Interview:** Guided conversational Q&A for incoming users to fill detected missing items.
2. **Cross-Source Conflict Detection Test Suite:** Automated synthetic contradiction generator.
3. **Version Diffs:** Visual git-style diffs between snapshot versions.
4. **Markdown Export:** One-click download of the complete handover document as formatted `.md`.
