'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Queue — Redis-backed FIFO job queue with priority, delay, and retry support.
 *
 * Data structures in Redis:
 *   {prefix}:{name}:waiting   — ZSET scored by priority (lower = higher priority)
 *   {prefix}:{name}:active    — ZSET scored by startedAt (for timeout detection)
 *   {prefix}:{name}:delayed   — ZSET scored by runAt timestamp
 *   {prefix}:{name}:completed — LIST (capped, for inspection)
 *   {prefix}:{name}:failed    — ZSET (Dead Letter Queue)
 *   {prefix}:{name}:job:{id}  — HASH containing job data
 */
class Queue {
  constructor(name, redis, options = {}) {
    this.name = name;
    this.redis = redis;
    this.prefix = options.prefix || 'queue';
    this.defaultPriority = options.defaultPriority || 0;
    this.defaultMaxAttempts = options.defaultMaxAttempts || 3;
    this.defaultBackoff = options.defaultBackoff || 'exponential';

    // Redis key builders
    this.keys = {
      waiting: `${this.prefix}:${name}:waiting`,
      active: `${this.prefix}:${name}:active`,
      delayed: `${this.prefix}:${name}:delayed`,
      completed: `${this.prefix}:${name}:completed`,
      failed: `${this.prefix}:${name}:failed`,
      job: (id) => `${this.prefix}:${name}:job:${id}`,
      dlq: `${this.prefix}:${name}:dlq`,
    };
  }

  /**
   * Enqueue a job. Returns the job ID.
   *
   * @param {string} type         - Job type identifier (e.g. 'send-welcome-email')
   * @param {Object} data         - Payload passed to processor
   * @param {Object} options      - { priority, delay, maxAttempts, timeout }
   */
  async add(type, data, options = {}) {
    const jobId = uuidv4();
    const now = Date.now();
    const runAt = options.delay ? now + options.delay : now;

    const job = {
      id: jobId,
      type,
      data: JSON.stringify(data),
      priority: options.priority ?? this.defaultPriority,
      maxAttempts: options.maxAttempts ?? this.defaultMaxAttempts,
      attempts: 0,
      timeout: options.timeout ?? 300_000, // 5 minutes
      createdAt: now,
      runAt,
      status: 'waiting',
      result: null,
      error: null,
      attemptLog: '[]',
    };

    const pipeline = this.redis.pipeline();

    // Store job hash
    pipeline.hset(this.keys.job(jobId), job);

    if (runAt > now) {
      // Delayed job — add to delayed ZSET scored by runAt
      pipeline.zadd(this.keys.delayed, runAt, jobId);
    } else {
      // Ready job — add to waiting ZSET scored by priority (higher priority = lower score)
      pipeline.zadd(this.keys.waiting, -job.priority, jobId);
    }

    await pipeline.exec();
    return jobId;
  }

  /**
   * Fetch the next ready job (moves from waiting → active atomically).
   * Returns null if no jobs are ready.
   */
  async dequeue() {
    // First: move any delayed jobs that are due into waiting
    await this._promoteDelayed();

    // Atomically pop from waiting ZSET and move to active ZSET
    const result = await this.redis.eval(`
      local jobId = redis.call('ZPOPMIN', KEYS[1])
      if #jobId == 0 then return nil end
      redis.call('ZADD', KEYS[2], ARGV[1], jobId[1])
      return jobId[1]
    `, 2, this.keys.waiting, this.keys.active, Date.now());

    if (!result) return null;

    const jobData = await this.redis.hgetall(this.keys.job(result));
    if (!jobData) return null;

    return this._deserializeJob(jobData);
  }

  /**
   * Mark a job as completed. Removes from active, stores in completed list.
   */
  async complete(jobId, result = null) {
    const pipeline = this.redis.pipeline();
    pipeline.zrem(this.keys.active, jobId);
    pipeline.hset(this.keys.job(jobId), {
      status: 'completed',
      result: JSON.stringify(result),
      completedAt: Date.now(),
    });
    // Keep last 1000 completed jobs for inspection
    pipeline.lpush(this.keys.completed, jobId);
    pipeline.ltrim(this.keys.completed, 0, 999);
    await pipeline.exec();
  }

