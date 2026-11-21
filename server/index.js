// Point d'entrée : serveur HTTP (fichiers statiques) + WebSocket (jeu temps réel).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { Game } from './game.js';
import { createProviders } from './payments/providers.js';
import { PaymentService } from './payments/service.js';
import { receiptPage, sandboxPage } from './payments/pages.js';
import { createSmsProvider } from './auth/sms.js';
import { OtpService } from './auth/otp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'db.json');
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const MERCHANT = {
  name: process.env.MERCHANT_NAME || 'Terra Vida',
  address: process.env.MERCHANT_ADDRESS || '',
  taxId: process.env.MERCHANT_TAX_ID || '', // ex. IFU au Bénin
  support: process.env.MERCHANT_SUPPORT || 'support via le chat du jeu',
  terms: process.env.MERCHANT_TERMS_URL || '',
  timezone: process.env.MERCHANT_TZ || 'Africa/Porto-Novo',
};

// Préfixe d'URL -> dossier servi
const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function resolveStatic(urlPath) {
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
    const file = path.resolve(dir, rel);
    // Empêche la traversée de répertoires (../)
    if (file !== dir && !file.startsWith(dir + path.sep)) return null;
    return file;
  }
  return null;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Corps trop volumineux'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = req.headers['content-type'] ?? '';
      try {
        resolve(type.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw)));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const html = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }).end(body);

/** Extrait la référence de transaction d'un webhook, propre à chaque prestataire. */
const WEBHOOK_REF = {
  fedapay: (b) => b?.entity?.id,
  wave: (b) => b?.data?.id,
  cinetpay: (b) => b?.cpm_trans_id,
  paypal: (b) => b?.resource?.supplementary_data?.related_ids?.order_id ?? b?.resource?.id,
};

async function handlePayments(req, res, url) {
  const [, , action, id, pathKey] = url.pathname.split('/'); // /pay/<action>/<id>[/<clé>]
  const key = pathKey ?? url.searchParams.get('k');
  if (url.pathname.startsWith('/receipt/')) {
    const order = store.getOrder(url.pathname.split('/')[2]);
    if (!payments.checkKey(order, key)) return html(res, 404, 'Reçu introuvable.');
    return html(res, 200, receiptPage(order, MERCHANT));
  }
  if (action === 'return' && req.method === 'GET') {
    const order = store.getOrder(id);
    if (!payments.checkKey(order, key)) return html(res, 404, 'Commande introuvable.');
    await payments.confirm(order.id);
    res.writeHead(302, { location: `/receipt/${order.id}?k=${order.receiptKey}` }).end();
    return;
  }
  if (action === 'webhook' && req.method === 'POST' && WEBHOOK_REF[id]) {
    const body = await readBody(req);
    const ref = WEBHOOK_REF[id](body);
    const order = ref != null ? payments.findByProviderRef(id, ref) : null;
    if (order) await payments.confirm(order.id); // revérifié auprès de l'API, jamais cru sur parole
    res.writeHead(200).end('ok');
    return;
  }
  if (action === 'sandbox' && providers.sandbox.enabled) {
    const order = store.getOrder(id);
    if (!payments.checkKey(order, key) || order.provider !== 'sandbox') return html(res, 404, 'Commande introuvable.');
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.action === 'pay') providers.sandbox.markPaid(order.id);
      else if (order.status === 'pending') {
        order.status = 'failed';
        store.save();
      }
      res.writeHead(303, { location: `/pay/return/${order.id}/${order.receiptKey}` }).end();
      return;
    }
    return html(res, 200, sandboxPage(order));
  }
  return html(res, 404, 'Introuvable.');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/pay/') || url.pathname.startsWith('/receipt/')) {
    handlePayments(req, res, url).catch((err) => {
      console.error('[pay] Erreur HTTP :', err);
      if (!res.headersSent) html(res, 500, 'Erreur serveur.');
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, players: game.clients.size }));
    return;
  }
  let file;
  try {
    file = resolveStatic(url.pathname);
  } catch {
    file = null; // URL mal encodée
  }
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': file.includes('node_modules') ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
});

const store = new Store(DATA_FILE);
const providers = createProviders(process.env);
let game;
const payments = new PaymentService(store, providers, { publicUrl: PUBLIC_URL, onPaid: (order) => game.notifyPaid(order) });
const sms = createSmsProvider(process.env);
const otp = new OtpService(sms);
console.log(`Connexion par SMS : ${sms ? sms.label : 'désactivée (configure un fournisseur SMS, voir README)'}`);
game = new Game(store, { payments, otp, adminPhones: process.env.ADMIN_PHONES ?? '' });
console.log(`Administrateurs : ${game.adminPhones.size} numéro(s) dans ADMIN_PHONES`);
const active = Object.values(providers).filter((p) => p.enabled).map((p) => p.label);
console.log(`Paiements actifs : ${active.length ? active.join(', ') : 'aucun (configure les clés, voir README)'}`);
if (providers.sandbox.enabled) console.warn('⚠️  Mode PAYMENTS_SANDBOX actif : paiements simulés, à ne jamais utiliser en production.');
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  // Derrière un proxy (Nginx, Render, Railway…), l'IP réelle est dans X-Forwarded-For
  const fwd = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  const client = game.connect(ws, { ip: fwd || req.socket.remoteAddress });
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data, isBinary) => {
    if (!isBinary) game.handleRaw(client, data.toString());
  });
  ws.on('close', () => game.disconnect(client));
  ws.on('error', () => game.disconnect(client));
});

// Détection des connexions mortes
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => console.log(`Terra Vida en ligne : http://localhost:${PORT}`));

function shutdown() {
  console.log('Arrêt… sauvegarde des données.');
  clearInterval(heartbeat);
  game.stop();
  store.flush();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
