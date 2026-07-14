'use strict';

/**
 * Email sender factory. The Function depends only on this interface:
 *
 *   sender.send({ to, from, fromName, replyTo, subject, text }) -> Promise<void>
 *
 * EMAIL_PROVIDER app setting selects the implementation:
 *   - "stub" (default): logs the message instead of sending — safe until Graph
 *     credentials are configured in SWA app settings.
 *   - "graph": Microsoft Graph app-only sendMail (BAC-3 decision; SMTP AUTH was
 *     ruled out — Microsoft retires basic-auth client submission Dec 2026).
 *     Requires GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, and `from`
 *     must be a real mailbox in the tenant (the app sends as that mailbox).
 */
function createEmailSender(env, logger, fetchImpl = fetch) {
  const provider = (env.EMAIL_PROVIDER || 'stub').toLowerCase();

  if (provider === 'stub') {
    return {
      provider,
      async send(message) {
        logger(`[email:stub] would send "${message.subject}" to ${message.to} (replyTo ${message.replyTo || 'n/a'})`);
      },
    };
  }

  if (provider === 'graph') {
    const missing = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET'].filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`EMAIL_PROVIDER "graph" requires app settings: ${missing.join(', ')}.`);
    }
    return createGraphSender(env, logger, fetchImpl);
  }

  throw new Error(`Unknown EMAIL_PROVIDER "${provider}" (expected "stub" or "graph").`);
}

function createGraphSender(env, logger, fetchImpl) {
  const tokenUrl = `https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  let cachedToken = null;
  let cachedTokenExpiresAt = 0; // epoch ms

  async function getToken() {
    // Refresh a minute early so a token never expires mid-send.
    if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;

    const res = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GRAPH_CLIENT_ID,
        client_secret: env.GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Graph token request failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    cachedToken = data.access_token;
    cachedTokenExpiresAt = Date.now() + data.expires_in * 1000;
    return cachedToken;
  }

  return {
    provider: 'graph',
    async send({ to, from, fromName, replyTo, subject, text }) {
      const token = await getToken();
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: 'Text', content: text },
            toRecipients: [{ emailAddress: { address: to } }],
            replyTo: replyTo ? [{ emailAddress: { address: replyTo } }] : [],
            from: { emailAddress: { address: from, name: fromName } },
          },
          // saveToSentItems left at its default (true): the sending mailbox's
          // Sent Items doubles as the audit trail for BAC-10's silent-failure concern.
        }),
      });
      if (res.status !== 202) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Graph sendMail failed (${res.status}): ${detail.slice(0, 300)}`);
      }
      logger(`[email:graph] sent "${subject}" to ${to} as ${from}`);
    },
  };
}

module.exports = { createEmailSender };
