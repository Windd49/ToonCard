#!/usr/bin/env node
/*
 * 漫劇卡 ToonCard — 選用的本機伺服器（不需安裝任何套件）
 * 1. 提供網頁：http://127.0.0.1:8787
 * 2. API 代理：/proxy?url=<目標網址>，用來避開不允許瀏覽器直連（CORS）的 API
 * 3. Vertex AI：/vertex/<地區>/models/<模型>:<方法>，用 Google Cloud 服務帳戶金鑰代簽請求（金鑰只留在這台電腦）
 * 代理、Vertex AI 與 config.local.json 只接受這個程式自己的網頁發出的請求。
 *
 * 用法：node server.js            只允許本機連線
 *      node server.js --open     啟動後自動開啟瀏覽器
 *      node server.js --lan      讓同一個區網的手機也能開（代理與 Vertex AI 會對區網開放，請只在信任的網路使用）
 *      PORT=9000 node server.js  改用其他連接埠
 * 安全性設定（連接埠、區網、代理）也可以寫在 config.local.json 的 server 段落，範本見 config.example.json；
 * Vertex AI 的金鑰檔放在本程式的 keys 資料夾，或在 config.local.json 的 vertex.keyFile 指定。
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const dns = require('dns');
const crypto = require('crypto');
const { exec } = require('child_process');

const ROOT = __dirname;
const KEY_DIR = path.join(ROOT, 'keys');
function readLocalConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.local.json'), 'utf8')); } catch (e) { return {}; }
}
// 伺服器的安全性設定（config.local.json 的 server 段落）；命令列參數與環境變數優先
//   port：連接埠｜lan：讓區網裝置連線｜proxy：本機 API 代理｜proxyPrivate：代理可不可以連到本機或區網位址（本機模型需要）
const SERVER = { port: 8787, lan: false, proxy: true, proxyPrivate: true, ...(readLocalConfig().server || {}) };
const PORT = +process.env.PORT || +SERVER.port || 8787;
const LAN = process.argv.includes('--lan') || SERVER.lan === true;
const OPEN = process.argv.includes('--open');
const URL_LOCAL = `http://127.0.0.1:${PORT}`;

function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${URL_LOCAL}"` : process.platform === 'darwin' ? `open "${URL_LOCAL}"` : `xdg-open "${URL_LOCAL}"`;
  exec(cmd, () => {});
}
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};
const HOP = ['host', 'origin', 'referer', 'cookie', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'];

/* ---------- 代理要連的位址 ---------- */
const bare = (h) => String(h || '').replace(/^\[|\]$/g, '').toLowerCase();
function isLoopbackIp(ip) {
  return /^127\./.test(ip) || ip === '::1' || /^::ffff:127\./.test(ip) || ip === '0.0.0.0' || ip === '::';
}
// 本機、區網、連結本地與電信級 NAT 位址
function isPrivateIp(ip) {
  if (/^::ffff:/.test(ip)) return isPrivateIp(ip.slice(7));
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return ip === '::1' || ip === '::' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}
function localIps() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) out.add(bare(a.address));
  return out;
}
// 不能用代理繞回這個伺服器自己（否則就能拿到 config.local.json 或借用 Vertex AI）；
// server.proxyPrivate 設為 false 時，也不能連到本機或區網的其他服務
function blockedTarget(ip, url) {
  const port = +url.port || (url.protocol === 'https:' ? 443 : 80);
  if (port === PORT && (isLoopbackIp(ip) || localIps().has(ip))) return '代理不能連到漫劇卡自己的伺服器';
  if (SERVER.proxyPrivate === false && isPrivateIp(ip)) return '代理不能連到本機或區網位址（config.local.json 的 server.proxyPrivate 是 false）';
  return '';
}
// 網址是主機名稱時，在真正連線前檢查查到的位址（避免查詢後才換成本機位址）
const guardedLookup = (url) => (hostname, opts, cb) => {
  dns.lookup(hostname, opts, (err, address, family) => {
    if (err) return cb(err);
    for (const a of Array.isArray(address) ? address : [{ address }]) {
      const why = blockedTarget(bare(a.address), url);
      if (why) return cb(Object.assign(new Error(why), { code: 'EBLOCKED' }));
    }
    cb(null, address, family);
  });
};

