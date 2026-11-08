# Baton — System Architecture & Data Flow

This document details the internal technical architecture, data processing pipeline, and server-side security perimeter of **Baton**.

---

## 1. End-to-End Pipeline Diagram

```mermaid
flowchart TD
    subgraph INGESTION["1. Multi-Source Ingestion & Chunking"]
        A1["Project Notes (.md/.txt)<br/>Access: team"] --> C1["Markdown Chunker<br/>(Paragraphs, Line refs L..)"]
        A2["Team Chat (.txt)<br/>Access: leads-only"] --> C2["Chat Parser<br/>(Author, Timestamp, Msg)"]
        A3["Task Board (.csv)<br/>Access: team"] --> C3["CSV Parser<br/>(Row index, Task ID, Assignee)"]
        A4["Confidential Channel (.txt)<br/>Access: confidential"] --> C4["Chat Parser<br/>(Private logs, L..)"]
        C1 & C2 & C3 & C4 --> DB_CHUNKS[("SQLite: chunks & sources")]
    end

    subgraph EXTRACTION["2. Grounded Claim Extraction"]
        DB_CHUNKS --> FILTER_ALLOWED["Filter Chunks by<br/>Allowed Labels (Audit Log)"]
        FILTER_ALLOWED --> BATCHER["Chunk Batcher<br/>(Batches of 25 chunks)"]
        BATCHER --> GEMINI["Gemini LLM Adapter<br/>(gemini-2.5-flash / gemini-3.5-flash)"]
        GEMINI -.->|429 Quota Exceeded / Offline| CACHE["Demo Extraction Cache<br/>(demo-extraction.json)"]
        GEMINI --> EXTRACTED_RAW["Raw Claims with<br/>Exact Source Quotes"]
        CACHE --> EXTRACTED_RAW
        EXTRACTED_RAW --> DB_CLAIMS[("SQLite: claims & claim_evidence<br/>(Status: Unverified, Review: pending)")]
    end

    subgraph VERIFIER["3. Deterministic Verifier (Plain Code)"]
        DB_CLAIMS --> V_QUOTE{"Verbatim Quote in Chunk?<br/>(Normalized string match)"}
        V_QUOTE -- No --> ST_UNVERIFIED["Status: Unverified<br/>(Hidden from recipient)"]
        V_QUOTE -- Yes --> V_COUNT{"Distinct Source IDs<br/>for Claim Evidence"}
        V_COUNT -- ">= 2 Sources" --> ST_VERIFIED["Status: Verified"]
        V_COUNT -- "== 1 Source" --> ST_SINGLE["Status: Single-source"]
        
        DB_CLAIMS --> V_CONFLICT{"Differing Owners for<br/>Same Subject across Sources?"}
        V_CONFLICT -- Yes --> ST_CONFLICT["Status: Conflicting<br/>(Side-by-side evidence stored)"]
        
        DB_CLAIMS --> V_GAP{"Unassigned Task or<br/>Dependency without Owner?"}
        V_GAP -- Yes --> ST_MISSING["Status: Missing<br/>(Gap note generated)"]
    end

    subgraph REVIEW["4. Lead Review & Handover Snapshot"]
        ST_VERIFIED & ST_SINGLE & ST_CONFLICT & ST_MISSING --> LEAD_UI["Lead Review Interface"]
        LEAD_UI --> ACT_RESOLVE["Resolve Conflict<br/>(Designate Verified Owner)"]
        LEAD_UI --> ACT_CONFIRM["Confirm Claim"]
        LEAD_UI --> ACT_REJECT["Reject Claim"]
        LEAD_UI --> ACT_APPROVE["Approve Handover<br/>(Create Version Snapshot)"]
        ACT_APPROVE --> DB_VERSIONS[("SQLite: versions & audit_log")]
    end

    subgraph SECURITY["5. Server-Side Access Perimeter (access.js)"]
        DB_VERSIONS --> API_REQ["API Request<br/>(X-Role: lead | incoming | restricted)"]
        API_REQ --> CAN_SEE{"canSee(role, claim)<br/>Can role view ALL evidence?"}
        CAN_SEE -- Yes --> DISPATCH_CLEAN["Send Full Claim &<br/>Role-Allowed Evidence"]
        CAN_SEE -- No --> DISPATCH_REDACT["Send Strict Redacted Placeholder<br/>{ id, redacted: true, reason: 'restricted' }<br/>(NO text, NO owner, NO quote)"]
    end

    classDef secure fill:#064e3b,stroke:#059669,color:#6ee7b7;
    classDef caution fill:#7c2d12,stroke:#ea580c,color:#fdba74;
    classDef neutral fill:#1e293b,stroke:#475569,color:#f8fafc;
    class DISPATCH_CLEAN secure;
    class DISPATCH_REDACT caution;
    class CAN_SEE neutral;
```

---

## 2. Data Flow & Security Perimeter

### Phase 1: Ingestion & Chunker Isolation
1. **Sources Table:** Every file uploaded or loaded via demo receives a UUID, a file type (`notes`, `chat`, `tasks`), and an explicit access label (`team`, `leads-only`, `confidential`).
2. **Chunker Line Numbering:**
   - Markdown documents are split into logical paragraphs and bullet lists with exact start/end line coordinates (`L12-L15`).
   - Chat logs parse timestamps and authors, tracking individual chat message boundaries.
   - CSV task boards preserve task keys (`TASK-02`), categories, and assignees.
