# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Android SMS Gateway Dashboard — a web dashboard that turns an Android device into an SMS gateway. It communicates with the Android SMS Gateway app running on your phone via HTTP.

## Build & Run Commands

### Node.js server (local network deployment)
```bash
npm install
npm start                    # or: node proxy.js
# Server starts on http://0.0.0.0:3000
```

### Tauri desktop app (recommended for end users)
```bash
# Prerequisites: Rust toolchain + Tauri system deps
cd src-tauri
cargo tauri dev              # development with webview
cargo tauri build            # production build
```

### CI
GitHub Actions in `.github/workflows/build.yml` — builds Tauri app for Linux, Windows, macOS on push/PR to master, and drafts a GitHub release on `v*` tags.

## Project Architecture

### Two Runtimes, One Codebase

The project has two parallel backends that share identical API contracts and database schema:

1. **Node.js** (`proxy.js` + `lib/`) — Simple HTTP server for direct deployment. Entry: `proxy.js`.
2. **Rust/Tauri** (`src-tauri/src/`) — Embedded axum HTTP server bundled in a Tauri v2 desktop app.

The Tauri app starts an embedded axum server on `127.0.0.1:<random-port>`, then opens a native webview pointing to it. The frontend files are compiled into the binary via `include_str!` in `embedded.rs`.

### Dual-Write Data Persistence

All data writes go to `localStorage` immediately and fire a background API request to SQLite. On startup, `Storage.init()` hydrates from the server API, falling back to localStorage. This means the frontend cache is always authoritative for reads.

### Key Files

| File | Purpose |
|------|---------|
| `proxy.js` | Node.js server entry (HTTP + static files + API) |
| `lib/db.js` | Node.js SQLite layer (better-sqlite3) |
| `lib/proxy-handler.js` | Node.js API routes, proxy, webhook, scheduler |
| `js/api.js` | Frontend API communication (send, test connection, poll) |
| `js/storage.js` | Frontend persistence (localStorage + server sync) |
| `css/design-system.css` | Complete design system — CSS custom properties, 6 themes |
| `index.html` | Single-file vanilla JS SPA (~46K, all components inline) |
| `src-tauri/src/main.rs` | Tauri entry — starts embedded server, opens webview |
| `src-tauri/src/lib.rs` | Library init — database, server, scheduler |
| `src-tauri/src/server.rs` | Axum router + all HTTP handlers |
| `src-tauri/src/db.rs` | Rust SQLite layer (rusqlite with bundled feature) |
| `src-tauri/src/models.rs` | All Rust data types (Message, Contact, etc.) |
| `src-tauri/src/proxy.rs` | SSRF protection + SMS forwarding |
| `src-tauri/src/scheduler.rs` | Background scheduler for due messages |
| `src-tauri/src/embedded.rs` | Frontend files embedded at compile time via include_str! |

### Architecture Notes

- **Frontend**: Vanilla JavaScript, no framework. All UI in a single `index.html`. Components use CSS custom properties for theming (6 themes).
- **API contract**: Node.js and Rust backends expose identical REST endpoints for drop-in compatibility.
- **SSRF protection**: Both backends block proxy requests to internal/private IPs (127.x, 10.x, 192.168.x, 172.16-31.x, ::1, fc00::/7, fe80::/10).
- **Frontend files**: The `frontend/` directory mirrors root-level files (index.html, css/, js/) and is used by the Tauri build. Tauri compiles them into the binary. The Node.js server serves root-level files directly.
- **Scheduler**: Checks every 10s for due scheduled messages and forwards them via the SMS gateway API.
- **Database tables**: messages, templates, groups (groups_t in Rust), app_config, app_stats, contacts, scheduled_messages. WAL journal mode.
