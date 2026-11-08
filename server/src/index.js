import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getDb, getDbType } from './db.js';
import apiRouter, { seedDemoProjectIfEmpty } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from root directory first, then local fallback
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

// Auto-initialize SQLite database on start
const db = getDb();
console.log(`[Baton DB] SQLite initialized (driver: ${getDbType()})`);

// Auto-seed demo project on startup if database is empty
seedDemoProjectIfEmpty(db);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Baton',
    version: '0.1.0',
    dbDriver: getDbType(),
    timestamp: new Date().toISOString()
  });
});

// Mount core API router
app.use('/api', apiRouter);

// Serve built client for production start
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Baton Server Error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start listening only when invoked directly (not when imported in tests)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  app.listen(PORT, () => {
    console.log(`[Baton Server] Listening on http://localhost:${PORT}`);
  });
}

export default app;
