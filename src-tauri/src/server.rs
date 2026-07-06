use std::path::PathBuf;
use std::sync::Arc;
use std::collections::VecDeque;

use axum::{
    Router,
    routing::{get, post},
    response::{IntoResponse, Json, Response},
    extract::{Query, State},
    http::{StatusCode, HeaderMap, HeaderValue, header},
    body::Body,
};
use serde::Deserialize;
use serde_json::json;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{info, error};
use tokio::sync::Mutex;

use crate::db::Database;
use crate::models::*;
use crate::proxy;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub received_messages: Arc<Mutex<VecDeque<ReceivedMessage>>>,
    pub project_dir: PathBuf,
}

fn json_ok() -> Json<ApiOk> {
    Json(ApiOk { ok: true, count: None, id: None, imported: None, skipped: None })
}

fn json_error(msg: &str) -> (StatusCode, Json<ApiError>) {
    (StatusCode::BAD_REQUEST, Json(ApiError { error: msg.to_string() }))
}

/// Serve embedded frontend files (or fall back to disk for dev mode).
async fn serve_frontend_handler(axum::extract::Path(path): axum::extract::Path<String>) -> Response {
    crate::embedded::serve_frontend(&path)
}

/// Serve the root (index.html) for embedded frontend.
async fn serve_root() -> Response {
    crate::embedded::serve_frontend("")
}

/// Build and return the axum Router with all routes.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        // ── Data API ────────────────────────────────────────────────────
        .route("/api/data", get(get_all_data).delete(clear_all_data))
        .route("/api/data/messages", post(save_messages_handler))
        .route("/api/data/templates", post(save_templates_handler))
        .route("/api/data/groups", post(save_groups_handler))
        .route("/api/data/stats", post(save_stats_handler))
        .route("/api/data/config", post(save_config_handler).delete(delete_config_handler))
        // ── Contacts API ────────────────────────────────────────────────
        .route("/api/contacts", get(get_contacts_handler).post(create_contact_handler).put(update_contact_handler).delete(delete_contact_handler))
        .route("/api/contacts/export", get(export_contacts_csv))
        .route("/api/contacts/export/vcf", get(export_contacts_vcf))
        .route("/api/contacts/import", post(import_contacts_csv))
        // ── Schedule API ────────────────────────────────────────────────
        .route("/api/schedule", post(create_schedule_handler).get(get_schedule_handler).delete(delete_schedule_handler))
        // ── Message Search ──────────────────────────────────────────────
        .route("/api/messages/search", get(search_messages_handler))
        // ── System routes ───────────────────────────────────────────────
        .route("/health", get(health_check))
        .route("/webhook", post(webhook_handler))
        .route("/messages", get(get_received_messages))
        .route("/proxy", post(proxy_handler))
        .route("/proxy/", post(proxy_handler))
        // ── Embedded frontend files ─────────────────────────────────────
        .route("/", get(serve_root))
        .route("/*path", get(serve_frontend_handler))
        // ── Middleware ──────────────────────────────────────────────────
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// ── Data API Handlers ──────────────────────────────────────────────────

async fn get_all_data(State(state): State<AppState>) -> Json<AllData> {
    Json(AllData {
        messages: state.db.get_messages(),
        templates: state.db.get_templates(),
        groups: state.db.get_groups(),
        stats: state.db.get_stats(),
        config: state.db.get_all_config(),
    })
}

async fn clear_all_data(State(state): State<AppState>) -> Json<ApiOk> {
    state.db.clear_all();
    Json(ApiOk { ok: true, count: None, id: None, imported: None, skipped: None })
}

async fn save_messages_handler(
    State(state): State<AppState>,
    Json(body): Json<MessagesBody>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    let count = body.messages.len();
    state.db.save_messages(&body.messages);
    Ok(Json(ApiOk { ok: true, count: Some(count), id: None, imported: None, skipped: None }))
}

async fn save_templates_handler(
    State(state): State<AppState>,
    Json(body): Json<TemplatesBody>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    let count = body.templates.len();
    state.db.save_templates(&body.templates);
    Ok(Json(ApiOk { ok: true, count: Some(count), id: None, imported: None, skipped: None }))
}

