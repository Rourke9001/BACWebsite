'use strict';

/**
 * Email sender factory. The Function depends only on this interface:
 *
 *   sender.send({ to, from, fromName, replyTo, subject, text }) -> Promise<void>
 *
 * EMAIL_PROVIDER app setting selects the implementation:
 *   - "stub"  (default): logs the message instead of sending — safe until BAC-9 lands.
 *   - "smtp" / "graph": to be implemented in BAC-9 (M365 SMTP AUTH vs Microsoft Graph).
 */
function createEmailSender(env, logger) {
  const provider = (env.EMAIL_PROVIDER || 'stub').toLowerCase();

  if (provider === 'stub') {
    return {
      provider,
      async send(message) {
        logger(`[email:stub] would send "${message.subject}" to ${message.to} (replyTo ${message.replyTo || 'n/a'})`);
      },
    };
  }

  if (provider === 'smtp' || provider === 'graph') {
    return {
      provider,
      async send() {
        throw new Error(`EMAIL_PROVIDER "${provider}" is not implemented yet — BAC-9 plugs this in.`);
      },
    };
  }

  throw new Error(`Unknown EMAIL_PROVIDER "${provider}" (expected stub, smtp or graph).`);
}

module.exports = { createEmailSender };
