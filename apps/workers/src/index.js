'use strict';

require('dotenv').config();
const Redis = require('ioredis');
const cron = require('node-cron');
const { Queue, Worker } = require('@tenantcore/queue-engine');

const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_QUEUE_DB || '1'),
  },
};

console.log('[Workers] Starting TenantCore Worker Processes...');

// ─── Redis connection ─────────────────────────────────────────────────────────
const redis = new Redis(config.redis);
redis.on('ready', () => console.log('[Workers] Redis connected'));
redis.on('error', (err) => console.error('[Workers] Redis error:', err.message));

// ─── Queue instances ──────────────────────────────────────────────────────────
const queues = {
  emails: new Queue('emails', redis, { prefix: 'tenantcore' }),
  onboarding: new Queue('onboarding', redis, { prefix: 'tenantcore' }),
  reports: new Queue('reports', redis, { prefix: 'tenantcore' }),
  cleanup: new Queue('cleanup', redis, { prefix: 'tenantcore' }),
};

// ─── Email Worker ─────────────────────────────────────────────────────────────
const emailProcessor = require('./processors/email.processor');
const emailWorker = new Worker(queues.emails, emailProcessor, {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY_EMAIL || '10'),
  workerId: `email-worker-${process.pid}`,
});

// ─── Onboarding Worker ────────────────────────────────────────────────────────
const onboardingProcessor = require('./processors/onboarding.processor');
const onboardingWorker = new Worker(queues.onboarding, onboardingProcessor, {
  concurrency: 3,
  workerId: `onboarding-worker-${process.pid}`,
});

// ─── Report Worker ────────────────────────────────────────────────────────────
const reportProcessor = require('./processors/report.processor');
const reportWorker = new Worker(queues.reports, reportProcessor, {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY_REPORTS || '3'),
  workerId: `report-worker-${process.pid}`,
  timeout: 5 * 60 * 1000, // 5 minute timeout per job
});

// ─── Cleanup Worker ───────────────────────────────────────────────────────────
const cleanupProcessor = require('./processors/cleanup.processor');
const cleanupWorker = new Worker(queues.cleanup, cleanupProcessor, {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY_CLEANUP || '5'),
  workerId: `cleanup-worker-${process.pid}`,
});

// ─── Start all workers ────────────────────────────────────────────────────────
emailWorker.start();
onboardingWorker.start();
reportWorker.start();
cleanupWorker.start();

// ─── Scheduled Jobs (Cron) ────────────────────────────────────────────────────
// Uses node-cron with distributed lock pattern to prevent duplicate execution

async function scheduleWithLock(jobName, cronExpr, handler, timeoutSecs = 60) {
  cron.schedule(cronExpr, async () => {
    const lockKey = `cron:lock:${jobName}`;
    // Acquire distributed lock
    const acquired = await redis.set(lockKey, process.pid, 'EX', timeoutSecs, 'NX');
    if (acquired !== 'OK') {
      console.log(`[Cron] ${jobName} lock held by another instance — skipping`);
      return;
    }

    console.log(`[Cron] Running: ${jobName}`);
    try {
      await handler();
    } catch (err) {
      console.error(`[Cron] ${jobName} failed:`, err.message);
    } finally {
      await redis.del(lockKey);
    }
  });
}

// Register all cron jobs
scheduleWithLock('cleanup:expired-tokens', '0 * * * *', async () => {
  await queues.cleanup.add('delete-expired-tokens', {}, { maxAttempts: 3 });
});

scheduleWithLock('quota:reset-monthly', '0 0 1 * *', async () => {
  await queues.cleanup.add('reset-monthly-quotas', {}, { maxAttempts: 10 }); // Critical
}, 3600);

scheduleWithLock('audit:archive-old-logs', '0 3 * * 0', async () => {
  await queues.cleanup.add('archive-old-audit-logs', {}, { maxAttempts: 3 });
}, 3600);

scheduleWithLock('notifications:send-digest', '0 9 * * 5', async () => {
  await queues.emails.add('send-weekly-digest', {}, { maxAttempts: 3 });
});

scheduleWithLock('tenants:check-trial-expiry', '0 8 * * *', async () => {
  await queues.cleanup.add('check-trial-expiry', {}, { maxAttempts: 3 });
});

console.log('[Workers] Cron jobs scheduled');

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  console.log(`[Workers] ${signal} received — shutting down...`);
  await Promise.all([
    emailWorker.stop(),
    onboardingWorker.stop(),
    reportWorker.stop(),
    cleanupWorker.stop(),
  ]);
  await redis.quit();
  console.log('[Workers] Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[Workers] Uncaught exception:', err.message);
  gracefulShutdown('uncaughtException');
});