3. Every chunk inherits its parent source's `access_label`, ensuring immutable security tracking from day 0.

### Phase 2: Grounded Extraction Pipeline
- **Audit-Logged Scope:** Chunks are filtered by the reconstruct run's allowed access labels (`team`, `leads-only`, `confidential` for lead reconstruction). The exact set of labels utilized is permanently recorded in `audit_log`.
- **Extraction Schema Enforcement:** Gemini outputs structured JSON matching a strict schema:
  - `type`: `decision` | `owner` | `task` | `dependency` | `risk` | `recurring_problem`
  - `text`: Factual claim description.
  - `owner`: Responsible party or `null` if unassigned (the prompt explicitly forbids hallucinating assignees).
  - `chunk_ids`: UUIDs of the cited chunks.
  - `quote`: **Exact verbatim quote** copied word-for-word from the cited chunk.
- **Fail-Safe Cache:** If Google API quota limits occur (`429 Resource Exhausted`), the adapter fails fast and transparently falls back to `server/cache/demo-extraction.json`.

### Phase 3: Deterministic Verifier (Plain Code)
The verifier does **not** rely on LLM prompts; it is 100% plain deterministic code:
1. **Verbatim Check:** Whitespace and case-normalizes the cited quote and tests for substring containment in the referenced chunk text. Missing quotes are assigned `Unverified`.
2. **Source Counting:** Evaluates independent distinct `source_id` references across valid evidence:
   - $\ge 2$ independent sources $\rightarrow$ `Verified`
   - $1$ source $\rightarrow$ `Single-source`
3. **Contradiction Detection:** Evaluates claims of type `owner` or `dependency` addressing the same normalized subject. If distinct sources report different owners, status is marked `Conflicting` and both pieces of evidence are preserved for side-by-side comparison.
4. **Gap Identification:** Open tasks with no assignee or dependencies without a contact point are tagged `Missing` with explanatory audit notes.

### Phase 4: Server-Side Security Perimeter & Redaction
Access control is enforced **strictly on the server** in `server/src/access.js` and `server/src/routes.js`:

```
                       ROLE PRIVILEGES
          ┌─────────────┬────────────────────────────────────┐
          │ Role        │ Allowed Evidence Access Labels     │
          ├─────────────┼────────────────────────────────────┤
          │ lead        │ team, leads-only, confidential     │
          │ incoming    │ team, leads-only                   │
          │ restricted  │ team                               │
          └─────────────┴────────────────────────────────────┘
```

#### Where Access Checks Happen:
1. **`canSee(role, claim)` Function:**
   - Evaluates whether the requested role has permission to see **all** supporting evidence chunks.
   - If any single piece of evidence comes from an unauthorized chunk (e.g., `confidential`), the claim fails the access test.
2. **`filterOrRedactClaim(role, claim)` Function:**
   - If `canSee` fails, returns a redacted stub:  
     `{ id: claim.id, redacted: true, reason: "restricted" }`  
     **No text, no owner, and no evidence quotes** are included.
3. **Database-Level Timeline Query:**
   - In `GET /api/projects/:id/timeline`, chunks and sources are joined with:
     ```sql
     WHERE c.access_label IN (:allowedLabels) AND s.access_label IN (:allowedLabels)
     ```
   - This prevents confidential messages from ever being loaded into Node memory for restricted users.
4. **Code-Derived "Next Actions" Generation:**
   - Redacted claims are skipped during Next Actions generation to prevent accidental data leaks through task descriptions.

---

## 3. SQLite Database Schema (ER Diagram)

```mermaid
erDiagram
    PROJECTS ||--o{ SOURCES : contains
    PROJECTS ||--o{ CLAIMS : has
    PROJECTS ||--o{ VERSIONS : snapshots
    PROJECTS ||--o{ AUDIT_LOG : tracks
    PROJECTS ||--o{ ACKNOWLEDGEMENTS : records
    
    SOURCES ||--o{ CHUNKS : splits_into
    
    CLAIMS ||--o{ CLAIM_EVIDENCE : grounded_by
    CHUNKS ||--o{ CLAIM_EVIDENCE : cited_in
    CLAIMS ||--o{ REVIEWS : reviewed_in

    PROJECTS {
        text id PK
        text name
        text description
        datetime created_at
        datetime updated_at
    }

    SOURCES {
        text id PK
        text project_id FK
        text name
        text type
        text access_label
        text raw_content
        datetime created_at
    }

    CHUNKS {
        text id PK
        text source_id FK
        text author
        text timestamp
        text text
        text access_label
        text line_ref
        datetime created_at
    }

    CLAIMS {
        text id PK
        text project_id FK
        text type
        text text
        text owner
        text status
        text review_state
        integer version
        text gap_note
        datetime created_at
        datetime updated_at
    }

    CLAIM_EVIDENCE {
        text id PK
        text claim_id FK
        text chunk_id FK
        text quote
        datetime created_at
    }

    VERSIONS {
        text id PK
        text project_id FK
        integer version_num
        text snapshot_json
        datetime created_at
    }

    ACKNOWLEDGEMENTS {
        text id PK
        text project_id FK
        text user_role
        datetime acknowledged_at
        text notes
    }

    AUDIT_LOG {
        text id PK
        text project_id FK
        text action
        text actor
        text details
        datetime created_at
    }
```
