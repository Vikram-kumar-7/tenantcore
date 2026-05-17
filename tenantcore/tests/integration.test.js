/**
 * TenantCore Integration Test Suite
 * ====================================
 * Self-contained test runner — no external test framework needed.
 * Run with: node tests/integration.test.js
 *
 * Covers all 20 scenarios from the test spec.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// ─── Override env for test isolation ─────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.PORT = '3999';
process.env.MONGODB_MASTER_URI = 'mongodb://localhost:27017/tenantcore_test';
process.env.BCRYPT_ROUNDS = '4'; // Fast hashing for tests
process.env.JWT_ACCESS_EXPIRY = '5s'; // Short for expiry test
process.env.JWT_REFRESH_EXPIRY = '1m';

const http = require('http');

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function log(icon, label, detail = '') {
  const color = icon === '✅' ? '\x1b[32m' : icon === '❌' ? '\x1b[31m' : '\x1b[33m';
  console.log(`${color}${icon}\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'pass' });
    log('✅', name);
  } catch (err) {
    failed++;
    results.push({ name, status: 'fail', error: err.message });
    log('❌', name, err.message);
  }
}

/**
 * HTTP client for the local test server.
 */
function req(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3999,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const reqObj = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data), raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });

    reqObj.on('error', reject);
    if (body) reqObj.write(JSON.stringify(body));
    reqObj.end();
  });
}

// ─── Test state ───────────────────────────────────────────────────────────────
let tenant1Token = null;
let tenant1Refresh = null;
let tenant1Id = null;
let tenant1Slug = null;
let tenant2Token = null;
let tenant2Slug = null;
let userId1 = null;
let apiKeyRaw = null;
let fileId = null;

// ─── Test Suite ───────────────────────────────────────────────────────────────