function proxy(req, res, target) {
  let url;
  try { url = new URL(target); } catch (e) { url = null; }
  if (!url || !/^https?:$/.test(url.protocol)) return sendJson(res, 400, { error: { message: '代理需要有效的 http(s) 網址' } });
  // 網址直接寫 IP 時不會經過查詢，先檢查一次
  const host = bare(url.hostname);
  const why = net.isIP(host) ? blockedTarget(host, url) : '';
  if (why) return sendJson(res, 403, { error: { message: why } });
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.includes(k)) headers[k] = v;
  const mod = url.protocol === 'https:' ? https : http;
  const preq = mod.request(url, { method: req.method, headers, lookup: guardedLookup(url) }, (pres) => {
    // 只給這個程式自己的網頁用（同一個來源），不需要也不允許跨來源讀取
    const h = { ...pres.headers, 'cache-control': 'no-store' };
    delete h['access-control-allow-origin'];
    delete h['access-control-allow-credentials'];
    res.writeHead(pres.statusCode || 502, h);
    pres.pipe(res);
  });
  preq.setTimeout(10 * 60 * 1000);
  preq.on('error', (e) => {
    if (res.headersSent) return res.end();
    sendJson(res, e.code === 'EBLOCKED' ? 403 : 502, { error: { message: e.code === 'EBLOCKED' ? e.message : '代理連線失敗：' + e.message } });
  });
  req.on('aborted', () => preq.destroy());
  req.pipe(preq);
}

function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  const rel = path.relative(ROOT, file);
  const ext = path.extname(file).toLowerCase();
  // 只提供網頁需要的檔案類型；設定檔與金鑰（.json、keys／private 資料夾）、腳本、隱藏檔一律不提供
  if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])\./.test(rel) || /^(keys|private|node_modules)([\\/]|$)/i.test(rel) || !MIME[ext] || ext === '.json') {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const isLoopback = (req) => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// 只接受這個程式自己的網頁發出的請求：擋掉其他網站（跨來源）與 DNS rebinding，避免別人用掉你的金鑰或額度
function fromOwnPage(req) {
  // 瀏覽器會標明請求從哪裡來：別的網站嵌進來的請求（圖片、表單、跨站 fetch）一律不接受
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const m = String(req.headers.host || '').toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!m || (m[2] || '80') !== String(PORT)) return false;
  const names = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (LAN) {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' || a.family === 4) names.add(a.address);
    }
  }
  if (!names.has(m[1])) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host.toLowerCase() === req.headers.host.toLowerCase(); } catch (e) { return false; }
}

// config.local.json 可能含 API 金鑰：本機拿完整內容，區網裝置（手機）拿去掉金鑰與本機路徑的版本
function stripSecrets(o) {
  if (!o || typeof o !== 'object') return o;
  for (const k of Object.keys(o)) {
    if (/^(apiKey|saved|keyFile|vertex)$/.test(k)) delete o[k];
    else stripSecrets(o[k]);
  }
  return o;
}

function serveLocalConfig(req, res) {
  if (!fromOwnPage(req)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(ROOT, 'config.local.json'), 'utf8', (err, text) => {
    if (err) { res.writeHead(404); return res.end(); }
    if (!isLoopback(req)) {
      try { text = JSON.stringify(stripSecrets(JSON.parse(text))); } catch (e) { res.writeHead(404); return res.end(); }
    }
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    res.end(text);
  });
}

/* ---------- Vertex AI（Google Cloud 服務帳戶金鑰） ---------- */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
let tokenCache = null;

function credType(file) {
  try {
    const t = JSON.parse(fs.readFileSync(file, 'utf8')).type;
    return t === 'service_account' || t === 'authorized_user' ? t : '';
  } catch (e) { return ''; }
}

