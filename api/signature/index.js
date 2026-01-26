/*
  signature proxy
  - Forwards browser requests to an upstream signature background-removal API.
  - Keeps upstream URL / API key out of the client.
  - Provides an optional /batch_zip endpoint for the demo UI.

  Required app settings (Azure SWA -> Application settings OR Function App settings):
  - SIGNATURE_API_BASE_URL        e.g. https://sigrbg-api.yourdomain

  Optional:
  - SIGNATURE_API_KEY_HEADER      e.g. x-api-key (default: x-api-key)
  - SIGNATURE_API_KEY             secret value
  - SIGNATURE_RATE_LIMIT_PER_MINUTE   default 30
  - SIGNATURE_RATE_LIMIT_PER_DAY      default 200

  Notes:
  - This function intentionally strips any client-supplied auth headers.
*/

'use strict';


const minuteState = new Map();
const dayState = new Map();

function isAllowedPath(path) {
  const p = String(path || '').replace(/^\/+/, '');

  // Upstream API endpoints
  if (p === 'api/health' || p === 'api/options' || p === 'api/process' || p === 'api/batch') return true;

  // Demo helper endpoint (implemented here)
  if (p === 'batch_zip') return true;

  return false;
}

function estimateCost(path) {
  const p = String(path || '').toLowerCase();
  if (p === 'api/health' || p === 'api/options') return 0;
  if (p === 'api/batch' || p === 'batch_zip') return 3;
  return 1;
}

function getFirstIp(xff) {
  if (!xff) return null;
  const first = String(xff).split(',')[0].trim();
  return first || null;
}

function getClientIp(req) {
  const h = (req && req.headers) || {};
  return (
    getFirstIp(h['x-forwarded-for']) ||
    getFirstIp(h['X-Forwarded-For']) ||
    h['x-client-ip'] ||
    h['X-Client-IP'] ||
    'unknown'
  );
}

function getInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function utcDayKey(d) {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function allowRequest(ip, cost) {
  const now = Date.now();
  const minuteLimit = getInt(process.env.SIGNATURE_RATE_LIMIT_PER_MINUTE, 30);
  const dayLimit = getInt(process.env.SIGNATURE_RATE_LIMIT_PER_DAY, 200);
  const c = getInt(cost, 1);

  const minuteBucket = Math.floor(now / 60000);
  const minuteKey = `${ip}|${minuteBucket}`;
  const minuteCount = (minuteState.get(minuteKey) || 0) + c;
  minuteState.set(minuteKey, minuteCount);

  if (minuteState.size > 5000) {
    for (const k of minuteState.keys()) {
      const parts = k.split('|');
      const bucket = Number(parts[1]);
      if (Number.isFinite(bucket) && bucket < minuteBucket - 2) minuteState.delete(k);
    }
  }

  const dayBucket = utcDayKey(new Date(now));
  const dayKey = `${ip}|${dayBucket}`;
  const dayCount = (dayState.get(dayKey) || 0) + c;
  dayState.set(dayKey, dayCount);

  if (dayState.size > 10000) {
    for (const k of dayState.keys()) {
      if (!k.endsWith(dayBucket)) dayState.delete(k);
    }
  }

  return {
    ok: minuteCount <= minuteLimit && dayCount <= dayLimit,
    minuteLimit,
    dayLimit,
    minuteCount,
    dayCount
  };
}

function json(status, obj, extraHeaders) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(extraHeaders || {})
    },
    body: JSON.stringify(obj)
  };
}

function sanitizeBase64(b64) {
  if (!b64) return null;
  const s = String(b64);
  const comma = s.indexOf(',');
  if (comma >= 0 && s.slice(0, comma).toLowerCase().includes('base64')) {
    return s.slice(comma + 1);
  }
  return s;
}

function guessExtFromBase64(b64) {
  const s = sanitizeBase64(b64);
  if (!s) return 'png';
  // TIFF magic bytes: II* or MM*
  const head = s.slice(0, 16);
  if (head.startsWith('SUkq') || head.startsWith('TU0q')) return 'tiff';
  return 'png';
}

function extractBatchItems(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.outputs)) return data.outputs;
  if (data.result && Array.isArray(data.result)) return data.result;
  if (data.result && Array.isArray(data.result.items)) return data.result.items;
  return [];
}

function extractImageBase64(item) {
  if (!item) return null;
  if (typeof item === 'string') return item;

  const candidates = [
    item.processed_image,
    item.image_base64,
    item.base64,
    item.b64,
    item.output,
    item.result && item.result.processed_image,
    item.result && item.result.image_base64
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c;
  }
  return null;
}

function extractFilename(item, idx) {
  const base = item && (item.filename || item.file_name || item.name || item.original_filename || item.original_name);
  if (base && typeof base === 'string') return base;
  return `signature_${String(idx + 1).padStart(2, '0')}.png`;
}