async fn save_groups_handler(
    State(state): State<AppState>,
    Json(body): Json<GroupsBody>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    state.db.save_groups(&body.groups);
    Ok(json_ok())
}

async fn save_stats_handler(
    State(state): State<AppState>,
    Json(body): Json<StatsBody>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    state.db.save_stats(&body.stats);
    Ok(json_ok())
}

async fn save_config_handler(
    State(state): State<AppState>,
    Json(body): Json<ConfigBody>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    for (key, value) in &body.config {
        state.db.set_config(key, value);
    }
    Ok(json_ok())
}

async fn delete_config_handler(
    State(state): State<AppState>,
) -> Json<ApiOk> {
    state.db.delete_all_config();
    json_ok()
}

// ── Contacts API Handlers ──────────────────────────────────────────────

async fn get_contacts_handler(
    State(state): State<AppState>,
) -> Json<Vec<Contact>> {
    Json(state.db.get_contacts())
}

async fn create_contact_handler(
    State(state): State<AppState>,
    Json(contact): Json<Contact>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    if contact.id.is_empty() || contact.name.is_empty() || contact.phone.is_empty() {
        return Err(json_error("Missing required fields: id, name, phone"));
    }
    state.db.save_contact(&contact);
    Ok(Json(ApiOk { ok: true, count: None, id: Some(contact.id.clone()), imported: None, skipped: None }))
}

async fn update_contact_handler(
    State(state): State<AppState>,
    Json(contact): Json<Contact>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    if contact.id.is_empty() || contact.name.is_empty() || contact.phone.is_empty() {
        return Err(json_error("Missing required fields: id, name, phone"));
    }
    state.db.save_contact(&contact);
    Ok(json_ok())
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    pub id: String,
}

async fn delete_contact_handler(
    State(state): State<AppState>,
    Query(query): Query<DeleteQuery>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    if query.id.is_empty() {
        return Err(json_error("Missing id query parameter"));
    }
    state.db.delete_contact(&query.id);
    Ok(json_ok())
}

async fn export_contacts_csv(
    State(state): State<AppState>,
) -> Response {
    let contacts = state.db.get_contacts();
    let mut csv = String::from("Name,Phone,Groups\n");
    for c in &contacts {
        let name = c.name.replace('"', "\"\"");
        let phone = c.phone.replace('"', "\"\"");
        let groups = c.groups.join("; ").replace('"', "\"\"");
        csv.push_str(&format!("\"{}\",\"{}\",\"{}\"\n", name, phone, groups));
    }

    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/csv; charset=utf-8"));
    response_headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"contacts.csv\""),
    );

    (response_headers, csv).into_response()
}

async fn export_contacts_vcf(
    State(state): State<AppState>,
) -> Response {
    let contacts = state.db.get_contacts();
    let mut vcf = String::new();

    for c in &contacts {
        let name = c.name.trim();
        let phone = c.phone.trim();

        // Split name into first/last for N field
        let parts: Vec<&str> = name.split_whitespace().collect();
        let last_name = if parts.len() > 1 { parts.last().unwrap() } else { "" };
        let first_name = if parts.len() > 1 { parts[..parts.len()-1].join(" ") } else { name.to_string() };
        let groups = c.groups.join(",");

        // Escape special characters for vCard
        let esc = |s: &str| -> String {
            s.replace('\\', "\\\\")
             .replace(';', "\\;")
             .replace(',', "\\,")
             .replace(':', "\\:")
             .replace('\n', "\\n")
        };

        vcf.push_str("BEGIN:VCARD\r\n");
        vcf.push_str("VERSION:3.0\r\n");
        vcf.push_str(&format!("FN:{}\r\n", esc(name)));
        vcf.push_str(&format!("N:{};{};;;\r\n", esc(last_name), esc(&first_name)));
        vcf.push_str(&format!("TEL;TYPE=CELL:{}\r\n", esc(phone)));
        if !groups.is_empty() {
            vcf.push_str(&format!("CATEGORIES:{}\r\n", esc(&groups)));
        }
        vcf.push_str("END:VCARD\r\n");
    }

    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/vcard; charset=utf-8"));
    response_headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"contacts.vcf\""),
    );

    (response_headers, vcf).into_response()
}

