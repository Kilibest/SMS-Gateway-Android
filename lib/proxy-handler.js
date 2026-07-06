const http = require('http');
const https = require('https');
const url = require('url');
const ipaddr = require('ipaddr.js');
const db = require('./db');

// In-memory storage for received messages from webhooks
let receivedMessages = [];

/**
 * Read the full body from an incoming HTTP request.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Set standard CORS headers on a response.
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Return CORS headers as a plain object (for writeHead).
 */
function corsHeadersObject() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

/**
 * Blocked hostnames that are never allowed to be proxied to.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'localhost6',
  'localhost6.localdomain6',
  '0.0.0.0',
  '::',
  '[::]',
  '::1',
  '[::1]'
]);

/**
 * SSRF Protection: Check whether a target hostname should be blocked.
 *
 * Blocks:
 *   - Well-known localhost hostnames (localhost, localhost.localdomain, etc.)
 *   - Unspecified addresses (0.0.0.0, ::)
 *   - Any IP address in loopback, private, link-local, or unique-local ranges
 *     (e.g. 127.x.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x,
 *      fc00::/7, fe80::/10, ::1)
 *
 * @param {string} hostname - The target hostname or IP string
 * @returns {boolean} true if the target should be blocked
 */
function isInternalTarget(hostname) {
  // 1. Strip IPv6 brackets for parsing
  const cleaned = hostname.replace(/^\[|\]$/g, '');

  // 2. Check blocked hostnames (not IP addresses)
  if (BLOCKED_HOSTNAMES.has(cleaned.toLowerCase())) {
    return true;
  }

  // 3. Try to parse as an IP address
  try {
    const addr = ipaddr.parse(cleaned);
    const range = addr.range();

    // Block loopback and link-local for security.
    // Private ranges (RFC 1918: 10/8, 172.16/12, 192.168/16) are intentionally allowed
    // so users can proxy to their Android device on the local WiFi network.
    return range === 'loopback'
      || range === 'linkLocal'
      || range === 'unspecified';
  } catch (_) {
    // Not a valid IP — it's a hostname. Don't block hostnames here
    // (they could be DNS names that legitimately resolve to public IPs).
    // The hostname-based BLOCKED_HOSTNAMES set above already catches
    // 'localhost' and common variants.
    return false;
  }
}

/**
 * Handle a single HTTP request for proxy/webhook/messages/health routes.
 *
 * Returns true if the request was handled, false if the route was not matched
 * (so the caller can try its own fallback routing).
 */
