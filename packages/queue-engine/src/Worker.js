'use strict';

/**
 * Worker — processes jobs from a Queue with concurrency control.
 *
 * - Polls the queue at configurable intervals
 * - Processes up to `concurrency` jobs in parallel
 * - Reports heartbeat to Redis so the autoscaler can monitor health
 * - Handles graceful shutdown: finishes active jobs before exiting
 */
class Worker {
  constructor(queue, processor, options = {}) {
    this.queue = queue;
    this.processor = processor;
    this.concurrency = options.concurrency || 5;
    this.pollInterval = options.pollInterval || 500; // ms
    this.workerId = options.workerId || `worker-${process.pid}-${Date.now()}`;
    this.heartbeatInterval = options.heartbeatInterval || 5000; // 5 seconds

    this._activeJobs = new Map(); // jobId → Promise
    this._running = false;
    this._pollTimer = null;
    this._heartbeatTimer = null;
    this._shutdownResolve = null;
  }

  /**
   * Start polling for jobs.
   */
  start() {
    this._running = true;
    this._poll();
    this._startHeartbeat();
    console.log(`[Worker ${this.workerId}] Started on queue: ${this.queue.name} (concurrency: ${this.concurrency})`);
  }

  /**
   * Graceful stop: stop accepting new jobs, wait for active jobs.
   */
  async stop() {
    this._running = false;
    clearTimeout(this._pollTimer);
    clearInterval(this._heartbeatTimer);

    if (this._activeJobs.size > 0) {
      console.log(`[Worker ${this.workerId}] Waiting for ${this._activeJobs.size} active job(s) to finish...`);
      await Promise.allSettled(Array.from(this._activeJobs.values()));
    }

    await this._clearHeartbeat();
    console.log(`[Worker ${this.workerId}] Stopped`);
  }

  /**
   * Poll the queue for ready jobs.
   */
  async _poll() {
    if (!this._running) return;

    try {
      // Process up to (concurrency - activeJobs) jobs per poll
      const slots = this.concurrency - this._activeJobs.size;
      if (slots > 0) {
        const promises = [];
        for (let i = 0; i < slots; i++) {
          const job = await this.queue.dequeue();
          if (!job) break;
          promises.push(this._process(job));
        }
        await Promise.allSettled(promises);
      }
    } catch (err) {
      console.error(`[Worker ${this.workerId}] Poll error:`, err.message);
    }

    this._pollTimer = setTimeout(() => this._poll(), this._activeJobs.size > 0 ? 100 : this.pollInterval);
  }

  /**
   * Process a single job. Calls the user-provided processor function.
   */
  async _process(job) {
    const jobPromise = (async () => {
      const start = Date.now();
      try {
        const result = await Promise.race([
          this.processor(job),
          this._timeout(job.timeout),
        ]);

        await this.queue.complete(job.id, result);
        console.log(`[Worker ${this.workerId}] ✓ Job ${job.id} (${job.type}) completed in ${Date.now() - start}ms`);
      } catch (err) {
        console.error(`[Worker ${this.workerId}] ✗ Job ${job.id} (${job.type}) failed:`, err.message);
        await this.queue.fail(job.id, err);
      } finally {
        this._activeJobs.delete(job.id);
      }
    })();

    this._activeJobs.set(job.id, jobPromise);
    return jobPromise;
  }

  _timeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Job timed out after ${ms}ms`)), ms)
    );
  }

  /**
   * Send heartbeat to Redis so the autoscaler and dashboard can see this worker.
   */
  async _startHeartbeat() {
    const sendHeartbeat = async () => {
      try {
        const data = JSON.stringify({
          workerId: this.workerId,
          queue: this.queue.name,
          activeJobs: this._activeJobs.size,
          concurrency: this.concurrency,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        });
        await this.queue.redis.set(
          `worker:heartbeat:${this.workerId}`,
          data,
          'EX',
          15 // Auto-expires if worker dies — detected within 15 seconds
        );
      } catch { /* ignore */ }
    };

    await sendHeartbeat();
    this._heartbeatTimer = setInterval(sendHeartbeat, this.heartbeatInterval);
  }

  async _clearHeartbeat() {
    try {
      await this.queue.redis.del(`worker:heartbeat:${this.workerId}`);
    } catch { /* ignore */ }
  }
}

module.exports = Worker;
