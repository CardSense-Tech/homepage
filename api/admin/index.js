/*
  Admin proxy
  - Proxies /api/v1/admin/* to the upstream API at BGREMOVER_API_BASE_URL
  - Preserves redirects + Set-Cookie for the login/session flow

  Required app settings (Azure SWA -> Application settings):
  - BGREMOVER_API_BASE_URL

  Notes:
  - The upstream admin endpoints should be secured (cookie session or ITSP-ADMIN).
  - This proxy does NOT inject admin keys.
*/

'use strict';

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

function normalizePath(p) {
  const s = String(p || '').replace(/^\/+/, '');
  if (!s) return '';
  if (s.includes('..')) return null;
  return s;
}

module.exports = async function (context, req) {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization,x-requested-with',
        'access-control-max-age': '600'
      }
    };
    return;
  }

  const upstreamBase = (process.env.BGREMOVER_API_BASE_URL || '').replace(/\/+$/, '');
  if (!upstreamBase) {
    context.res = json(500, { message: 'Server not configured. Missing BGREMOVER_API_BASE_URL.' });
    return;
  }

  const raw = (context.bindingData && context.bindingData.path) ? context.bindingData.path : '';
  const path = normalizePath(raw);
  if (path === null) {
    context.res = json(400, { message: 'Invalid path.' });
    return;
  }

  // Preserve query string
  let search = '';
  try {
    const u = new URL(req.url);
    search = u.search || '';
  } catch (e) {}

  const suffix = path ? `/${path}` : '';
  const targetUrl = `${upstreamBase}/api/v1/admin${suffix}${search}`;

  // Forward headers (keep cookies for session auth)
  const incomingHeaders = req.headers || {};
  const headers = {};
  for (const [k, v] of Object.entries(incomingHeaders)) {
    const key = String(k).toLowerCase();
    if (key === 'host' || key === 'content-length') continue;
    if (key.startsWith('x-forwarded-')) continue;
    headers[key] = v;
  }

  const init = {
    method,
    headers,
    redirect: 'manual'
  };

  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    if (typeof req.body !== 'undefined' && req.body !== null) {
      if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
        init.body = req.body;
      } else {
        // If the runtime parsed JSON, re-serialize.
        init.body = JSON.stringify(req.body);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
      }
    }
  }

  try {
    const resp = await fetch(targetUrl, init);

    const outHeaders = {
      'cache-control': 'no-store'
    };

    const contentType = resp.headers.get('content-type');
    if (contentType) outHeaders['content-type'] = contentType;

    const location = resp.headers.get('location');
    if (location) outHeaders['location'] = location;

    // Preserve session cookie from upstream login.
    const getSetCookie = resp.headers.getSetCookie;
    if (typeof getSetCookie === 'function') {
      const cookies = getSetCookie.call(resp.headers);
      if (cookies && cookies.length) outHeaders['set-cookie'] = cookies;
    } else {
      const sc = resp.headers.get('set-cookie');
      if (sc) outHeaders['set-cookie'] = sc;
    }

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
