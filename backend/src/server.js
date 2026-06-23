import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request } from 'undici';
import { query } from './db.js';
import {
  reloadNginx,
  renderAllRules,
  validateEndpoint,
  validatePort,
  writeCertificateFiles,
} from './nginx.js';

const app = express();
const upload = multer({ dest: path.join(os.tmpdir(), 'nginx-manager-uploads') });
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function rowToRule(row) {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    headers: row.headers || {},
    publicPort: row.public_port,
    mcpEnabled: row.mcp_enabled,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getEnabledRules() {
  const { rows } = await query('SELECT * FROM proxy_rules WHERE enabled = TRUE ORDER BY public_port ASC');
  return rows;
}

async function getActiveCertificate() {
  const { rows } = await query('SELECT * FROM certificates WHERE active = TRUE ORDER BY updated_at DESC LIMIT 1');
  return rows[0] || null;
}

async function applyNginxConfig() {
  const rules = await getEnabledRules();
  const certificate = await getActiveCertificate();
  await renderAllRules(rules, certificate);
  await reloadNginx();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/rules', asyncRoute(async (_req, res) => {
  const { rows } = await query('SELECT * FROM proxy_rules WHERE enabled = TRUE ORDER BY public_port ASC');
  res.json({ rules: rows.map(rowToRule) });
}));

app.post('/api/rules', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim() || 'Untitled rule';
  const endpoint = String(req.body.endpoint || '').trim();
  const headers = req.body.headers && typeof req.body.headers === 'object' ? req.body.headers : {};
  const publicPort = validatePort(req.body.publicPort);
  const mcpEnabled = Boolean(req.body.mcpEnabled);

  validateEndpoint(endpoint);

  const { rows } = await query(
    `INSERT INTO proxy_rules (name, endpoint, headers, public_port, mcp_enabled)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (public_port)
     DO UPDATE SET name = EXCLUDED.name,
                   endpoint = EXCLUDED.endpoint,
                   headers = EXCLUDED.headers,
                   mcp_enabled = EXCLUDED.mcp_enabled,
                   enabled = TRUE,
                   updated_at = NOW()
     RETURNING *`,
    [name, endpoint, JSON.stringify(headers), publicPort, mcpEnabled]
  );

  await applyNginxConfig();
  res.status(201).json({ rule: rowToRule(rows[0]), message: 'Rule saved and Nginx reloaded.' });
}));

app.delete('/api/rules/:id', asyncRoute(async (req, res) => {
  await query('UPDATE proxy_rules SET enabled = FALSE, updated_at = NOW() WHERE id = $1', [req.params.id]);
  await applyNginxConfig();
  res.json({ message: 'Rule disabled and Nginx reloaded.' });
}));

app.post('/api/apply', asyncRoute(async (_req, res) => {
  await applyNginxConfig();
  res.json({ message: 'Nginx configuration regenerated and reloaded.' });
}));

app.post('/api/certificates', upload.fields([
  { name: 'certificate', maxCount: 1 },
  { name: 'privateKey', maxCount: 1 },
  { name: 'caBundle', maxCount: 1 },
]), asyncRoute(async (req, res) => {
  if (!req.files?.certificate?.[0] || !req.files?.privateKey?.[0]) {
    res.status(400).json({ error: 'certificate and privateKey files are required.' });
    return;
  }

  const stored = await writeCertificateFiles(req.files);
  await query('UPDATE certificates SET active = FALSE WHERE active = TRUE');
  const { rows } = await query(
    `INSERT INTO certificates
       (name, certificate_path, private_key_path, ca_bundle_path, fingerprint_sha256, active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING *`,
    [
      req.body.name || 'default',
      stored.certificatePath,
      stored.privateKeyPath,
      stored.caBundlePath,
      stored.fingerprint,
    ]
  );

  for (const file of Object.values(req.files).flat()) {
    await fs.rm(file.path, { force: true });
  }

  await applyNginxConfig();
  res.status(201).json({ certificate: rows[0], message: 'Certificate stored and Nginx reloaded.' });
}));

app.post('/mcp-proxy/:ruleId', asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM proxy_rules WHERE id = $1 AND enabled = TRUE AND mcp_enabled = TRUE', [req.params.ruleId]);
  const rule = rows[0];

  if (!rule) {
    res.status(404).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32004, message: 'MCP proxy rule not found.' } });
    return;
  }

  if (req.body?.method === 'tools/list') {
    res.json({
      jsonrpc: '2.0',
      id: req.body.id,
      result: {
        tools: [{
          name: 'http_request',
          description: `Forward an HTTP request to ${rule.endpoint}`,
          inputSchema: {
            type: 'object',
            properties: {
              method: { type: 'string', default: 'GET' },
              path: { type: 'string', default: '/' },
              headers: { type: 'object', additionalProperties: { type: 'string' } },
              body: {},
            },
          },
        }],
      },
    });
    return;
  }

  if (req.body?.method !== 'tools/call' || req.body?.params?.name !== 'http_request') {
    res.status(400).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32601, message: 'Unsupported MCP method.' } });
    return;
  }

  const args = req.body.params.arguments || {};
  const target = new URL(rule.endpoint);
  const requestPath = String(args.path || '/');
  target.pathname = `${target.pathname.replace(/\/$/, '')}/${requestPath.replace(/^\//, '')}`;

  const upstream = await request(target, {
    method: String(args.method || 'GET').toUpperCase(),
    headers: { ...(rule.headers || {}), ...(args.headers || {}) },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });
  const body = await upstream.body.text();

  res.json({
    jsonrpc: '2.0',
    id: req.body.id,
    result: {
      content: [{ type: 'text', text: body }],
      metadata: {
        status: upstream.statusCode,
        headers: upstream.headers,
        url: target.toString(),
      },
    },
  });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Unexpected error.' });
});

app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