async function handleBatchZip(context, req, upstreamBase, headers, rl) {
  let JSZip;
  try {
    JSZip = require('jszip');
  } catch (e) {
    return json(500, {
      message: 'Server missing dependency for batch zip (jszip).',
      hint: 'Ensure the api build installs dependencies (npm install) before deployment.'
    });
  }

  // Preserve query string
  let search = '';
  try {
    const u = new URL(req.url);
    search = u.search || '';
  } catch (e) {}

  const targetUrl = `${upstreamBase}/api/batch${search}`;

  const init = {
    method: 'POST',
    headers,
    body: req.body
  };

  const resp = await fetch(targetUrl, init);
  const text = await resp.text();

  if (!resp.ok) {
    return json(resp.status, {
      message: 'Upstream batch failed.',
      upstreamStatus: resp.status,
      upstreamBody: text.slice(0, 2000)
    }, {
      'cache-control': 'no-store',
      'x-ratelimit-limit-minute': String(rl.minuteLimit),
      'x-ratelimit-limit-day': String(rl.dayLimit)
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return json(502, {
      message: 'Upstream returned non-JSON for batch.',
      sample: text.slice(0, 2000)
    });
  }

  const items = extractBatchItems(data);
  if (!items.length) {
    return json(502, {
      message: 'Unexpected batch response shape (no items found).'
    });
  }

  const zip = new JSZip();

  let added = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const b64 = extractImageBase64(it);
    if (!b64) continue;

    const cleaned = sanitizeBase64(b64);
    const ext = guessExtFromBase64(cleaned);

    let name = extractFilename(it, i);
    name = String(name).replace(/\\/g, '/').split('/').pop();
    name = name.replace(/\.[^.]+$/, '') + '.' + ext;

    zip.file(name, cleaned, { base64: true });
    added++;
  }

  if (!added) {
    return json(502, {
      message: 'Batch response did not contain any base64 images.'
    });
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  return {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="signature_outputs.zip"',
      'cache-control': 'no-store',
      'x-ratelimit-limit-minute': String(rl.minuteLimit),
      'x-ratelimit-limit-day': String(rl.dayLimit)
    },
    body: buf
  };
}

module.exports = async function (context, req) {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization,x-requested-with',
        'access-control-max-age': '600'
      }
    };
    return;
  }

  const upstreamBase = (process.env.SIGNATURE_API_BASE_URL || '').replace(/\/+$/, '');
  if (!upstreamBase) {
    context.res = json(500, {
      message: 'Server not configured. Missing SIGNATURE_API_BASE_URL.'
    });
    return;
  }

  const path = (context.bindingData && context.bindingData.path) ? String(context.bindingData.path) : '';

  if (!isAllowedPath(path)) {
    context.res = json(404, { message: 'Not found.' });
    return;
  }

  const cost = estimateCost(path);
  const ip = getClientIp(req);
  const rl = allowRequest(ip, cost);
  if (!rl.ok) {
    context.res = json(429, {
      message: 'Rate limit exceeded. Please try later or contact us for higher limits.'
    }, {
      'retry-after': '60',
      'x-ratelimit-limit-minute': String(rl.minuteLimit),
      'x-ratelimit-limit-day': String(rl.dayLimit)
    });
    return;
  }

  // Preserve query string
  let search = '';
  try {
    const u = new URL(req.url);
    search = u.search || '';
  } catch (e) {}

  // Forward headers (keep content-type for multipart)
  const incomingHeaders = req.headers || {};
  const headers = {};
  for (const [k, v] of Object.entries(incomingHeaders)) {
    const key = String(k).toLowerCase();
    if (key === 'host' || key === 'content-length') continue;
    if (key.startsWith('x-forwarded-')) continue;

    // Never accept client-supplied API keys
    if (key === 'authorization' || key === 'itsp' || key === 'x-api-key') continue;

    headers[key] = v;
  }

  // API key injection
  const apiKeyHeader = (process.env.SIGNATURE_API_KEY_HEADER || 'x-api-key').trim();
  const apiKey = (process.env.SIGNATURE_API_KEY || '').trim();
  if (apiKey) {
    const h = apiKeyHeader.toLowerCase();
    if (h === 'authorization') {
      headers[h] = apiKey.toLowerCase().startsWith('bearer ') ? apiKey : `Bearer ${apiKey}`;
    } else {
      headers[h] = apiKey;
    }
  }

  if (path === 'batch_zip') {
    try {
      context.res = await handleBatchZip(context, req, upstreamBase, headers, rl);
    } catch (e) {
      context.res = json(502, {
        message: 'Batch ZIP failed.',
        detail: e && e.message ? e.message : String(e)
      });
    }
    return;
  }

  const targetUrl = `${upstreamBase}/${path}${search}`;

  const init = {
    method,
    headers
  };

  if (method === 'POST') {
    init.body = req.body;
  }

  try {
    const resp = await fetch(targetUrl, init);

    const outHeaders = {
      'cache-control': 'no-store',
      'x-ratelimit-limit-minute': String(rl.minuteLimit),
      'x-ratelimit-limit-day': String(rl.dayLimit)
    };

    const contentType = resp.headers.get('content-type');
    if (contentType) outHeaders['content-type'] = contentType;

    const buf = Buffer.from(await resp.arrayBuffer());

    context.res = {
      status: resp.status,
      headers: outHeaders,
      body: buf
    };
  } catch (e) {
    context.res = json(502, {
      message: 'Upstream API unreachable.',
      detail: e && e.message ? e.message : String(e)
    });
  }
};
