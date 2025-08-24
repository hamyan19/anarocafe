#!/usr/bin/env node
/**
 * make-inline-post.js
 * - Đọc content thô (HTML/Markdown/Plain text)
 * - Trích meta: title/description/tags/date/cover (+author mặc định)
 * - Dựng HTML post hoàn chỉnh, CSS inline
 * - Ghi META block <!-- META-START ... META-END -->
 * - Lưu file vào: blog/posts/YYYY-MM-DD-slug.html
 *
 * Dùng:
 *   node scripts/make-inline-post.js --input drafts/abc.html --css scripts/post-inline.css
 *   # hoặc đọc từ STDIN:
 *   cat drafts/abc.txt | node scripts/make-inline-post.js --css scripts/post-inline.css
 */

const fs = require('fs-extra');
const path = require('path');

// ===== Helpers =====
const readStdin = async () =>
  new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function stripHtml(html) {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSlug(str) {
  if (!str) return 'bai-viet';
  // bỏ dấu tiếng Việt + ký tự đặc biệt
  let s = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'bai-viet';
}

function firstNonEmptyLine(text) {
  const lines = (text || '').split(/\r?\n/).map(l => l.trim());
  return lines.find(l => l.length > 0) || '';
}

function findFirstImage(content) {
  // HTML <img>
  const mImg = content.match(/<img[^>]+src=[\"']([^\"']+)[\"']/i);
  if (mImg) return mImg[1];
  // Markdown ![alt](url)
  const mMd = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (mMd) return mMd[1];
  // Fallback "Cover: http(s)://..."
  const mLine = content.match(/^\s*Cover:\s*(https?:\/\/\S+)/im);
  if (mLine) return mLine[1];
  return null;
}

function extractDate(raw) {
  // YYYY-MM-DD
  let m = raw.match(/\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (m) return m[0];
  // DD/MM/YYYY
  m = raw.match(/\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(20\d{2}|19\d{2})\b/);
  if (m) {
    const [d, mo, y] = m[0].split('/');
    const dd = String(d).padStart(2, '0');
    const mm = String(mo).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  // DD-MM-YYYY
  m = raw.match(/\b(0?[1-9]|[12]\d|3[01])-(0?[1-9]|1[0-2])-(20\d{2}|19\d{2})\b/);
  if (m) {
    const [d, mo, y] = m[0].split('-');
    const dd = String(d).padStart(2, '0');
    const mm = String(mo).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  // hôm nay (UTC) -> YYYY-MM-DD
  return new Date().toISOString().slice(0, 10);
}

function extractTitle(raw) {
  // <h1>...</h1>
  let m = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) return stripHtml(m[1]).trim();
  // Markdown "# ..."
  m = raw.match(/^\s*#\s+(.+)$/m);
  if (m) return m[1].trim();
  // Dòng đầu
  return firstNonEmptyLine(stripHtml(raw));
}

function extractDescription(raw) {
  // đoạn văn đầu tiên từ <p> hoặc từ dòng đầu
  let m = raw.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  let text = stripHtml(m ? m[1] : raw);
  // rút gọn ~160 ký tự
  let out = text.slice(0, 200).trim();
  if (out.length > 160) {
    // cố gắng cắt ở từ
    const cut = out.lastIndexOf(' ', 160);
    out = out.slice(0, cut > 60 ? cut : 160).trim() + '…';
  }
  return out;
}

function extractTags(raw) {
  // 1) "Tags:" hoặc "Từ khóa:"
  let m = raw.match(/^\s*(Tags|Từ khóa)\s*:\s*(.+)$/im);
  if (m) {
    return m[2]
      .split(',')
      .map(s => toSlug(s.trim()))
      .filter(Boolean)
      .slice(0, 8);
  }
  // 2) hashtag #abc-def
  const hs = Array.from(
    new Set((raw.match(/#[\p{L}0-9\-]+/gu) || []).map(h => toSlug(h.replace(/^#/, ''))))
  );
  if (hs.length) return hs.slice(0, 8);
  // 3) rel="tag" / class chứa "tag"
  const rel = Array.from(
    raw.matchAll(/<a[^>]+rel=[\"']tag[\"'][^>]*>([^<]+)<\/a>/gi)
  ).map(m => toSlug(stripHtml(m[1])));
  const cls = Array.from(
    raw.matchAll(/<a[^>]+class=[\"'][^\"']*tag[^\"']*[\"'][^>]*>([^<]+)<\/a>/gi)
  ).map(m => toSlug(stripHtml(m[1])));
  const merged = Array.from(new Set([...rel, ...cls])).filter(Boolean);
  if (merged.length) return merged.slice(0, 8);
  // 4) fallback rỗng
  return [];
}

function ensureIdsForHeadings(html) {
  // thêm id cho h2/h3 nếu thiếu
  return html.replace(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) => {
    const hasId = /\sid=[\"'][^\"']+[\"']/.test(attrs);
    const text = stripHtml(inner);
    const id = toSlug(text);
    const newAttrs = hasId ? attrs : `${attrs} id="${id}"`;
    return `<${tag}${newAttrs}>${inner}</${tag}>`;
  });
}

function buildTOC(html) {
  const items = [];
  html.replace(/<(h2|h3)[^>]*id=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, id, inner) => {
    const text = stripHtml(inner);
    items.push({ level: tag.toLowerCase(), id, text });
  });
  if (!items.length) return '';
  return `
      <div class="sidebar-widget">
        <div class="widget-header"> Mục Lục</div>
        <div class="widget-content">
          <ul class="toc-list" style="list-style:none;padding:0;margin:0;">
            ${items
              .map(it => `<li style="margin:4px 0;"><a class="toc-item" href="#${it.id}">${it.text}</a></li>`)
              .join('\n')}
          </ul>
        </div>
      </div>`;
}

function estimateReadingTime(text) {
  const words = (stripHtml(text).match(/\S+/g) || []).length;
  return Math.max(1, Math.round(words / 200));
}

// very-light MD → HTML (đủ dùng với content thô)
function lightMarkdownToHtml(src) {
  let s = src;
  // images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `<img src="${url}" alt="${alt}" class="article-image" loading="lazy">`);
  // links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // headings
  s = s.replace(/^\s*###\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^\s*##\s+(.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^\s*#\s+(.+)$/gm, '<h1>$1</h1>');
  // paragraphs (đoạn cách bởi 2 newline)
  s = s
    .split(/\n{2,}/)
    .map(block => {
      if (/^\s*<.+>\s*$/.test(block.trim())) return block;
      return `<p>${block.trim().replace(/\n/g, ' ')}</p>`;
    })
    .join('\n');
  return s;
}

(async () => {
  try {
    const inputPath = arg('input', null);
    const cssPath = arg('css', null);
    // Output directory for generated posts. Use blog/post (singular) for consistency with existing repo
    const outDir = arg('out', 'blog/post');
    const author = arg('author', 'ANARO Coffee');
    const category = arg('category', 'Hướng dẫn');
    const siteOrigin = arg('origin', 'https://anarocafe.vercel.app');

    let raw = '';
    if (inputPath) {
      raw = await fs.readFile(inputPath, 'utf8');
    } else {
      raw = await readStdin();
    }
    if (!raw || !raw.trim()) {
      console.error('❌ Không có content. Hãy dùng --input <file> hoặc pipe qua STDIN.');
      process.exit(1);
    }

    // vệ sinh 1 số brand không mong muốn
    raw = raw.replace(/vinbarista/gi, '').trim();

    // ==== Extract meta
    const title = extractTitle(raw);
    const description = extractDescription(raw);
    const tags = extractTags(raw);
    const date = extractDate(raw);
    const cover = findFirstImage(raw) || '/blog/assets/images/default.jpg';
    const slug = toSlug(title);
    const filename = `${date}-${slug}.html`;
    // Construct canonical URL consistent with blog/post path
    const canonical = `${siteOrigin}/blog/post/${filename}`;
    const readingMin = estimateReadingTime(raw);

    // ==== Prepare body HTML
    let bodyHtml = '';
    const looksHtml = /<\/?[a-z][\s\S]*/i.test(raw);
    if (looksHtml) {
      // nếu đã là HTML: lấy phần trong <body> nếu có, else dùng raw
      const mBody = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      bodyHtml = mBody ? mBody[1] : raw;
    } else {
      // Markdown / Plain text
      bodyHtml = lightMarkdownToHtml(raw);
    }

    // ensure ids for headings, TOC
    bodyHtml = ensureIdsForHeadings(bodyHtml);
    const tocHtml = buildTOC(bodyHtml);

    // ==== CSS inline
    let css = '';
    if (cssPath) {
      css = await fs.readFile(cssPath, 'utf8');
    } else {
      css = `
            /* Minimal fallback CSS (khuyên dùng --css để chèn full CSS của bạn) */
            body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;color:#2a221d;background:#f6efe9}
            .main-container{max-width:1200px;margin:0 auto;padding:24px;display:grid;grid-template-columns:1fr 300px;gap:40px}
            .article-content{background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e9d7c5}
            .article-header{padding:24px}
            .article-title{margin:0 0 10px 0}
            .article-body{padding:24px}
            .article-image{width:100%;border-radius:12px;margin:20px 0}
            .sidebar{position:sticky;top:80px;display:flex;flex-direction:column;gap:20px}
            .sidebar-widget{background:#fff;border:1px solid #e9d7c5;border-radius:12px;overflow:hidden}
            .widget-header{background:#6b3f25;color:#fff;padding:12px 16px;font-weight:700}
            .widget-content{padding:16px}
            .breadcrumb{display:flex;gap:8px;color:#806a5b;padding:0 24px 16px}
          `.trim();
    }

    // ==== Build HTML
    const metaBlock = `<!-- META-START
    title: "${title.replace(/"/g, '\\"')}"
    description: "${description.replace(/"/g, '\\"')}"
    tags: [${tags.map(t => `\"${t}\"`).join(', ')}]
    date: "${date}"
    cover: "${cover}"
    author: "${author}"
    META-END -->`;

    const html = `<!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${title}</title>
      <meta name="description" content="${description}">
      <link rel="canonical" href="${canonical}">
      <style>
    ${css}
      </style>
    </head>
    <body>
    ${metaBlock}
    <a href="#main-content" class="skip-link">Bỏ qua đến nội dung chính</a>

    <header class="header">
      <div class="header-container">
        <a href="/" class="logo">☕ ANARO Coffee</a>
        <nav class="breadcrumb">
          <a href="/blog.html">Blog</a>
          <span class="breadcrumb-separator">›</span>
          <span>${title}</span>
        </nav>
      </div>
    </header>

    <div class="main-container">
      <main id="main-content" class="article-content">
        <header class="article-header">
          <span class="article-category">${category}</span>
          <h1 class="article-title">${title}</h1>
          <p class="article-excerpt">${description}</p>
          <div class="article-meta">
            <div class="meta-item"><time datetime="${date}">${date.split('-').reverse().join('/')}</time></div>
            <div class="meta-item reading-time">~${readingMin} phút đọc</div>
          </div>
        </header>

        <article class="article-body">
          ${cover ? `<img src="${cover}" alt="Ảnh minh họa" class="article-image" loading="lazy">` : ''}
    ${bodyHtml}
        </article>
      </main>

      <aside class="sidebar">
        ${tocHtml}
        <!-- Có thể bổ sung Related posts / Products sau, để trống nếu chưa có -->
      </aside>
    </div>
    </body>
    </html>`.replace(/\r\n/g, '\n');

    // ==== Write out
    await fs.ensureDir(outDir);
    const outPath = path.join(outDir, filename);
    await fs.writeFile(outPath, html, 'utf8');

    console.log('✅ Đã tạo bài viết: ' + outPath);
    console.log('• Title:', title);
    console.log('• Date:', date);
    console.log('• Tags:', tags.join(', ') || '(trống)');
    console.log('• Cover:', cover);
    console.log('• Canonical:', canonical);
  } catch (e) {
    console.error('❌ Lỗi:', e.message);
    process.exit(1);
  }
})();