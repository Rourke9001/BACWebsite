'use strict';

const { routeBlogPath } = require('./router');
const render = require('./render');

const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' };

// A permanent redirect for a URL the old site owned. Cached hard: these targets
// only change if a post is renamed, which re-mints the redirect anyway.
function movedTo(location) {
  return {
    status: 301,
    headers: { Location: location, 'Cache-Control': 'public, max-age=3600' },
    body: '',
  };
}

function notFound() {
  return {
    status: 404,
    headers: { ...HTML, 'Cache-Control': 'no-store' },
    body: render.renderError('Page not found', 'That blog page does not exist. Visit /blog/ for the latest posts.'),
  };
}

async function handleBlogRequest(pathname, deps) {
  const publicPath = pathname.replace(/^\/api(?=\/)/, '');

  if (publicPath === '/sitemap-blog.xml') {
    try {
      const posts = await deps.getPosts();
      return {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
        body: render.renderBlogSitemap(posts),
      };
    } catch (err) {
      deps.log(`sitemap-blog storage failure: ${err.message}`);
      return { status: 503, headers: { 'Cache-Control': 'no-store' }, body: '' };
    }
  }

  const route = routeBlogPath(publicPath);

  if (route.kind === 'media') {
    const media = await deps.getMedia(route.file).catch((err) => {
      deps.log(`media read failure: ${err.message}`);
      return null;
    });
    if (!media) return notFound();
    return {
      status: 200,
      headers: { 'Content-Type': media.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: media.buffer,
    };
  }

  // Resolved before the post load below, because a retired URL must still redirect
  // during a storage outage — a 503 on a 2019 inbound link is worse than a guess.
  if (route.kind === 'legacy') {
    if (!route.slug) return movedTo('/blog/');
    const posts = await deps.getPosts().catch((err) => {
      deps.log(`legacy redirect degraded, storage unavailable: ${err.message}`);
      return [];
    });
    // Matched on slug alone: posts were reorganised into folders after these URLs
    // were minted, so the folder in the old path is a hint, not an identity.
    const post = posts.find((p) => p.name === route.slug && !p.unpublished);
    if (!post) return movedTo('/blog/');
    return movedTo(post.folder ? `/blog/${post.folder}/${post.name}.html` : `/blog/${post.name}.html`);
  }

  let posts;
  try {
    posts = await deps.getPosts();
  } catch (err) {
    deps.log(`blog storage failure: ${err.message}`);
    return {
      status: 503,
      headers: { ...HTML, 'Cache-Control': 'no-store' },
      body: render.renderError('Blog briefly unavailable',
        'Our blog is having a moment — please try again in a minute. The rest of the site is unaffected.'),
    };
  }

  if (route.kind === 'index') {
    const html = render.renderIndex(posts, route.page);
    if (html == null) return notFound();
    return { status: 200, headers: HTML, body: html };
  }

  if (route.kind === 'post') {
    const post = posts.find((p) =>
      p.name === route.slug && (p.folder || null) === route.folder && !p.unpublished);
    if (!post) return notFound();
    return { status: 200, headers: HTML, body: render.renderPost(post) };
  }

  return notFound();
}

module.exports = { handleBlogRequest };