async fn import_contacts_csv(
    State(state): State<AppState>,
    Json(body): Json<CsvBody>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    if body.csv.is_empty() {
        return Err(json_error("Expected { csv: \"...\" }"));
    }

    let lines: Vec<&str> = body.csv.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return Ok(Json(ApiOk { ok: true, count: None, id: None, imported: Some(0), skipped: Some(0) }));
    }

    let data_lines = &lines[1..]; // Skip header
    let mut imported = 0usize;
    let mut skipped = 0usize;

    for line in data_lines {
        // Simple CSV parser respecting quoted fields
        let parsed = parse_csv_line(line);
        if parsed.len() < 2 {
            skipped += 1;
            continue;
        }
        let name = parsed[0].trim().to_string();
        let phone = parsed[1].trim().to_string();
        let groups_str = parsed.get(2).map(|s| s.trim()).unwrap_or("");
        let groups: Vec<String> = if groups_str.is_empty() {
            vec![]
        } else {
            groups_str.split(';').map(|g| g.trim().to_string()).filter(|g| !g.is_empty()).collect()
        };

        if !name.is_empty() && !phone.is_empty() {
            let id = format!("import-{}-{}", chrono::Utc::now().timestamp_millis(),
                uuid::Uuid::new_v4().to_string().chars().take(6).collect::<String>());
            state.db.save_contact(&Contact { id, name, phone, groups });
            imported += 1;
        } else {
            skipped += 1;
        }
    }

    Ok(Json(ApiOk { ok: true, count: None, id: None, imported: Some(imported), skipped: Some(skipped) }))
}

/// Simple CSV line parser respecting quoted fields.
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];
        if in_quotes {
            if ch == '"' {
                if i + 1 < chars.len() && chars[i + 1] == '"' {
                    current.push('"');
                    i += 1;
                } else {
                    in_quotes = false;
                }
            } else {
                current.push(ch);
            }
        } else {
            match ch {
                '"' => in_quotes = true,
                ',' => {
                    result.push(current.trim().to_string());
                    current = String::new();
                }
                _ => current.push(ch),
            }
        }
        i += 1;
    }
    result.push(current.trim().to_string());
    result
}

// ── Schedule API Handlers ──────────────────────────────────────────────

async fn create_schedule_handler(
    State(state): State<AppState>,
    Json(msg): Json<ScheduledMessage>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    if msg.id.is_empty() || msg.phone.is_empty() || msg.text.is_empty() || msg.sendAt.is_empty() {
        return Err(json_error("Missing required fields: id, phone, text, sendAt"));
    }
    let mut full_msg = msg;
    if full_msg.createdAt.is_empty() {
        full_msg.createdAt = chrono::Utc::now().to_rfc3339();
    }
    state.db.create_scheduled_message(&full_msg);
    Ok(Json(ApiOk { ok: true, count: None, id: Some(full_msg.id.clone()), imported: None, skipped: None }))
}

async fn get_schedule_handler(
    State(state): State<AppState>,
) -> Json<Vec<ScheduledMessage>> {
    Json(state.db.get_scheduled_messages())
}

async fn delete_schedule_handler(
    State(state): State<AppState>,
    Query(query): Query<DeleteQuery>,
) -> Result<Json<ApiOk>, (StatusCode, Json<ApiError>)> {
    if query.id.is_empty() {
        return Err(json_error("Missing id query parameter"));
    }
    state.db.delete_scheduled_message(&query.id);
    Ok(json_ok())
}

// ── Search Handlers ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub limit: Option<usize>,
}

async fn search_messages_handler(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Response {
    let q = query.q.trim().to_string();
    if q.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "Missing query parameter: q"}))).into_response();
    }

    let limit = query.limit.unwrap_or(5);
    let results = state.db.search_messages(&q, limit);
    Json(json!({ "results": results })).into_response()
}

