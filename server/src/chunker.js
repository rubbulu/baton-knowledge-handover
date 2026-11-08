import crypto from 'crypto';

/**
 * Parses raw text content into structured chunks based on the source type.
 * Each chunk preserves: id, source_id, author, timestamp, text, access_label, line_ref.
 */
export function chunkSource({ content, filename = '', type = 'notes', accessLabel = 'team', sourceId }) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const determinedType = detectSourceType(filename, type, content);

  switch (determinedType) {
    case 'chat':
      return chunkChatExport(content, sourceId, accessLabel);
    case 'tasks':
      return chunkCsvTasks(content, sourceId, accessLabel);
    case 'notes':
    default:
      return chunkMarkdownNotes(content, sourceId, accessLabel);
  }
}

/**
 * Detects the source type from filename, provided type, or content heuristics.
 */
function detectSourceType(filename, type, content) {
  const lowerName = (filename || '').toLowerCase();
  const lowerType = (type || '').toLowerCase();

  if (lowerType === 'chat' || lowerName.includes('chat') || lowerName.endsWith('.chat.txt')) {
    return 'chat';
  }
  if (lowerType === 'tasks' || lowerType === 'csv' || lowerName.endsWith('.csv') || lowerName.includes('task')) {
    return 'tasks';
  }
  if (lowerType === 'notes' || lowerName.endsWith('.md') || lowerName.includes('note') || lowerName.includes('meeting')) {
    return 'notes';
  }

  // Heuristics on content
  if (/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/m.test(content)) {
    return 'chat';
  }
  if (content.trim().startsWith('id,') || content.trim().startsWith('"id",') || content.includes('status,owner')) {
    return 'tasks';
  }

  return 'notes';
}

/**
 * Chunks a chat export by message.
 * Parses lines matching: [YYYY-MM-DD HH:MM:SS] Author: message text
 */
function chunkChatExport(content, sourceId, accessLabel) {
  const lines = content.split(/\r?\n/);
  const chunks = [];
  const messageRegex = /^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.*)$/;

  let currentMsg = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(messageRegex);

    if (match) {
      if (currentMsg) {
        chunks.push(flushChatMessage(currentMsg, sourceId, accessLabel));
      }
      currentMsg = {
        startLine: i + 1,
        endLine: i + 1,
        timestamp: match[1].trim(),
        author: match[2].trim(),
        textLines: [match[3].trim()]
      };
    } else if (currentMsg) {
      if (line.trim().length > 0) {
        currentMsg.textLines.push(line.trim());
      }
      currentMsg.endLine = i + 1;
    }
  }

  if (currentMsg) {
    chunks.push(flushChatMessage(currentMsg, sourceId, accessLabel));
  }

  return chunks;
}

function flushChatMessage(msg, sourceId, accessLabel) {
  const line_ref = msg.startLine === msg.endLine ? `L${msg.startLine}` : `L${msg.startLine}-L${msg.endLine}`;
  return {
    id: crypto.randomUUID(),
    source_id: sourceId,
    author: msg.author,
    timestamp: msg.timestamp,
    text: msg.textLines.join('\n').trim(),
    access_label: accessLabel,
    line_ref
  };
}

/**
 * Chunks CSV task board by row.
 * Extracts task id, title, assignee, status, category, dependencies, notes.
 */
function chunkCsvTasks(content, sourceId, accessLabel) {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const chunks = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const values = parseCsvLine(rawLine);
    if (values.length === 0 || values.every(v => !v.trim())) continue;

    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = (values[idx] || '').trim();
    });

    const id = rowObj.id || rowObj['task id'] || rowObj.task_id || `ROW-${i + 1}`;
    const title = rowObj.title || rowObj.task || rowObj.name || rowObj.summary || 'Untitled Task';
    const status = rowObj.status || 'Todo';
    const owner = rowObj.owner || rowObj.assignee || rowObj['assigned to'] || null;
    const category = rowObj.category || rowObj.type || 'Task';
    const dependencies = rowObj.dependencies || rowObj.dependency || 'None';
    const notes = rowObj.notes || rowObj.description || '';

    const textParts = [
      `[${id}] ${title}`,
      `Category: ${category}`,
      `Status: ${status}`,
      `Owner: ${owner || 'Unassigned'}`
    ];
    if (dependencies && dependencies !== 'None') {
      textParts.push(`Dependencies: ${dependencies}`);
    }
    if (notes) {
      textParts.push(`Notes: ${notes}`);
    }

    chunks.push({
      id: crypto.randomUUID(),
      source_id: sourceId,
      author: owner || null,
      timestamp: rowObj.created_at || rowObj.date || null,
      text: textParts.join(' | '),
      access_label: accessLabel,
      line_ref: `row-${i + 1} (${id})`
    });
  }

  return chunks;
}

/**
 * Helper to parse a single CSV line with support for quoted strings.
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Chunks markdown or notes by paragraph or bullet with line numbers.
 */
function chunkMarkdownNotes(content, sourceId, accessLabel) {
  const lines = content.split(/\r?\n/);
  const chunks = [];

  let currentBlock = [];
  let startLine = null;
  let currentHeader = '';

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    // Check for markdown headers (#, ##, ###)
    if (trimmed.startsWith('#')) {
      if (currentBlock.length > 0) {
        chunks.push(flushNoteBlock(currentBlock, startLine, i, currentHeader, sourceId, accessLabel));
        currentBlock = [];
        startLine = null;
      }
      currentHeader = trimmed.replace(/^#+\s*/, '');
      continue;
    }

    // Check for bullet items
    const isBullet = /^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);

    if (isBullet) {
      // Flush previous paragraph block if exists
      if (currentBlock.length > 0) {
        chunks.push(flushNoteBlock(currentBlock, startLine, i, currentHeader, sourceId, accessLabel));
        currentBlock = [];
        startLine = null;
      }
      // Bullet is its own chunk
      chunks.push(flushNoteBlock([line], lineNum, lineNum, currentHeader, sourceId, accessLabel));
      continue;
    }

    if (trimmed.length === 0) {
      if (currentBlock.length > 0) {
        chunks.push(flushNoteBlock(currentBlock, startLine, i, currentHeader, sourceId, accessLabel));
        currentBlock = [];
        startLine = null;
      }
    } else {
      if (currentBlock.length === 0) {
        startLine = lineNum;
      }
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    chunks.push(flushNoteBlock(currentBlock, startLine, lines.length, currentHeader, sourceId, accessLabel));
  }

  return chunks;
}

function flushNoteBlock(lines, startLine, endLine, currentHeader, sourceId, accessLabel) {
  const textContent = lines.join('\n').trim();
  const line_ref = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;

  // Heuristically extract author/timestamp if annotated
  let author = null;
  let timestamp = null;

  const authorMatch = textContent.match(/(?:Author|Owner|Lead|Recorded by|Presenter):\s*([^\n,;]+)/i);
  if (authorMatch) {
    author = authorMatch[1].trim();
  }

  const dateMatch = textContent.match(/(?:Date|Timestamp):\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/i);
  if (dateMatch) {
    timestamp = dateMatch[1].trim();
  }

  return {
    id: crypto.randomUUID(),
    source_id: sourceId,
    author,
    timestamp,
    text: textContent,
    access_label: accessLabel,
    line_ref
  };
}
