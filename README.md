# Android SMS Gateway Dashboard

<div align="center">
  <p>
    <strong>A modern, professional web dashboard for managing SMS messaging through your Android device</strong>
  </p>
  <p>
    <a href="#features">Features</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#usage-guide">Usage</a> •
    <a href="#api-reference">API</a> •
    <a href="#deployment">Deployment</a>
  </p>
</div>

---

## Overview

Android SMS Gateway Dashboard is a full-featured web application that turns your Android device into an SMS gateway. It communicates with the [Android SMS Gateway](https://github.com/capcom6/android-sms-gateway) app running on your phone, providing a professional desktop UI to send and receive SMS messages through a local network or cloud API.

The app runs as a single Node.js server that serves the dashboard UI and acts as a secure proxy to your Android device, overcoming CORS restrictions that would prevent a browser from directly accessing the device.

---

## Features

### 📨 Messaging
- **Single SMS** — Send messages to individual phone numbers
- **Group SMS** — Create named groups with multiple recipients and broadcast messages
- **CSV Bulk Send** — Upload a CSV file of phone numbers (with optional messages) to send in bulk
- **Message Templates** — Save and reuse pre-written messages with quick insert from the composer
- **Message Scheduling** — Schedule messages for future delivery with a background scheduler
- **Conversation History** — Persistent message history organized by contact with date grouping

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
- **SSRF Protection** — Blocks proxy requests to internal/private networks using `ipaddr.js`
- **Path Traversal Prevention** — Static file serving is locked to the project directory
- **Credentials Storage** — Optional "Remember me" with encrypted local storage
- **No Data Leaves Your Network** — All SMS traffic stays on your local LAN

---

## Architecture

```
┌─────────────┐     HTTP/WS      ┌──────────────────┐      HTTP       ┌──────────────────┐
│   Browser   │ ──────────────→  │  Node.js Server  │ ──────────────→  │  Android Device  │
│ (Dashboard) │                  │  (localhost:3000) │                  │  (SMS Gateway)   │
└─────────────┘                  └──────────────────┘                  └──────────────────┘
                                         │
                                         │ SQLite (data.db)
                                         ▼
                                  ┌──────────────────┐
                                  │  Persistent Data  │
                                  │  - Messages       │
                                  │  - Contacts       │
                                  │  - Templates      │
                                  │  - Groups         │
                                  │  - Config         │
                                  │  - Stats          │
                                  │  - Scheduled Msgs │
                                  └──────────────────┘
```

The server handles three roles on a single port:

1. **Static file server** — Serves the dashboard UI (`index.html`, CSS, JS)
2. **API server** — REST endpoints for data persistence, contacts, and scheduling
3. **Proxy server** — Forwards SMS requests to the Android device with SSRF protection

### Data Persistence

The app uses a dual-write strategy:
- **Primary:** SQLite database (`data.db`) via `better-sqlite3` — server-side persistence
- **Cache:** `localStorage` — local cache and fallback when the server is unreachable

On startup, `Storage.init()` hydrates the in-memory cache from the server API. All subsequent reads are synchronous from the cache; writes go to localStorage immediately and fire a background API request to sync with the server.

---

## Quick Start

### Prerequisites

1. **Android SMS Gateway App** installed on your Android device
   - Download from [GitHub Releases](https://github.com/capcom6/android-sms-gateway/releases)
   - Enable the REST API and set a username/password in the app settings
   - Note your device's IP address on the local network

2. **Node.js** v18+ — [Download](https://nodejs.org/)

### Setup

```bash
# Clone or download the project
cd android-sms-gateway-dashboard

# Install dependencies
npm install

# Start the server
npm start
```

The server starts on `http://localhost:3000`. Open it in your browser.

### Connect to Your Device

1. Open `http://localhost:3000` in your browser
2. Enter your Android device's IP address and port (e.g., `192.168.1.100:8080`)
3. Enter the username and password from the Android SMS Gateway app
4. Check **Remember my credentials** (optional)
5. Click **Connect**

> **Tip:** The app also supports cloud-based SMS gateways via the [SMS Gateway API](https://api.sms-gate.app). Enter a cloud API URL to connect remotely.

---

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

---

## API Reference

The server exposes the following REST API endpoints:

### Data API

| Method | Endpoint | Description |
|--------|----------|-------------|
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
|--------|----------|-------------|
| `GET` | `/api/contacts` | List all contacts (sorted by name) |
| `POST` | `/api/contacts` | Create a contact `{ id, name, phone, groups }` |
| `PUT` | `/api/contacts` | Update a contact `{ id, name, phone, groups }` |
| `DELETE` | `/api/contacts?id=xxx` | Delete a contact |
| `GET` | `/api/contacts/export` | Export all contacts as CSV |
| `GET` | `/api/contacts/export/vcf` | Export all contacts as vCard 3.0 |
| `POST` | `/api/contacts/import` | Import contacts from CSV `{ csv: "..." }` |

### Schedule API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/schedule` | Schedule a message `{ id, phone, text, sendAt, ... }` |
| `GET` | `/api/schedule` | List all scheduled messages |
| `DELETE` | `/api/schedule?id=xxx` | Cancel a scheduled message |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check `{ status: "ok", timestamp }` |
| `POST` | `/webhook` | Receive incoming SMS from the Android app |
| `GET` | `/messages` | Poll for received messages |
| `POST` | `/proxy?url=<target>` | Proxy an SMS request to the Android device |

---

## File Structure

```
android-sms-gateway-dashboard/
├── index.html                  # Main dashboard HTML (all UI components)
├── package.json                # Project metadata and dependencies
├── manifest.json               # PWA manifest (installable web app)
├── proxy.js                    # Server entry point (HTTP + static files + API)
├── start.sh                    # Convenience startup script
├── data.db                     # SQLite database (auto-created at runtime)
├── CHANGELOG.md                # Version history
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
│   ├── db.js                   # SQLite database layer (tables, CRUD, queries)
│   └── proxy-handler.js        # Server request handler (API routes, proxy, scheduler)
│
└── dist/                       # Platform-specific builds (optional)
```

---

## Deployment

### Local Network (Recommended)

The simplest deployment — run the server on any machine on your local network:

```bash
npm start
# or
bash start.sh
```

All devices on the same network can access the dashboard at `http://<your-ip>:3000`.

### Production Server

For a more permanent setup:

```bash
# Install as a systemd service (Linux)
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

### Docker

```dockerfile
# Dockerfile
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
|----------|---------|-------------|
| `PORT` | `3000` | Server port (override in `proxy.js`) |
| `HOST` | `0.0.0.0` | Bind address |

---

## Security

- **SSRF Protection:** The proxy blocks requests to loopback (`127.x.x.x`), private (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`), link-local (`169.254.x.x`), and unique-local (`fc00::/7`) addresses. Only public IP addresses and hostnames are allowed through the proxy.
- **Path Traversal Protection:** Static file serving resolves paths and verifies they stay within the project directory.
- **No External Dependencies for Core:** Only `better-sqlite3` (database) and `ipaddr.js` (IP validation) as production dependencies.
- **CORS:** Cross-origin headers are set for API endpoints, but the proxy requires proper authorization headers.

---

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

---

## Browser Support

| Browser | Minimum Version | PWA Support |
|---------|----------------|-------------|
| Chrome  | 88+            | ✅ Desktop + Android |
| Firefox | 87+            | ❌ (no PWA) |
| Safari  | 15+            | ✅ iOS Add-to-Home |
| Edge    | 88+            | ✅ Desktop |

Requires: CSS Grid, CSS Custom Properties, Optional Chaining (`?.`), `aspect-ratio`, `backdrop-filter`.

---

## Tech Stack

- **Runtime:** Node.js (v18+)
- **Database:** SQLite via `better-sqlite3` (WAL mode)
- **Frontend:** Vanilla JavaScript (no framework), CSS Custom Properties
- **Design System:** Custom design tokens with 6 themes
- **Proxy:** Native Node.js `http`/`https` modules
- **IP Validation:** `ipaddr.js`

---

## License

MIT License — see [LICENSE](LICENSE)

---

## Acknowledgments

Built for the [Android SMS Gateway](https://github.com/capcom6/android-sms-gateway) community.
