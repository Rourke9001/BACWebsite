'use strict';

// Derives FAQPage JSON-LD from the About page's existing accordion markup, so the
// structured data and the visible answers cannot drift apart. Used by the build
// step that writes the block and by the test that re-derives and compares it.

const ITEM_RE = /<button class="faq-question"[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<div id="[^"]*" class="faq-answer" hidden>([\s\S]*?)<\/div>/g;

function decode(text) {
  return text
    .replace(/&ndash;/g, '\u2013').replace(/&mdash;/g, '\u2014')
    .replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
    .replace(/&ldquo;/g, '\u201c').replace(/&rdquo;/g, '\u201d')
    .replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const strip = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function extractFaqs(html) {
  const out = [];
  for (const m of html.matchAll(ITEM_RE)) {
    const question = strip(m[1]);
    const answer = strip(m[2]);
    if (question && answer) out.push({ question, answer });
  }
  return out;
}

function buildFaqSchema(html) {
  const faqs = extractFaqs(html);
  if (!faqs.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

module.exports = { extractFaqs, buildFaqSchema };
