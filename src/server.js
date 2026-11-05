'use strict';
// HTTP server: JSON API under /api, printable documents under /print/:id and
// the single-page app from /public. No external dependencies.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDatabase, verifyPassword } = require('./db');
const { createServices, DOC_LABELS } = require('./services');
const { renderDocument, fmtDate, METHOD_LABELS } = require('./print');
const { HttpError, formatMoney } = require('./money');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'pos_session';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isString ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isString ? body : JSON.stringify(body));
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function createApp({ dbFile = path.join(__dirname, '..', 'data', 'pos.db') } = {}) {
  const db = openDatabase(dbFile);
  const svc = createServices(db);

  // ------------------------------------------------------------ sessions
  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.active = 1`).get(token);
    if (!row || row.expires_at < Date.now()) return null;
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() + SESSION_TTL_MS, token);
    return { id: row.id, username: row.username, full_name: row.full_name, role: row.role, token };
  }

  const cookieHeader = (token, maxAge) =>
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

  // -------------------------------------------------------------- routes
  const routes = [];
  const route = (method, pattern, handler, { auth = 'user' } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler, auth });
  };

  route('POST', '/api/login', async ({ body, res }) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(body.username || '').trim());
    if (!user || !verifyPassword(body.password || '', user.password_hash)) throw new HttpError(401, 'Wrong username or password');
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, Date.now() + SESSION_TTL_MS);
    res.setHeader('Set-Cookie', cookieHeader(token, SESSION_TTL_MS / 1000));
    return { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  }, { auth: 'none' });

  route('POST', '/api/logout', ({ user, res }) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    return { ok: true };
  });

  route('GET', '/api/me', ({ user }) => {
    const { token, ...u } = user;
    return u;
  });

  route('PUT', '/api/me/password', ({ user, body }) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(body.current_password || '', row.password_hash)) throw new HttpError(400, 'Current password is wrong');
    svc.updateUser(user.id, { password: body.new_password });
    return { ok: true };
  });

  // Settings: everyone can read (needed to render), only admin can change.
  route('GET', '/api/settings', () => svc.getSettings());
  route('PUT', '/api/settings', ({ body }) => svc.updateSettings(body), { auth: 'admin' });

  route('GET', '/api/users', () => svc.listUsers(), { auth: 'admin' });
  route('POST', '/api/users', ({ body }) => svc.createUser(body), { auth: 'admin' });
  route('PUT', '/api/users/:id', ({ params, body }) => svc.updateUser(Number(params.id), body), { auth: 'admin' });

  route('GET', '/api/products', ({ query }) => svc.listProducts(query));
  route('POST', '/api/products', ({ body, user }) => svc.createProduct(body, user), { auth: 'admin' });
  route('GET', '/api/products/:id', ({ params }) => svc.getProduct(Number(params.id)));
  route('PUT', '/api/products/:id', ({ params, body }) => svc.updateProduct(Number(params.id), body), { auth: 'admin' });
  route('POST', '/api/products/:id/adjust', ({ params, body, user }) => svc.adjustStock(Number(params.id), body, user), { auth: 'admin' });
  route('GET', '/api/products/:id/movements', ({ params }) => svc.productMovements(Number(params.id)));

  route('GET', '/api/customers', ({ query }) => svc.listCustomers(query));
  route('POST', '/api/customers', ({ body }) => svc.createCustomer(body));
  route('GET', '/api/customers/:id', ({ params }) => svc.getCustomer(Number(params.id)));
  route('PUT', '/api/customers/:id', ({ params, body }) => svc.updateCustomer(Number(params.id), body));

  route('GET', '/api/documents', ({ query }) => svc.listDocuments(query));
  route('POST', '/api/documents', ({ body, user }) => svc.createDocument(body, user));
  route('GET', '/api/documents/:id', ({ params }) => svc.getDocument(Number(params.id)));
  route('POST', '/api/documents/:id/convert', ({ params, body, user }) => svc.convertQuotation(Number(params.id), user, body));
  route('POST', '/api/documents/:id/void', ({ params, body, user }) => svc.voidDocument(Number(params.id), body.reason, user), { auth: 'admin' });

  route('GET', '/api/reports/summary', ({ query }) => svc.report(query));

  route('GET', '/api/export/documents.csv', ({ query, res }) => {
    const docs = svc.listDocuments({ ...query, limit: 5000 });
    const header = ['Type', 'Number', 'Date', 'Customer', 'Status', 'Sub total', 'Discount', 'VAT', 'Total', 'Paid', 'Balance', 'Payment method', 'Prepared by'];
    const lines = [header.join(',')];
    for (const d of docs) {
      lines.push([
        DOC_LABELS[d.type], d.number, fmtDate(d.date), d.customer_name, d.voided_at ? 'void' : d.status,
        formatMoney(d.subtotal), formatMoney(d.discount), formatMoney(d.vat_amount), formatMoney(d.total),
        formatMoney(d.amount_paid), d.type === 'invoice' ? formatMoney(d.total - d.amount_paid) : '',
        METHOD_LABELS[d.payment_method] || '', d.prepared_by_name,
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Disposition', `attachment; filename="documents-${query.from || 'all'}-${query.to || 'all'}.csv"`);
    send(res, 200, lines.join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8' });
  });

  route('GET', '/api/backup', ({ res }) => {
    res.setHeader('Content-Disposition', `attachment; filename="pos-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return svc.backup();
  }, { auth: 'admin' });

  route('GET', '/print/:id', ({ params, query, res }) => {
    const doc = svc.getDocument(Number(params.id));
    if (doc.type === 'receipt' && doc.source_id) {
      // Balance on the invoice right after this payment was received.
      const inv = db.prepare('SELECT total FROM documents WHERE id = ?').get(doc.source_id);
      const paid = db.prepare(`SELECT COALESCE(SUM(amount_paid), 0) AS p FROM documents
        WHERE source_id = ? AND type = 'receipt' AND voided_at IS NULL AND id <= ?`).get(doc.source_id, doc.id).p;
      doc.invoice_balance = inv.total - paid;
    }
    const html = renderDocument(doc, svc.getSettings(), { format: query.format, autoprint: query.autoprint === '1' });
    send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  });

  // ------------------------------------------------------------- handler
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const isApi = pathname.startsWith('/api/') || pathname.startsWith('/print/');

    if (isApi) {
      try {
        const match = routes
          .filter((r) => r.re.test(pathname))
          .find((r) => r.method === req.method);
        if (!match) throw new HttpError(404, 'Not found');
        const user = match.auth === 'none' ? null : currentUser(req);
        if (match.auth !== 'none' && !user) {
          if (pathname.startsWith('/print/')) {
            res.writeHead(302, { Location: '/#/login' });
            return res.end();
          }
          throw new HttpError(401, 'Please log in');
        }
        if (match.auth === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Only an administrator can do this');
        const m = pathname.match(match.re);
        const params = Object.fromEntries(match.keys.map((k, i) => [k, m[i + 1]]));
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const query = Object.fromEntries(url.searchParams);
        const result = await match.handler({ req, res, user, params, query, body });
        if (!res.headersSent && result !== undefined) send(res, 200, result);
      } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error(err);
        const message = status === 500 ? 'Something went wrong' : err.message;
        if (!res.headersSent) send(res, status, { error: message });
      }
      return;
    }

    // Static files (SPA)
    let file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong' });
    });
  });
  return { server, db, svc };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createApp({ dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pos.db') });
  server.listen(port, host, () => {
    console.log(`POS running on http://localhost:${port}  (default login: admin / admin123)`);
  });
}

module.exports = { createApp };
