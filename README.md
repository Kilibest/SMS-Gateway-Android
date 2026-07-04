# Android SMS Gateway Dashboard

**A modern, professional web dashboard for managing SMS messaging through your Android device**

[Features](#features) • [Quick Start](#quick-start) • [Usage](#usage-guide) • [API](#api-reference) • [Deployment](#deployment)


## Overview

Android SMS Gateway Dashboard is a full-featured web application that turns your Android device into an SMS gateway. It communicates with the [Android SMS Gateway](https://github.com/capcom6/android-sms-gateway) app running on your phone, providing a professional desktop UI to send and receive SMS messages through a local network or cloud API.

![preview](https://res.cloudinary.com/dmztdgxfp/image/upload/v1782916280/epj9kqpfbtkqlss1uq9q.png)

The app comes in two forms:

- **Desktop App (Tauri)** — A standalone windowed application. No browser, no terminal. Just install and run. Available for Windows (MSI), Linux (AppImage/DEB/RPM), and macOS (DMG).
- **Node.js Server** — Runs on any machine on your local network. Access the dashboard from any browser on the same network. Good for team use or when you can't install software.


## Features

### 📨 Messaging
![preview sms screen](https://res.cloudinary.com/dmztdgxfp/image/upload/v1782917324/p4obonbrkby23wpzmvvs.png)
- **Single SMS** — Send messages to individual phone numbers

![Preview group - svc](https://res.cloudinary.com/dmztdgxfp/image/upload/v1782917559/wafwtikil8t4jbpue4qa.png)
- **Group SMS** — Create named groups with multiple recipients and broadcast messages

- **CSV Bulk Send** — Upload a CSV file of phone numbers (with optional messages) to send in bulk

- **Message Templates** — Save and reuse pre-written messages with quick insert from the composer
![Preview Templates creation](https://res.cloudinary.com/dmztdgxfp/image/upload/v1782917864/yahq5c4jxwhtupyb7f6x.png)
- **Message Scheduling** — Schedule messages for future delivery with a background scheduler

- **Conversation History** — Persistent message history organized by contact with date grouping
![Preview conversation screen](https://res.cloudinary.com/dmztdgxfp/image/upload/v1782917864/dv0yrrfsr6a9hkcifeoz.png)

### 📇 Contact Management

- **Contact Book** — Full CRUD for contacts with name, phone number, and group tags

- **Contact Search** — Real-time filtering by name, phone, or group tags

- **Quick-Select Chat** — Click any contact to immediately start a conversation

- **CSV Import** — Bulk import contacts from CSV files

- **vCard / CSV Export** — Export contacts as CSV or vCard (.vcf) format

- **Drag-and-Drop Import** — Drag CSV files directly onto the contacts modal

### 📊 Dashboard & Monitoring

- **Statistics Panel** — Track sent, delivered, failed, and received messages

- **Group Chat Count** — View number of active group chats

- **Scheduled Message Dashboard** — View, refresh, and cancel scheduled messages from the stats modal

- **Received Message Polling** — Auto-fetches incoming messages every 3 seconds

### 🎨 User Experience
![Preview setting screen](https://res.cloudinary.com/dmztdgxfp/image/upload/v1782917559/bvogefme9ktqvnszsagq.png)
- **6 Themes** — Light, Dark, Chocolate, Sky Blue, Neon, and Vanilla (persisted across sessions)

- **Active Theme Indicator** — Settings modal shows which theme is currently active

- **Responsive Modals** — All interactions use animated modal dialogs

- **Toast Notifications** — Non-intrusive success/error/warning/info messages

- **Character Counter** — Real-time SMS character count with multi-SMS detection

- **Message Status Icons** — Visual indicators for sent, delivered, sending, and failed states

- **Rate Limiting** — 500ms throttle between messages to prevent API overload

- **Keyboard Shortcuts** — Enter to send, Shift+Enter for newline, Escape to close modals

- **Focus Trapping** — Accessible modal navigation with Tab/Shift+Tab

- **Screen Reader Support** — ARIA live regions and landmarks

### 🔒 Security

- **SSRF Protection** — Blocks proxy requests to loopback/localhost addresses while allowing private network access to your Android device

- **Path Traversal Prevention** — Static file serving is locked to the project directory

- **Credentials Storage** — Optional "Remember me" with encrypted local storage

- **No Data Leaves Your Local Network** — All SMS traffic stays on your LAN when using local mode


## Architecture

The app has two independent backends that share the same frontend and API design:

```
                 ┌──────────────────────────────────────────────────┐
                 │            Browser or Tauri Webview              │
                 │  (index.html, CSS, JS — same UI either way)      │
                 └──────┬───────────────────────────┬───────────────┘
                        │                           │
                 ┌──────▼──────────────┐   ┌────────▼──────────────┐
                 │  Node.js Server     │   │  Tauri Desktop App    │
                 │  (proxy.js + lib/)  │   │  (Rust + axum server) │
                 │  Port: 3000         │   │  Port: random (127.0) │
                 └──────┬──────────────┘   └────────┬──────────────┘
                        │                           │
                        └──────────┬────────────────┘
                                   │ HTTP proxy
                          ┌────────▼──────────┐
                          │  Android Device   │
                          │  (SMS Gateway)    │
                          │  192.168.x.x:8080 │
                          └───────────────────┘
```

Both backends:
1. **Serve the dashboard UI** — `index.html`, CSS, JS files
2. **REST API** — Endpoints for messages, contacts, templates, scheduling
3. **Proxy server** — Forwards SMS requests to the Android device on your local network
4. **SQLite database** — Persistent storage (messages, contacts, templates, groups, stats, config)

### Data Persistence

The app uses a dual-write strategy:

- **Primary:** SQLite database — server-side persistence (rusqlite in Rust / better-sqlite3 in Node.js)
- **Cache:** `localStorage` — local cache and fallback when the server is unreachable

On startup, `Storage.init()` hydrates the in-memory cache from the server API. All subsequent reads are synchronous from the cache; writes go to localStorage immediately and fire a background API request to sync with the server.


## Quick Start

### Prerequisites

1. **Android SMS Gateway App** installed on your Android device

   - Download from [GitHub Releases](https://github.com/capcom6/android-sms-gateway/releases)

   - Enable the REST API and set a username/password in the app settings

   - Note your device's IP address on the local network

2. Choose your setup:

   - **Desktop App** — No prerequisites. Download from the [Releases](#desktop-app-recommended) section.
   - **Node.js Server** — Requires [Node.js](https://nodejs.org/) v18+.

### Setup (Node.js)

```
# Clone or download the project  
cd android-sms-gateway-dashboard  
  
# Install dependencies  
npm install  
  
# Start the server  
npm start
```

The server starts on `http://localhost:3000`. Open it in your browser.

### Connect to Your Device

1. Open the dashboard in your browser (Node.js) or launch the desktop app

2. Enter your Android device's IP address and port (e.g., `192.168.1.100:8080`)

3. Enter the username and password from the Android SMS Gateway app

4. Click **Connect**

> **Tip:** The app also supports cloud-based SMS gateways via the [SMS Gateway API](https://api.sms-gate.app/). Enter a cloud API URL to connect remotely.

### Download the Desktop App (Recommended)

No building required — grab the latest release:

| Platform | Download |
|----------|----------|
| **Windows** | `SMS Gateway Dashboard_x.x.x_x64.msi` / `.exe` |
| **Linux** | `SMS Gateway Dashboard_x.x.x_amd64.AppImage` or `.deb` or `.rpm` |
| **macOS** | `SMS Gateway Dashboard_x.x.x_x64.dmg` |

Available on the [Releases page](https://github.com/your-username/your-repo/releases).


## Usage Guide

### Sending Messages

#### Single Message

1. Click **+** (New Chat) in the sidebar

2. Select **Single**

3. Enter the phone number with country code (e.g., `+12345678900`)

4. Click **Start Chat**

5. Type your message and press **Enter** (or click the send button)

#### Group Message

1. Click **+** → **Group**

2. Enter a **Group Name** (e.g., "Marketing Team")

3. Add recipients by typing phone numbers and pressing **Enter** after each

4. Click **Start Chat**

5. Send messages to the entire group at once

> You can also import recipients from a CSV file by clicking **Import from CSV** in the group form.

#### Bulk CSV Send

1. Click **+** → **Via CSV**

2. Drop or click to select a CSV file

   - Format: `phone` (one per line) or `phone,message`

3. Review the preview of up to 10 entries

4. Add a default message for recipients without one

5. Click **Send Messages**

### Message Templates

Save frequently used messages for quick access:

1. Click the **document icon** (📄) in the chat header

2. Enter a **Template Name** and **Message Content**

3. Click **Save Template**

4. To use a template, click the **document icon** (📄) next to the message input, then select the template

### Message Scheduling

1. Click the **clock icon** (⏰) next to the send button

2. Pick a future date and time

3. The send button now shows the scheduled date

4. Click **Send** to schedule the message (a placeholder appears in chat)

5. Cancel anytime via the schedule info bar or the **Stats** modal

### Managing Contacts

1. Click **Contacts** in the sidebar footer

2. **Search** contacts by name, phone, or group tags

3. **Add** — Click **Add**, fill in name, phone, and optional group tags

4. **Edit** — Click the pencil icon on any contact

5. **Delete** — Click the trash icon (with confirmation)

6. **Quick Chat** — Click a contact's name or the chat icon to start a conversation

#### Import/Export Contacts

- **Export CSV** — Click the download icon to export all contacts as CSV

- **Export vCard** — Click the person icon to export as `.vcf` (importable into phone contacts)

- **Import CSV** — Click **Import** and select a CSV file (format: `Name,Phone,Groups`)

- **Drag & Drop** — Drag a CSV file directly onto the contacts modal

### Statistics

Click the **chart icon** (📊) in the header to view:

- Messages sent, delivered, received, and failed
- Number of active group chats and unique contacts
- Scheduled messages with status and cancel buttons
- Reset all statistics (with confirmation)

### Settings

Click **Settings** in the sidebar footer:

- **Disconnect** — Clear the connection and return to the setup screen
- **Themes** — Choose from 6 themes (Light, Dark, Chocolate, Sky Blue, Neon, Vanilla)
- **Clear All Data** — Delete all messages, contacts, templates, and statistics


## API Reference

The server exposes the following REST API endpoints:

### Data API

| Method | Endpoint | Description |
| - | - | - |
| `GET` | `/api/data` | Fetch all app data (messages, templates, groups, stats, config) |
| `POST` | `/api/data/messages` | Save messages `{ messages: [...] }` |
| `POST` | `/api/data/templates` | Save templates `{ templates: [...] }` |
| `POST` | `/api/data/groups` | Save groups `{ groups: {...} }` |
| `POST` | `/api/data/stats` | Save stats `{ stats: {...} }` |
| `POST` | `/api/data/config` | Save config `{ config: {...} }` |
| `DELETE` | `/api/data/config` | Delete all config |
| `DELETE` | `/api/data` | Clear all data |

### Contacts API

| Method | Endpoint | Description |
| - | - | - |
| `GET` | `/api/contacts` | List all contacts (sorted by name) |
| `POST` | `/api/contacts` | Create a contact `{ id, name, phone, groups }` |
| `PUT` | `/api/contacts` | Update a contact `{ id, name, phone, groups }` |
| `DELETE` | `/api/contacts?id=xxx` | Delete a contact |
| `GET` | `/api/contacts/export` | Export all contacts as CSV |
| `GET` | `/api/contacts/export/vcf` | Export all contacts as vCard 3.0 |
| `POST` | `/api/contacts/import` | Import contacts from CSV `{ csv: "..." }` |

### Schedule API

| Method | Endpoint | Description |
| - | - | - |
| `POST` | `/api/schedule` | Schedule a message `{ id, phone, text, sendAt, ... }` |
| `GET` | `/api/schedule` | List all scheduled messages |
| `DELETE` | `/api/schedule?id=xxx` | Cancel a scheduled message |

### System

| Method | Endpoint | Description |
| - | - | - |
| `GET` | `/health` | Health check `{ status: "ok", timestamp }` |
| `POST` | `/webhook` | Receive incoming SMS from the Android app |
| `GET` | `/messages` | Poll for received messages |
| `POST` | `/proxy?url=<target>` | Proxy an SMS request to the Android device |


## File Structure

```
android-sms-gateway-dashboard/  
├── index.html                  # Main dashboard HTML (all UI components)  
├── package.json                # Project metadata and dependencies  
├── manifest.json               # PWA manifest (installable web app)  
├── proxy.js                    # Node.js server entry point  
├── start.sh                    # Convenience startup script (Linux/macOS)  
├── CHANGELOG.md                # Version history  
├── CLAUDE.md                   # AI coding assistant instructions  
├── LICENSE                     # MIT license  
│  
├── css/  
│   └── design-system.css       # Complete design system (tokens, themes, components)  
│  
├── js/  
│   ├── app.js                  # Main application logic (state, UI, interactions)  
│   ├── api.js                  # API communication (connection, send, poll)  
│   ├── storage.js              # Data persistence (SQLite via API + localStorage)  
│   └── toast.js                # Toast notification system  
│  
├── lib/  
│   ├── db.js                   # Node.js SQLite layer (tables, CRUD, queries)  
│   └── proxy-handler.js        # Node.js request handler (API routes, proxy, scheduler)  
│  
├── frontend/                   # Frontend files for Tauri desktop build  
│   ├── index.html              #   (mirrors root files — embedded into the binary)  
│   ├── css/  
│   └── js/  
│  
├── src-tauri/                  # Tauri desktop app (Rust backend)  
│   ├── Cargo.toml              # Rust dependencies and build config  
│   ├── tauri.conf.json         # Tauri window and bundle settings  
│   ├── build.rs                # Compile-time frontend embedding  
│   └── src/  
│       ├── main.rs             # App entry — starts server, opens webview  
│       ├── lib.rs              # Library init — database, server, scheduler  
│       ├── server.rs           # Axum HTTP router and all API handlers  
│       ├── db.rs               # Rust SQLite layer (rusqlite)  
│       ├── models.rs           # Data types (Message, Contact, etc.)  
│       ├── proxy.rs            # SSRF protection + SMS forwarding  
│       ├── scheduler.rs        # Background scheduler for due messages  
│       └── embedded.rs         # Frontend files embedded at compile time  
│  
├── release/                    # Pre-built installers (gitignored)  
│   └── v2.0.0/  
│       ├── SMS Gateway Dashboard_2.0.0_amd64.AppImage  
│       ├── SMS Gateway Dashboard_2.0.0_amd64.deb  
│       └── SMS Gateway Dashboard-2.0.0-1.x86_64.rpm  
│  
└── .github/workflows/          # CI/CD — builds for all platforms on push/PR  
    └── build.yml
```


## Deployment

### Option 1: Desktop App (Recommended)

No technical skills required. Download the installer for your operating system and install it like any other program.

#### For Windows Users

> **Need help?** If you're not familiar with the command line, use the pre-built installer from the [Releases page](https://github.com/your-username/your-repo/releases) instead.

If you want to build the app yourself from the source code (for example, to get the latest changes), follow these steps:

**Step 1 — Install Rust**

1. Go to [rustup.rs](https://rustup.rs/) and download `rustup-init.exe`
2. Run the installer — accept the default settings
3. After installation, restart your computer

**Step 2 — Install WebView2**

Windows 10 (version 1803+) and Windows 11 already have WebView2. If you're on an older version, download it from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

**Step 3 — Build the app**

Open **Command Prompt** or **PowerShell** in the project folder and run:

```
cd src-tauri
cargo tauri build
```

The first build downloads and compiles many dependencies and can take 5–10 minutes.

**Step 4 — Find the installer**

After the build finishes, you'll find two installers in the following folder:

```
src-tauri\target\release\bundle\msi\
  SMS Gateway Dashboard_x.x.x_x64.msi    ← Run this to install

src-tauri\target\release\bundle\nsis\
  SMS Gateway Dashboard_x.x.x_x64-setup.exe    ← Alternative installer
```

Double-click the `.msi` or `.exe` file to install the app like any Windows program. A shortcut will appear in your Start Menu.

#### For Linux Users

```bash
# Prerequisites: Rust toolchain and system libraries
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libssl-dev build-essential

# Build
cd src-tauri
cargo tauri build

# Installer located at:
# src-tauri/target/release/bundle/deb/   (.deb for Debian/Ubuntu)
# src-tauri/target/release/bundle/rpm/   (.rpm for Fedora)
# src-tauri/target/release/bundle/appimage/  (AppImage — runs anywhere)
```

#### For macOS Users

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Build
cd src-tauri
cargo tauri build

# Installer located at:
# src-tauri/target/release/bundle/dmg/   (drag to Applications)
```

### Option 2: Local Network (Node.js)

Run the server on any machine on your local network:

```bash
npm start
# or
bash start.sh
```

Access the dashboard at `http://<your-ip>:3000` from any device on the same network.

### Option 3: Production Server (systemd)

```bash
sudo tee /etc/systemd/system/sms-gateway.service << EOF
[Unit]
Description=Android SMS Gateway Dashboard
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/android-sms-gateway-dashboard
ExecStart=/usr/bin/node proxy.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable sms-gateway
sudo systemctl start sms-gateway
```

### Option 4: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "proxy.js"]
```

```bash
docker build -t sms-gateway .
docker run -d -p 3000:3000 --name sms-gateway sms-gateway
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name sms-gateway.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Environment Variables

| Variable | Default | Description |
| - | - | - |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |


## Security

- **SSRF Protection:** The proxy blocks requests to loopback (`127.x.x.x`, `::1`), link-local (`169.254.x.x`, `fe80::/10`), and unspecified (`0.0.0.0`) addresses. Private network ranges (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`) are allowed since the Android device lives on your local WiFi network.

- **Path Traversal Protection:** Static file serving resolves paths and verifies they stay within the project directory.

- **Credentials Storage:** Optional "Remember me" with encrypted local storage.

- **No Data Leaves Your Local Network:** All SMS traffic stays on your LAN when using local mode.


## Troubleshooting

### "Cannot connect to device"

- Ensure phone and computer are on the same WiFi network
- Verify the Android SMS Gateway app shows "Server running"
- Check the IP address is correct (find it in the app or your router's DHCP list)
- Make sure port 8080 (or custom port) is not blocked by a firewall

### "Authentication failed"

- Double-check the username and password set in the Android SMS Gateway app
- Credentials are case-sensitive
- Try re-entering credentials in the connection form

### "Gateway Timeout"

- Keep the Android screen on while sending (disable battery optimization for the app)
- Ensure the app has SMS permissions granted
- Check if the phone has a stable WiFi connection

### "Server won't start (EADDRINUSE)"

```bash
# Find and kill the process using port 3000
lsof -i :3000
kill -9 <PID>
```

### PWA / Install

- **Chrome/Edge:** Click the install icon in the address bar
- **Safari (iOS):** Tap the Share button, then "Add to Home Screen"
- The app runs offline-capable after initial load


## Browser Support

| Browser | Minimum Version | PWA Support |
| - | - | - |
| Chrome | 88+ | ✅ Desktop + Android |
| Firefox | 87+ | ❌ (no PWA) |
| Safari | 15+ | ✅ iOS Add-to-Home |
| Edge | 88+ | ✅ Desktop |

Requires: CSS Grid, CSS Custom Properties, Optional Chaining (`?.`), `aspect-ratio`, `backdrop-filter`.


## Tech Stack

- **Runtime:** Node.js (v18+) or Rust (Tauri desktop app)
- **Backend:** Rust (axum HTTP server) or Node.js (proxy.js)
- **Database:** SQLite via `rusqlite` (Rust) or `better-sqlite3` (Node.js)
- **Frontend:** Vanilla JavaScript (no framework), CSS Custom Properties
- **Design System:** Custom design tokens with 6 themes
- **Desktop:** Tauri v2 with embedded HTTP server
- **Proxy:** Native HTTP client (`reqwest` in Rust / `http`/`https` in Node.js)


## License

MIT License — see [LICENSE](LICENSE)


## Acknowledgments

Built for the [Android SMS Gateway](https://github.com/capcom6/android-sms-gateway) community.
