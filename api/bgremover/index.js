/*
  bgremover proxy
  - Forwards browser requests to an upstream background-removal API.
  - Enforces basic rate limits.
  - Keeps upstream URL / API key out of the client.

  Required app settings (Azure SWA -> Application settings):
  - BGREMOVER_API_BASE_URL   e.g. https://your-api.example.com

  Optional:
  - BGREMOVER_API_KEY_HEADER e.g. x-api-key
  - BGREMOVER_API_KEY        secret value
  - RATE_LIMIT_PER_MINUTE    default 30
  - RATE_LIMIT_PER_DAY       default 200
*/

'use strict';

const minuteState = new Map();
const dayState = new Map();

function isAllowedPath(path) {
  const p = String(path || '').replace(/^\/+/, '');

  // Health endpoints (open)
  if (p === 'health' || p === 'health/' || p === 'health/live' || p === 'health/ready' || p === 'health/detailed') {
    return true;
  }

  // Demo-friendly endpoints
  if (p === 'process_sync' || p === 'batch_sync') return true;
  if (p.startsWith('status/')) return true;

  // Versioned API endpoints (processing routes)
  if (p === 'api/v1/process') return true;
  if (p.startsWith('api/v1/')) {
    // Never expose upstream admin routes via this public proxy.
    if (p.startsWith('api/v1/admin')) return false;
    return true;
  }

  return false;
}

function estimateCost(path) {
  const p = String(path || '').toLowerCase();
  if (p.startsWith('health')) return 0;
  if (p.startsWith('status/')) return 1;
  if (p.includes('batch')) return 3;
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
  const minuteLimit = getInt(process.env.RATE_LIMIT_PER_MINUTE, 30);
  const dayLimit = getInt(process.env.RATE_LIMIT_PER_DAY, 200);
  const c = getInt(cost, 1);

  // Fixed-minute window
  const minuteBucket = Math.floor(now / 60000);
  const minuteKey = `${ip}|${minuteBucket}`;
  const minuteCount = (minuteState.get(minuteKey) || 0) + c;
  minuteState.set(minuteKey, minuteCount);

  // Cleanup older minute buckets opportunistically
  if (minuteState.size > 5000) {
    for (const k of minuteState.keys()) {
      const parts = k.split('|');
      const bucket = Number(parts[1]);
      if (Number.isFinite(bucket) && bucket < minuteBucket - 2) minuteState.delete(k);
    }
  }

  // UTC-day window
  const dayBucket = utcDayKey(new Date(now));
  const dayKey = `${ip}|${dayBucket}`;
  const dayCount = (dayState.get(dayKey) || 0) + c;
  dayState.set(dayKey, dayCount);

  // Cleanup older days opportunistically
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

module.exports = async function (context, req) {
  const method = (req.method || 'GET').toUpperCase();

  // CORS preflight support (same-origin in prod, but keeps local dev smoother)
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

  const upstreamBase = (process.env.BGREMOVER_API_BASE_URL || '').replace(/\/+$/, '');
  if (!upstreamBase) {
    context.res = json(500, {
      message: 'Server not configured. Missing BGREMOVER_API_BASE_URL.'
    });
    return;
  }

  const path = (context.bindingData && context.bindingData.path) ? String(context.bindingData.path) : '';

  if (!isAllowedPath(path)) {
    context.res = json(404, {
      message: 'Not found.'
    });
    return;
  }

  // Rate limiting: estimate cost by endpoint
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
  } catch (e) {
    // ignore
  }

  const targetUrl = `${upstreamBase}/${path}${search}`;

  // Forward headers (keep content-type for multipart)
  const incomingHeaders = req.headers || {};
  const headers = {};
  for (const [k, v] of Object.entries(incomingHeaders)) {
    const key = String(k).toLowerCase();
    if (key === 'host' || key === 'content-length') continue;
    if (key.startsWith('x-forwarded-')) continue;
    // Never accept client-supplied API keys; proxy injects server-side secret if configured.
    if (key === 'authorization' || key === 'itsp' || key === 'x-api-key') continue;
    headers[key] = v;
  }

  // Optional API key injection
  const apiKeyHeader = (process.env.BGREMOVER_API_KEY_HEADER || '').trim();
  const apiKey = (process.env.BGREMOVER_API_KEY || '').trim();
  if (apiKeyHeader && apiKey) {
    const h = apiKeyHeader.toLowerCase();
    if (h === 'authorization') {
      headers[h] = apiKey.toLowerCase().startsWith('bearer ') ? apiKey : `Bearer ${apiKey}`;
    } else {
      headers[h] = apiKey;
    }
  }

  const init = {
    method,
    headers
  };

  // Forward body for POST
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
