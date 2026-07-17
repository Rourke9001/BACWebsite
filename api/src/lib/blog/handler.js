'use strict';

const { routeBlogPath } = require('./router');
const render = require('./render');

const HTML = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' };

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
