#!/usr/bin/env node
// Gerador do site: lê poemas/<categoria>/*.md e escreve o site estático em dist/
// Uso:  node build.mjs            -> gera dist/
//       node build.mjs --serve    -> gera, serve em http://localhost:3000 e recarrega ao editar
import { readdir, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'poemas');
const OUT = path.join(ROOT, 'dist');
const ASSETS = path.join(ROOT, 'assets');
const CONFIG_FILE = path.join(ROOT, 'site.config.json');

let config = {};
let BASE = '';
const url = (p = '/') => BASE + p;

/* ---------- utilitários ---------- */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fold = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const slugify = (s) =>
  fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-nome';

const humanize = (s) => {
  const t = String(s).replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// **negrito** e *itálico* dentro dos versos
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

const toList = (v) =>
  String(v ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const isTrue = (v) => /^(sim|true|yes|1)$/i.test(String(v ?? '').trim());

function parseFM(raw) {
  raw = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 1 || line.trim().startsWith('#')) continue;
    const key = fold(line.slice(0, i).trim());
    const val = line.slice(i + 1).trim().replace(/^["'](.*)["']$/, '$1');
    data[key] = val;
  }
  return { data, body: raw.slice(m[0].length) };
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}

/* ---------- leitura dos poemas ---------- */
function parsePoem(raw, file) {
  const { data, body } = parseFM(raw);
  let text = body.trim();
  let title = data.titulo || data.title;
  const h = text.match(/^#\s+(.+)\n?/);
  if (h) {
    if (!title) title = h[1].trim();
    text = text.slice(h[0].length).trim();
  }
  if (!title) title = humanize(path.basename(file, path.extname(file)));

  const [versesPart, ...notesParts] = text.split(/\n-{3,}\n/);
  const notes = notesParts.join('\n').trim();
  const stanzas = versesPart
    .trim()
    .split(/\n\s*\n/)
    .map((s) => s.split('\n').map((l) => l.replace(/\s+$/, '')))
    .filter((s) => s.some((l) => l.trim()));

  return { data, title, stanzas, notes };
}

async function load() {
  const cats = new Map();
  const getCat = (slug, meta = {}) => {
    if (!cats.has(slug)) {
      cats.set(slug, {
        slug,
        nome: meta.nome || humanize(slug),
        descricao: meta.descricao || '',
        icone: meta.icone || '❦',
        ordem: Number(meta.ordem) || 999,
        poems: [],
      });
    }
    return cats.get(slug);
  };

  const skip = (name) => name.startsWith('_') || name.startsWith('.') || /^readme\.md$/i.test(name);
  const entries = await readdir(SRC, { withFileTypes: true });

  const files = []; // { file, catSlug }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(SRC, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('_')) continue;
      let meta = {};
      const metaFile = path.join(full, '_categoria.md');
      if (existsSync(metaFile)) meta = parseFM(await readFile(metaFile, 'utf8')).data;
      const cat = getCat(slugify(e.name), meta);
      for (const f of await walk(full)) {
        if (!skip(path.basename(f))) files.push({ file: f, cat });
      }
    } else if (/\.md$/i.test(e.name) && !skip(e.name)) {
      files.push({ file: full, cat: getCat('avulsos', { nome: 'Outros poemas', icone: '✦', ordem: 9999 }) });
    }
  }

  const used = new Set();
  for (const { file, cat } of files) {
    const { data, title, stanzas, notes } = parsePoem(await readFile(file, 'utf8'), file);
    if (!stanzas.length) continue;

    let slug = slugify(path.basename(file, path.extname(file)));
    while (used.has(`${cat.slug}/${slug}`)) slug += '-2';
    used.add(`${cat.slug}/${slug}`);

    const author = data.autor || data.author || config.autorPadrao || '';
    const tags = toList(data.tags);
    const lines = stanzas.flat();
    const poem = {
      title,
      slug,
      cat,
      author,
      authorSlug: author ? slugify(author) : '',
      year: data.ano || '',
      date: data.data || '',
      ordem: data.ordem !== undefined && data.ordem !== '' ? Number(data.ordem) : 999,
      tags,
      source: data.fonte || '',
      featured: isTrue(data.destaque),
      stanzas,
      notes,
      verseCount: lines.filter((l) => l.trim()).length,
      excerpt: stanzas[0].slice(0, 4),
      href: `/poema/${cat.slug}/${slug}/`,
    };
    poem.searchText = fold([title, author, cat.nome, tags.join(' '), lines.join(' ')].join(' '));
    cat.poems.push(poem);
  }

  const byOrder = (a, b) =>
    a.ordem - b.ordem || (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'pt');
  const catList = [...cats.values()]
    .filter((c) => c.poems.length)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt'));
  catList.forEach((c) => c.poems.sort(byOrder));

  const all = catList
    .flatMap((c) => c.poems)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'pt'));

  const authors = new Map();
  for (const p of all) {
    if (!p.author) continue;
    if (!authors.has(p.authorSlug)) authors.set(p.authorSlug, { slug: p.authorSlug, nome: p.author, poems: [] });
    authors.get(p.authorSlug).poems.push(p);
  }
  const authorList = [...authors.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));

  return { cats: catList, poems: all, authors: authorList };
}

