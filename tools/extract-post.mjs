#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node extract-post.mjs <input.(html|md)> [--date YYYY-MM-DD] [--hero /blog/assets/images/hero.jpg] [--author "ANARO Coffee"] [--category "Hướng dẫn"] [--rel "T1|/url1,T2|/url2"] [--canonical-root https://anarocafe.vercel.app]');
  process.exit(1);
}
const inputPath = args[0];
const opts = Object.fromEntries(args.slice(1).reduce((acc, v, i, a) => {
  if (v.startsWith('--')) {
    const key = v.slice(2);
    const val = (a[i+1] && !a[i+1].startsWith('--')) ? a[i+1] : true;
    acc.push([key, val]);
  }
  return acc;
}, []));

const input = fs.readFileSync(inputPath, 'utf8');
const isHTML = /<\s*html[\s>]/i.test(input) || /<\s*h1[\s>]/i.test(input);
const author = opts.author || 'ANARO Coffee';
const category = opts.category || 'Hướng dẫn';
const date = opts.date || new Date().toISOString().slice(0,10);
const canonicalRoot = opts['canonical-root'] || 'https://anarocafe.vercel.app';

const STOP = new Set(['và','hoặc','là','của','trong','với','cho','các','một','những','được','khi','đến','từ','theo','này','đó','nên','cần','rất','thì','đã','sau','trước','đầu','cuối','bằng','để','không','có','như','vì','ra','vào','nhưng','hơn','ít','nhiều','cũng','trên','dưới','giữa','đang','sẽ','tại','vẫn','hết','rồi']);
function esc(s=''){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
function normalizeVN(s=''){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function slugify(s=''){return normalizeVN(s).toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-');}
function pickExcerpt(html){
  const m = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  let t = m? m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(): '';
  if (!t) t = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  if (t.length>170) t = t.slice(0,167).replace(/\s+\S*$/,'')+'...';
  return t;
}
function humanDateISO(iso){ const d = new Date(iso); return d.toLocaleDateString('vi-VN',{year:'numeric',month:'2-digit',day:'2-digit'}); }
function ensureIds(html){
  let i = 0;
  return html.replace(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi,(m,tag,attrs,txt)=>{
    const hasId = /id\s*=\s*["'][^"']+["']/.test(attrs);
    if (hasId) return m;
    const id = slugify(String(txt).replace(/<[^>]+>/g,'').trim()) || `muc-${++i}`;
    return `<${tag} id="${id}"${attrs}>${txt}</${tag}>`;
  });
}
function extractHeadings(html){
  const hs = [];
  html.replace(/<(h2|h3)\s+[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi,(m,tag,id,txt)=>{
    const title = String(txt).replace(/<[^>]+>/g,'').trim();
    hs.push({level: tag.toLowerCase(), id, title});
  });
  return hs;
}
function buildTOC(hs){
  const items = hs.map(h=>`<li class="toc-item toc-${h.level}"><a href="#${esc(h.id)}">${esc(h.title)}</a></li>`).join('');
  return `<div class="sidebar-widget"><div class="widget-header">Mục lục</div><div class="widget-content"><ul class="toc-list">${items}</ul></div></div>`;
}
function extractTitle(html){
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return String(h1[1]).replace(/<[^>]+>/g,'').trim();
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) return String(h2[1]).replace(/<[^>]+>/g,'').trim();
  return 'Bài viết';
}
function mdToHtml(md){
  const lines = md.split(/\r?\n/);
  let html = '', inUL=false, inOL=false;
  const flushLists=()=>{ if(inUL){html+='</ul>';inUL=false;} if(inOL){html+='</ol>';inOL=false;} };
  for (const line of lines){
    if (/^\s*#\s+/.test(line)){ flushLists(); html += `<h1>${esc(line.replace(/^\s*#\s+/,'').trim())}</h1>`; continue; }
    if (/^\s*##\s+/.test(line)){ flushLists(); html += `<h2>${esc(line.replace(/^\s*##\s+/,'').trim())}</h2>`; continue; }
    if (/^\s*###\s+/.test(line)){ flushLists(); html += `<h3>${esc(line.replace(/^\s*###\s+/,'').trim())}</h3>`; continue; }
    if (/^\s*-\s+/.test(line)){ if(!inUL){flushLists(); html+='<ul>' ; inUL=true;} html+=`<li>${esc(line.replace(/^\s*-\s+/,'').trim())}</li>`; continue; }
    if (/^\s*\d+\.\s+/.test(line)){ if(!inOL){flushLists(); html+='<ol>' ; inOL=true;} html+=`<li>${esc(line.replace(/^\s*\d+\.\s+/,'').trim())}</li>`; continue; }
    if (!line.trim()){ flushLists(); continue; }
    html += `<p>${esc(line.trim())}</p>`;
  }
  flushLists();
  return html;
}
function topTags(text, n=6){
  const words = normalizeVN(text).toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>2 && !STOP.has(w));
  const freq = Object.create(null);
  for (const w of words){ freq[w]=(freq[w]||0)+1; }
  const picks = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0, n).map(([w])=>w);
  for (const d of ['ca-phe','espresso','bao-quan','rang']){ if (!picks.includes(d)) picks.push(d); }
  return Array.from(new Set(picks)).slice(0,8);
}
function extractFAQ(html){
  const qas = [];
  html.replace(/<(h2|h3)[^>]*>([\s\S]*?)<\/\1>\s*<p[^>]*>([\s\S]*?)<\/p>/gi,(m,tag,head,para)=>{
    const ht = String(head).replace(/<[^>]+>/g,'').trim();
    if (/[?？]$/.test(ht)) {
      const ans = String(para).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      if (ht && ans) qas.push({q: ht, a: ans});
    }
  });
  return qas.slice(0,8);
}
function parseRelated(str){
  const list = [];
  if (!str) return list;
  for (const part of str.split(/\s*,\s*/)){
    const [t,u] = part.split('|');
    if (t && u) list.push({title: t.trim(), url: u.trim()});
  }
  return list.slice(0,3);
}

let bodyHTML = '';
if (isHTML){
  const m = input.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  bodyHTML = m? m[1] : input;
} else {
  bodyHTML = mdToHtml(input);
}

let title = extractTitle(bodyHTML);
let contentWithIds = ensureIds(bodyHTML);
const headings = extractHeadings(contentWithIds);
const tocHTML = buildTOC(headings);

const excerpt = pickExcerpt(contentWithIds);
const tags = topTags(`${title} ${contentWithIds}`);
const heroPath = opts.hero || '';
const heroHTML = heroPath ? `<img src="${esc(heroPath)}" alt="${esc(title)}" class="article-image" loading="lazy">` : '<!-- TODO: hero -->';

const related = parseRelated(opts.rel);
while (related.length<2){ related.push({title:`[Gợi ý] Bài liên quan #${related.length+1}`, url:`/blog/posts/TO-FIX-${related.length+1}.html`}); }
const relatedHTML = `<div class="sidebar-widget"><div class="widget-header">Bài liên quan</div><div class="widget-content related-posts">`+
  related.map(r=>`<a class="related-post" href="${esc(r.url)}"><div class="related-post-content"><h5>${esc(r.title)}</h5><div class="related-post-meta">Gợi ý</div></div></a>`).join('')+
  `</div></div>`;

const productPageHTML = `<section aria-label="Trang sản phẩm" class="product-page-link" style="margin:24px 0;">
  <div class="social-sharing" style="text-align:center">
    <div class="sharing-title">Xem tất cả sản phẩm</div>
    <a class="cta-button" href="https://anaro.vercel.app">anaro.vercel.app</a>
  </div>
</section>`;

const ctaHTML = `<div class="article-cta"><div class="cta-content">
  <div class="cta-title">Mua hạt espresso rang tươi</div>
  <div class="cta-description">Đặt hàng lẻ 250g/500g. Giao nhanh, rang mới mỗi tuần.</div>
  <a class="cta-button" href="https://anaro.vercel.app">Mua ngay</a>
</div></div>
<div class="article-cta"><div class="cta-content">
  <div class="cta-title">Cần blend espresso cho quán?</div>
  <div class="cta-description">ANARO hỗ trợ thiết kế blend theo gu khách, nhận mẫu test miễn phí.</div>
  <a class="cta-button" href="https://anarocafe.vercel.app/wholesale.html">Nhận tư vấn + bảng giá</a>
</div></div>`;

const faq = extractFAQ(contentWithIds);
const faqHTML = faq.length? `<section id="faq" aria-label="Câu hỏi thường gặp">`+ faq.map(x=>`<h3>${esc(x.q)}</h3><p>${esc(x.a)}</p>`).join('') + `</section>` : '';

const createdISO = new Date(date).toISOString();
const filename = `${date}-${slugify(title)}.html`;
const canonical = `${canonicalRoot}/blog/posts/${filename}`;

const metaBlock = `<!-- META-START
title: "${title}"
description: "${excerpt}"
tags: [${tags.map(t=>`"${t}"`).join(', ')}]
date: "${date}"
cover: "${heroPath}"
author: "${author}"
META-END -->`;

const finalHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(excerpt)}">
  <link rel="canonical" href="${canonical}">
  <link rel="stylesheet" href="/blog/assets/css/post.css">
</head>
<body>
${metaBlock}

<header class="header"><div class="header-container">
  <a href="/" class="logo">☕ ANARO Coffee</a>
  <nav class="breadcrumb"><a href="/blog.html">Blog</a><span class="breadcrumb-separator">›</span><span>${esc(title)}</span></nav>
</div></header>

<div class="main-container">
  <main id="main-content" class="article-content">
    <header class="article-header">
      <span class="article-category">${esc(category)}</span>
      <h1 class="article-title">${esc(title)}</h1>
      <p class="article-excerpt">${esc(excerpt)}</p>
      <div class="article-meta"><div class="meta-item"><time datetime="${createdISO}">${humanDateISO(createdISO)}</time></div>
      <div class="meta-item reading-time">~${Math.max(1, Math.round(input.split(/\s+/).length/200))} phút đọc</div></div>
    </header>

    <article class="article-body">
      ${heroHTML}
      ${contentWithIds}
      ${productPageHTML}
      ${ctaHTML}
      ${faqHTML}
    </article>
  </main>
  <aside class="sidebar">
    ${tocHTML}
    ${relatedHTML}
  </aside>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(process.cwd(), filename), finalHTML, 'utf8');
console.log('Wrote', filename);
