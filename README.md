# Baton 🏃‍♂️

> **Intelligent, Grounded Knowledge-Handover Tool**  
> *Transforming fragmented project notes, team chat exports, and task boards into structured, verified claims backed by verbatim source citations.*

[![CI / Tests](https://img.shields.io/badge/tests-passing-brightgreen)](https://github.com/rubbulu/baton-knowledge-handover)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Repository](https://img.shields.io/badge/GitHub-baton--knowledge--handover-181717?logo=github)](https://github.com/rubbulu/baton-knowledge-handover)

---

## 📌 What is Baton?

When team leads or core contributors transition off a project, critical institutional context is routinely lost across scattered documents, unorganized chat exports, and outdated task trackers.

**Baton** automates this handover by ingesting three fundamental real-world artifacts:
1. **Project Notes** (`.md` / `.txt`)
2. **Team Chat Exports** (`.txt`)
3. **Task Boards** (`.csv`)

From these raw inputs, Baton extracts concrete, factual **claims** across 6 core operational categories:
- 🏛️ **Decisions:** Architectural, product, and organizational choices made by the team.
- 👤 **Owners:** Systems, cloud accounts, API keys, repositories, and role assignments.
- 📋 **Tasks:** Active, upcoming, blocked, or deferred action items.
- 🔗 **Dependencies:** System, library, credential, or external blocker requirements.
- ⚠️ **Risks:** Single points of failure, security vulnerabilities, and technical debt.
- 🔁 **Recurring Problems:** Known bugs, rate limits, manual workarounds, and chronic operational friction.

Every claim is strictly grounded in an **exact, verbatim source quote** and deterministically assessed by code for verification integrity.

---

## ✨ Features Completed in Round 2

1. **Multi-Source Ingestion & Intelligent Chunking:**
   - Accurate line-by-line paragraph/bullet chunking for Markdown/text (`L12-L15`).
   - Chat parser for message timestamps and speaker attribution (`[YYYY-MM-DD HH:MM:SS] Author: message`).
   - CSV row parser mapping task IDs, categories, assignees, and notes.
   - Per-file access label assignment: `team`, `leads-only`, and `confidential`.

2. **Grounded Claim Extraction Pipeline:**
   - Google Gemini API integration behind a resilient, timeout-protected adapter.
   - Structured JSON output strictly requiring verbatim quotes and chunk citations.
   - Offline cache fallback (`server/cache/demo-extraction.json`) guaranteeing instantaneous demo execution without quota issues.

3. **Deterministic Plain-Code Verifier:**
   - **Quote Authenticity Check:** Normalizes whitespace and case to ensure quotes exist verbatim inside source chunks. Unmatched claims are flagged `Unverified` and hidden from recipient views.
   - **Cross-Source Corroboration:** 2 or more independent sources $\rightarrow$ `Verified`; 1 source $\rightarrow$ `Single-source`.
   - **Conflict Detection:** Identifies differing owners for the same subject across sources $\rightarrow$ `Conflicting` (stores conflicting evidence side by side).
   - **Gap Detection:** Unassigned tasks or dependencies lacking contacts $\rightarrow$ `Missing` with explanatory gap notes.

4. **Server-Enforced Access Control & Redaction:**
   - Role simulation via `X-Role` request header: `lead`, `incoming`, and `restricted`.
   - Central `canSee(role, claim)` rule: A claim is visible **only** if the role is authorized to see **all** of its supporting evidence chunks.
   - Non-compliant claims are redacted on the server into safe placeholders:  
     `{ id, redacted: true, reason: "restricted" }`.
   - Zero confidential strings leak across claims, handover documents, or chronological timeline events.

5. **Lead Review & Handover Snapshot Engine:**
   - Review actions: Edit claim text/owner, Confirm claim, Reject claim.
   - Conflict resolution modal displaying both conflicting citations side by side for lead decision.
   - Immutable Handover Versioning: "Approve Handover" snapshots all approved claims into versioned records (`v1`, `v2`, etc.) in SQLite with audit logs.

6. **Interactive Role-Based Handover Screen:**
   - Grouped sections (Decisions, Owners, Open tasks, Dependencies, Risks, Recurring problems).
   - Code-derived "Next Actions" priority panel.
   - Interactive `🔍 Trace Evidence` links opening exact verbatim quotes and metadata.
   - "Acknowledge Receipt" button recording timestamped recipient acknowledgements.

7. **One-Service Full Stack Deployment:**
   - Single Express service serving the built Vite React client and API.
   - Auto-seeding on fresh start when the database is empty.
   - `render.yaml` configuration ready for Render's free tier.

---

## 🛠️ Tech Stack

- **Frontend:** React 18, Vite, Plain CSS (accessible focus rings, WCAG-compliant contrast, dark aesthetic)
- **Backend:** Node.js, Express
- **Database:** SQLite with WAL mode (`better-sqlite3` with automated `node:sqlite` fallback)
- **File Parsing & Uploads:** `multer` (in-memory buffering), CSV parser, custom Markdown & chat chunkers
- **LLM Engine:** Google Gemini API (`@google/genai` v3 SDK) behind adapter with fast-fail quota detection
- **Testing:** Node.js native test runner (`node --test`), assert module, custom E2E integration test suite

---

## 🚀 How to Run Locally

### 1. Prerequisites
- **Node.js** v20, v22, or v24
- **npm** v9+
- *(Optional)* Gemini API Key from [Google AI Studio](https://aistudio.google.com/) if testing live API extraction instead of the pre-computed demo cache.

### 2. Clone & Setup
```bash
git clone https://github.com/rubbulu/baton-knowledge-handover.git
cd baton-knowledge-handover
cp .env.example .env
```

### 3. Install Dependencies
```bash
npm run install:all
```

### 4. Configure Environment
Edit `.env` (optional — works out of the box with `USE_CACHE=true`):
```env
PORT=5000
USE_CACHE=true
GEMINI_API_KEY=your_gemini_api_key_here
```

### 5. Start the Application
- **Option A: Production One-Service Mode (Recommended)**
  ```bash
  npm run build
  npm start
  ```
  Open **[http://localhost:5000](http://localhost:5000)** in your browser.

- **Option B: Development Mode (Hot Reloading)**
  ```bash
  npm run dev
  ```
  Frontend runs on **http://localhost:3000**, backend runs on **http://localhost:5000**.

### 6. Run the Test Suites
```bash
# Run unit tests and access control tests
npm test --prefix server

# Run end-to-end full workflow simulation
node test-e2e-flow.js
```

---

## 🛡️ How the Verifier and Access Control Work

```
┌─────────────────────────────────────────────────────────────┐
│                       INGESTED SOURCES                      │
│   meeting-notes.md (team)        tasks.csv (team)           │
│   team-chat.txt (leads-only)     confidential-chat.txt      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 LLM EXTRACTION (Gemini Adapter)             │
│   Extracts structured claims with verbatim source quotes     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             DETERMINISTIC VERIFIER (Plain Code)             │
│                                                             │
│   1. Verbatim quote exists in chunk?                        │
│      ├── NO  ──> Status: "Unverified" (hidden from handover)│
│      └── YES ──> Check independent sources:                 │
│                  ├── 2+ Sources ──> Status: "Verified"      │
│                  └── 1 Source   ──> Status: "Single-source" │
│                                                             │
│   2. Different owners for same subject?                     │
│      └── YES ──> Status: "Conflicting" (requires resolution)│
│                                                             │
│   3. Task without assignee or dependency without owner?     │
│      └── YES ──> Status: "Missing" (gap note generated)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│         SERVER-SIDE ROLE ACCESS PERIMETER (canSee)          │
│                                                             │
│   - lead:       Sees team, leads-only, confidential         │
│   - incoming:   Sees team, leads-only (confidential hidden) │
│   - restricted: Sees team ONLY (leads & confidential hidden)│
│                                                             │
│   Redaction: Returns { id, redacted: true, reason: "..." }  │
│   with ZERO text, owner, or quotes sent to the client.      │
└─────────────────────────────────────────────────────────────┘
```

1. **Verifier Integrity:** Verification is pure deterministic TypeScript/JavaScript logic — **not** an LLM prompt. This guarantees that hallucinated citations are flagged as `Unverified` and never shown to handover recipients.
2. **Server-Side Enforcement:** Redaction is never handled client-side via CSS or hidden React components. If a user’s role does not allow viewing a chunk, the Express server replaces the entire claim payload with a sanitized `{ id, redacted: true, reason: "restricted" }` object.

---

## 🚶 Demo Walkthrough (5 Steps)

Follow this 5-minute walkthrough using the built-in synthetic **CodeCraft Club** dataset (Arjun graduating and handing over to Priya):

1. **Load the Demo Project:**
   - On the Home screen, click **"⚡ Load Demo Project"**.
   - 4 source files (108 chunks) are ingested with access labels pre-assigned (`meeting-notes-0314.md` = `team`, `team-chat.txt` = `leads-only`, `tasks.csv` = `team`, `confidential-chat.txt` = `confidential`).

2. **Reconstruct Claims:**
   - Click **"🔄 Reconstruct Claims"**.
   - In milliseconds, 51 structured claims are extracted and verified. Inspect the status pills: **8 Verified**, **36 Single-source**, **2 Conflicting**, and **5 Missing**.

3. **Lead Review & Conflict Resolution:**
   - Locate the conflicting claim: *"Google Maps API billing account and API key..."*.
   - Click **"⚡ Resolve Conflict"** to open the side-by-side evidence dialog showing Arjun's chat statement vs Priya's notes.
   - Click **"Choose Priya Sharma"** and submit. The claim immediately upgrades to `Verified`!
   - Confirm 2-3 additional claims and click **"✕ Reject"** on an outdated item.

4. **Approve Handover Snapshot:**
   - Click **"📜 Approve & Versions"** in the top bar.
   - Click **"✅ Approve Handover Snapshot"** to create **Version Snapshot v1**.

5. **Role-Based Handover & Receipt Acknowledgement:**
   - Switch to the **"Handover Document & Next Actions"** tab.
   - Review code-generated immediate next actions and trace evidence quotes with `🔍 Trace Evidence`.
   - Use the top-right role switcher to toggle to **Incoming Member**: notice confidential leadership disputes are securely hidden while team decisions remain visible.
   - Toggle to **Restricted Newcomer**: notice all leads-only chat context is replaced with `🔒 Restricted - ask the project lead`.
   - Click **"📝 Acknowledge Receipt"** to sign off and write to the audit log.

---

## 🔄 Changes from the Round 1 Plan

| Round 1 Initial Concept | Round 2 Implementation | Architectural Reason |
|---|---|---|
| Pure LLM verification pipeline | **Deterministic plain-code verifier** (`verify.js`) | LLMs can hallucinate verification agreements. Writing the verifier in plain deterministic code guarantees mathematical citation integrity and 100% reproducible status badges. |
| Client-side role filtering | **Server-side perimeter redaction** (`access.js`) | Security integrity: client-side inspection or modified network requests could leak confidential leadership quotes. Sensitive payloads are stripped before leaving Express. |
| Live API dependency only | **Dual-path architecture with cached demo fallback** | Avoids demo failure during hackathon judging caused by Google AI Studio API rate limits (`429 Quota Exceeded`) or network drops. |
| Monolithic document view | **Grouped taxonomy + Code-derived Next Actions** | Categorizing claims into 6 specific operational buckets with auto-prioritized action items makes handovers actionable on day 1. |

---

## 🤖 AI Assistance & Libraries Disclosure

### AI Assistance Disclosure
- **Coding Assistant:** Antigravity (Advanced Agentic AI Assistant designed by Google DeepMind).
- **LLM Adapter:** Google Gemini API (`gemini-2.5-flash` / `gemini-3.5-flash`) via the official `@google/genai` SDK for structured JSON claim extraction.

### Third-Party Libraries
#### Backend:
- `express` (v4.21.2): HTTP web server and API routing.
- `better-sqlite3` (v11.8.1) & `node:sqlite`: High-performance SQLite engine with automated LTS fallback.
- `multer` (v1.4.5-lts.1): Secure multipart file uploads.
- `cors` (v2.8.5): Cross-origin resource sharing middleware.
- `dotenv` (v16.4.7): Environment variable management.
- `@google/genai` (v3.0.0): Official Google Gen AI SDK for Gemini models.

#### Frontend:
- `react` (v18.3.1) & `react-dom` (v18.3.1): Declarative component UI.
- `vite` (v6.4.5): Next-generation frontend bundler and development server.
- `concurrently` (v9.1.2): Development orchestration tool.
