# Changelog

## [Unreleased]

### Changed

- **Server-side SQLite persistence**: Replaced pure localStorage persistence with a dual-write strategy.
  - Created `lib/db.js` with 5 tables (`messages`, `templates`, `groups`, `app_config`, `app_stats`) using `better-sqlite3`.
  - Added `GET /api/data`, `POST /api/data/{messages,templates,groups,stats,config}`, and `DELETE /api/data/{config,}` REST API routes.
  - `js/storage.js` rewritten to hydrate from server API on init and write to both localStorage (sync) and server (async fire-and-forget).
  - Data persists across page refreshes and survives browser cache clears.
  - Added index on `messages.phone` for performance.

- **Message scheduling**: Added delayed message delivery with a server-side scheduler.
  - Created `scheduled_messages` table in SQLite with full CRUD.
  - Added `POST /api/schedule`, `GET /api/schedule`, `DELETE /api/schedule` endpoints.
  - Built a background scheduler that checks every 10 seconds and forwards due messages to the device.
  - Added a clock icon button and `datetime-local` picker in the composer UI.
  - Scheduled messages appear in chat history with a clock badge and send time.
  - Scheduled messages dashboard in the stats modal with cancel support.
  - Added `ipaddr.js` dependency for comprehensive SSRF protection.

- **Web-only migration**: Removed all Electron build dependencies and artifacts.
  - Deleted `main.js` (Electron main process), removed `electron` and `electron-builder` from `package.json`.
  - Deleted pre-built `dist/` directory (win + Linux artifacts, ~160MB).
  - Consolidated static file serving into `proxy.js` — the app now runs entirely via `node proxy.js` on a single port (3000).
  - Simplified `start.sh` from a 55-line Python/http.server fallback chain to a clean Node.js startup script.
  - Added path traversal protection to static file serving.

- **Code quality**: Extracted shared proxy/webhook/message-handling logic.
  - Created `lib/proxy-handler.js` with `handleProxyRequest()` and `createProxyServer()`.
  - `proxy.js` reduced from ~230 lines to a thin wrapper.
  - `main.js` (deleted) previously duplicated the same ~200 lines of proxy logic.

- **Security**: Upgraded SSRF protection from a weak hostname blocklist to comprehensive IP range blocking.
  - Added `ipaddr.js` dependency.
  - Blocks all loopback (`127.0.0.0/8`, `::1`), private RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, `fe80::/10`), unique-local (`fc00::/7`), and unspecified (`0.0.0.0`, `::`) addresses.
  - Non-IP hostnames (e.g., `api.sms-gate.app`) pass through correctly.

- **CSS fixes**: Resolved multiple issues in `design-system.css`.
  - Replaced undefined `var(--color-success)` / `var(--color-error)` with `var(--success-500)` / `var(--error-500)`.
  - Fixed broken `.composer__input` selector where 8 properties had fallen outside the rule block.
  - Removed 15+ duplicate utility class definitions.

- **Bug fix**: Resolved blank page on load.
  - Static file server now strips query strings (e.g., `?v=7`) from `req.url` before resolving file paths, preventing 404s on cache-busted assets.

- **Documentation**: Updated `README.md`.
  - Quick Start simplified to single-command (`npm start`).
  - Architecture diagram updated for single-server setup.
  - Browser support section updated with accurate minimum versions (Chrome 88+, Firefox 87+, Safari 15+, Edge 88+).

### Added

- **Contact Book**: Full address book with server-side persistence.
  - Added `contacts` table to SQLite with indexes on `name` and `phone`.
  - Added `GET /api/contacts`, `POST /api/contacts`, `PUT /api/contacts`, `DELETE /api/contacts` endpoints.
  - New contacts modal with real-time search by name, phone, and group tags.
  - Add/edit contact form with group tag management (e.g., Family, Work, Friends).
  - Quick-select to start a chat with any contact directly from the book.
  - Contacts button added to the sidebar footer.

- **CSV export/import for contacts**: Bulk import and export contacts as CSV files.
  - Added `GET /api/contacts/export` — returns all contacts as a downloadable CSV with proper field quoting and escaping.
  - Added `POST /api/contacts/import` — accepts CSV text, parses quoted fields, splits group tags by semicolons.
  - Export button in contacts modal downloads `contacts.csv` via Blob URL.
  - Import button opens a file picker; uploaded CSV rows are saved as new contacts with unique IDs.
  - Proper handling of quoted commas, escaped quotes, and Windows `\r\n` line endings.

- **Drag-and-drop CSV import on contacts modal**: Import contacts by dragging a CSV file onto the modal.
  - Added an absolutely-positioned dropzone overlay with dashed border, backdrop blur, and centered upload icon/text ("Drop CSV file to import contacts").
  - Dropzone hidden by default, shown via `.drag-active` class on `dragenter`/`dragover`.
  - Visual feedback dims modal content to `opacity: 0.3` while dragging over the modal body.
  - `dragenter`/`dragover`/`dragleave`/`drop` handlers registered with a `dragCounter` to correctly handle nested element enter/leave events.
  - On drop, validates CSV file extension/MIME type, reads via `FileReader`, POSTs to `/api/contacts/import`, and reloads the contact list.
  - Handlers set up once via a one-time guard in `openContacts()` to prevent duplicate listener registration.

- `lib/proxy-handler.js` — shared module for API route handling.
- `CHANGELOG.md` — this file.
- `dist/` to `.gitignore`.
- `ipaddr.js` dependency for SSRF protection.

### Removed

- `main.js` — Electron main process file (no longer needed).
- `dist/` — pre-built Electron artifacts (win-unpacked, linux-unpacked).
- `electron` and `electron-builder` devDependencies.
- All `build:*` npm scripts and `build` config block from `package.json`.