async function handleProxyRequest(req, res) {
  setCorsHeaders(res);

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // ── CORS preflight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeadersObject());
    res.end();
    return true;
  }

  // ── Data API ────────────────────────────────────────────────────────────
  if (req.url === '/api/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
    res.end(JSON.stringify({
      messages:  db.getMessages(),
      templates: db.getTemplates(),
      groups:    db.getGroups(),
      stats:     db.getStats(),
      config:    db.getAllConfig(),
    }));
    return true;
  }

  if (req.url === '/api/data/messages' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { messages } = JSON.parse(body);
      if (Array.isArray(messages)) {
        db.saveMessages(messages);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ ok: true, count: messages.length }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Expected { messages: [...] }' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url === '/api/data/templates' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { templates } = JSON.parse(body);
      if (Array.isArray(templates)) {
        db.saveTemplates(templates);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ ok: true, count: templates.length }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Expected { templates: [...] }' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url === '/api/data/groups' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { groups } = JSON.parse(body);
      if (groups && typeof groups === 'object') {
        db.saveGroups(groups);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Expected { groups: {...} }' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url === '/api/data/stats' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { stats } = JSON.parse(body);
      if (stats && typeof stats === 'object') {
        db.saveStats(stats);
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Expected { stats: {...} }' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url === '/api/data/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { config } = JSON.parse(body);
      if (config && typeof config === 'object') {
        for (const [key, value] of Object.entries(config)) {
          db.setConfig(key, value);
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Expected { config: {...} }' }));
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url === '/api/data/config' && req.method === 'DELETE') {
    db.deleteAllConfig();
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (req.url === '/api/data' && req.method === 'DELETE') {
    db.clearAll();
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Contacts API ──────────────────────────────────────────────────────
  if (req.url === '/api/contacts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
    res.end(JSON.stringify(db.getContacts()));
    return true;
  }

  if (req.url === '/api/contacts' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!data.id || !data.name || !data.phone) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Missing required fields: id, name, phone' }));
        return true;
      }
      db.saveContact({
        id: data.id,
        name: data.name,
        phone: data.phone,
        groups: data.groups || [],
      });
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ ok: true, id: data.id }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.method === 'PUT' && req.url.startsWith('/api/contacts')) {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!data.id || !data.name || !data.phone) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Missing required fields: id, name, phone' }));
        return true;
      }
      db.saveContact({
        id: data.id,
        name: data.name,
        phone: data.phone,
        groups: data.groups || [],
      });
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/contacts')) {
    const parsedUrl = url.parse(req.url, true);
    const id = parsedUrl.query.id;
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: 'Missing id query parameter' }));
      return true;
    }
    db.deleteContact(id);
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Contacts Export/Import ────────────────────────────────────────────
  if (req.url === '/api/contacts/export' && req.method === 'GET') {
    const contacts = db.getContacts();
    // Build CSV with header row
    let csv = 'Name,Phone,Groups\n';
    for (const c of contacts) {
      const name = (c.name || '').replace(/"/g, '""');
      const phone = (c.phone || '').replace(/"/g, '""');
      const groups = ((c.groups || []).join('; ')).replace(/"/g, '""');
      csv += `"${name}","${phone}","${groups}"\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="contacts.csv"',
      ...corsHeadersObject(),
    });
    res.end(csv);
    return true;
  }

  if (req.url === '/api/contacts/export/vcf' && req.method === 'GET') {
    const contacts = db.getContacts();
    let vcf = '';
    for (const c of contacts) {
      // vCard 3.0 format
      const name = c.name || '';
      const phone = c.phone || '';
      // Split name into last/first/middle for FN and N fields
      const parts = name.trim().split(/\s+/);
      const lastName = parts.length > 1 ? parts.pop() : '';
      const firstName = parts.join(' ');
      const groups = (c.groups || []).join(',');

      // Escape special characters
      const esc = (s) => (s || '').replace(/[,;:]/g, '\\$&').replace(/\n/g, '\\n');

      vcf += 'BEGIN:VCARD\r\n';
      vcf += 'VERSION:3.0\r\n';
      vcf += `FN:${esc(name)}\r\n`;
      vcf += `N:${esc(lastName)};${esc(firstName)};;;\r\n`;
      vcf += `TEL;TYPE=CELL:${esc(phone)}\r\n`;
      if (groups) {
        vcf += `CATEGORIES:${esc(groups)}\r\n`;
      }
      vcf += 'END:VCARD\r\n';
    }
    res.writeHead(200, {
      'Content-Type': 'text/vcard',
      'Content-Disposition': 'attachment; filename="contacts.vcf"',
      ...corsHeadersObject(),
    });
    res.end(vcf);
    return true;
  }

  if (req.url === '/api/contacts/import' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { csv } = JSON.parse(body);
      if (!csv || typeof csv !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Expected { csv: "..." }' }));
        return true;
      }

      // Parse CSV lines (skip header row)
      const lines = csv.split('\n').map(l => l.trim()).filter(l => l);
      const header = lines[0];
      const dataLines = lines.slice(1);
      let imported = 0;
      let skipped = 0;

      for (const line of dataLines) {
        // Simple CSV parser respecting quoted fields
        const parsed = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQ) {
            if (ch === '"') {
              if (line[i + 1] === '"') { cur += '"'; i++; }
              else { inQ = false; }
            } else {
              cur += ch;
            }
          } else {
            if (ch === '"') { inQ = true; }
            else if (ch === ',') { parsed.push(cur.trim()); cur = ''; }
            else { cur += ch; }
          }
        }
        parsed.push(cur.trim());

        const name = parsed[0];
        const phone = parsed[1];
        const groupsStr = parsed[2] || '';
        const groups = groupsStr ? groupsStr.split(';').map(g => g.trim()).filter(Boolean) : [];

        if (name && phone) {
          const id = `import-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
          db.saveContact({ id, name, phone, groups });
          imported++;
        } else {
          skipped++;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ ok: true, imported, skipped }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── Schedule API ────────────────────────────────────────────────────────
  if (req.url === '/api/schedule' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!data.id || !data.phone || !data.text || !data.sendAt) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
        res.end(JSON.stringify({ error: 'Missing required fields: id, phone, text, sendAt' }));
        return true;
      }
      db.createScheduledMessage({
        id: data.id,
        phone: data.phone,
        text: data.text,
        recipients: data.recipients,
        groupName: data.groupName,
        isGroup: !!data.isGroup,
        gatewayUrl: data.gatewayUrl || null,
        authUser: data.authUser || null,
        authPass: data.authPass || null,
        isRemote: !!data.isRemote,
        sendAt: data.sendAt,
        createdAt: new Date().toISOString(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ ok: true, id: data.id }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  if (req.url === '/api/schedule' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
    res.end(JSON.stringify(db.getScheduledMessages()));
    return true;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/schedule')) {
    const parsedUrl = url.parse(req.url, true);
    const id = parsedUrl.query.id;
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: 'Missing id query parameter' }));
      return true;
    }
    db.deleteScheduledMessage(id);
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Message Search API ──────────────────────────────────────────────────
  if (req.url.startsWith('/api/messages/search') && req.method === 'GET') {
    const parsedUrl = url.parse(req.url, true);
    const q = parsedUrl.query.q;
    const limit = parseInt(parsedUrl.query.limit, 10) || 5;

    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: 'Missing query parameter: q' }));
      return true;
    }

    try {
      const results = db.searchMessages(q.trim(), limit);
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeadersObject() });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── Health check ────────────────────────────────────────────────────────
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return true;
  }

  // ── Webhook: receive incoming SMS from Android app ──────────────────────
  if (req.url === '/webhook' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      console.log('Webhook received:', data.event, data.payload);

      if (data.event === 'sms:received') {
        const parsedReceivedAt = new Date(data.payload.receivedAt || Date.now());
        const safeReceivedAt = Number.isNaN(parsedReceivedAt.getTime()) ? new Date() : parsedReceivedAt;
        receivedMessages.push({
          phone: data.payload.phoneNumber,
          text: data.payload.message,
          time: safeReceivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          rawTime: safeReceivedAt.toISOString(),
          type: 'received',
          status: 'received',
          id: Date.now() + Math.random()
        });
      }

      res.writeHead(200);
      res.end('OK');
    } catch (e) {
      console.error('Webhook error:', e.message);
      res.writeHead(400);
      res.end('Invalid JSON');
    }
    return true;
  }

  // ── Get received messages ───────────────────────────────────────────────
  if (req.url === '/messages' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(receivedMessages));
    return true;
  }

  // ── Proxy: forward SMS to the Android device's local API ───────────────
  if ((req.url.startsWith('/proxy') || req.url.startsWith('/proxy?')) && req.method === 'POST') {
    const parsedUrl = url.parse(req.url, true);
    const targetUrl = parsedUrl.query.url;
    const auth = req.headers['authorization'];

    console.log('Incoming proxy request:');
    console.log('  Target URL:', targetUrl);
    console.log('  Auth header:', auth ? 'Present' : 'Missing');

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url parameter');
      return true;
    }

    // Read and validate the request body
    let smsData;
    try {
      console.log('Reading request body...');
      smsData = await readBody(req);
      if (!smsData) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing request body');
        return true;
      }
      JSON.parse(smsData); // Validate JSON
    } catch (e) {
      console.error('Error reading body:', e.message);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid JSON in request body: ' + e.message);
      return true;
    }

    console.log('  Body length:', smsData.length);

    // Validate the target URL
    let targetUrlObj;
    try {
      targetUrlObj = new URL(targetUrl);
    } catch (e) {
      res.writeHead(400);
      res.end('Invalid URL');
      return true;
    }

    // SSRF Protection: comprehensive check using ipaddr.js
    if (isInternalTarget(targetUrlObj.hostname)) {
      console.log('  BLOCKED - internal target:', targetUrlObj.hostname);
      res.writeHead(403, {
        'Content-Type': 'application/json',
        ...corsHeadersObject()
      });
      res.end(JSON.stringify({
        error: 'Forbidden',
        message: 'Access to internal/private network targets is blocked for security',
        host: targetUrlObj.hostname
      }));
      return true;
    }

    // Forward the request to the target
    const parsedTarget = url.parse(targetUrl);
    const requestModule = parsedTarget.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: parsedTarget.hostname,
      port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
      path: parsedTarget.path,
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(smsData)
      },
      timeout: 10000
    };

    console.log('Proxying to:', parsedTarget.hostname + ':' + requestOptions.port);

    return new Promise((resolve) => {
      let responseSent = false;

      const proxyReq = requestModule.request(requestOptions, (proxyRes) => {
        let responseData = '';
        console.log('Proxy response status:', proxyRes.statusCode);

        proxyRes.on('data', (chunk) => {
          responseData += chunk;
        });

        proxyRes.on('end', () => {
          if (responseSent) return;
          responseSent = true;

          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          delete headers['transfer-encoding'];
          delete headers['connection'];
          Object.assign(headers, corsHeadersObject());

          res.writeHead(proxyRes.statusCode, headers);
          res.end(responseData);
          resolve(true);
        });
      });

      proxyReq.on('error', (e) => {
        if (responseSent) return;
        responseSent = true;
        console.error('Proxy Error:', e.code, e.message);
        res.writeHead(502, {
          'Content-Type': 'application/json',
          ...corsHeadersObject()
        });
        res.end(JSON.stringify({
          error: 'Bad Gateway',
          message: e.message,
          target: targetUrl
        }));
        resolve(true);
      });

      proxyReq.on('timeout', () => {
        if (responseSent) return;
        responseSent = true;
        console.error('Proxy Timeout - device not responding');
        proxyReq.destroy();
        res.writeHead(504, {
          'Content-Type': 'application/json',
          ...corsHeadersObject()
        });
        res.end(JSON.stringify({
          error: 'Gateway Timeout',
          message: 'Cannot connect to Android device. Please check: 1) Device is on same network, 2) Android SMS Gateway app is running, 3) IP address is correct',
          target: targetUrl
        }));
        resolve(true);
      });

      proxyReq.write(smsData);
      proxyReq.end();
    });
  }

  // Not a route we handle
  return false;
}

