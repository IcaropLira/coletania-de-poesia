// Cria um poema novo já com o cabeçalho pronto.
// Uso: npm run novo -- sonetos "Título do poema" ["Nome do Autor"]
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const [categoria, titulo, autorArg] = process.argv.slice(2);

if (!categoria || !titulo) {
  console.log('Uso: npm run novo -- <categoria> "<título>" ["<autor>"]');
  console.log('Ex.:  npm run novo -- sonetos "Soneto da Saudade" "Fagundes Varela"');
  process.exit(1);
}

const slug = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const config = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const autor = autorArg || config.autorPadrao || '';
const dir = path.join(ROOT, 'poemas', slug(categoria));
const file = path.join(dir, `${slug(titulo)}.md`);

if (existsSync(file)) {
  console.log(`Já existe: ${path.relative(ROOT, file)}`);
  process.exit(1);
}

await mkdir(dir, { recursive: true });
await writeFile(
  file,
  `---
titulo: ${titulo}
autor: ${autor}
ano: ${new Date().getFullYear()}
data: ${new Date().toISOString().slice(0, 10)}
tags:
---

Escreva aqui o primeiro verso
e siga com os demais,

deixe uma linha em branco
entre uma estrofe e outra.
`,
);
console.log(`Criado: ${path.relative(ROOT, file)}`);
