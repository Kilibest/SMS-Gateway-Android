use rusqlite::{Connection, params, Result as SqlResult};
use std::sync::Mutex;
use crate::models::*;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL")?;
        let db = Self { conn: Mutex::new(conn) };
        db.create_tables()?;
        Ok(db)
    }

    fn create_tables(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
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

            CREATE TABLE IF NOT EXISTS groups_t (
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

            CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_messages(status);"
        )?;
        Ok(())
    }

    // ── Messages ────────────────────────────────────────────────────────

    pub fn get_messages(&self) -> Vec<Message> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM messages ORDER BY rawTime ASC").unwrap();
        stmt.query_map([], |row| {
            let recipients_str: Option<String> = row.get("recipients")?;
            Ok(Message {
                id: row.get("id")?,
                phone: row.get("phone")?,
                text: row.get("text")?,
                msg_type: row.get("type")?,
                status: row.get("status")?,
                time: row.get::<_, Option<String>>("time")?.unwrap_or_default(),
                rawTime: row.get::<_, Option<String>>("rawTime")?.unwrap_or_default(),
                isGroup: row.get::<_, i32>("isGroup")? != 0,
                recipients: recipients_str.and_then(|s| serde_json::from_str(&s).ok()),
                groupName: row.get("groupName")?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn save_messages(&self, messages: &[Message]) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages", []).unwrap();
        let mut stmt = conn.prepare(
            "INSERT OR REPLACE INTO messages (id, phone, text, type, status, time, rawTime, isGroup, recipients, groupName)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).unwrap();
        for m in messages {
            stmt.execute(params![
                m.id, m.phone, m.text, m.msg_type, m.status,
                m.time, m.rawTime,
                if m.isGroup { 1 } else { 0 },
                m.recipients.as_ref().map(|r| serde_json::to_string(r).unwrap()),
                m.groupName,
            ]).unwrap();
        }
    }

    // ── Templates ───────────────────────────────────────────────────────

    pub fn get_templates(&self) -> Vec<Template> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM templates ORDER BY id ASC").unwrap();
        stmt.query_map([], |row| {
            Ok(Template {
                id: Some(row.get("id")?),
                title: row.get("title")?,
                text: row.get("text")?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn save_templates(&self, templates: &[Template]) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM templates", []).unwrap();
        let mut stmt = conn.prepare("INSERT INTO templates (title, text) VALUES (?1, ?2)").unwrap();
        for t in templates {
            stmt.execute(params![t.title, t.text]).unwrap();
        }
    }

    // ── Groups ──────────────────────────────────────────────────────────

    pub fn get_groups(&self) -> Groups {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM groups_t").unwrap();
        let mut map = Groups::new();
        stmt.query_map([], |row| {
            let recipients_str: Option<String> = row.get("recipients")?;
            Ok((row.get::<_, String>("group_id")?, GroupMeta {
                groupName: row.get("group_name")?,
                recipients: recipients_str.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
            }))
        }).unwrap().filter_map(|r| r.ok()).for_each(|(id, meta)| { map.insert(id, meta); });
        map
    }

    pub fn save_groups(&self, groups: &Groups) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM groups_t", []).unwrap();
        let mut stmt = conn.prepare("INSERT OR REPLACE INTO groups_t (group_id, group_name, recipients) VALUES (?1, ?2, ?3)").unwrap();
        for (id, meta) in groups {
            stmt.execute(params![
                id,
                meta.groupName,
                serde_json::to_string(&meta.recipients).unwrap(),
            ]).unwrap();
        }
    }

    // ── Config ──────────────────────────────────────────────────────────

    pub fn get_config(&self, key: &str) -> Option<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            params![key],
            |row| {
                let val: String = row.get(0)?;
                serde_json::from_str(&val).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
            }
        ).ok()
    }

    pub fn get_all_config(&self) -> Config {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM app_config").unwrap();
        let mut map = Config::new();
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>("key")?, row.get::<_, String>("value")?))
        }).unwrap().filter_map(|r| r.ok()).for_each(|(k, v)| {
            if let Ok(val) = serde_json::from_str(&v) {
                map.insert(k, val);
            }
        });
        map
    }

    pub fn set_config(&self, key: &str, value: &serde_json::Value) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES (?1, ?2)",
            params![key, serde_json::to_string(value).unwrap()],
        ).unwrap();
    }

    pub fn delete_all_config(&self) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM app_config", []).unwrap();
    }

    // ── Stats ───────────────────────────────────────────────────────────

    pub fn get_stats(&self) -> Stats {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_stats WHERE key = 'main'",
            [],
            |row| {
                let val: String = row.get(0)?;
                serde_json::from_str(&val).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
            }
        ).unwrap_or_default()
    }

    pub fn save_stats(&self, stats: &Stats) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO app_stats (key, value) VALUES ('main', ?1)",
            params![serde_json::to_string(stats).unwrap()],
        ).unwrap();
    }

    // ── Contacts ────────────────────────────────────────────────────────

    pub fn get_contacts(&self) -> Vec<Contact> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM contacts ORDER BY name ASC").unwrap();
        stmt.query_map([], |row| {
            let groups_str: Option<String> = row.get("groups")?;
            Ok(Contact {
                id: row.get("id")?,
                name: row.get("name")?,
                phone: row.get("phone")?,
                groups: groups_str.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn save_contact(&self, contact: &Contact) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO contacts (id, name, phone, groups) VALUES (?1, ?2, ?3, ?4)",
            params![
                contact.id,
                contact.name,
                contact.phone,
                serde_json::to_string(&contact.groups).unwrap(),
            ],
        ).unwrap();
    }

    pub fn delete_contact(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM contacts WHERE id = ?1", params![id]).unwrap();
    }

    // ── Scheduled Messages ──────────────────────────────────────────────

    pub fn create_scheduled_message(&self, msg: &ScheduledMessage) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO scheduled_messages (id, phone, text, recipients, groupName, isGroup, gatewayUrl, authUser, authPass, isRemote, sendAt, status, createdAt)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12)",
            params![
                msg.id, msg.phone, msg.text,
                msg.recipients.as_ref().map(|r| serde_json::to_string(r).unwrap()),
                msg.groupName,
                if msg.isGroup { 1 } else { 0 },
                msg.gatewayUrl, msg.authUser, msg.authPass,
                if msg.isRemote { 1 } else { 0 },
                msg.sendAt, msg.createdAt,
            ],
        ).unwrap();
    }

    pub fn get_scheduled_messages(&self) -> Vec<ScheduledMessage> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM scheduled_messages ORDER BY sendAt ASC").unwrap();
        stmt.query_map([], |row| {
            let recipients_str: Option<String> = row.get("recipients")?;
            Ok(ScheduledMessage {
                id: row.get("id")?,
                phone: row.get("phone")?,
                text: row.get("text")?,
                recipients: recipients_str.and_then(|s| serde_json::from_str(&s).ok()),
                groupName: row.get("groupName")?,
                isGroup: row.get::<_, i32>("isGroup")? != 0,
                gatewayUrl: row.get("gatewayUrl")?,
                authUser: row.get("authUser")?,
                authPass: row.get("authPass")?,
                isRemote: row.get::<_, i32>("isRemote")? != 0,
                sendAt: row.get("sendAt")?,
                status: row.get("status")?,
                error: row.get("error")?,
                createdAt: row.get("createdAt")?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_due_scheduled_messages(&self) -> Vec<ScheduledMessage> {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT * FROM scheduled_messages WHERE status = 'pending' AND sendAt <= ?1"
        ).unwrap();
        stmt.query_map(params![now], |row| {
            let recipients_str: Option<String> = row.get("recipients")?;
            Ok(ScheduledMessage {
                id: row.get("id")?,
                phone: row.get("phone")?,
                text: row.get("text")?,
                recipients: recipients_str.and_then(|s| serde_json::from_str(&s).ok()),
                groupName: row.get("groupName")?,
                isGroup: row.get::<_, i32>("isGroup")? != 0,
                gatewayUrl: row.get("gatewayUrl")?,
                authUser: row.get("authUser")?,
                authPass: row.get("authPass")?,
                isRemote: row.get::<_, i32>("isRemote")? != 0,
                sendAt: row.get("sendAt")?,
                status: row.get("status")?,
                error: row.get("error")?,
                createdAt: row.get("createdAt")?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn update_scheduled_status(&self, id: &str, status: &str, error: Option<&str>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE scheduled_messages SET status = ?1, error = ?2 WHERE id = ?3",
            params![status, error, id],
        ).unwrap();
    }

    pub fn delete_scheduled_message(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM scheduled_messages WHERE id = ?1", params![id]).unwrap();
    }

    // ── Clear All ───────────────────────────────────────────────────────

    pub fn clear_all(&self) {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "DELETE FROM messages; DELETE FROM templates; DELETE FROM groups_t; DELETE FROM app_config; DELETE FROM app_stats; DELETE FROM scheduled_messages;"
        ).unwrap();
    }
}
