use serde::{Deserialize, Serialize};

// ── Message ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct Message {
    pub id: String,
    pub phone: String,
    pub text: String,
    #[serde(default = "default_message_type")]
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub rawTime: String,
    #[serde(default)]
    pub isGroup: bool,
    #[serde(default)]
    pub recipients: Option<Vec<String>>,
    #[serde(default)]
    pub groupName: Option<String>,
}

fn default_message_type() -> String { "sent".to_string() }
fn default_status() -> String { "sending".to_string() }

// ── Template ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: Option<i64>,
    pub title: String,
    pub text: String,
}

// ── Group ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct GroupMeta {
    #[serde(default)]
    pub groupName: String,
    #[serde(default)]
    pub recipients: Vec<String>,
}

pub type Groups = std::collections::HashMap<String, GroupMeta>;

// ── Config ───────────────────────────────────────────────────────────────

pub type Config = std::collections::HashMap<String, serde_json::Value>;

// ── Stats ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    #[serde(default)]
    pub sent: i64,
    #[serde(default)]
    pub delivered: i64,
    #[serde(default)]
    pub failed: i64,
    #[serde(default)]
    pub received: i64,
}

impl Default for Stats {
    fn default() -> Self {
        Self { sent: 0, delivered: 0, failed: 0, received: 0 }
    }
}

// ── Contact ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub phone: String,
    #[serde(default)]
    pub groups: Vec<String>,
}

// ── Scheduled Message ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct ScheduledMessage {
    pub id: String,
    pub phone: String,
    pub text: String,
    #[serde(default)]
    pub recipients: Option<Vec<String>>,
    #[serde(default)]
    pub groupName: Option<String>,
    #[serde(default)]
    pub isGroup: bool,
    #[serde(default)]
    pub gatewayUrl: Option<String>,
    #[serde(default)]
    pub authUser: Option<String>,
    #[serde(default)]
    pub authPass: Option<String>,
    #[serde(default)]
    pub isRemote: bool,
    pub sendAt: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub createdAt: String,
}

// ── Webhook Payloads ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub event: String,
    pub payload: Option<WebhookSmsPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookSmsPayload {
    #[serde(rename = "phoneNumber")]
    pub phone_number: String,
    pub message: String,
    #[serde(rename = "receivedAt")]
    pub received_at: Option<String>,
}

// ── API Request / Response Types ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct MessagesBody {
    pub messages: Vec<Message>,
}

#[derive(Debug, Deserialize)]
pub struct TemplatesBody {
    pub templates: Vec<Template>,
}

#[derive(Debug, Deserialize)]
pub struct GroupsBody {
    pub groups: Groups,
}

#[derive(Debug, Deserialize)]
pub struct StatsBody {
    pub stats: Stats,
}

#[derive(Debug, Deserialize)]
pub struct ConfigBody {
    pub config: Config,
}

#[derive(Debug, Deserialize)]
pub struct CsvBody {
    pub csv: String,
}

#[derive(Debug, Serialize)]
pub struct ApiOk {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
pub struct ProxyError {
    pub error: String,
    pub message: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct ReceivedMessage {
    pub id: String,
    pub phone: String,
    pub text: String,
    pub time: String,
    pub rawTime: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub status: String,
}

// ── Search Results ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct SearchResultMessage {
    pub id: String,
    pub text: String,
    pub time: String,
    pub rawTime: String,
    pub msg_type: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct SearchResultGroup {
    pub phone: String,
    pub isGroup: bool,
    pub groupName: Option<String>,
    pub messages: Vec<SearchResultMessage>,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub results: Vec<SearchResultGroup>,
}

// ── All Data Response ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AllData {
    pub messages: Vec<Message>,
    pub templates: Vec<Template>,
    pub groups: Groups,
    pub stats: Stats,
    pub config: Config,
}
