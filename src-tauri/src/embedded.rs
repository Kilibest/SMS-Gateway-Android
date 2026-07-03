use axum::response::{IntoResponse, Response};
use axum::http::{header, StatusCode};

// ── Embedded frontend files ──────────────────────────────────────────

const INDEX_HTML: &str = include_str!("../../frontend/index.html");
const DESIGN_SYSTEM_CSS: &str = include_str!("../../frontend/css/design-system.css");
const APP_JS: &str = include_str!("../../frontend/js/app.js");
const API_JS: &str = include_str!("../../frontend/js/api.js");
const STORAGE_JS: &str = include_str!("../../frontend/js/storage.js");
const TOAST_JS: &str = include_str!("../../frontend/js/toast.js");

const FAVICON_ICO: &[u8] = include_bytes!("../../frontend/favicon.ico");

const MANIFEST_JSON: &str = "{\
\"name\":\"SMS Gateway Dashboard\",\
\"short_name\":\"SMS Gateway\",\
\"start_url\":\"/\",\
\"display\":\"standalone\",\
\"background_color\":\"#ffffff\",\
\"theme_color\":\"#0d9488\"\
}";

/// Serve an embedded frontend file by its path.
pub fn serve_frontend(path: &str) -> Response {
    let path = path.trim_start_matches('/');

    let (content, content_type) = match path {
        "" | "index.html" => (INDEX_HTML, "text/html; charset=utf-8"),
        "css/design-system.css" => (DESIGN_SYSTEM_CSS, "text/css; charset=utf-8"),
        "js/app.js" => (APP_JS, "application/javascript; charset=utf-8"),
        "js/api.js" => (API_JS, "application/javascript; charset=utf-8"),
        "js/storage.js" => (STORAGE_JS, "application/javascript; charset=utf-8"),
        "js/toast.js" => (TOAST_JS, "application/javascript; charset=utf-8"),
        "favicon.ico" => {
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "image/x-icon")
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .body(axum::body::Body::from(FAVICON_ICO.to_vec()))
                .unwrap();
        }
        "manifest.json" => {
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
                .body(axum::body::Body::from(MANIFEST_JSON.to_string()))
                .unwrap();
        }
        _ => {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .body(axum::body::Body::from(content.to_string()))
        .unwrap()
}
