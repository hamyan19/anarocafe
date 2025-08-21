const fs = require('fs-extra');
const path = require('path');

const SITE = 'https://anarocafe.vercel.app';
const PAGE_SIZE = 12; // đổi nếu muốn

class BlogGenerator {
  constructor(){
    this.root = path.join(__dirname, '..');
    this.postsDir = path.join(this.root, 'blog', 'posts');
    this.templatesDir = path.join(this.root, 'blog', 'templates');
    this.outputIndex = path.join(this.root, 'blog.html'); // trang 1
  }

  formatDate(d){
    return new Date(d).toLocaleDateString('vi-VN',{year:'numeric',month:'2-digit',day:'2-digit'});
  }

  rfc822(d){
    return new Date(d).toUTCString(); // cho RSS
  }

  slugify(s){
    return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }

  toCover(p){
    if(!p) return '/blog/assets/images/default.jpg';
    if(/^https?:\/\//i.test(p)) return p;
    let s=p.replace(/^\.?\//,'').replace(/^blog\//,'');
    if(!s.startsWith('blog/assets/')) s='blog/assets/'+s.replace(/^assets\//,'');
    return '/'+s;
  }

  extractMeta(file, html){
    const m = html.match(/<!--\s*META-START([\s\S]*?)META-END\s*-->/);
    const meta = { title:'Untitled Post', description:'', tags:[], date:'', cover:'/blog/assets/images/default.jpg', author:'ANARO Coffee' };
    if(m){
      for(const raw of m[1].split('\n')){
        const line = raw.trim(); if(!line) continue;
        const kv = line.match(/^(\w+)\s*:\s*(.+)$/); if(!kv) continue;
        const key = kv[1]; let val = kv[2].trim();
        if(key==='tags'){
          try { meta.tags = JSON.parse(val.replace(/'/g,'"')); }
          catch { meta.tags = val.split(',').map(s=>s.trim()).filter(Boolean); }
        } else {
          meta[key] = val.replace(/^"(.*)"$/,'$1');
        }
      }
    }
    if(!meta.date){
      const d = file.match(/^(\d{4}-\d{2}-\d{2})/);
      if(d) meta.date = d[1];
    }
    meta.cover = this.toCover(meta.cover);
    meta.tagsDisplay = (meta.tags||[]).map(t=>t.trim()).filter(Boolean);
    meta.tagsData = meta.tagsDisplay.map(t=>this.slugify(t));
    return meta;
  }

  async readPosts(){
    await fs.ensureDir(this.postsDir);
    const files = (await fs.readdir(this.postsDir)).filter(f=>f.endsWith('.html'));
    const posts = [];
    for(const file of files){
      const html = await fs.readFile(path.join(this.postsDir,file),'utf8');
      const meta = this.extractMeta(file, html);
      posts.push({
        filename:file,
        url:`/blog/posts/${file}`,
        title:meta.title,
        description:meta.description,
        cover:meta.cover,
        date:meta.date || new Date().toISOString().slice(0,10),
        author:meta.author || 'ANARO Coffee',
        tagsDisplay:meta.tagsDisplay,
        tagsData:meta.tagsData
      });
    }
    posts.sort((a,b)=>new Date(b.date)-new Date(a.date));
    return posts;
  }

  postCard(p, aboveFold=false){
    // ảnh tối ưu lazy-load
    const imgAttrs = aboveFold
      ? `loading="eager" fetchpriority="high"`
      : `loading="lazy" decoding="async" fetchpriority="low"`;
    return `
<article class="post-card" data-tags="${p.tagsData.join(',')}">
  <div class="post-image">
    <img src="${p.cover}" alt="${p.title}" width="1200" height="675" ${imgAttrs}>
  </div>
  <div class="post-content">
    <h2 class="post-title"><a href="${p.url}">${p.title}</a></h2>
    <p class="post-excerpt">${p.description}</p>
    <div class="post-tags">
      ${p.tagsDisplay.map((t,i)=>`<span class="post-tag" data-tag="${p.tagsData[i]}">${t}</span>`).join('')}
    </div>
  </div>
</article>`.trim();
  }

  paginationHtml(page, total){
    if(total<=1) return '';
    const items=[];
    const link = (p, label, active=false, rel='')=>{
      const href = p===1 ? '/blog.html' : `/blog/page/${p}/`;
      return `<a class="page${active?' active':''}" href="${href}" ${rel?`rel="${rel}"`:''}>${label}</a>`;
    };
    if(page>1) items.push(link(page-1,'‹ Trước',false,'prev'));
    for(let i=1;i<=total;i++) items.push(link(i,String(i), i===page));
    if(page<total) items.push(link(page+1,'Sau ›',false,'next'));
    return `<nav class="pagination">${items.join(' ')}</nav>`;
  }

  async generateIndexPages(posts){
    const tpl = await fs.readFile(path.join(this.templatesDir,'blog-index.html'),'utf8');
    const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));

    for(let page=1; page<=totalPages; page++){
      const start = (page-1)*PAGE_SIZE;
      const slice = posts.slice(start, start+PAGE_SIZE);
      const cards = slice.map((p,i)=>this.postCard(p, page===1 && i<1)).join('\n');

      const tagsMap = new Map();
      slice.forEach(p=>p.tagsData.forEach((slug,i)=>{ if(!tagsMap.has(slug)) tagsMap.set(slug, p.tagsDisplay[i]); }));
      const tagsFilter = [...tagsMap.entries()].map(([slug,txt])=>`<button class="tag-filter" data-tag="${slug}">${txt}</button>`).join('');

      const lastUpdate = new Date().toLocaleString('vi-VN',{ timeZone:'Asia/Ho_Chi_Minh' });

      const html = tpl
        .replace('{{POSTS}}', cards)
        .replace('{{TAGS_FILTER}}', tagsFilter)
        .replace('{{POSTS_COUNT}}', String(posts.length))
        .replace('{{LAST_UPDATE}}', lastUpdate)
        .replace('{{PAGINATION}}', this.paginationHtml(page, totalPages));

      if(page===1){
        await fs.writeFile(this.outputIndex, html, 'utf8');
      }else{
        const dir = path.join(this.root, 'blog', 'page', String(page));
        await fs.ensureDir(dir);
        await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8');
      }
    }
    console.log(`✅ Generated index pages: ${Math.max(1, Math.ceil(posts.length/PAGE_SIZE))}`);
  }

  async generateSitemap(posts){
    const urls=[];
    // homepage + blog
    urls.push({loc:`${SITE}/`, lastmod:new Date().toISOString()});
    urls.push({loc:`${SITE}/blog.html`, lastmod:new Date().toISOString()});
    // blog pagination
    const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
    for(let p=2;p<=totalPages;p++){
      urls.push({loc:`${SITE}/blog/page/${p}/`, lastmod:new Date().toISOString()});
    }
    // posts
    posts.forEach(p=>{
      urls.push({loc:`${SITE}${p.url}`, lastmod:new Date(p.date).toISOString()});
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u=>`  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join('\n')}
</urlset>`;
    await fs.writeFile(path.join(this.root,'sitemap.xml'), xml, 'utf8');
    console.log('✅ Generated sitemap.xml');
  }

  async generateRSS(posts){
    const items = posts.slice(0, 50).map(p=>`
  <item>
    <title><![CDATA[${p.title}]]></title>
    <link>${SITE}${p.url}</link>
    <guid>${SITE}${p.url}</guid>
    <pubDate>${this.rfc822(p.date)}</pubDate>
    <description><![CDATA[${p.description}]]></description>
  </item>`).join('\n');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>ANARO Coffee Blog</title>
  <link>${SITE}/blog.html</link>
  <description>Cà phê, pha chế, kinh doanh quán.</description>
  <language>vi</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
    await fs.writeFile(path.join(this.root,'rss.xml'), rss, 'utf8');
    console.log('✅ Generated rss.xml');
  }

  async run(){
    const posts = await this.readPosts();
    await this.generateIndexPages(posts);
    await this.generateSitemap(posts);
    await this.generateRSS(posts);
  }
}

new BlogGenerator().run().catch(e=>{ console.error(e); process.exit(1); });
