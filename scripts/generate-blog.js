const fs = require('fs-extra');
const path = require('path');

class BlogGenerator {
  constructor(){
    this.root = path.join(__dirname, '..');
    this.postsDir = path.join(this.root, 'blog', 'posts');
    this.templatesDir = path.join(this.root, 'blog', 'templates');
    this.outputFile = path.join(this.root, 'blog.html');
    this.currentFile = '';
  }

  formatDate(d){
    return new Date(d).toLocaleDateString('vi-VN',{year:'numeric',month:'2-digit',day:'2-digit'});
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

  extractMetadata(content){
    const m = content.match(/<!--\s*META-START([\s\S]*?)META-END\s*-->/);
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
    if(!meta.date && this.currentFile){
      const d = this.currentFile.match(/^(\d{4}-\d{2}-\d{2})/);
      if(d) meta.date = d[1];
    }
    meta.cover = this.toCover(meta.cover);
    meta.tagsDisplay = (meta.tags||[]).map(t=>t.trim()).filter(Boolean);
    meta.tagsData = meta.tagsDisplay.map(t=>this.slugify(t));
    return meta;
  }

  async readAllPosts(){
    await fs.ensureDir(this.postsDir);
    const files = (await fs.readdir(this.postsDir)).filter(f=>f.endsWith('.html'));
    const posts = [];
    for(const file of files){
      this.currentFile = file;
      const html = await fs.readFile(path.join(this.postsDir,file),'utf8');
      const meta = this.extractMetadata(html);
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

  generatePostCard(p){
    return `
<article class="post-card" data-tags="${p.tagsData.join(',')}">
  <div class="post-image">
    <img src="${p.cover}" alt="${p.title}" loading="lazy">
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

  async generateIndex(posts){
    const tpl = await fs.readFile(path.join(this.templatesDir,'blog-index.html'),'utf8');
    const postsHtml = posts.map(p=>this.generatePostCard(p)).join('\n');

    const map = new Map(); // slug -> display
    posts.forEach(p=>p.tagsData.forEach((slug,i)=>{ if(!map.has(slug)) map.set(slug, p.tagsDisplay[i]); }));
    const tagsFilter = [...map.entries()].map(([slug,txt])=>`<button class="tag-filter" data-tag="${slug}">${txt}</button>`).join('');

    const lastUpdate = new Date().toLocaleString('vi-VN',{ timeZone:'Asia/Ho_Chi_Minh' });

    const html = tpl
      .replace('{{TAGS_FILTER}}', tagsFilter)
      .replace('{{POSTS_COUNT}}', String(posts.length))
      .replace('{{LAST_UPDATE}}', lastUpdate)
      .replace('{{POSTS}}', postsHtml);

    await fs.writeFile(this.outputFile, html, 'utf8');
    console.log(`✅ Generated ${this.outputFile} with ${posts.length} posts`);
  }

  async run(){ const posts = await this.readAllPosts(); await this.generateIndex(posts); }
}

new BlogGenerator().run().catch(e=>{ console.error(e); process.exit(1); });
