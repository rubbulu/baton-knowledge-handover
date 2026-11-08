# Baton — Hackathon Round 2 Submission

**Project Title:** Baton: Grounded Knowledge-Handover Tool  
**Public Repository:** [https://github.com/rubbulu/baton-knowledge-handover](https://github.com/rubbulu/baton-knowledge-handover)  
**Round 2 Deadline:** 11 Nov 2026, 10:00 AM IST  

---

## 1. List of Completed Features (Round 2)

- **Multi-Modal Document Ingestion & Chunking:**
  - Automated ingestion of Project Notes (`.md`/`.txt`), Team Chat Exports (`.txt`), and Task Boards (`.csv`).
  - Line-by-line coordinate tracking (`L12-L15`), chat author/timestamp message parsing, and CSV task row extraction.
  - Granular access label tagging per file: `team`, `leads-only`, and `confidential`.
- **Pre-Seeded Synthetic Demo Dataset:**
  - CodeCraft Club leadership transition dataset (Arjun Mehta graduating and handing over to Priya Sharma).
  - Pre-seeded with 4 multi-source files (108 chunks) exhibiting a multi-source verified decision, conflicting Maps API owners, unassigned task gaps, single-source claims, and confidential financial discussions.
- **Grounded Claim Extraction Pipeline:**
  - Gemini LLM adapter with batched processing, structured JSON schema output, and timeout protection.
  - Extracts 6 distinct claim categories: `decision`, `owner`, `task`, `dependency`, `risk`, `recurring_problem`.
  - Enforces strict verbatim quote extraction copied word-for-word from cited source chunks.
  - Dual-path offline cache fallback (`server/cache/demo-extraction.json`) preventing API quota failures during live demonstrations.
- **Deterministic Plain-Code Verifier:**
  - Quote authenticity verification via normalized string matching (missing quotes marked `Unverified`).
  - Cross-source evidence corroboration ($\ge 2$ independent sources $\rightarrow$ `Verified`; $1$ source $\rightarrow$ `Single-source`).
  - Automated contradiction detection (differing owners for the same subject across sources $\rightarrow$ `Conflicting`).
  - Gap rule identifying floating tasks and dependencies lacking owners $\rightarrow$ `Missing`.
- **Server-Enforced Access Control & Redaction:**
  - Role-based visibility model via `X-Role` request header (`lead`, `incoming`, `restricted`).
  - Central `canSee(role, claim)` rule: A claim is visible only if the user has clearance for all supporting chunks.
  - Server-side redaction returning sanitized stubs `{ id, redacted: true, reason: "restricted" }` with zero quote/owner leaks.
- **Lead Review & Version Snapshot Engine:**
  - Lead review capabilities: inline edit of claim text/assignee, approve/confirm, and reject.
  - Conflict resolution dialog displaying side-by-side citations from independent sources to choose the verified owner.
  - Handover approval snapshots creating immutable, versioned records (`v1`, `v2`, etc.) in SQLite with an audit log.
- **Recipient Handover Screen & Receipts:**
  - Grouped view across all 6 claim buckets.
  - Code-derived "Next Actions" panel highlighting urgent priorities and unassigned tasks.
  - Interactive `🔍 Trace Evidence` drawers showing exact verbatim quotes, line references, and author metadata.
  - "Acknowledge Receipt" button recording timestamped recipient acknowledgements in SQLite.
- **Modern, Accessible Web Application:**
  - Single-service deployment: Express serves both the REST API and the built Vite + React frontend.
  - Interactive "How It Works" 4-step guide strip (`Upload` $\rightarrow$ `Reconstruct` $\rightarrow$ `Review` $\rightarrow$ `Handover`).
  - Auto-seeding on fresh startup when the database is empty.

---

## 2. Technology & Implementation Details

- **Frontend Architecture:**
  - Built with React 18 and Vite.
  - Clean, accessible CSS with WCAG-compliant high-contrast states, responsive layouts, and interactive modals.
  - Role switcher dynamically broadcasts active permissions to all active views and the fetch wrapper.
- **Backend Architecture:**
  - Built on Node.js and Express.
  - Multi-part file upload streaming via `multer` (in-memory buffers, 25MB limits).
  - Single-service production architecture: Express serves the static production build from `client/dist`.
- **Database Layer:**
  - SQLite with WAL (Write-Ahead Logging) mode and foreign key enforcement.
  - Dual-driver runtime: dynamically loads `better-sqlite3` on Node 20/22 and falls back to Node's built-in `node:sqlite` on Node 24, ensuring universal runtime portability.
  - Configurable database path via `DATABASE_PATH` / `SQLITE_PATH` environment variables.
- **LLM Pipeline & Adapter:**
  - Google Gemini API (`@google/genai` v3 SDK) configured for `gemini-2.5-flash` / `gemini-3.5-flash`.
  - Resilient adapter architecture with fast-fail quota detection (halts immediately on 429 quota exhaustion to prevent browser hanging).
  - Offline cache fallback for deterministic, sub-100ms hackathon evaluation.
- **Security & Access Control:**
  - Perimeter-enforced server-side redaction.
  - Database queries join chunks and sources on `access_label IN (:allowedLabels)` so confidential messages are never retrieved into memory for restricted users.

---

## 3. Explanation of Changes Made to the Original Plan

1. **Deterministic Plain-Code Verifier instead of Pure LLM Evaluation:**
   - *Original Plan:* Use the LLM to both extract and verify whether claims agreed or conflicted.
   - *Change:* LLM is restricted solely to initial extraction and quote citation; verification is executed by deterministic JavaScript code (`verify.js`).
   - *Reason:* LLMs can hallucinate corroboration or miss subtle contradictions. Plain code guarantees 100% mathematical citation matching, reproducible status badges, and deterministic conflict detection.
2. **Server-Side Perimeter Redaction instead of Client-Side Masking:**
   - *Original Plan:* Filter claims in the React UI based on user role.
   - *Change:* Enforce redaction strictly on the Express server in `access.js`.
   - *Reason:* Security perimeter integrity. Client-side hiding sends confidential quotes over the wire, allowing inspection via browser DevTools. The server completely strips text, owner, and quote fields before dispatching JSON.
3. **Dual-Path Caching Architecture:**
   - *Original Plan:* Rely solely on live Gemini API calls for every extraction run.
   - *Change:* Save extracted claims for the demo project to `server/cache/demo-extraction.json` with automatic fallback.
   - *Reason:* Google AI Studio free tier rate limits (`429 Quota Exceeded`) can block live hackathon judging. The dual-path architecture guarantees instantaneous (< 100ms) execution for demo data while preserving live extraction for uploaded files.
4. **Taxonomy & Code-Generated Next Actions:**
   - *Original Plan:* Display a flat list of claims.
   - *Change:* Group claims into 6 categorized buckets (Decisions, Owners, Tasks, Dependencies, Risks, Recurring Problems) and generate an automated "Next Actions" priority matrix.
   - *Reason:* Incoming team members need actionable day-one direction rather than a raw dump of statements.

---

## 4. Round 3 Improvements (Roadmap)

The following three core capabilities are planned for Round 3:

1. **Interactive Gap Interview:**
   - An intelligent conversational agent that reviews all claims marked `Missing` (unassigned tasks, floating cloud credentials, missing vendor contact points) and conducts an interactive, step-by-step interview with the outgoing lead before they depart to systematically resolve every operational blind spot.
2. **Cross-Source Conflict Detection with a Seeded Contradiction Test Set:**
   - A formalized synthetic evaluation test set containing contradictory claims across diverse source pairings (e.g., chat vs task board deadline discrepancies, budget discrepancies between notes and invoices).
   - Automated benchmarking metrics measuring precision, recall, and false positive rates of the conflict detector.
3. **Version Diffs & Formatted Markdown Export:**
   - **Version Diffs:** Visual, git-style side-by-side comparison between handover versions (e.g. `v1` vs `v2`), highlighting modified owners, new verified claims, and newly resolved conflicts.
   - **Markdown Export:** One-click generation of a standalone, beautifully formatted `HANDOVER.md` document incorporating all approved claims, citations, and next actions for archiving directly in the team's repository.
