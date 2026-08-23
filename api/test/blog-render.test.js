'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const render = require('../src/lib/blog/render');

// Deliberately /couch/uploads/ — what all 90 live posts still store post-Stage-6a (mapped
// at render time). This is the map's INPUT, not a repo file ref — must not be rewritten.
const post = (over = {}) => ({
  title: 'Test Post Heading', name: 'test-post', folder: null, date: '2026-03-24',
  author: '', featured_image: '/couch/uploads/image/blog/x.png', featured_image_alt: 'Alt text',
  excerpt: '', body: '<p>One</p><p>Two</p><p>Three</p><p>Four</p>', tags: ['Tag A', 'Tag B'],
  meta_title: 'Test Post', meta_description: 'Desc', og_image: '', canonical_url: '',
  robots: '', json_ld: '', youtube_id: '', youtube_title: '', unpublished: false, ...over,
});

test('renderPost fills head and article', () => {
  const html = render.renderPost(post());
  assert.ok(html.includes('<title>Test Post</title>'));
  assert.ok(html.includes('href="https://baclogistics.co.za/blog/test-post.html"'));
  assert.ok(html.includes('<h1 class="gl-blog-article-title">Test Post Heading</h1>'));
  assert.ok(html.includes('<span class="gl-blog-article-date">24 March 2026</span>'));
  assert.ok(html.includes('<strong>Tags:</strong> Tag A, Tag B'));
  assert.ok(html.includes('GTM-MPPHRHH')); // chrome survived tokenizing
  assert.ok(!html.includes('{{'));         // no unfilled tokens
});

// Counts only the per-post block. The chrome carries a sitewide Organization
// script on every page, so "no JSON-LD at all" stopped being the right assertion.
const postJsonLd = (html) => html
  .replace(/<!-- @chrome:org-schema -->[\s\S]*?<!-- @end:org-schema -->/, '')
  .includes('application/ld+json');

test('renderPost adds video, json_ld and robots only when present', () => {
  const plain = render.renderPost(post());
  assert.ok(!plain.includes('gl-blog-article-video'));
  assert.ok(!postJsonLd(plain), 'a post with no json_ld must not emit a post-level block');
  assert.ok(plain.includes('"@type": "Organization"'), 'sitewide Organization schema is missing');
  const rich = render.renderPost(post({
    youtube_id: 'lyvv36Vc2m4', json_ld: '{"@type":"NewsArticle"}', robots: 'noindex',
  }));
  assert.ok(rich.includes('youtube.com/embed/lyvv36Vc2m4'));
  assert.ok(postJsonLd(rich));
  assert.ok(rich.includes('content="noindex"'));
  const sneaky = render.renderPost(post({ json_ld: '{"x":"</script><img src=x>"}' }));
  assert.ok(!sneaky.includes('</script><img'));
  assert.ok(sneaky.includes('<\\/script>'));
});

test('og:image falls back featured_image -> site default, and is always absolute', () => {
  // No post in production carries an og_image; every one carries a featured_image.
  const inherited = render.renderPost(post());
  assert.ok(inherited.includes(
    'property="og:image" content="https://baclogistics.co.za/blog/media/x.webp"'));
  assert.ok(inherited.includes(
    'name="twitter:image" content="https://baclogistics.co.za/blog/media/x.webp"'));

  // An explicit og_image still wins over featured_image, and is mapped the same way.
  const explicit = render.renderPost(post({ og_image: '/couch/uploads/image/blog/share.png' }));
  assert.ok(explicit.includes(
    'property="og:image" content="https://baclogistics.co.za/blog/media/share.webp"'));

  // /admin/ accepts free text, so an author-supplied absolute URL must survive untouched.
  const external = render.renderPost(post({ og_image: 'https://cdn.example.com/a.png' }));
  assert.ok(external.includes('property="og:image" content="https://cdn.example.com/a.png"'));

  // Neither field set: falls back to a STATIC repo asset (not a blog image), so it must
  // NOT be mapped into /blog/media/ — nothing was uploaded under that name, would 404.
  const bare = render.renderPost(post({ og_image: '', featured_image: '' }));
  assert.ok(bare.includes(
    'property="og:image" content="https://baclogistics.co.za/media/home/bac-header1.webp"'));

  // Never a relative or empty value, whatever the input.
  for (const html of [inherited, explicit, external, bare]) {
    assert.ok(!/content="" \/>\s*\n\s*<meta name="twitter:card"/.test(html));
    assert.ok(!html.includes('property="og:image" content="/'));
  }
});