// 金鑰檔：config.local.json 的 vertex.keyFile → 環境變數 GOOGLE_APPLICATION_CREDENTIALS → 本程式 keys 資料夾裡最新的服務帳戶金鑰
// （只看 keys 資料夾，不會去翻這台電腦的其他地方）
let found = { at: 0, file: null };
function findKeyFile() {
  const v = readLocalConfig().vertex || {};
  if (v.keyFile) return path.resolve(ROOT, v.keyFile);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  // 掃描結果記一分鐘，不用每個請求都翻一次資料夾
  if (found.file && Date.now() - found.at < 60000 && fs.existsSync(found.file)) return found.file;
  let best = null;
  let names = [];
  try { names = fs.readdirSync(KEY_DIR); } catch (e) { names = []; }
  for (const n of names) {
    if (!/\.json$/i.test(n)) continue;
    const f = path.join(KEY_DIR, n);
    let st;
    try { st = fs.statSync(f); } catch (e) { continue; }
    const t = st.birthtimeMs || st.mtimeMs;
    if (!st.isFile() || st.size > 64 * 1024 || (best && t <= best.t)) continue;
    if (credType(f)) best = { f, t };
  }
  found = { at: Date.now(), file: best && best.f };
  return found.file;
}

const b64url = (v) => Buffer.from(v).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const setupError = (message) => Object.assign(new Error(message), { setup: true });

function postForm(target, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const r = https.request(target, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.setTimeout(30000, () => r.destroy(new Error('連線逾時')));
    r.on('error', reject);
    r.end(body);
  });
}

// 用金鑰換一小時有效的存取權杖，快取到快過期再換
async function vertexAuth() {
  const file = findKeyFile();
  if (!file) throw setupError('找不到 Google Cloud 服務帳戶金鑰（.json）：請放進本程式的 keys 資料夾，或在 config.local.json 的 vertex.keyFile 填入路徑。');
  let cred;
  try { cred = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw setupError('讀不到金鑰檔，或不是有效的 JSON：' + path.basename(file)); }
  const project = (readLocalConfig().vertex || {}).project || cred.project_id || cred.quota_project_id;
  if (!project) throw setupError('不知道要用哪個 Google Cloud 專案：請在 config.local.json 的 vertex.project 填入專案 ID。');
  const key = [file, fs.statSync(file).mtimeMs, project].join('|');
  const now = Date.now();
  if (tokenCache && tokenCache.key === key && tokenCache.exp - 120000 > now) return tokenCache;
  let form;
  if (cred.type === 'service_account') {
    const iat = Math.floor(now / 1000);
    const enc = (o) => b64url(JSON.stringify(o));
    const unsigned = enc({ alg: 'RS256', typ: 'JWT', kid: cred.private_key_id }) + '.' +
      enc({ iss: cred.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: cred.token_uri || TOKEN_URL, iat, exp: iat + 3600 });
    let sig;
    try { sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(cred.private_key); } catch (e) { throw setupError('金鑰檔裡的私鑰無法使用：' + e.message); }
    form = { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(sig) };
  } else if (cred.type === 'authorized_user') {
    form = { grant_type: 'refresh_token', client_id: cred.client_id, client_secret: cred.client_secret, refresh_token: cred.refresh_token };
  } else {
    throw setupError('這個 .json 不是服務帳戶金鑰（type 應為 service_account）：' + path.basename(file));
  }
  const r = await postForm(cred.token_uri || TOKEN_URL, form);
  if (!r.json || !r.json.access_token) throw setupError('Google 拒絕了這把金鑰：' + ((r.json && (r.json.error_description || r.json.error)) || 'HTTP ' + r.status));
  tokenCache = { key, token: r.json.access_token, exp: now + (+r.json.expires_in || 3600) * 1000, project, file };
  return tokenCache;
}

