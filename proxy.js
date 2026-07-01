const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { handleProxyRequest, startScheduler } = require('./lib/proxy-handler');
const db = require('./lib/db');

// Initialize SQLite database
db.init();

// Start background scheduler for scheduled messages (checks every 10s)
startScheduler(10000);

const PORT = 3000;
const HOST = '0.0.0.0';

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // Try API routes first (OPTIONS, /health, /webhook, /messages, /proxy)
  const handled = await handleProxyRequest(req, res);
  if (handled) return;

  // ── Static file serving ──────────────────────────────────────────────
  // Strip query string (e.g. ?v=7) before resolving the file path
  const parsedUrl = url.parse(req.url);
  const requestedPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;

  // Prevent path traversal: resolve the full path and ensure it's inside the project
  const filePath = path.resolve(path.join(__dirname, requestedPath));

  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SMS Gateway Dashboard running at http://${HOST}:${PORT}`);
  console.log(`Usage: POST to http://${HOST}:${PORT}/proxy?url=<target> with JSON body`);
  console.log(`Webhook: POST to http://${HOST}:${PORT}/webhook`);
  console.log(`Messages: GET http://${HOST}:${PORT}/messages`);
});