test('Stage 6a: blog images resolve to Blob Storage, everything else is left alone', () => {
  // The 87 came from two directories — the flat image/ folder (61) and image/blog/ (26).
  // Directory is not the discriminator, so both must map identically.
  const flat = render.renderPost(post({ featured_image: '/couch/uploads/image/aog.jpg' }));
  assert.ok(flat.includes('<img src="/blog/media/aog.webp"'));
  const nested = render.renderPost(post({ featured_image: '/couch/uploads/image/blog/aog.jpg' }));
  assert.ok(nested.includes('<img src="/blog/media/aog.webp"'));

  // Both source extensions in the set become .webp — all 87 were re-encoded on upload.
  for (const [src, want] of [['a.jpg', 'a.webp'], ['b.png', 'b.webp'], ['c.JPEG', 'c.webp']]) {
    const html = render.renderPost(post({ featured_image: `/couch/uploads/image/${src}` }));
    assert.ok(html.includes(`<img src="/blog/media/${want}"`), src);
  }

  // A dotted basename keeps every dot but the last — the map must agree with the
  // splitext() the upload script used to name the blob, or the URL points at nothing.
  const dotted = render.renderPost(post({ featured_image: '/couch/uploads/image/a.b.jpg' }));
  assert.ok(dotted.includes('<img src="/blog/media/a.b.webp"'));

  // Images uploaded through /admin/ are already /blog/media/ and are stored exactly as
  // uploaded — mapping them, or swapping their extension, would 404 a working image.
  const uploaded = render.renderPost(post({ featured_image: '/blog/media/photo-1753728000000.png' }));
  assert.ok(uploaded.includes('<img src="/blog/media/photo-1753728000000.png"'));

  // Index cards go through the same map as the article body.
  const index = render.renderIndex([post()], 1);
  assert.ok(index.includes('<img src="/blog/media/x.webp"'));
  assert.ok(!index.includes('/couch/uploads/image/blog/x.png'));

  // Six posts name their image inside json_ld too, embedded in a JSON string rather
  // than being the whole field.
  const ld = render.renderPost(post({
    json_ld: '{"image":"/couch/uploads/image/blog/y.png","logo":"/couch/uploads/image/header/l.png"}',
  }));
  assert.ok(ld.includes('"image":"/blog/media/y.webp"'));
  assert.ok(ld.includes('"logo":"/blog/media/l.webp"'));
  // Scoped to the json_ld string itself — replace() runs on that value alone, so it
  // can't touch a /couch/ reference anywhere else the template might carry.
  const ldBlock = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(ld)[1];
  assert.ok(!ldBlock.includes('/couch/uploads/'));

  // No post-owned reference should still point at the retired path.
  assert.ok(!render.renderPost(post()).includes('/couch/uploads/image/blog/x.png'));
});

test('post head carries populated social metadata', () => {
  const html = render.renderPost(post());
  assert.ok(html.includes('property="og:type" content="article"'));
  assert.ok(html.includes('property="og:locale" content="en_ZA"'));
  assert.ok(html.includes('property="og:site_name" content="BAC Logistics"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  // og:description mirrors the meta description rather than rendering empty.
  assert.ok(html.includes('property="og:description" content="Desc"'));
  assert.ok(html.includes('name="twitter:description" content="Desc"'));
  assert.ok(!html.includes('twitter:site'));   // no X account to attribute to
});

test('blog index head carries populated social metadata', () => {
  const html = render.renderIndex([post()], 1);
  assert.ok(html.includes('property="og:type" content="website"'));
  assert.ok(html.includes('property="og:locale" content="en_ZA"'));
  assert.ok(html.includes(
    'property="og:image" content="https://baclogistics.co.za/media/blog/news.webp"'));
  assert.ok(html.includes(
    'name="twitter:image" content="https://baclogistics.co.za/media/blog/news.webp"'));
});

test('folder posts get folder URLs', () => {
  assert.strictEqual(render.postUrlPath(post({ folder: 'road-freight' })),
    '/blog/road-freight/test-post.html');
});

test('renderIndex paginates 12 per page, hides unpublished, sorts date desc', () => {
  const posts = [];
  for (let i = 1; i <= 14; i++) {
    posts.push(post({ name: `p${i}`, title: `P${i}`, date: `2026-01-${String(i).padStart(2, '0')}` }));
  }
  posts.push(post({ name: 'hidden', unpublished: true, date: '2026-02-01' }));
  const page1 = render.renderIndex(posts, 1);
  assert.ok(page1.includes('/blog/p14.html'));  // newest first
  assert.ok(!page1.includes('/blog/hidden.html'));
  assert.ok(page1.includes('<span class="page_current">1</span>'));
  assert.ok(page1.includes('href="/blog/pg/2/"'));
  const page2 = render.renderIndex(posts, 2);
  assert.ok(page2.includes('/blog/p1.html'));   // oldest lands on page 2
  assert.strictEqual(render.renderIndex(posts, 3), null);
});

test('excerpt falls back to first three body paragraphs', () => {
  const html = render.renderIndex([post()], 1);
  assert.ok(html.includes('<p>Three</p>'));
  assert.ok(!html.includes('<p>Four</p>'));
});

test('renderBlogSitemap lists index + published posts', () => {
  const xml = render.renderBlogSitemap([post(), post({ name: 'z', unpublished: true })]);
  assert.ok(xml.includes('<loc>https://baclogistics.co.za/blog/</loc>'));
  assert.ok(xml.includes('<loc>https://baclogistics.co.za/blog/test-post.html</loc>'));
  assert.ok(!xml.includes('/blog/z.html'));
});

test('renderError produces branded page', () => {
  const html = render.renderError('Blog briefly unavailable', 'Try again shortly.');
  assert.ok(html.includes('Blog briefly unavailable'));
  assert.ok(!html.includes('{{'));
  assert.ok(!html.includes('404'));
  assert.ok(html.includes('<h1>Blog briefly unavailable</h1>'));
});
