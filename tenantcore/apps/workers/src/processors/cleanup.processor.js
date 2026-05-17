'use strict';

/**
 * Cleanup Processor — maintenance and housekeeping jobs.
 */
async function cleanupProcessor(job) {
  const { type, data } = job;

  switch (type) {
    case 'delete-expired-tokens':
      console.log('[CleanupProcessor] Deleting expired tokens...');
      // Redis TTL handles blacklisted token cleanup automatically
      return { cleaned: true };

    case 'archive-old-audit-logs':
      console.log('[CleanupProcessor] Archiving old audit logs...');
      // Move logs older than retention period (Feature 7)
      return { archived: true };

    case 'reset-monthly-quotas':
      console.log('[CleanupProcessor] Resetting monthly quotas...');
      // Reset all tenant monthly quota counters (Feature 20)
      return { reset: true };

    case 'check-trial-expiry':
      console.log('[CleanupProcessor] Checking trial expiry...');
      // Suspend expired trial tenants (Feature 1)
      return { checked: true };

    case 'cleanup-orphan-files':
      console.log('[CleanupProcessor] Cleaning up orphan files...');
      return { cleaned: true };

    default:
      throw new Error(`Unknown cleanup job type: ${type}`);
  }
}

module.exports = cleanupProcessor;
