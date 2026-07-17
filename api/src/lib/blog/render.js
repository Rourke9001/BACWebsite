'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

const ORIGIN = 'https://baclogistics.co.za';
const POSTS_PER_PAGE = 12;
const TPL_DIR = path.join(__dirname, '..', '..', 'blog-templates');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const tplCache = new Map();
function tpl(name) {
  if (!tplCache.has(name)) tplCache.set(name, readFileSync(path.join(TPL_DIR, name), 'utf8'));
  return tplCache.get(name);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in values ? values[key] : ''));
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function postUrlPath(post) {
  return post.folder ? `/blog/${post.folder}/${post.name}.html` : `/blog/${post.name}.html`;
}

function publishedSorted(allPosts) {
  return allPosts
    .filter((p) => !p.unpublished)
    .sort((a, b) =>
      b.date.localeCompare(a.date) ||
      ((a.migrated_order ?? -1) - (b.migrated_order ?? -1)) ||
      a.name.localeCompare(b.name));
}

function firstParagraphs(html, n) {
  return (html.match(/<p\b[\s\S]*?<\/p>/g) || []).slice(0, n).join('\n');
}

function renderArticleSection(post) {
  const tagsHtml = post.tags && post.tags.length
    ? `\n                <p class="gl-blog-article-tags"><strong>Tags:</strong> ${esc(post.tags.join(', '))}</p>`
    : '';
  const imageHtml = post.featured_image
    ? `<div class="gl-blog-article-image">
                <img src="${esc(post.featured_image)}" alt="${esc(post.featured_image_alt)}" />
            </div>`
    : '';
  const videoHtml = post.youtube_id
    ? `\n            <div class="gl-blog-article-video">
                <iframe
                    src="https://www.youtube.com/embed/${esc(post.youtube_id)}"
                    title="${esc(post.youtube_title || post.title)}"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowfullscreen
                ></iframe>
            </div>`
    : '';
  return `<section class="gl-blog-article-section">
    <div class="container">
        <article class="gl-blog-article">
            <header class="gl-blog-article-header">
                <h1 class="gl-blog-article-title">${esc(post.title)}</h1>

                <div class="gl-blog-article-meta">
                    <span class="gl-blog-article-date">${formatDate(post.date)}</span>
                </div>
${tagsHtml}
            </header>

            ${imageHtml}

            <div class="gl-blog-article-body">
${post.body}
            </div>
${videoHtml}
        </article>
    </div>
</section>`;
}

function renderPost(post) {
  const canonical = post.canonical_url || `${ORIGIN}${postUrlPath(post)}`;
  return fill(tpl('post.html'), {
    title_tag: esc(post.meta_title || post.title),
    meta_description: esc(post.meta_description),
    canonical: esc(canonical),
    og_image: esc(post.og_image),
    robots_meta: post.robots ? `<meta name="robots" content="${esc(post.robots)}" />` : '',
    json_ld: post.json_ld ? `<script type="application/ld+json">\n${post.json_ld.replace(/<\//g, '<\\/')}\n</script>` : '',
    article_section: renderArticleSection(post),
  });
}

function renderCard(post) {
  const author = post.author ? `<span>${esc(post.author)}</span>                                    ` : '';
  const imageHtml = post.featured_image
    ? `<div class="gl-blog-card-image">
            <img src="${esc(post.featured_image)}" alt="${esc(post.featured_image_alt)}" />
        </div>`
    : '';
  return `<article class="gl-blog-card">
    <a class="gl-blog-card-link" href="${postUrlPath(post)}">
        ${imageHtml}
        <div class="gl-blog-card-content">
            <div class="gl-blog-card-meta">
                ${author}<span>${formatDate(post.date)}</span>
            </div>
            <h2 class="gl-blog-card-title">${esc(post.title)}</h2>
            <div class="gl-blog-card-text line-clamp-3">
${post.excerpt || firstParagraphs(post.body, 3)}
            </div>
        </div>
    </a>
</article>`;
}

// Markup mirrors the static pagination exactly (verified against site/blog/pg/2 and pg/8).
function renderPagination(page, totalPages) {
  const href = (n) => `/blog/pg/${n}/`;
  const prev = page > 1
    ? `<a href="${href(page - 1)}" class="prev">&#171; prev</a>`
    : '<span class="page_disabled prev">&#171; prev</span>';
  const next = page < totalPages
    ? `<a href="${href(page + 1)}" class="next">next &#187;</a>`
    : '<span class="page_disabled next">next &#187;</span>';
  let nums = '';
  for (let n = 1; n <= totalPages; n++) {
    nums += n === page ? `<span class="page_current">${n}</span>` : `<a href="${href(n)}">${n}</a>`;
  }
  return `<div class="pagination">${prev}${nums}${next}</div>`;
}

function renderIndex(allPosts, page) {
  const posts = publishedSorted(allPosts);
  const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  if (page < 1 || page > totalPages) return null;
  const slice = posts.slice((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE);
  // The static mirror's canonical is always /blog/ regardless of page number
  // (verified: site/blog/pg/2, pg/5, pg/8 all emit
  // <link rel="canonical" href="https://baclogistics.co.za/blog/" />) — not
  // a page-specific `?pg=N` URL. Replicated here for markup fidelity.
  const canonical = `${ORIGIN}/blog/`;
  return fill(tpl('index.html'), {
    canonical: esc(canonical),
    cards: slice.map(renderCard).join('\n'),
    pagination: renderPagination(page, totalPages),
  });
}

function renderBlogSitemap(allPosts) {
  const urls = [`${ORIGIN}/blog/`, ...publishedSorted(allPosts).map((p) => ORIGIN + postUrlPath(p))];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
    '\n</urlset>\n';
}

function renderError(title, message) {
  return fill(tpl('error.html'), { error_title: esc(title), error_message: esc(message) });
}

module.exports = {
  renderPost, renderIndex, renderBlogSitemap, renderError,
  publishedSorted, postUrlPath, formatDate, esc, POSTS_PER_PAGE, ORIGIN,
};
