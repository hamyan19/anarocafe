// scripts/generate-blog.js (simplified and fixed for ANARO Cafe)
// This script reads all HTML posts from blog/post, extracts metadata or
// falls back to reasonable defaults, and builds a blog index page,
// RSS feed and sitemap. It uses the template at blog/templates/blog-index.html.

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = process.cwd();
// In this repository posts are stored in blog/post
const POSTS_DIR = path.join(ROOT, 'blog', 'post');
// Use the provided template blog-index.html instead of blog.html
const TPL_FILE = path.join(ROOT, 'blog', 'templates', 'blog-index.html');
const OUT_BLOG = path.join(ROOT, 'blog.html');
const OUT_RSS = path.join(ROOT, 'rss.xml');
const OUT_SITEMAP = path.join(ROOT, 'sitemap.xml');

const SITE_ORIGIN = 'https://anarocafe.vercel.app';
const DEFAULT_COVER = '/blog/assets/images/default.jpg';

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function trim160(s) {
  if (!s) return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 160 ? s.slice(0, 157) + '…' : s;
}

function normalizeTag(t) {
  return t
    .toLowerCase()
    .trim()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '');
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function extractFromMetaBlock(html) {
  // look for <!-- META-START ... META-END --> block
  const m = html.match(/<!--\s*META-START([\s\S]*?)META-END\s*-->/i);
  if (!m) return {};
  const block = m[1];
  // helper to read key: "value"
  const read = key => {
    const re = new RegExp(`${key}\\s*:\\s*"(.*?)"`, 'i');
    const mm = block.match(re);
    return mm ? mm[1].trim() : undefined;
  };
  // tags may be an array literal or comma separated
  let tags;
  const tagsArray = block.match(/tags\s*:\s*\[([\s\S]*?)\]/i);
  if (tagsArray) {
    tags = tagsArray[1]
      .split(',')
      .map(s => s.replace(/["'\s]/g, ''))
      .map(normalizeTag)
      .filter(Boolean);
  } else {
    const line = read('tags');
    if (line) {
      tags = line.split(',').map(normalizeTag);
    }
  }
  return {
    title: read('title'),
    description: read('description'),
    date: read('date'),
    cover: read('cover'),
    author: read('author'),
    tags,
  };
}

// detect a date from text or fallback to file mtime or today
function detectDate(text, stat) {
  const patterns = [
    /\b(\d{4})-(\d{2})-(\d{2})\b/, // 2025-01-15
    /\b(\d{2})\/(\d{2})\/(\d{4})\b/, // 15/01/2025
    /\b(\d{2})-(\d{2})-(\d{4})\b/, // 15-01-2025
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      if (re === patterns[0]) return `${m[1]}-${m[2]}-${m[3]}`;
      if (re === patterns[1]) return `${m[3]}-${m[2]}-${m[1]}`;
      if (re === patterns[2]) return `${m[3]}-${m[2]}-${m[1]}`;
    }
  }
  // fallback: file name like YYYY-MM-DD-xxx.html
  const m2 = text.match(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  // fallback: file modification time
  if (stat) {
    const d = new Date(stat.mtime);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  // default to today
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function extractFallback($, html, fileText, stat) {
  // title: first h1 or first non-empty line
  let title = $('h1').first().text().trim();
  if (!title) {
    const firstLine = (fileText.split(/\r?\n/).find(l => l.trim()) || '').trim();
    title = firstLine.replace(/^#+\s*/, '').trim();
  }
  if (!title) title = path.basename(stat?.filePath || 'bai-viet', '.html');
  // description: meta description or first <p>
  let desc = $('meta[name="description"]').attr('content');
  if (!desc) {
    desc = $('p').first().text().trim() || $('article p').first().text().trim();
  }
  desc = trim160(desc || '');
  // cover: first image or default
  let cover =
    $('img').first().attr('src') ||
    (html.match(/Cover\s*:\s*(https?:\/\/\S+|\S+\.jpg|\S+\.png)/i)?.[1]) ||
    DEFAULT_COVER;
  // tags: lines starting with Tags: or Từ khóa:, hashtags, rel=tag, class containing tag
  let tags = [];
  const tagLine = html.match(/(?:Tags|Từ khóa)\s*:\s*([^\n\r<]+)/i)?.[1];
  if (tagLine) {
    tags.push(...tagLine.split(',').map(normalizeTag));
  }
  // hashtags (#foo)
  const hashMatches = [...fileText.matchAll(/#([\p{L}\p{N}-]{2,})/gu)].map(m => normalizeTag(m[1]));
  tags.push(...hashMatches);
  // rel="tag" or class includes tag
  $('a[rel="tag"]').each((_, el) => tags.push(normalizeTag($(el).text())));
  $('[class*="tag"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 40) tags.push(normalizeTag(t));
  });
  tags = uniq(tags);
  // date
  const plain = $.text();
  const date = detectDate(`${html}\n${plain}\n${stat?.filePath || ''}`, stat);
  return { title, description: desc, cover, tags, date };
}

function loadPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.html'));
  const posts = [];
  for (const fname of files) {
    const fpath = path.join(POSTS_DIR, fname);
    const html = safeRead(fpath);
    if (!html.trim()) continue;
    const stat = fs.statSync(fpath);
    const $ = cheerio.load(html);
    const meta = extractFromMetaBlock(html);
    const autoMeta = extractFallback($, html, html, { ...stat, filePath: fpath });
    const title = meta.title || autoMeta.title;
    const description = meta.description || autoMeta.description;
    const date = meta.date || autoMeta.date;
    const cover = meta.cover || autoMeta.cover;
    const tags = (meta.tags && meta.tags.length ? meta.tags : autoMeta.tags) || [];
    // For consistency with directory structure, construct URL with /blog/post
    const url = `/blog/post/${fname}`;
    posts.push({ title, description, date, cover, tags, url, file: fpath });
  }
  // sort by date desc
  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  return posts;
}

function renderTagsFilter(allTags) {
  if (!allTags.length) return '';
  allTags.sort();
  return allTags
    .map(t => `<button class="tag-filter" data-tag="${t}">${t}</button>`)
    .join('\n');
}

function renderPostCard(p) {
  const tagsHtml = (p.tags || [])
    .slice(0, 6)
    .map(t => `<span class="post-tag">#${t}</span>`)
    .join('');
  const dataTags = (p.tags || []).join(',');
  const alt = p.title.replace(/"/g, '&quot;');
  return `
    <article class="post-card" data-tags="${dataTags}">
      <div class="post-image">
        <a href="${p.url}"><img src="${p.cover}" alt="${alt}" loading="lazy"></a>
      </div>
      <div class="post-content">
        <h3 class="post-title"><a href="${p.url}">${p.title}</a></h3>
        <p class="post-excerpt">${p.description || ''}</p>
        <div class="post-tags">${tagsHtml}</div>
      </div>
    </article>`.trim();
}

function buildRSS(posts) {
  const items = posts
    .map(p => `
      <item>
        <title><![CDATA[${p.title}]]></title>
        <link>${SITE_ORIGIN}${p.url}</link>
        <guid>${SITE_ORIGIN}${p.url}</guid>
        <pubDate>${new Date(p.date).toUTCString()}</pubDate>
        <description><![CDATA[${p.description || ''}]]></description>
      </item>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
    <channel>
      <title>ANARO Coffee Blog</title>
      <link>${SITE_ORIGIN}/blog.html</link>
      <description>Blog về cà phê, pha chế và kinh doanh quán.</description>
    ${items}
    </channel>
    </rss>`;
}

function buildSitemap(posts) {
  const urls = [
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/blog.html`,
    ...posts.map(p => `${SITE_ORIGIN}${p.url}`),
  ];
  const urlset = urls
    .map(u => `
      <url>
        <loc>${u}</loc>
      </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urlset}
    </urlset>`;
}

(async () => {
  // read template or fallback
  let tpl = safeRead(TPL_FILE);
  if (!tpl.trim()) tpl = safeRead(path.join(ROOT, 'blog.html'));
  if (!tpl.trim()) {
    console.error('Không tìm thấy template blog-index.html hoặc blog.html');
    process.exit(1);
  }
  const posts = loadPosts();
  const allTags = uniq(posts.flatMap(p => p.tags || []));
  const postsHTML = posts.map(renderPostCard).join('\n');
  const tagsHTML = renderTagsFilter(allTags);
  const lastUpdate = new Date();
  const lastStr = `${lastUpdate.getFullYear()}-${String(lastUpdate.getMonth() + 1).padStart(2, '0')}-${String(lastUpdate.getDate()).padStart(2, '0')}`;
  let out = tpl
    .replace('{{POSTS}}', postsHTML)
    .replace('{{TAGS_FILTER}}', tagsHTML)
    .replace('{{POSTS_COUNT}}', String(posts.length))
    .replace('{{LAST_UPDATE}}', lastStr)
    .replace('{{PAGINATION}}', ''); // static pagination placeholder
  await fs.writeFile(OUT_BLOG, out, 'utf8');
  await fs.writeFile(OUT_RSS, buildRSS(posts), 'utf8');
  await fs.writeFile(OUT_SITEMAP, buildSitemap(posts), 'utf8');
  console.log(`Generated: ${path.relative(ROOT, OUT_BLOG)}, ${path.relative(ROOT, OUT_RSS)}, ${path.relative(ROOT, OUT_SITEMAP)}`);
})();