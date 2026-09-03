#!/usr/bin/env node
/**
 * Local Guzo site + API (OpenRouter, in-memory sessions).
 *
 * Serves the static site from the repo root and /guzo/* API routes.
 * Loads OPENROUTER_API_KEY / GUZO_MODEL from infrastructure/.env (gitignored).
 *
 * Usage: node scripts/guzo-local-server.mjs
 * Open:  http://localhost:8787/
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChatStream } from '../infrastructure/lambda/guzo-chat-handler/lib/chat.js';
import {
    handleSession,
    handleSessionGet,
    handleHealth,
    handleCatalogSearch,
    handleCatalogProduct,
    handleItineraryPost,
    handleItineraryGet,
    corsOrigin,
} from '../infrastructure/lambda/guzo-chat-handler/lib/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_PATH = join(ROOT, 'infrastructure/.env');
const PORT = Number(process.env.PORT || 8787);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
};

function loadEnvFile(path) {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

loadEnvFile(ENV_PATH);

process.env.GUZO_MODEL = process.env.GUZO_MODEL || 'openai/gpt-5.6-luna';
process.env.CORS_ALLOW_ORIGINS = process.env.CORS_ALLOW_ORIGINS
    || [
        `http://localhost:${PORT}`,
        `http://127.0.0.1:${PORT}`,
        'http://localhost:3456',
        'http://localhost:5500',
        'http://localhost:3000',
        'http://127.0.0.1:3456',
        'http://127.0.0.1:5500',
        'http://127.0.0.1:3000',
        'null',
    ].join(',');

if (!process.env.OPENROUTER_API_KEY) {
    console.error(`Missing OPENROUTER_API_KEY. Add it to ${ENV_PATH}`);
    process.exit(1);
}

function toEvent(req, url, bodyText) {
    return {
        rawPath: url.pathname,
        path: url.pathname,
        httpMethod: req.method,
        requestContext: { http: { method: req.method, path: url.pathname } },
        headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
        ),
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        body: bodyText,
    };
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

function corsHeaders(event, extra = {}) {
    return {
        'Access-Control-Allow-Origin': corsOrigin(event),
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '600',
        ...extra,
    };
}

function sendJson(res, event, result) {
    const headers = {
        ...corsHeaders(event),
        ...(result.headers || {}),
        'Content-Type': result.headers?.['Content-Type'] || 'application/json; charset=utf-8',
    };
    res.writeHead(result.statusCode || 200, headers);
    res.end(result.body ?? '');
}

function resolveStaticPath(urlPath) {
    let rel = decodeURIComponent(urlPath.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const cleaned = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = join(ROOT, cleaned);
    if (!full.startsWith(ROOT + sep) && full !== ROOT) return null;
    return full;
}

function serveStatic(req, res, urlPath) {
    const full = resolveStaticPath(urlPath);
    if (!full || !existsSync(full) || !statSync(full).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
    }
    const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(readFileSync(full));
}

function logApi(method, path, detail = '') {
    const stamp = new Date().toISOString().slice(11, 23);
    console.log(`[${stamp}] ${method} ${path}${detail ? ` ${detail}` : ''}`);
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    let bodyText = '';

    try {
        if (req.method === 'OPTIONS') {
            const event = toEvent(req, url, '');
            res.writeHead(204, corsHeaders(event));
            res.end();
            return;
        }

        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            bodyText = await readBody(req);
        }

        const event = toEvent(req, url, bodyText);

        // API routes only — static frontend lives under /guzo/*.js as well
        if (path === '/guzo/health' && req.method === 'GET') {
            logApi(req.method, path);
            return sendJson(res, event, handleHealth(event));
        }
        if (path === '/guzo/session' && req.method === 'GET') {
            const sid = url.searchParams.get('sessionId') || '';
            const result = await handleSessionGet(event);
            logApi(req.method, path, `sessionId=${sid || '?'} status=${result.statusCode || 200}`);
            return sendJson(res, event, result);
        }
        if (path === '/guzo/session' && req.method === 'POST') {
            let sid = '';
            try { sid = JSON.parse(bodyText || '{}').sessionId || ''; } catch { /* ignore */ }
            logApi(req.method, path, `sessionId=${sid || 'new'}`);
            return sendJson(res, event, await handleSession(event));
        }
        if (path === '/guzo/catalog/search' && req.method === 'GET') {
            logApi(req.method, path, url.search || '');
            return sendJson(res, event, await handleCatalogSearch(event));
        }
        if (path.startsWith('/guzo/catalog/product') && req.method === 'GET') {
            logApi(req.method, path, url.search || '');
            return sendJson(res, event, await handleCatalogProduct(event));
        }
        if (path === '/guzo/itinerary' && req.method === 'POST') {
            logApi(req.method, path);
            return sendJson(res, event, await handleItineraryPost(event));
        }
        if (path === '/guzo/itinerary' && req.method === 'GET') {
            logApi(req.method, path, url.search || '');
            return sendJson(res, event, await handleItineraryGet(event));
        }
        if (path === '/guzo/chat' && req.method === 'POST') {
            const body = bodyText ? JSON.parse(bodyText) : {};
            const preview = String(body.message || '').replace(/\s+/g, ' ').slice(0, 80);
            logApi(req.method, path, `sessionId=${body.sessionId || '?'} msg="${preview}"`);
            res.writeHead(200, corsHeaders(event, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
            }));
            const stream = {
                write(chunk) {
                    res.write(chunk);
                },
                end() {
                    res.end();
                },
            };
            try {
                await handleChatStream(body, stream);
            } catch (chatErr) {
                console.error(`[chat] sessionId=${body.sessionId || '?'}`, chatErr);
                throw chatErr;
            }
            if (!res.writableEnded) res.end();
            logApi('DONE', path, `sessionId=${body.sessionId || '?'}`);
            return;
        }

        if (req.method === 'GET' || req.method === 'HEAD') {
            return serveStatic(req, res, path);
        }

        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
    } catch (err) {
        console.error(err);
        // Chat SSE writes headers before streaming; don't crash on late failures.
        if (res.headersSent) {
            if (!res.writableEnded) res.end();
            return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message || 'Server error' }));
    }
});

// Export corsOrigin from routes — ensure it's exported
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Guzo local site + API: http://localhost:${PORT}/`);
    console.log(`Model: ${process.env.GUZO_MODEL}`);
    console.log('Health: GET /guzo/health');
});