// 地區 → 端點：global 用 aiplatform.googleapis.com；us／eu 是多區域端點；其他是單一區域（例如 us-central1）
function vertexHost(loc) {
  if (loc === 'global') return 'aiplatform.googleapis.com';
  if (loc === 'us' || loc === 'eu') return `aiplatform.${loc}.rep.googleapis.com`;
  return `${loc}-aiplatform.googleapis.com`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 50 * 1024 * 1024) { reject(new Error('請求內容太大')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function vertex(req, res, u) {
  if (u.pathname === '/vertex/status') {
    try {
      const a = await vertexAuth();
      return sendJson(res, 200, { ok: true, project: a.project, file: path.basename(a.file) });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: e.message });
    }
  }
  const m = u.pathname.match(/^\/vertex\/([a-z0-9-]+)\/models(?:\/([\w.@-]+):(generateContent|streamGenerateContent|countTokens))?$/);
  if (!m) return sendJson(res, 404, { error: { code: 404, message: '未知的 Vertex AI 路徑' } });
  const [, loc, model, method] = m;
  if (model && req.method !== 'POST') return sendJson(res, 405, { error: { code: 405, message: '需要 POST' } });
  let auth;
  let body = null;
  try {
    if (model) body = await readBody(req);
    auth = await vertexAuth();
  } catch (e) {
    return sendJson(res, 500, { error: { code: 500, message: e.message, status: 'VERTEX_SETUP' } });
  }
  const base = `https://${vertexHost(loc)}/v1beta1`;
  const target = model
    ? `${base}/projects/${encodeURIComponent(auth.project)}/locations/${loc}/publishers/google/models/${model}:${method}${u.search}`
    : `${base}/publishers/google/models?pageSize=300&listAllVersions=true`;
  const headers = { authorization: 'Bearer ' + auth.token };
  if (body) Object.assign(headers, { 'content-type': 'application/json', 'content-length': body.length });
  else headers['x-goog-user-project'] = auth.project;
  const preq = https.request(target, { method: model ? 'POST' : 'GET', headers }, (pres) => {
    res.writeHead(pres.statusCode || 502, { 'content-type': pres.headers['content-type'] || MIME['.json'], 'cache-control': 'no-store' });
    pres.pipe(res);
  });
  preq.setTimeout(10 * 60 * 1000);
  preq.on('error', (e) => {
    if (res.headersSent) return res.end();
    sendJson(res, 502, { error: { code: 502, message: '連不到 Vertex AI：' + e.message } });
  });
  res.on('close', () => { if (!res.writableEnded) preq.destroy(); });
  preq.end(body || undefined);
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
  const own = () => fromOwnPage(req) || (sendJson(res, 403, { error: { code: 403, message: '只接受漫劇卡自己網頁的請求' } }), false);
  // 關掉代理時連 ping 也不回應，網頁就會改成直接連線
  if (u.pathname === '/proxy/ping') {
    if (SERVER.proxy === false) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('tavern-toon-proxy vertex');
  }
  if (u.pathname === '/config.local.json') return serveLocalConfig(req, res);
  if (u.pathname.startsWith('/vertex/')) {
    if (!own()) return;
    return vertex(req, res, u).catch((e) => { if (!res.headersSent) sendJson(res, 500, { error: { code: 500, message: e.message } }); });
  }
  if (u.pathname === '/proxy') {
    if (SERVER.proxy === false) return sendJson(res, 404, { error: { message: '本機代理已關閉（config.local.json 的 server.proxy）' } });
    if (!own()) return;
    return proxy(req, res, u.searchParams.get('url'));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, u.pathname);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // 已經有一個在執行：直接打開瀏覽器就好
    console.log(`\n  連接埠 ${PORT} 已在使用中（漫劇卡可能已經開著），直接開啟：${URL_LOCAL}\n`);
    if (OPEN) openBrowser();
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  漫劇卡已啟動：${URL_LOCAL}`);
  if (LAN) {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  手機（同一個 Wi-Fi）：http://${a.address}:${PORT}`);
    }
    console.log('  注意：同一個網路的裝置都能透過這台電腦使用你的 API 代理與 Vertex AI 額度。');
  }
  if (SERVER.proxy === false) console.log('  本機 API 代理：已關閉（config.local.json 的 server.proxy）');
  const key = findKeyFile();
  console.log(key ? `  Vertex AI 金鑰：${path.basename(key)}` : '  Vertex AI：沒找到 Google Cloud 金鑰（放進 keys 資料夾；不用 Vertex AI 可以忽略）');
  console.log('  使用期間請保持這個視窗開著，關掉視窗就會停止。\n');
  if (OPEN) openBrowser();
});
