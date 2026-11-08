# Baton System Architecture

## System Overview
Baton is an automated knowledge-handover tool designed to turn unstructured project artifacts into structured, grounded, and verified claims for incoming team members.

## Core Ingestion Pipeline
1. **Multi-Source Ingestion:**
   - Project Notes (`.md`, `.txt`)
   - Chat Export (`.txt`)
   - Task Board (`.csv`)

2. **Extraction Adapter (Gemini LLM):**
   - Parses ingested artifacts.
   - Extracts claims across 6 core categories:
     - Decisions
     - Owners
     - Tasks
     - Dependencies
     - Risks
     - Recurring Problems
   - Associates every claim with an exact source citation (quote, line, source document).

3. **Status Verification Engine:**
   - Evaluates evidence corroboration:
     - `Verified`: Supported across multiple independent sources.
     - `Single-source`: Confirmed in exactly one source document.
     - `Conflicting`: Conflicting evidence discovered between sources.
     - `Unverified`: Unsubstantiated claims.
     - `Missing`: Expected operational details with zero trace in sources.

4. **Review & Role-Based Delivery:**
   - Project Lead reviews, edits, and approves claims.
   - Incoming team members view approved handovers.
   - Server-side redaction removes sensitive quotes prior to payload dispatch.

## Technology Stack
- **Client:** React (Vite)
- **Server:** Node.js (Express)
- **Storage:** SQLite (`better-sqlite3`)
- **LLM Adapter:** Google Gemini API
