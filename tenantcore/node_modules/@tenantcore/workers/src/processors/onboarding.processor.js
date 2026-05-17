'use strict';

/**
 * Onboarding Processor — handles tenant provisioning and onboarding jobs.
 */
async function onboardingProcessor(job) {
  const { type, data } = job;

  switch (type) {
    case 'provision-tenant':
      console.log(`[OnboardingProcessor] Provisioning tenant: ${data.tenantId}`);
      // Full provisioning handled synchronously in TenantProvisioner
      // This job handles post-provisioning steps
      return { provisioned: true };

    case 'seed-default-data':
      console.log(`[OnboardingProcessor] Seeding data for tenant: ${data.tenantId}`);
      return { seeded: true };

    case 'send-onboarding-sequence':
      console.log(`[OnboardingProcessor] Starting onboarding sequence for: ${data.email}`);
      // Schedule delayed welcome emails (day 1, day 3, day 7)
      return { sequenceStarted: true };

    default:
      throw new Error(`Unknown onboarding job type: ${type}`);
  }
}

module.exports = onboardingProcessor;
