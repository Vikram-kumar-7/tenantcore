'use strict';

// ─── Module path fix: resolve API deps before anything else ──────────────────
const path = require('path');
const Module = require('module');
const apiNodeModules = path.join(__dirname, '..', 'node_modules');
const rootNodeModules = path.join(__dirname, '..', '..', '..', 'node_modules');
Module.globalPaths.unshift(apiNodeModules, rootNodeModules);

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

process.env.NODE_ENV = 'test';
process.env.PORT = '3999';
process.env.MONGODB_MASTER_URI = 'mongodb://localhost:27017/tenantcore_test';
process.env.BCRYPT_ROUNDS = '4';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '1m';

const http = require('http');
const jwt  = require('jsonwebtoken');

// ─── Tiny test helpers ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`\x1b[32m✅\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`\x1b[31m❌\x1b[0m ${name}  \x1b[2m${err.message}\x1b[0m`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function req(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3999, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d), raw: d }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: d, raw: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ─── Shared test state ────────────────────────────────────────────────────────
const slug1 = `testcorp${Date.now()}`;
const slug2 = `othercorp${Date.now()}`;
let tok1, ref1, tenantId1, tok2;

// ─── Test cases ───────────────────────────────────────────────────────────────
async function runAll() {
  console.log('\n\x1b[1m═══════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m  TenantCore Integration Test Suite\x1b[0m');
  console.log('\x1b[1m═══════════════════════════════════════════════\x1b[0m\n');

  // ── 1. Health endpoints ───────────────────────────────────────────────────
  await test('GET /health → 200 + status ok', async () => {
    const r = await req('GET', '/health');
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.body.status === 'ok', `status=${r.body.status}`);
    assert(typeof r.body.uptime === 'number', 'missing uptime');
  });

  await test('GET /liveness → 200 + memoryUsage', async () => {
    const r = await req('GET', '/liveness');
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.body.status === 'alive', `status=${r.body.status}`);
    assert(r.body.memoryUsage?.heapUsed, 'missing heapUsed');
  });

  await test('GET /readiness → returns checks object', async () => {
    const r = await req('GET', '/readiness');
    assert([200, 503].includes(r.status), `Got ${r.status}`);
    assert('mongodb' in (r.body.checks || {}), 'missing mongodb check');
  });

  // ── 2. Signup / tenant provisioning ──────────────────────────────────────
  await test(`POST /auth/signup → 201 + tokens + tenant (${slug1})`, async () => {
    const r = await req('POST', '/api/v1/auth/signup', {
      email: `owner@${slug1}.com`, password: 'SecurePass@123',
      firstName: 'Alice', lastName: 'Smith',
      tenantName: 'Test Corp', tenantSlug: slug1,
    });
    assert(r.status === 201, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.accessToken, 'missing accessToken');
    assert(r.body.data?.tenant?.slug === slug1, `slug=${r.body.data?.tenant?.slug}`);
    tok1  = r.body.data.accessToken;
    ref1  = r.body.data.refreshToken;
    tenantId1 = r.body.data.tenant.id;
  });

  // ── 3. Login ──────────────────────────────────────────────────────────────
  await test('POST /auth/login → 200 + tokens', async () => {
    const r = await req('POST', '/api/v1/auth/login', {
      email: `owner@${slug1}.com`, password: 'SecurePass@123', tenantSlug: slug1,
    });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.accessToken, 'missing accessToken');
    tok1 = r.body.data.accessToken;
    ref1 = r.body.data.refreshToken;
  });

  // ── 4. Token refresh ──────────────────────────────────────────────────────
  await test('POST /auth/refresh → 200 + new token pair', async () => {
    const r = await req('POST', '/api/v1/auth/refresh', { refreshToken: ref1 });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.accessToken, 'missing new accessToken');
    tok1 = r.body.data.accessToken;
    ref1 = r.body.data.refreshToken;
  });

  // ── 5. Protected route with valid token → 200 ────────────────────────────
  await test('GET /auth/me with valid token → 200', async () => {
    const r = await req('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.user?.role === 'owner', `role=${r.body.data?.user?.role}`);
  });

  // ── 6. Expired token → 401 ────────────────────────────────────────────────
  await test('Expired token → 401', async () => {
    const expired = jwt.sign(
      { sub: 'x', tenantId: 'x', role: 'member', type: 'access', jti: 'exp' },
      'dev-access-secret-change-in-production',
      { expiresIn: '1ms', issuer: 'tenantcore' }
    );
    await new Promise(r => setTimeout(r, 10));
    const r = await req('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${expired}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 401, `Got ${r.status}`);
    assert(r.body.error?.code, 'missing error.code');
  });

  // ── 7. Wrong role → 403 ───────────────────────────────────────────────────
  await test('Non-super-admin hitting admin route → 403', async () => {
    const r = await req('GET', '/api/admin/tenants', null, {
      Authorization: `Bearer ${tok1}`,
    });
    assert(r.status === 403, `Got ${r.status}`);
  });

  // ── 8. Logout → token blacklisted ────────────────────────────────────────
  const tokToKill = tok1;
  await test('POST /auth/logout → 200', async () => {
    const r = await req('POST', '/api/v1/auth/logout', null, {
      Authorization: `Bearer ${tokToKill}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
  });

  await test('Blacklisted token → 401 on next request', async () => {
    const r = await req('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${tokToKill}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 401, `Got ${r.status}`);
  });

  // Re-login for further tests
  const relogin = await req('POST', '/api/v1/auth/login', {
    email: `owner@${slug1}.com`, password: 'SecurePass@123', tenantSlug: slug1,
  });
  tok1 = relogin.body.data?.accessToken;

  // ── 9. Two tenants — data isolation ──────────────────────────────────────
  await test(`Second tenant signup (${slug2})`, async () => {
    const r = await req('POST', '/api/v1/auth/signup', {
      email: `owner@${slug2}.com`, password: 'SecurePass@123',
      firstName: 'Bob', lastName: 'Jones',
      tenantName: 'Other Corp', tenantSlug: slug2,
    });
    assert(r.status === 201, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    tok2 = r.body.data.accessToken;
  });

  await test('Tenant-2 users list does NOT contain tenant-1 data', async () => {
    const r = await req('GET', '/api/v1/users', null, {
      Authorization: `Bearer ${tok2}`, 'X-Tenant-Slug': slug2,
    });
    assert(r.status === 200, `Got ${r.status}`);
    const emails = (r.body.data?.users || []).map(u => u.email);
    assert(!emails.some(e => e.includes(slug1)), `Cross-tenant leak: ${emails}`);
  });

  // ── 10. Rate limit headers ────────────────────────────────────────────────
  await test('API response includes X-RateLimit headers', async () => {
    const r = await req('GET', '/api/v1/users', null, {
      Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}`);
    // Headers present if Redis is up; degraded header present if Redis is down
    const hasRateLimit = r.headers['x-ratelimit-limit'] || r.headers['x-ratelimit-degraded'];
    assert(hasRateLimit, `Missing rate limit headers. Headers: ${JSON.stringify(r.headers)}`);
  });

  // ── 11. API Key creation + usage ─────────────────────────────────────────
  let apiKey;
  await test('POST /apikeys → 201 + rawKey (tc_live_ prefix)', async () => {
    const r = await req('POST', '/api/v1/apikeys', {
      name: 'CI Key', scopes: ['users:read'],
    }, { Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1 });
    assert(r.status === 201, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.rawKey?.startsWith('tc_live_'), `rawKey=${r.body.data?.rawKey}`);
    assert(r.body.data?.warning, 'missing one-time warning message');
    apiKey = r.body.data.rawKey;
  });

  await test('Request with API key → 200', async () => {
    const r = await req('GET', '/api/v1/users', null, {
      'X-API-Key': apiKey, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
  });

  // ── 12. File upload — pre-signed URL flow ─────────────────────────────────
  await test('POST /files/upload-url → 201 + fileId', async () => {
    const r = await req('POST', '/api/v1/files/upload-url', {
      filename: 'report.pdf', mimeType: 'application/pdf', size: 1024,
    }, { Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1 });
    assert(r.status === 201, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.fileId, 'missing fileId');
    console.log(`   \x1b[2m(uploadUrl ${r.body.data?.uploadUrl ? 'present' : 'absent — MinIO not running locally'})\x1b[0m`);
  });

  // ── 13. Roles ─────────────────────────────────────────────────────────────
  await test('GET /roles → system roles seeded (owner, admin, member, viewer)', async () => {
    const r = await req('GET', '/api/v1/roles', null, {
      Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    const names = (r.body.data?.roles || []).map(r => r.name);
    assert(names.includes('owner'), `System roles: ${names}`);
    assert(names.includes('member'), `Missing member: ${names}`);
  });

  await test('POST /roles → create custom role', async () => {
    const r = await req('POST', '/api/v1/roles', {
      name: `dev${Date.now()}`, displayName: 'Developer',
      permissions: ['users:read'],
    }, { Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1 });
    assert(r.status === 201, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.role?.isSystem === false, 'should not be system role');
  });

  // ── 14. Notifications ────────────────────────────────────────────────────
  await test('GET /notifications → 200 + unreadCount', async () => {
    const r = await req('GET', '/api/v1/notifications', null, {
      Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}`);
    assert(typeof r.body.data?.unreadCount === 'number', 'missing unreadCount');
  });

  // ── 15. Audit log query ───────────────────────────────────────────────────
  await test('GET /audit → 200 + logs array', async () => {
    const r = await req('GET', '/api/v1/audit', null, {
      Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(Array.isArray(r.body.data?.logs), 'logs not an array');
  });

  // ── 16. Quota ─────────────────────────────────────────────────────────────
  await test('GET /quota → 200 + usage metrics', async () => {
    const r = await req('GET', '/api/v1/quota', null, {
      Authorization: `Bearer ${tok1}`, 'X-Tenant-Slug': slug1,
    });
    assert(r.status === 200, `Got ${r.status}: ${JSON.stringify(r.body).slice(0,200)}`);
    assert(r.body.data?.quota?.plan, 'missing plan');
  });

  // ── 17. Prometheus metrics ────────────────────────────────────────────────
  await test('GET /metrics → Prometheus text format', async () => {
    const r = await req('GET', '/metrics');
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.raw.includes('http_requests_total'), 'missing http_requests_total');
    assert(r.raw.includes('nodejs_heap_size_used_bytes'), 'missing default node metrics');
  });

  // ── 18. X-Request-ID echo ─────────────────────────────────────────────────
  await test('X-Request-ID echoed back in response header', async () => {
    const id = `test-${Date.now()}`;
    const r = await req('GET', '/health', null, { 'X-Request-ID': id });
    assert(r.headers['x-request-id'] === id, `Got ${r.headers['x-request-id']}`);
  });

  // ── 19. 404 with structured error ────────────────────────────────────────
  await test('Unknown route → 404 with error.code + meta.requestId', async () => {
    const r = await req('GET', '/api/v1/does-not-exist');
    assert(r.status === 404, `Got ${r.status}`);
    assert(r.body?.error?.code, 'missing error.code');
    assert(r.body?.meta?.requestId, 'missing meta.requestId');
    assert(r.body?.meta?.timestamp, 'missing meta.timestamp');
  });

  // ── 20. Invalid JSON body → 400 ──────────────────────────────────────────
  await test('Malformed JSON body → 400 INVALID_JSON', async () => {
    const r = await new Promise((res, rej) => {
      const o = http.request({
        hostname: 'localhost', port: 3999, path: '/api/v1/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (response) => {
        let d = '';
        response.on('data', c => d += c);
        response.on('end', () => {
          try { res({ status: response.statusCode, body: JSON.parse(d) }); }
          catch { res({ status: response.statusCode, body: d }); }
        });
      });
      o.on('error', rej);
      o.write('{bad json');
      o.end();
    });
    assert(r.status === 400, `Got ${r.status}`);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[1m───────────────────────────────────────────────\x1b[0m');
  console.log(`\x1b[1mResults: \x1b[32m${passed} passed\x1b[0m  \x1b[31m${failed} failed\x1b[0m  / ${passed + failed} total`);
  if (failures.length) {
    console.log('\n\x1b[31mFailed:\x1b[0m');
    failures.forEach(f => console.log(`  ✗ ${f.name}\n      ${f.error}`));
  }
  console.log('\x1b[1m───────────────────────────────────────────────\x1b[0m\n');
  return failed;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function main() {
  const mongoose = require('mongoose');
  const { connectMaster, closeMaster } = require('../src/db/master');
  const EventBus = require('../src/core/EventBus');
  const { createApp } = require('../src/app');

  console.log('\x1b[33m⚡ Starting test server on :3999...\x1b[0m');

  await connectMaster();
  console.log('\x1b[32m✓ MongoDB connected\x1b[0m');

  try { EventBus.registerListeners(); } catch { /* Redis may be offline */ }

  const app = createApp();
  const server = require('http').createServer(app);
  await new Promise((ok, fail) => server.listen(3999, err => err ? fail(err) : ok()));
  console.log('\x1b[32m✓ Server ready\x1b[0m\n');

  let exitCode = 1;
  try {
    const failCount = await runAll();
    exitCode = failCount > 0 ? 1 : 0;
  } finally {
    server.close();
    await closeMaster().catch(() => {});
    // Drain redis
    try { await require('../src/services/redis').closeAllRedis(); } catch { /* ok */ }
    await mongoose.disconnect().catch(() => {});
    process.exit(exitCode);
  }
}

main().catch(err => { console.error('Fatal:', err.message, err.stack); process.exit(1); });