// ── System Handlers ────────────────────────────────────────────────────

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub url: String,
}

async fn proxy_handler(
    State(_state): State<AppState>,
    Query(query): Query<ProxyQuery>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let target_url = &query.url;

    info!("Incoming proxy request to: {}", target_url);

    if target_url.is_empty() {
        return (StatusCode::BAD_REQUEST, "Missing url parameter").into_response();
    }

    // Validate JSON body
    if let Err(_) = serde_json::from_str::<serde_json::Value>(&body) {
        return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response();
    }

    // Validate target URL
    let parsed_url = match url::Url::parse(target_url) {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid URL").into_response(),
    };

    // SSRF Protection
    if proxy::is_internal_target(parsed_url.host_str().unwrap_or("")) {
        error!("BLOCKED - internal target: {}", parsed_url.host_str().unwrap_or(""));
        return (StatusCode::FORBIDDEN, Json(json!({
            "error": "Forbidden",
            "message": "Access to internal/private network targets is blocked for security",
            "host": parsed_url.host_str().unwrap_or("")
        }))).into_response();
    }

    // Forward the request
    let auth = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();

    match client
        .post(target_url)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            let resp_headers = resp.headers().clone();
            let resp_body = resp.text().await.unwrap_or_default();

            let mut response = Response::builder()
                .status(status)
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from(resp_body))
                .unwrap();

            // Forward relevant headers
            if let Some(ct) = resp_headers.get("content-type") {
                response.headers_mut().insert("content-type", ct.clone());
            }

            response
        }
        Err(e) => {
            error!("Proxy Error: {}", e);
            let (status, msg) = if e.is_timeout() {
                (StatusCode::GATEWAY_TIMEOUT, format!(
                    "Cannot connect to Android device. Please check: 1) Device is on same network, 2) Android SMS Gateway app is running, 3) IP address is correct"))
            } else {
                (StatusCode::BAD_GATEWAY, e.to_string())
            };

            (status, Json(json!({
                "error": if status == StatusCode::GATEWAY_TIMEOUT { "Gateway Timeout" } else { "Bad Gateway" },
                "message": msg,
                "target": target_url
            }))).into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct WebhookQuery {
    pub event: Option<String>,
    pub payload: Option<serde_json::Value>,
}

async fn webhook_handler(
    State(state): State<AppState>,
    body: String,
) -> StatusCode {
    let data: serde_json::Value = match serde_json::from_str(&body) {
        Ok(d) => d,
        Err(_) => return StatusCode::BAD_REQUEST,
    };

    info!("Webhook received: {}", body);

    if data.get("event").and_then(|v| v.as_str()) == Some("sms:received") {
        if let Some(payload) = data.get("payload") {
            let phone = payload.get("phoneNumber").and_then(|v| v.as_str()).unwrap_or("");
            let text = payload.get("message").and_then(|v| v.as_str()).unwrap_or("");
            
            let received_at_str = payload.get("receivedAt").and_then(|v| v.as_str()).unwrap_or("");
            let parsed_time = chrono::DateTime::parse_from_rfc3339(received_at_str)
                .map(|d| d.to_utc())
                .unwrap_or_else(|_| chrono::Utc::now());

            let msg = ReceivedMessage {
                id: format!("{}-{}", chrono::Utc::now().timestamp_millis(), rand_id()),
                phone: phone.to_string(),
                text: text.to_string(),
                time: parsed_time.format("%I:%M %p").to_string(),
                rawTime: parsed_time.to_rfc3339(),
                msg_type: "received".to_string(),
                status: "received".to_string(),
            };

            let mut msgs = state.received_messages.lock().await;
            msgs.push_back(msg);
            if msgs.len() > 1000 {
                msgs.pop_front();
            }
        }
    }

    StatusCode::OK
}

fn rand_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().subsec_nanos();
    format!("{}", nanos)
}

async fn get_received_messages(
    State(state): State<AppState>,
) -> Json<Vec<ReceivedMessage>> {
    let msgs = state.received_messages.lock().await;
    Json(msgs.iter().cloned().collect())
}