  /**
   * Mark a job attempt as failed. Re-queue with backoff or move to DLQ.
   */
  async fail(jobId, error) {
    const jobData = await this.redis.hgetall(this.keys.job(jobId));
    if (!jobData) return;

    const attempts = parseInt(jobData.attempts || '0') + 1;
    const maxAttempts = parseInt(jobData.maxAttempts || '3');
    const attemptLog = JSON.parse(jobData.attemptLog || '[]');

    attemptLog.push({ attempt: attempts, error: error.message, failedAt: Date.now() });

    await this.redis.zrem(this.keys.active, jobId);
    await this.redis.hset(this.keys.job(jobId), {
      attempts,
      attemptLog: JSON.stringify(attemptLog),
      lastError: error.message,
    });

    if (attempts >= maxAttempts) {
      // Move to Dead Letter Queue
      await this.redis.hset(this.keys.job(jobId), { status: 'failed' });
      await this.redis.zadd(this.keys.dlq, Date.now(), jobId);
    } else {
      // Re-queue with exponential backoff: 2s, 4s, 8s, ...
      const backoffMs = Math.pow(2, attempts) * 1000;
      const runAt = Date.now() + backoffMs;
      await this.redis.hset(this.keys.job(jobId), { status: 'waiting', runAt });
      await this.redis.zadd(this.keys.delayed, runAt, jobId);
    }
  }

  /**
   * Get queue depth stats.
   */
  async stats() {
    const [waiting, active, delayed, completed, failed] = await Promise.all([
      this.redis.zcard(this.keys.waiting),
      this.redis.zcard(this.keys.active),
      this.redis.zcard(this.keys.delayed),
      this.redis.llen(this.keys.completed),
      this.redis.zcard(this.keys.dlq),
    ]);
    return { name: this.name, waiting, active, delayed, completed, failed };
  }

  /**
   * Get DLQ jobs for admin inspection.
   */
  async getDLQJobs(limit = 50) {
    const jobIds = await this.redis.zrange(this.keys.dlq, 0, limit - 1);
    return Promise.all(jobIds.map(async (id) => {
      const data = await this.redis.hgetall(this.keys.job(id));
      return data ? this._deserializeJob(data) : null;
    }));
  }

  /**
   * Retry a specific DLQ job.
   */
  async retryDLQ(jobId) {
    const exists = await this.redis.zscore(this.keys.dlq, jobId);
    if (!exists) throw new Error(`Job ${jobId} not in DLQ`);

    await this.redis.zrem(this.keys.dlq, jobId);
    await this.redis.hset(this.keys.job(jobId), { status: 'waiting', attempts: 0, error: null });
    await this.redis.zadd(this.keys.waiting, 0, jobId);
  }

  /**
   * Promote delayed jobs whose runAt has passed into the waiting queue.
   */
  async _promoteDelayed() {
    const now = Date.now();
    const dueJobIds = await this.redis.zrangebyscore(this.keys.delayed, '-inf', now);
    if (!dueJobIds.length) return;

    const pipeline = this.redis.pipeline();
    for (const id of dueJobIds) {
      pipeline.zrem(this.keys.delayed, id);
      pipeline.zadd(this.keys.waiting, 0, id);
    }
    await pipeline.exec();
  }

  _deserializeJob(data) {
    return {
      ...data,
      data: data.data ? JSON.parse(data.data) : {},
      priority: parseInt(data.priority || '0'),
      maxAttempts: parseInt(data.maxAttempts || '3'),
      attempts: parseInt(data.attempts || '0'),
      timeout: parseInt(data.timeout || '300000'),
      createdAt: parseInt(data.createdAt || '0'),
      runAt: parseInt(data.runAt || '0'),
      attemptLog: data.attemptLog ? JSON.parse(data.attemptLog) : [],
    };
  }
}

module.exports = Queue;
