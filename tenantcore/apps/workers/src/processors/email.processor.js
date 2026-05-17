'use strict';

/**
 * Email Processor — handles all email jobs from the 'emails' queue.
 *
 * Supported job types:
 *   send-welcome-email
 *   send-invite-email
 *   send-quota-warning
 *   send-password-reset
 *   send-weekly-digest
 */

const nodemailer = require('nodemailer');
const Handlebars = require('handlebars');

// Lazy SMTP transporter (don't crash if SMTP not configured in dev)
let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
  }
  return transporter;
}

// Simple HTML email templates
const TEMPLATES = {
  welcome: Handlebars.compile(`
    <h1>Welcome to TenantCore, {{firstName}}!</h1>
    <p>Your workspace <strong>{{tenantName}}</strong> is ready.</p>
    <p><a href="{{dashboardUrl}}">Open Dashboard →</a></p>
  `),
  invite: Handlebars.compile(`
    <h1>You've been invited to {{tenantName}}</h1>
    <p>{{inviterName}} invited you as <strong>{{role}}</strong>.</p>
    <p><a href="{{acceptUrl}}">Accept Invitation →</a></p>
  `),
  quotaWarning: Handlebars.compile(`
    <h1>Quota Warning — {{metric}} at {{percentage}}%</h1>
    <p>Your workspace <strong>{{tenantName}}</strong> has used {{percentage}}% of its {{metric}} quota.</p>
    <p>Consider upgrading your plan to avoid service interruptions.</p>
  `),
  passwordReset: Handlebars.compile(`
    <h1>Reset Your Password</h1>
    <p>Click the link below to reset your password. This link expires in 1 hour.</p>
    <p><a href="{{resetUrl}}">Reset Password →</a></p>
    <p>If you didn't request this, please ignore this email.</p>
  `),
};

async function emailProcessor(job) {
  const { type, data } = job;
  const transport = getTransporter();

  let html, subject, to;

  switch (type) {
    case 'send-welcome-email':
      html = TEMPLATES.welcome(data);
      subject = `Welcome to TenantCore!`;
      to = data.email;
      break;

    case 'send-invite-email':
      html = TEMPLATES.invite(data);
      subject = `You've been invited to ${data.tenantName}`;
      to = data.email;
      break;

    case 'send-quota-warning':
      html = TEMPLATES.quotaWarning(data);
      subject = `⚠️ Quota Warning: ${data.metric} at ${data.percentage}%`;
      to = data.ownerEmail;
      break;

    case 'send-password-reset':
      html = TEMPLATES.passwordReset(data);
      subject = `Reset your TenantCore password`;
      to = data.email;
      break;

    case 'send-weekly-digest':
      // Weekly digest — minimal template
      html = `<h1>Your Weekly Digest</h1><p>Usage summary for your workspace.</p>`;
      subject = `Your TenantCore Weekly Digest`;
      to = data.email;
      break;

    default:
      throw new Error(`Unknown email job type: ${type}`);
  }

  if (!to) throw new Error('Email recipient (to) is required');

  await transport.sendMail({
    from: process.env.SMTP_FROM || 'TenantCore <no-reply@tenantcore.com>',
    to,
    subject,
    html,
  });

  console.log(`[EmailProcessor] Sent '${type}' to ${to}`);
  return { sent: true, to, type };
}

module.exports = emailProcessor;
