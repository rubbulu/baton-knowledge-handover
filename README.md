# Baton 🏃‍♂️

> **Intelligent Knowledge-Handover Tool**  
> *Turning messy project notes, chat exports, and task boards into structured, verified claims with exact source quotes.*

---

## 📌 Overview

When team members leave or hand over a project, critical context gets lost in fragmented documents, slack threads, and task trackers. **Baton** bridges this gap by automatically ingesting:
1. **Project Notes** (`.md` / `.txt`)
2. **Chat Exports** (`.txt`)
3. **Task Boards** (`.csv`)

From these sources, Baton extracts structured **claims** across 6 essential categories:
- 🏛️ **Decisions** (architectural, product, process decisions made)
- 👤 **Owners** (key responsibilities and domain experts)
- 📋 **Tasks** (active, upcoming, or deferred action items)
- 🔗 **Dependencies** (system, team, or external blockers)
- ⚠️ **Risks** (identified failure points and edge cases)
- 🔁 **Recurring Problems** (known pain points and legacy workarounds)

Every extracted claim is strictly tied to an **exact source quote** and classified into an evidence status:
- `Verified`: Corroborated across multiple independent sources
- `Single-source`: Confirmed in only one source document
- `Conflicting`: Conflicting facts found across sources
- `Unverified`: Claim made without supporting evidentiary proof
- `Missing`: Expected operational details not mentioned anywhere

A designated lead can review, adjust, and approve claims. Incoming members receive a tailored, role-based view where confidential or sensitive quotes are redacted securely on the server.

---

## 🛠️ Tech Stack

- **Frontend:** React 18, Vite
- **Backend:** Node.js, Express
- **Database:** SQLite (`better-sqlite3`)
- **LLM Engine:** Gemini API behind a clean pluggable adapter

---

## 📂 Project Structure

```
baton-knowledge-handover/
├── client/              # React + Vite frontend application
│   ├── src/             # Frontend components, views, and styles
│   ├── index.html       # Vite entry HTML
│   ├── package.json
│   └── vite.config.js
├── server/              # Express backend API & SQLite database
│   ├── src/             # API routes, LLM adapter, DB schema & services
│   ├── package.json
│   └── ...
├── demo-data/           # Sample inputs (notes.md, chat-export.txt, task-board.csv)
├── docs/                # Architecture design and documentation
├── .env.example         # Example environment variables
├── .gitignore
├── package.json         # Root scripts (dev, build, start)
└── README.md
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** (v18+ or v20+)
- **npm** (v9+)
- A **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/)

### 2. Environment Configuration
Copy the `.env.example` file in the root to `.env` and provide your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=5000
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Installation
Install dependencies for both client and server:

```bash
npm run install:all
```

### 4. Running the Application

- **Development Mode** (runs server on port 5000 & client on port 3000 with hot reload):
  ```bash
  npm run dev
  ```
  Open [http://localhost:3000](http://localhost:3000) in your browser.

- **Production Build & Start** (builds React client and serves it via Express on port 5000):
  ```bash
  npm run build
  npm start
  ```
  Open [http://localhost:5000](http://localhost:5000) in your browser.
