const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data.db');

let db;

/**
 * Initialize (or re-initialize) the database connection.
 * Safe to call multiple times — reuses the existing connection.
 */
function init() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  createTables();
  return db;
}

/**
 * Create all tables if they don't exist.
 */
function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id       TEXT PRIMARY KEY,
      phone    TEXT NOT NULL,
      text     TEXT NOT NULL,
      type     TEXT NOT NULL DEFAULT 'sent',
      status   TEXT NOT NULL DEFAULT 'sending',
      time     TEXT,
      rawTime  TEXT,
      isGroup  INTEGER DEFAULT 0,
      recipients TEXT,
      groupName  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);

    CREATE TABLE IF NOT EXISTS templates (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      text  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      group_id   TEXT PRIMARY KEY,
      group_name TEXT,
      recipients TEXT
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS app_stats (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      phone TEXT NOT NULL,
      groups TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
    CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id         TEXT PRIMARY KEY,
      phone      TEXT NOT NULL,
      text       TEXT NOT NULL,
      recipients TEXT,
      groupName  TEXT,
      isGroup    INTEGER DEFAULT 0,
      gatewayUrl TEXT,
      authUser   TEXT,
      authPass   TEXT,
      isRemote   INTEGER DEFAULT 0,
      sendAt     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      error      TEXT,
      createdAt  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_messages(status);
  `);
}

// ── Messages ────────────────────────────────────────────────────────────

/** Return all messages, sorted by rawTime ascending. */
function getMessages() {
  const rows = db.prepare('SELECT * FROM messages ORDER BY rawTime ASC').all();
  return rows.map(row => ({
    ...row,
    isGroup: !!row.isGroup,
    recipients: row.recipients ? JSON.parse(row.recipients) : undefined,
  }));
}

/** Replace all messages with a new array. Runs inside a transaction. */
function saveMessages(messages) {
  const del = db.prepare('DELETE FROM messages');
  const ins = db.prepare(`
    INSERT OR REPLACE INTO messages (id, phone, text, type, status, time, rawTime, isGroup, recipients, groupName)
    VALUES (@id, @phone, @text, @type, @status, @time, @rawTime, @isGroup, @recipients, @groupName)
  `);
  db.transaction(() => {
    del.run();
    for (const m of messages) {
      ins.run({
        id: m.id,
        phone: m.phone,
        text: m.text,
        type: m.type || 'sent',
        status: m.status || 'sending',
        time: m.time || '',
        rawTime: m.rawTime || '',
        isGroup: m.isGroup ? 1 : 0,
        recipients: m.recipients ? JSON.stringify(m.recipients) : null,
        groupName: m.groupName || null,
      });
    }
  })();
}

// ── Templates ───────────────────────────────────────────────────────────

/** Return all templates. */
function getTemplates() {
  return db.prepare('SELECT * FROM templates ORDER BY id ASC').all();
}

/** Replace all templates. */
function saveTemplates(templates) {
  const del = db.prepare('DELETE FROM templates');
  const ins = db.prepare('INSERT INTO templates (title, text) VALUES (@title, @text)');
  db.transaction(() => {
    del.run();
    for (const t of templates) {
      ins.run({ title: t.title, text: t.text });
    }
  })();
}

// ── Groups ──────────────────────────────────────────────────────────────

/** Return all groups as an object keyed by group_id. */
function getGroups() {
  const rows = db.prepare('SELECT * FROM groups').all();
  const result = {};
  for (const row of rows) {
    result[row.group_id] = {
      groupName: row.group_name,
      recipients: row.recipients ? JSON.parse(row.recipients) : [],
    };
  }
  return result;
}

/** Save groups object ({ groupId: { groupName, recipients } }). */
function saveGroups(groups) {
  const del = db.prepare('DELETE FROM groups');
  const ins = db.prepare('INSERT OR REPLACE INTO groups (group_id, group_name, recipients) VALUES (@id, @name, @recipients)');
  db.transaction(() => {
    del.run();
    for (const [id, meta] of Object.entries(groups)) {
      ins.run({
        id,
        name: meta.groupName || '',
        recipients: JSON.stringify(meta.recipients || []),
      });
    }
  })();
}

// ── Config ──────────────────────────────────────────────────────────────

/** Get a config value by key. Returns parsed JSON or null. */
function getConfig(key) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

/** Get all config as a flat object. */
function getAllConfig() {
  const rows = db.prepare('SELECT * FROM app_config').all();
  const result = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value);
  }
  return result;
}

/** Set a config value. */
function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

/** Delete a config key. */
function deleteConfig(key) {
  db.prepare('DELETE FROM app_config WHERE key = ?').run(key);
}

/** Delete all config keys. */
function deleteAllConfig() {
  db.prepare('DELETE FROM app_config').run();
}

// ── Stats ───────────────────────────────────────────────────────────────

/** Get stats object. Returns default if none saved. */
function getStats() {
  const row = db.prepare('SELECT value FROM app_stats WHERE key = ?').get('main');
  return row ? JSON.parse(row.value) : { sent: 0, delivered: 0, failed: 0, received: 0 };
}

/** Save stats object. */
function saveStats(stats) {
  db.prepare('INSERT OR REPLACE INTO app_stats (key, value) VALUES (?, ?)').run('main', JSON.stringify(stats));
}

// ── Contacts ────────────────────────────────────────────────────────────

/** Return all contacts, sorted by name. */
function getContacts() {
  const rows = db.prepare('SELECT * FROM contacts ORDER BY name ASC').all();
  return rows.map(row => ({
    ...row,
    groups: row.groups ? JSON.parse(row.groups) : [],
  }));
}

/** Create or update a contact. */
function saveContact(contact) {
  db.prepare(`
    INSERT OR REPLACE INTO contacts (id, name, phone, groups)
    VALUES (@id, @name, @phone, @groups)
  `).run({
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    groups: contact.groups ? JSON.stringify(contact.groups) : '[]',
  });
}

/** Delete a contact by ID. */
function deleteContact(id) {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
}

// ── Scheduled Messages ────────────────────────────────────────────────

/** Create a new scheduled message. */
function createScheduledMessage(msg) {
  db.prepare(`
    INSERT INTO scheduled_messages (id, phone, text, recipients, groupName, isGroup, gatewayUrl, authUser, authPass, isRemote, sendAt, status, createdAt)
    VALUES (@id, @phone, @text, @recipients, @groupName, @isGroup, @gatewayUrl, @authUser, @authPass, @isRemote, @sendAt, 'pending', @createdAt)
  `).run({
    id: msg.id,
    phone: msg.phone,
    text: msg.text,
    recipients: msg.recipients ? JSON.stringify(msg.recipients) : null,
    groupName: msg.groupName || null,
    isGroup: msg.isGroup ? 1 : 0,
    gatewayUrl: msg.gatewayUrl || null,
    authUser: msg.authUser || null,
    authPass: msg.authPass || null,
    isRemote: msg.isRemote ? 1 : 0,
    sendAt: msg.sendAt,
    createdAt: msg.createdAt || new Date().toISOString(),
  });
}

/** Get all scheduled messages, newest first. */
function getScheduledMessages() {
  const rows = db.prepare('SELECT * FROM scheduled_messages ORDER BY sendAt ASC').all();
  return rows.map(row => ({
    ...row,
    isGroup: !!row.isGroup,
    isRemote: !!row.isRemote,
    recipients: row.recipients ? JSON.parse(row.recipients) : undefined,
  }));
}

/** Get pending messages that are due to be sent. */
function getDueScheduledMessages() {
  const rows = db.prepare("SELECT * FROM scheduled_messages WHERE status = 'pending' AND sendAt <= ?").all(new Date().toISOString());
  return rows.map(row => ({
    ...row,
    isGroup: !!row.isGroup,
    isRemote: !!row.isRemote,
    recipients: row.recipients ? JSON.parse(row.recipients) : undefined,
  }));
}

/** Update a scheduled message's status (and optional error). */
function updateScheduledStatus(id, status, error) {
  db.prepare('UPDATE scheduled_messages SET status = ?, error = ? WHERE id = ?').run(status, error || null, id);
}

/** Delete (cancel) a scheduled message by ID. */
function deleteScheduledMessage(id) {
  db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
}

// ── Search ────────────────────────────────────────────────

/**
 * Search messages by text content using LIKE.
 * Returns results grouped by conversation, newest first,
 * with up to `limit` matching messages per conversation.
 *
 * @param {string} query - Search term
 * @param {number} limit - Max results per conversation (default 5)
 * @returns {Array<{phone: string, isGroup: boolean, groupName: string|null, messages: Array}>}
 */
function searchMessages(query, limit) {
  const perConversation = limit || 5;
  const searchTerm = `%${query}%`;

  const rows = db.prepare(
    `SELECT * FROM messages WHERE text LIKE ? ORDER BY phone ASC, rawTime DESC LIMIT 500`
  ).all(searchTerm);

  const groups = {};
  for (const row of rows) {
    if (!groups[row.phone]) {
      groups[row.phone] = {
        phone: row.phone,
        isGroup: !!row.isGroup,
        groupName: row.groupName || null,
        messages: [],
      };
    }
    if (groups[row.phone].messages.length < perConversation) {
      groups[row.phone].messages.push({
        id: row.id,
        text: row.text,
        time: row.time,
        rawTime: row.rawTime,
        type: row.type,
        status: row.status,
      });
    }
  }

  return Object.values(groups).sort((a, b) => {
    const aTime = a.messages[0]?.rawTime || '';
    const bTime = b.messages[0]?.rawTime || '';
    return bTime.localeCompare(aTime);
  });
}

// ── Clear all ───────────────────────────────────────────────────────────

/** Delete all app data from the database. */
function clearAll() {
  db.exec('DELETE FROM messages; DELETE FROM templates; DELETE FROM groups; DELETE FROM app_config; DELETE FROM app_stats; DELETE FROM scheduled_messages;');
}

// ── Exports ─────────────────────────────────────────────────────────────

module.exports = {
  init,
  getMessages,
  saveMessages,
  getTemplates,
  saveTemplates,
  getGroups,
  saveGroups,
  getConfig,
  getAllConfig,
  setConfig,
  deleteConfig,
  deleteAllConfig,
  getStats,
  saveStats,
  getContacts,
  saveContact,
  deleteContact,
  createScheduledMessage,
  getScheduledMessages,
  getDueScheduledMessages,
  updateScheduledStatus,
  deleteScheduledMessage,
  searchMessages,
  clearAll,
};