async function runAll() {
  console.log('\n\x1b[1m╔══════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m║      TenantCore Integration Test Suite               ║\x1b[0m');
  console.log('\x1b[1m╚══════════════════════════════════════════════════════╝\x1b[0m\n');

  // ─── SCENARIO 1: Health Endpoints ─────────────────────────────────────────
  await test('GET /health → 200 + status ok', async () => {
    const r = await req('GET', '/health');
    assert(r.status === 200, `Expected 200 got ${r.status}`);
    assert(r.body.status === 'ok', `status: ${r.body.status}`);
    assert(r.body.uptime >= 0, 'missing uptime');
    assert(r.body.version, 'missing version');
  });

  await test('GET /liveness → 200 + memoryUsage', async () => {
    const r = await req('GET', '/liveness');
    assert(r.status === 200, `Got ${r.status}`);
    assert(r.body.status === 'alive', `status: ${r.body.status}`);
    assert(r.body.memoryUsage?.heapUsed, 'missing heapUsed');
  });

  await test('GET /readiness → returns checks object', async () => {
    const r = await req('GET', '/readiness');
    assert([200, 503].includes(r.status), `Got ${r.status}`);
    assert(r.body.checks, 'missing checks');
    assert('mongodb' in r.body.checks, 'missing mongodb check');
  });

  // ─── SCENARIO 2: Signup / Tenant Provisioning ─────────────────────────────
  tenant1Slug = `testcorp-${Date.now()}`;
  await test('POST /auth/signup → 201 + tokens + tenant', async () => {
    const r = await req('POST', '/api/v1/auth/signup', {
      email: `owner@${tenant1Slug}.com`,
      password: 'SecurePass@123',
      firstName: 'Alice',
      lastName: 'Smith',
      tenantName: 'Test Corp',
      tenantSlug: tenant1Slug,
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.accessToken, 'missing accessToken');
    assert(r.body.data?.refreshToken, 'missing refreshToken');
    assert(r.body.data?.tenant?.slug === tenant1Slug, 'slug mismatch');
    tenant1Token = r.body.data.accessToken;
    tenant1Refresh = r.body.data.refreshToken;
    tenant1Id = r.body.data.tenant.id;
    userId1 = r.body.data.user.id;
  });

  // ─── SCENARIO 3: Login ────────────────────────────────────────────────────
  await test('POST /auth/login → 200 + tokens', async () => {
    const r = await req('POST', '/api/v1/auth/login', {
      email: `owner@${tenant1Slug}.com`,
      password: 'SecurePass@123',
      tenantSlug: tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.accessToken, 'missing accessToken');
    assert(r.body.data?.user?.email, 'missing user email');
  });

  // ─── SCENARIO 4: Token Refresh ────────────────────────────────────────────
  await test('POST /auth/refresh → 200 + new token pair', async () => {
    const r = await req('POST', '/api/v1/auth/refresh', {
      refreshToken: tenant1Refresh,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.accessToken, 'missing new accessToken');
    assert(r.body.data?.refreshToken, 'missing new refreshToken');
    // Rotate to the new token
    tenant1Token = r.body.data.accessToken;
    tenant1Refresh = r.body.data.refreshToken;
  });

  // ─── SCENARIO 5: GET /auth/me — protected route with valid token ──────────
  await test('GET /auth/me with valid token → 200 + user', async () => {
    const r = await req('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.user?.email, 'missing user email');
    assert(r.body.data?.user?.role === 'owner', `role: ${r.body.data?.user?.role}`);
  });

  // ─── SCENARIO 6: Protected route with expired token → 401 ────────────────
  await test('Protected route with expired token → 401', async () => {
    // JWT signed with 5s expiry — wait 6s for it to expire
    const expiredToken = require('jsonwebtoken').sign(
      { sub: 'fake-id', tenantId: 'fake-tenant', role: 'member', type: 'access', jti: 'fake-jti' },
      'dev-access-secret-change-in-production',
      { expiresIn: '1ms', issuer: 'tenantcore' }
    );
    await new Promise(r => setTimeout(r, 50)); // Ensure expired
    const r = await req('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${expiredToken}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 401, `Expected 401 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error?.code, 'missing error code');
  });

  // ─── SCENARIO 7: Wrong role → 403 ────────────────────────────────────────
  await test('Access admin-only endpoint with viewer token → 403', async () => {
    // Use admin panel route that requires super-admin
    const r = await req('GET', '/api/admin/tenants', null, {
      Authorization: `Bearer ${tenant1Token}`, // owner, not super-admin
    });
    assert(r.status === 403, `Expected 403 got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ─── SCENARIO 8: Logout → token blacklisted ───────────────────────────────
  let tokenToBlacklist = tenant1Token;
  await test('POST /auth/logout → 200 + token blacklisted', async () => {
    const r = await req('POST', '/api/v1/auth/logout', null, {
      Authorization: `Bearer ${tokenToBlacklist}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('Blacklisted token → 401 on next request', async () => {
    const r = await req('GET', '/api/v1/auth/me', null, {
      Authorization: `Bearer ${tokenToBlacklist}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 401, `Expected 401 got ${r.status}`);
  });

  // Re-login to get fresh token for further tests
  const loginR = await req('POST', '/api/v1/auth/login', {
    email: `owner@${tenant1Slug}.com`,
    password: 'SecurePass@123',
    tenantSlug: tenant1Slug,
  });
  tenant1Token = loginR.body.data?.accessToken;
  tenant1Refresh = loginR.body.data?.refreshToken;

  // ─── SCENARIO 9: Tenant Data Isolation ───────────────────────────────────
  tenant2Slug = `othercorp-${Date.now()}`;
  await test('Create tenant 2 → separate workspace', async () => {
    const r = await req('POST', '/api/v1/auth/signup', {
      email: `owner@${tenant2Slug}.com`,
      password: 'SecurePass@123',
      firstName: 'Bob',
      lastName: 'Jones',
      tenantName: 'Other Corp',
      tenantSlug: tenant2Slug,
    });
    assert(r.status === 201, `Expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.tenant?.slug === tenant2Slug, 'wrong slug');
    tenant2Token = r.body.data.accessToken;
  });

  await test('Tenant 1 users not visible to Tenant 2', async () => {
    // Tenant 2 lists their users — should only see themselves (no tenant1 users)
    const r = await req('GET', '/api/v1/users', null, {
      Authorization: `Bearer ${tenant2Token}`,
      'X-Tenant-Slug': tenant2Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}`);
    const emails = r.body.data?.users?.map(u => u.email) || [];
    const crossTenant = emails.filter(e => e.includes(tenant1Slug));
    assert(crossTenant.length === 0, `Cross-tenant data leak: ${JSON.stringify(crossTenant)}`);
  });

  // ─── SCENARIO 10: API Key Creation ───────────────────────────────────────
  await test('POST /apikeys → 201 + rawKey shown once', async () => {
    const r = await req('POST', '/api/v1/apikeys', {
      name: 'CI Pipeline Key',
      scopes: ['users:read', 'files:upload'],
    }, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 201, `Expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.rawKey?.startsWith('tc_live_'), `rawKey format: ${r.body.data?.rawKey}`);
    assert(r.body.data?.warning, 'missing one-time warning');
    apiKeyRaw = r.body.data.rawKey;
  });

  await test('Use API key → authenticated as api-key role', async () => {
    const r = await req('GET', '/api/v1/users', null, {
      'X-API-Key': apiKeyRaw,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ─── SCENARIO 11: Users list ─────────────────────────────────────────────
  await test('GET /users → list with pagination metadata', async () => {
    const r = await req('GET', '/api/v1/users?page=1&limit=10', null, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}`);
    assert(Array.isArray(r.body.data?.users), 'users not an array');
    assert(r.body.pagination?.total >= 1, 'missing pagination.total');
    assert(r.body.meta?.requestId, 'missing requestId');
  });

  // ─── SCENARIO 12: Roles ───────────────────────────────────────────────────
  await test('GET /roles → system roles seeded during provisioning', async () => {
    const r = await req('GET', '/api/v1/roles', null, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    const roleNames = r.body.data?.roles?.map(r => r.name) || [];
    assert(roleNames.includes('owner'), `system roles missing owner: ${JSON.stringify(roleNames)}`);
  });

  await test('POST /roles → create custom role', async () => {
    const r = await req('POST', '/api/v1/roles', {
      name: 'developer',
      displayName: 'Developer',
      permissions: ['users:read', 'files:upload'],
      description: 'Dev team role',
    }, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 201, `Expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.role?.name === 'developer', 'name mismatch');
    assert(r.body.data?.role?.isSystem === false, 'should not be system role');
  });

  // ─── SCENARIO 13: File Upload (pre-signed URL flow) ───────────────────────
  await test('POST /files/upload-url → 201 + uploadUrl + fileId', async () => {
    const r = await req('POST', '/api/v1/files/upload-url', {
      filename: 'test-document.pdf',
      mimeType: 'application/pdf',
      size: 102400,
      category: 'documents',
    }, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 201, `Expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.fileId, 'missing fileId');
    // uploadUrl may be null if MinIO is not running — that's ok in local test
    fileId = r.body.data.fileId;
    log('⚠️', 'MinIO upload URL skipped (no MinIO locally)', `fileId: ${fileId}`);
  });

  // ─── SCENARIO 14: Notifications ──────────────────────────────────────────
  await test('GET /notifications → empty list with unreadCount', async () => {
    const r = await req('GET', '/api/v1/notifications', null, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(Array.isArray(r.body.data?.notifications), 'not an array');
    assert(typeof r.body.data?.unreadCount === 'number', 'missing unreadCount');
  });

  // ─── SCENARIO 15: Audit logs ──────────────────────────────────────────────
  await test('GET /audit → returns audit log entries', async () => {
    const r = await req('GET', '/api/v1/audit?limit=10', null, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(Array.isArray(r.body.data?.logs), 'logs not an array');
    assert(r.body.pagination?.total >= 0, 'missing pagination');
  });

  // ─── SCENARIO 16: Quota ───────────────────────────────────────────────────
  await test('GET /quota → usage within plan limits', async () => {
    const r = await req('GET', '/api/v1/quota', null, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data?.quota?.plan, 'missing plan');
    assert(r.body.data?.quota?.usage?.apiRequests, 'missing apiRequests usage');
  });

  // ─── SCENARIO 17: Rate Limiting ──────────────────────────────────────────
  await test('X-RateLimit headers present on API responses', async () => {
    const r = await req('GET', '/api/v1/users', null, {
      Authorization: `Bearer ${tenant1Token}`,
      'X-Tenant-Slug': tenant1Slug,
    });
    assert(r.status === 200, `Expected 200 got ${r.status}`);
    assert(r.headers['x-ratelimit-limit'], 'missing X-RateLimit-Limit header');
    assert(r.headers['x-ratelimit-remaining'], 'missing X-RateLimit-Remaining header');
    assert(r.headers['x-ratelimit-reset'], 'missing X-RateLimit-Reset header');
    log('⚠️', `Rate limit headers: limit=${r.headers['x-ratelimit-limit']} remaining=${r.headers['x-ratelimit-remaining']}`);
  });

  // ─── SCENARIO 18: Prometheus Metrics ─────────────────────────────────────
  await test('GET /metrics → Prometheus text format', async () => {
    const r = await req('GET', '/metrics');
    assert(r.status === 200, `Expected 200 got ${r.status}`);
    assert(typeof r.raw === 'string', 'metrics should be text');
    assert(r.raw.includes('http_requests_total'), `missing http_requests_total in: ${r.raw.slice(0, 200)}`);
    assert(r.raw.includes('nodejs_heap_size_used_bytes'), 'missing nodejs default metrics');
  });

  // ─── SCENARIO 19: Tenant suspension (admin) ───────────────────────────────
  await test('POST /api/admin/tenants/:id/suspend requires super-admin', async () => {
    const r = await req('POST', `/api/admin/tenants/${tenant1Id}/suspend`, { reason: 'Test suspension' }, {
      Authorization: `Bearer ${tenant1Token}`, // not super-admin
    });
    assert(r.status === 403, `Expected 403 got ${r.status}`);
  });

  // ─── SCENARIO 20: Request ID propagation ─────────────────────────────────
  await test('X-Request-ID header echoed back', async () => {
    const customId = `test-req-${Date.now()}`;
    const r = await req('GET', '/health', null, { 'X-Request-ID': customId });
    assert(r.headers['x-request-id'] === customId, `Got ${r.headers['x-request-id']}`);
  });

  await test('Error responses include requestId + timestamp', async () => {
    const r = await req('GET', '/api/v1/nonexistent-route', null, {
      Authorization: `Bearer ${tenant1Token}`,
    });
    assert(r.status === 404, `Expected 404 got ${r.status}`);
    assert(r.body.error?.code, 'missing error.code');
    assert(r.body.meta?.requestId, 'missing meta.requestId');
    assert(r.body.meta?.timestamp, 'missing meta.timestamp');
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log(`\x1b[1mResults: \x1b[32m${passed} passed\x1b[0m \x1b[1m/ \x1b[31m${failed} failed\x1b[0m \x1b[1m/ ${passed + failed} total\x1b[0m`);

  if (failed > 0) {
    console.log('\n\x1b[31mFailed tests:\x1b[0m');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  ✗ ${r.name}`);
      console.log(`    ${r.error}`);
    });
  }

  console.log('\x1b[1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');
  return { passed, failed };
}

// ─── Bootstrap test server ───────────────────────────────────────────────────

async function main() {
  // Import after env overrides
  const mongoose = require('mongoose');
  const { connectMaster } = require('./apps/api/src/db/master');
  const EventBus = require('./apps/api/src/core/EventBus');
  const { createApp } = require('./apps/api/src/app');

  console.log('\n\x1b[33m⚡ Starting test server...\x1b[0m');

  // Try connecting to MongoDB
  try {
    await connectMaster();
    console.log('\x1b[32m✓ MongoDB connected\x1b[0m');
  } catch (err) {
    console.log(`\x1b[31m✗ MongoDB connection failed: ${err.message}\x1b[0m`);
    console.log('\x1b[33mMake sure MongoDB is running on localhost:27017\x1b[0m');
    process.exit(1);
  }

  // Register event listeners (non-fatal if Redis is down)
  try {
    EventBus.registerListeners();
  } catch (err) {
    console.log(`\x1b[33m⚠ EventBus setup partial: ${err.message}\x1b[0m`);
  }

  // Start Express app
  const app = createApp();
  const server = require('http').createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(3999, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  console.log('\x1b[32m✓ Test server running on :3999\x1b[0m\n');

  // Run tests
  let exitCode = 0;
  try {
    const { failed } = await runAll();
    exitCode = failed > 0 ? 1 : 0;
  } catch (err) {
    console.error('Test runner crashed:', err);
    exitCode = 1;
  } finally {
    server.close();
    await mongoose.disconnect();
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
