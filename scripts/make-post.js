// scripts/make-post.js
// Tạo bài post HTML đầy đủ từ file nháp chỉ có nội dung (HTML thô)

const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

// =========== helpers ===========
const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const stripHtml = (html) =>
  cheerio.load(`<div id="x">${html}</div>`)('#x').text().replace(/\s+/g, ' ').trim();

const truncate160 = (s) => {
  if (!s) return '';
  if (s.length <= 160) return s;
  const cut = s.slice(0, 160);
  const i = Math.max(cut.lastIndexOf(' '), 120);
  return cut.slice(0, i) + '…';
};

const deaccent = (str) =>
  str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');

const slugify = (s) =>
  deaccent(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'post';

const unique = (arr) => [...new Set(arr.filter(Boolean).map((t) => t.trim()).filter(Boolean))];

const ensureIdForHeadings = ($) => {
  $('h2, h3').each((_, el) => {
    const $el = $(el);
    if (!$el.attr('id')) {
      $el.attr('id', slugify($el.text()));
    }
  });
};

const addLazyToImages = ($) => {
  $('img').each((_, img) => {
    const $img = $(img);
    if (!$img.attr('loading')) $img.attr('loading', 'lazy');
  });
};

// parse CLI overrides
const argv = process.argv.slice(2);
if (!argv[0]) {
  console.error('Usage: node scripts/make-post.js <draft-path> [--title "..."] [--description "..."] [--tags "a,b"] [--date "YYYY-MM-DD"] [--cover "url"]');
  process.exit(1);
}
const draftPath = argv[0];
const getFlag = (name) => {
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return '';
};

// =========== main ===========
(async () => {
  const repoRoot = process.cwd();
  const absDraft = path.join(repoRoot, draftPath);
  if (!(await fs.pathExists(absDraft))) {
    console.error(`Không thấy file nháp: ${draftPath}`);
    process.exit(1);
  }

  const raw = await fs.readFile(absDraft, 'utf8');
  const $doc = cheerio.load(raw, { decodeEntities: false });

  // Nếu người dùng dán cả trang HTML, ưu tiên body; nếu chỉ nội dung, lấy nguyên
  let innerHtml = '';
  if ($doc('body').length) innerHtml = $doc('body').html() || '';
  else innerHtml = raw;

  const $ = cheerio.load(innerHtml, { decodeEntities: false });

  // ---- title ----
  let title = getFlag('title') || $('h1').first().text().trim();
  if (!title) {
    const firstTextLine = stripHtml(innerHtml).split('\n').map(s => s.trim()).find(Boolean);
    title = firstTextLine || 'Bài viết mới';
  }

  // ---- description ----
  let description = getFlag('description') || truncate160(stripHtml($('p').first().html() || stripHtml(innerHtml)));

  // ---- cover ----
  let cover =
    getFlag('cover') ||
    $('img').first().attr('src') ||
    (raw.match(/^\s*Cover:\s*(\S+)/mi) ? RegExp.$1 : '') ||
    './blog/assets/images/default.jpg';

  // ---- tags ----
  const overrideTags = getFlag('tags'); // "pha che, ca phe phin"
  let tags = [];
  if (overrideTags) {
    tags = overrideTags.split(',').map((t) => t.trim()).filter(Boolean);
  } else {
    // 1) Dòng "Tags:" / "Từ khóa:"
    const tagLine = (raw.match(/^\s*(Tags|Từ khóa)\s*:\s*(.+)$/gim) || [])[0];
    if (tagLine) {
      const m = tagLine.split(':').slice(1).join(':');
      tags = tags.concat(m.split(',').map((t) => t.trim()));
    }
    // 2) hashtags #aaa-bbb
    const hashtagRe = /#[\p{L}\p{N}_-]+/gu;
    const found = (stripHtml(innerHtml).match(hashtagRe) || []).map((h) => h.replace(/^#/, ''));
    tags = tags.concat(found);
    // 3) rel="tag" hoặc class chứa 'tag'
    $('a[rel="tag"], .tag, [class*="tag"]').each((_, el) => {
      const t = $(el).text().trim();
      if (t) tags.push(t);
    });
    // chuẩn hoá
    tags = unique(tags).map((t) => slugify(t).replace(/-/g, ' ')).slice(0, 8);
    if (!tags.length) tags = ['blog'];
  }

  // ---- date ----
  let date = getFlag('date') || '';
  if (!date) {
    const text = raw;
    let m =
      text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) || // YYYY-MM-DD
      text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/) || // DD/MM/YYYY
      text.match(/\b(\d{2})-(\d{2})-(\d{4})\b/); // DD-MM-YYYY
    if (m) {
      if (m[1].length === 4) {
        date = `${m[1]}-${m[2]}-${m[3]}`;
      } else {
        date = `${m[3]}-${m[2]}-${m[1]}`;
      }
    } else {
      date = todayStr();
    }
  }

  // ---- author ----
  const author = 'ANARO Coffee';

  // Chuẩn hoá headings + lazy image
  ensureIdForHeadings($);
  addLazyToImages($);

  const articleHtml = $('body').length ? $('body').html() : $.root().html();

  // slug + filename
  const slug = slugify(title);
  const filename = `${date}-${slug}.html`;
  const outDir = path.join(repoRoot, 'blog', 'posts');
  await fs.ensureDir(outDir);

  // Tránh đè file nếu trùng
  let finalName = filename;
  let k = 2;
  while (await fs.pathExists(path.join(outDir, finalName))) {
    finalName = `${date}-${slug}-${k}.html`;
    k++;
  }

  // category = tag đầu tiên (nếu có)
  const category = (tags[0] || 'blog').toString();

  // canonical
  const canonical = `https://anarocafe.vercel.app/blog/posts/${finalName}`;

  // META comment for generator
  const metaComment = `<!-- META-START
title: "${title.replace(/"/g, '\\"')}"
description: "${description.replace(/"/g, '\\"')}"
tags: ${JSON.stringify(tags)}
date: "${date}"
cover: "${cover}"
author: "${author}"
META-END -->`;

  // Full page template (dùng post.css)
  const page = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <link rel="stylesheet" href="/blog/assets/css/post.css">
  <!-- Open Graph -->
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${cover}">
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${cover}">
</head>
<body>
${metaComment}
<header class="header" role="banner">
  <div class="header-container">
    <a href="/" class="logo" aria-label="Trang chủ ANARO Coffee">☕ ANARO Coffee</a>
    <nav role="navigation" aria-label="Breadcrumb" class="breadcrumb">
      <a href="/blog.html">Blog</a>
      <span class="breadcrumb-separator" aria-hidden="true">›</span>
      <span>${title}</span>
    </nav>
  </div>
</header>

<div class="main-container">
  <main id="main-content" class="article-content" role="main">
    <header class="article-header">
      <span class="article-category">${category}</span>
      <h1 class="article-title">${title}</h1>
      <p class="article-excerpt">${description}</p>
      <div class="article-meta">
        <div class="meta-item"><time datetime="${date}">${date.split('-').reverse().join('/')}</time></div>
        <div class="meta-item"><span>${author}</span></div>
        <div class="meta-item reading-time">5 phút đọc</div>
      </div>
    </header>
    <article class="article-body">
      ${articleHtml}
    </article>
  </main>

  <aside class="sidebar" role="complementary" aria-label="Nội dung liên quan">
    <div class="sidebar-widget">
      <div class="widget-header">📋 Mục lục</div>
      <nav class="widget-content" aria-label="Mục lục bài viết">
        <ul class="toc-list">
          ${(() => {
            const $$ = cheerio.load(articleHtml);
            const items = [];
            $$('h2[id], h3[id]').each((_, el) => {
              const id = $$(el).attr('id');
              const txt = $$(el).text().trim();
              items.push(`<li class="toc-item"><a href="#${id}">${txt}</a></li>`);
            });
            return items.join('\n');
          })()}
        </ul>
      </nav>
    </div>
  </aside>
</div>

<script>
// TOC highlight
document.addEventListener('DOMContentLoaded',function(){
  const tocLinks=[...document.querySelectorAll('.toc-list a')];
  const sections=[...document.querySelectorAll('h2[id],h3[id]')];
  tocLinks.forEach(a=>a.addEventListener('click',e=>{
    e.preventDefault();
    const id=a.getAttribute('href').slice(1);
    const t=document.getElementById(id);
    if(t) t.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  let ticking=false;
  const onScroll=()=>{
    if(!ticking){
      requestAnimationFrame(()=>{
        const y=window.scrollY+150;
        let cur='';
        sections.forEach(s=>{ if(y >= s.offsetTop) cur=s.id; });
        tocLinks.forEach(l=>{
          l.classList.toggle('active', l.getAttribute('href')==='#'+cur);
        });
        ticking=false;
      });
      ticking=true;
    }
  };
  window.addEventListener('scroll',onScroll);
  onScroll();
});
</script>
</body>
</html>`;

  const outPath = path.join(outDir, finalName);
  await fs.writeFile(outPath, page, 'utf8');

  console.log(`✅ Created: blog/posts/${finalName}`);
})();
