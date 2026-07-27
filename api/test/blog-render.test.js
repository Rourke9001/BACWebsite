'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const render = require('../src/lib/blog/render');

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

test('renderPost adds video, json_ld and robots only when present', () => {
  const plain = render.renderPost(post());
  assert.ok(!plain.includes('gl-blog-article-video'));
  assert.ok(!plain.includes('application/ld+json'));
  const rich = render.renderPost(post({
    youtube_id: 'lyvv36Vc2m4', json_ld: '{"@type":"NewsArticle"}', robots: 'noindex',
  }));
  assert.ok(rich.includes('youtube.com/embed/lyvv36Vc2m4'));
  assert.ok(rich.includes('application/ld+json'));
  assert.ok(rich.includes('content="noindex"'));
  const sneaky = render.renderPost(post({ json_ld: '{"x":"</script><img src=x>"}' }));
  assert.ok(!sneaky.includes('</script><img'));
  assert.ok(sneaky.includes('<\\/script>'));
});

test('og:image falls back featured_image -> site default, and is always absolute', () => {
  // No post in production carries an og_image; every one carries a featured_image.
  const inherited = render.renderPost(post());
  assert.ok(inherited.includes(
    'property="og:image" content="https://baclogistics.co.za/couch/uploads/image/blog/x.png"'));
  assert.ok(inherited.includes(
    'name="twitter:image" content="https://baclogistics.co.za/couch/uploads/image/blog/x.png"'));

  // An explicit og_image still wins over featured_image.
  const explicit = render.renderPost(post({ og_image: '/couch/uploads/image/blog/share.png' }));
  assert.ok(explicit.includes(
    'property="og:image" content="https://baclogistics.co.za/couch/uploads/image/blog/share.png"'));

  // /admin/ accepts free text, so an author-supplied absolute URL must survive untouched.
  const external = render.renderPost(post({ og_image: 'https://cdn.example.com/a.png' }));
  assert.ok(external.includes('property="og:image" content="https://cdn.example.com/a.png"'));

  // Neither field set — a future post saved without an image still shares something.
  const bare = render.renderPost(post({ og_image: '', featured_image: '' }));
  assert.ok(bare.includes(
    'property="og:image" content="https://baclogistics.co.za/couch/uploads/image/home/bac-header1.webp"'));

  // Never a relative or empty value, whatever the input.
  for (const html of [inherited, explicit, external, bare]) {
    assert.ok(!/content="" \/>\s*\n\s*<meta name="twitter:card"/.test(html));
    assert.ok(!html.includes('property="og:image" content="/'));
  }
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
    'property="og:image" content="https://baclogistics.co.za/couch/uploads/image/blog/news.webp"'));
  assert.ok(html.includes(
    'name="twitter:image" content="https://baclogistics.co.za/couch/uploads/image/blog/news.webp"'));
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