/* ---------- templates ---------- */
const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9D%A6%3C/text%3E%3C/svg%3E";

function layout({ title, description, body, path: pagePath = '/' }) {
  const fullTitle = title ? `${title} · ${config.titulo}` : config.titulo;
  const desc = description || config.descricao || config.subtitulo || '';
  const nav = [
    ['Início', url('/')],
    ['Categorias', url('/#categorias')],
    ['Autores', url('/autores/')],
  ];
  if (config.portfolio) nav.push(['Portfólio', config.portfolio]);

  return `<!doctype html>
<html lang="${esc(config.idioma || 'pt-BR')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#b4532a">
<link rel="icon" href="${favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script>try{var t=localStorage.getItem('tema')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}</script>
<link rel="stylesheet" href="${url('/assets/style.css')}">
<script src="${url('/assets/app.js')}" defer></script>
</head>
<body>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="${url('/')}"><span class="brand-mark">❦</span> ${esc(config.titulo)}</a>
    <nav class="nav" aria-label="Principal">
      ${nav.map(([t, h]) => `<a href="${esc(h)}">${esc(t)}</a>`).join('\n      ')}
      <button class="icon-btn" type="button" data-theme-toggle aria-label="Alternar tema claro/escuro"><span class="ico-sun">☀</span><span class="ico-moon">☾</span></button>
    </nav>
  </div>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <div class="wrap foot">
    <span>© ${new Date().getFullYear()} ${esc(config.nomeAutor || '')}</span>
    <span class="foot-links">
      ${config.portfolio ? `<a href="${esc(config.portfolio)}">Portfólio</a>` : ''}
      ${config.github ? `<a href="${esc(config.github)}">GitHub</a>` : ''}
    </span>
  </div>
</footer>
</body>
</html>`;
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function card(p) {
  return `<a class="card" href="${url(p.href)}" data-cat="${esc(p.cat.slug)}" data-search="${esc(p.searchText)}">
  <span class="card-meta"><span class="tag">${esc(p.cat.icone)} ${esc(p.cat.nome)}</span>${p.year ? `<span>${esc(p.year)}</span>` : ''}</span>
  <h3>${esc(p.title)}</h3>
  <p class="excerpt">${p.excerpt.map(inline).join('<br>')}</p>
  <span class="card-foot"><span>${esc(p.author)}</span><span class="more">ler →</span></span>
</a>`;
}

function homePage({ cats, poems, authors }) {
  const words = String(config.titulo).split(' ');
  const last = words.pop();
  const heroTitle = `${esc(words.join(' '))} <em>${esc(last)}</em>`.trim();

  const featured = poems.find((p) => p.featured) || poems[0];
  const verses = poems.map((p) => ({
    t: p.title,
    a: p.author,
    u: url(p.href),
    v: p.excerpt,
  }));
  const versesJson = JSON.stringify(verses).replace(/</g, '\\u003c');

  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-text fade">
      <p class="kicker">${plural(poems.length, 'poema', 'poemas')} · ${plural(cats.length, 'forma poética', 'formas poéticas')}</p>
      <h1>${heroTitle}</h1>
      <p class="lead">${esc(config.subtitulo || '')}</p>
      <label class="search" for="busca">
        <span aria-hidden="true">⌕</span>
        <input id="busca" type="search" placeholder="Buscar por título, autor, verso ou tema…" autocomplete="off">
      </label>
    </div>
    <figure class="verse-card fade" id="verso" aria-live="polite">
      <span class="quote-mark" aria-hidden="true">“</span>
      <blockquote id="verso-texto">${featured.excerpt.map(inline).join('<br>')}</blockquote>
      <figcaption>
        <a id="verso-link" href="${url(featured.href)}">${esc(featured.title)}</a>
        <span id="verso-autor">${featured.author ? '— ' + esc(featured.author) : ''}</span>
      </figcaption>
      <button class="link-btn" id="outro-verso" type="button">outro verso ↻</button>
    </figure>
  </div>
  <script type="application/json" id="versos">${versesJson}</script>
</section>

<section class="section" id="categorias">
  <div class="wrap">
    <h2 class="section-title">Formas poéticas</h2>
    <div class="cat-grid">
      ${cats
        .map(
          (c) => `<a class="cat-card" href="${url(`/categoria/${c.slug}/`)}">
        <span class="cat-icon">${esc(c.icone)}</span>
        <h3>${esc(c.nome)}</h3>
        <p>${esc(c.descricao)}</p>
        <span class="count">${plural(c.poems.length, 'poema', 'poemas')}</span>
      </a>`,
        )
        .join('\n      ')}
    </div>
  </div>
</section>

<section class="section" id="poemas">
  <div class="wrap">
    <div class="section-head">
      <h2 class="section-title">Todos os poemas</h2>
      <p class="muted" id="contagem" aria-live="polite">${plural(poems.length, 'poema', 'poemas')}</p>
    </div>
    <div class="chips" role="group" aria-label="Filtrar por forma poética">
      <button class="chip" type="button" data-cat="todos" aria-pressed="true">Todos</button>
      ${cats
        .map(
          (c) =>
            `<button class="chip" type="button" data-cat="${esc(c.slug)}" aria-pressed="false">${esc(c.icone)} ${esc(c.nome)}</button>`,
        )
        .join('\n      ')}
    </div>
    <div class="poem-grid" id="grade">
      ${poems.map(card).join('\n      ')}
    </div>
    <p class="empty" id="vazio" hidden>Nenhum poema encontrado. Tente outra palavra ou limpe o filtro.</p>
  </div>
</section>`;

  return layout({ title: '', description: config.descricao, body });
}

function listPage({ kicker, title, intro, icon, poems, others }) {
  const body = `
<section class="page-head">
  <div class="wrap fade">
    ${icon ? `<span class="cat-icon big">${esc(icon)}</span>` : ''}
    <p class="kicker">${esc(kicker)}</p>
    <h1>${esc(title)}</h1>
    ${intro ? `<p class="lead">${esc(intro)}</p>` : ''}
    <p class="muted">${plural(poems.length, 'poema', 'poemas')}</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap">
    <div class="poem-grid">
      ${poems.map(card).join('\n      ')}
    </div>
    ${others || ''}
  </div>
</section>`;
  return body;
}

function categoryPage(c, cats) {
  const others = `<div class="others"><h2 class="section-title small">Outras formas</h2><div class="chips">${cats
    .filter((x) => x.slug !== c.slug)
    .map((x) => `<a class="chip" href="${url(`/categoria/${x.slug}/`)}">${esc(x.icone)} ${esc(x.nome)}</a>`)
    .join('')}</div></div>`;
  return layout({
    title: c.nome,
    description: c.descricao,
    body: listPage({ kicker: 'Forma poética', title: c.nome, intro: c.descricao, icon: c.icone, poems: c.poems, others }),
  });
}

function authorPage(a) {
  return layout({
    title: a.nome,
    description: `Poemas de ${a.nome}`,
    body: listPage({ kicker: 'Autor', title: a.nome, intro: '', icon: '', poems: a.poems }),
  });
}

function authorsPage(authors) {
  const body = `
<section class="page-head">
  <div class="wrap fade">
    <p class="kicker">Poetas</p>
    <h1>Autores</h1>
    <p class="lead">Quem escreveu o quê: cada poeta com seus versos reunidos.</p>
  </div>
</section>
<section class="section tight">
  <div class="wrap">
    <div class="cat-grid">
      ${authors
        .map(
          (a) => `<a class="cat-card" href="${url(`/autor/${a.slug}/`)}">
        <span class="cat-icon">✎</span>
        <h3>${esc(a.nome)}</h3>
        <span class="count">${plural(a.poems.length, 'poema', 'poemas')}</span>
      </a>`,
        )
        .join('\n      ')}
    </div>
  </div>
</section>`;
  return layout({ title: 'Autores', description: 'Autores da coletânea', body });
}

function poemPage(p) {
  const list = p.cat.poems;
  const i = list.indexOf(p);
  const prev = list[i - 1];
  const next = list[i + 1];

  const stanzas = p.stanzas
    .map(
      (s) =>
        `<p class="stanza">${s
          .map((l) => {
            const lead = l.match(/^\s*/)[0].replace(/\t/g, '    ').length;
            const style = lead ? ` style="padding-left:${Math.min(lead, 12) * 0.45}em"` : '';
            return `<span class="verse"${style}>${inline(l.trim())}</span>`;
          })
          .join('')}</p>`,
    )
    .join('\n');

  const notes = p.notes
    ? `<aside class="notes">${p.notes
        .split(/\n\s*\n/)
        .map((n) => `<p>${inline(n.replace(/\n/g, ' '))}</p>`)
        .join('')}</aside>`
    : '';

  const byline = [
    p.author ? `<a href="${url(`/autor/${p.authorSlug}/`)}">${esc(p.author)}</a>` : '',
    p.year ? esc(p.year) : '',
    plural(p.verseCount, 'verso', 'versos'),
  ]
    .filter(Boolean)
    .join(' <span class="dot">·</span> ');

  const body = `
<article class="poem wrap-narrow">
  <nav class="crumbs" aria-label="Você está em">
    <a href="${url('/')}">Início</a> <span>/</span> <a href="${url(`/categoria/${p.cat.slug}/`)}">${esc(p.cat.nome)}</a>
  </nav>
  <header class="poem-head fade">
    <a class="tag" href="${url(`/categoria/${p.cat.slug}/`)}">${esc(p.cat.icone)} ${esc(p.cat.nome)}</a>
    <h1>${esc(p.title)}</h1>
    <p class="byline">${byline}</p>
  </header>
  <div class="orn" aria-hidden="true">❦</div>
  <div class="poem-body fade" id="poema">
${stanzas}
  </div>
  ${notes}
  ${p.source ? `<p class="source">Fonte: ${esc(p.source)}</p>` : ''}
  ${p.tags.length ? `<ul class="taglist">${p.tags.map((t) => `<li>#${esc(t)}</li>`).join('')}</ul>` : ''}
  <div class="actions">
    <button class="btn" type="button" id="copiar">Copiar poema</button>
    <button class="btn ghost" type="button" onclick="window.print()">Imprimir</button>
  </div>
  <nav class="pager" aria-label="Outros poemas desta forma">
    ${
      prev
        ? `<a class="pager-link" href="${url(prev.href)}" rel="prev"><small>← Anterior</small><strong>${esc(prev.title)}</strong></a>`
        : '<span></span>'
    }
    ${
      next
        ? `<a class="pager-link right" href="${url(next.href)}" rel="next"><small>Próximo →</small><strong>${esc(next.title)}</strong></a>`
        : '<span></span>'
    }
  </nav>
</article>`;

  return layout({
    title: p.title,
    description: p.excerpt.join(' / '),
    body,
  });
}

function notFoundPage() {
  return layout({
    title: 'Página não encontrada',
    body: `<section class="page-head"><div class="wrap fade"><p class="kicker">404</p><h1>Esse verso se perdeu</h1><p class="lead">A página que você procura não existe (ainda).</p><p><a class="btn" href="${url('/')}">Voltar ao início</a></p></div></section>`,
  });
}

/* ---------- escrita ---------- */
async function writePage(rel, html) {
  const dir = path.join(OUT, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html);
}

async function build() {
  config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  BASE = String(process.env.BASE_PATH ?? config.base ?? '').replace(/\/+$/, '');

  const data = await load();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  if (existsSync(ASSETS)) await cp(ASSETS, path.join(OUT, 'assets'), { recursive: true });
  await writeFile(path.join(OUT, '.nojekyll'), '');

  if (!data.poems.length) {
    console.warn('Nenhum poema encontrado em poemas/. Crie arquivos .md dentro de poemas/<categoria>/.');
  }

  await writeFile(path.join(OUT, 'index.html'), data.poems.length ? homePage(data) : layout({ title: '', body: '<section class="page-head"><div class="wrap"><h1>Em breve</h1></div></section>' }));
  await writeFile(path.join(OUT, '404.html'), notFoundPage());

  for (const c of data.cats) {
    await writePage(`categoria/${c.slug}`, categoryPage(c, data.cats));
    for (const p of c.poems) await writePage(`poema/${c.slug}/${p.slug}`, poemPage(p));
  }
  await writePage('autores', authorsPage(data.authors));
  for (const a of data.authors) await writePage(`autor/${a.slug}`, authorPage(a));

  console.log(`✔ Site gerado em dist/: ${data.poems.length} poemas, ${data.cats.length} categorias, ${data.authors.length} autores`);
}

/* ---------- servidor de desenvolvimento ---------- */
async function serve(port = 3000) {
  const http = await import('node:http');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
  };
  http
    .createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
      let f = path.join(OUT, p);
      if (!f.startsWith(OUT)) {
        res.writeHead(403).end();
        return;
      }
      try {
        if (p.endsWith('/') || !path.extname(f)) f = path.join(f, 'index.html');
        const buf = await readFile(f);
        res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
        res.end(buf);
      } catch {
        res.writeHead(404, { 'Content-Type': types['.html'] });
        res.end(await readFile(path.join(OUT, '404.html')).catch(() => '404'));
      }
    })
    .listen(port, () => console.log(`→ http://localhost:${port}${BASE}/  (Ctrl+C para sair)`));

  let timer;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error('Erro no build:', e.message)), 150);
  };
  for (const target of [SRC, ASSETS, CONFIG_FILE]) {
    try {
      watch(target, { recursive: true }, rebuild);
    } catch {
      try { watch(target, rebuild); } catch { /* ignora */ }
    }
  }
}

await build();
if (process.argv.includes('--serve')) await serve(Number(process.env.PORT) || 3000);