/**
 * Create a standalone HTTP proxy server.
 *
 * @param {number} port  - Port to listen on (default 3000)
 * @param {string} host  - Host to bind to (default '0.0.0.0')
 * @returns {http.Server}
 */
function createProxyServer(port, host) {
  const PORT = port || 3000;
  const HOST = host || '0.0.0.0';

  const server = http.createServer(async (req, res) => {
    const handled = await handleProxyRequest(req, res);
    if (!handled) {
      console.log('404 - Not matching any route:', req.method, req.url.substring(0, 50));
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + req.method + ' ' + req.url.substring(0, 50));
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Proxy server running at http://${HOST}:${PORT}`);
    console.log(`Usage: POST to http://${HOST}:${PORT}/proxy?url=<target> with JSON body`);
    console.log(`Webhook: POST to http://${HOST}:${PORT}/webhook`);
    console.log(`Messages: GET http://${HOST}:${PORT}/messages`);
  });

  return server;
}

/**
 * Internal: forward an SMS to the target device.
 * Returns { success: true } or { success: false, error: '...' }.
 */
function forwardSMS(gatewayUrl, authUser, authPass, isRemote, phoneNumbers, text) {
  return new Promise((resolve) => {
    try {
      const endpoint = isRemote
        ? gatewayUrl
        : `${gatewayUrl}/messages`;

      const targetUrl = new URL(endpoint);
      const requestModule = targetUrl.protocol === 'https:' ? https : http;
      const smsData = JSON.stringify({
        textMessage: { text },
        phoneNumbers: Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers],
      });

      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname,
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64'),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(smsData),
        },
        timeout: 10000,
      };

      const req = requestModule.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200 || (res.statusCode === 400 && body.includes('country code'))) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
          }
        });
      });

      req.on('error', (e) => resolve({ success: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Connection timed out' }); });
      req.write(smsData);
      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

/**
 * Start the background scheduler that checks for due messages every N seconds.
 * Returns the interval ID (for cleanup).
 */
function startScheduler(intervalMs) {
  const CHECK_INTERVAL = intervalMs || 10000;

  const tick = async () => {
    try {
      const due = db.getDueScheduledMessages();
      for (const msg of due) {
        try {
          const phoneNumbers = msg.isGroup && msg.recipients
            ? msg.recipients
            : [msg.phone];

          const result = await forwardSMS(
            msg.gatewayUrl,
            msg.authUser,
            msg.authPass,
            msg.isRemote,
            phoneNumbers,
            msg.text
          );

          if (result.success) {
            db.updateScheduledStatus(msg.id, 'sent', null);
            console.log(`[Scheduler] Sent scheduled message ${msg.id} to ${msg.phone}`);
          } else {
            db.updateScheduledStatus(msg.id, 'failed', result.error);
            console.error(`[Scheduler] Failed scheduled message ${msg.id}: ${result.error}`);
          }
        } catch (e) {
          db.updateScheduledStatus(msg.id, 'failed', e.message);
          console.error(`[Scheduler] Error processing ${msg.id}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Error during check:', e.message);
    }
  };

  // Run immediately on start, then every interval
  tick();
  return setInterval(tick, CHECK_INTERVAL);
}

module.exports = {
  handleProxyRequest,
  readBody,
  createProxyServer,
  startScheduler,
};
