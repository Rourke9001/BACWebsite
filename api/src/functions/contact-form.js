'use strict';

const { app } = require('@azure/functions');
const { handleSubmission } = require('../lib/handler');
const { createEmailSender } = require('../lib/email');

app.http('contact-form', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'contact-form',
  handler: async (request, context) => {
    const logger = (msg) => context.log(msg);

    let fields = {};
    try {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        if (typeof value === 'string') fields[key] = value;
      }
    } catch {
      return { status: 400, body: 'Invalid form submission.' };
    }

    const accept = request.headers.get('accept') || '';
    const meta = {
      // SWA puts the caller address in x-forwarded-for ("ip:port, ...").
      ip: (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().replace(/:\d+$/, ''),
      userAgent: request.headers.get('user-agent') || '',
      wantsJson:
        accept.includes('application/json') ||
        (request.headers.get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest',
    };

    const deps = {
      sender: createEmailSender(process.env, logger),
      recipient: process.env.CONTACT_RECIPIENT,
      from: process.env.CONTACT_FROM,
      logger,
    };

    const result = await handleSubmission(fields, meta, deps);

    if (result.kind === 'json') {
      return { status: result.status, jsonBody: result.payload };
    }
    return { status: result.status, headers: { Location: result.location } };
  },
});
