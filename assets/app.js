(() => {
  const root = document.documentElement;
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* Tema claro/escuro */
  document.querySelectorAll('[data-theme-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('tema', next); } catch (e) { /* ignora */ }
    }),
  );

  /* Busca + filtro por categoria (home) */
  const grid = document.getElementById('grade');
  if (grid) {
    const cards = [...grid.querySelectorAll('.card')];
    const input = document.getElementById('busca');
    const chips = [...document.querySelectorAll('.chip[data-cat]')];
    const count = document.getElementById('contagem');
    const empty = document.getElementById('vazio');
    let cat = 'todos';

    const apply = () => {
      const terms = fold(input ? input.value : '').split(/\s+/).filter(Boolean);
      let n = 0;
      cards.forEach((c) => {
        const ok = (cat === 'todos' || c.dataset.cat === cat) && terms.every((t) => c.dataset.search.includes(t));
        c.hidden = !ok;
        if (ok) n++;
      });
      if (count) count.textContent = n === 1 ? '1 poema' : `${n} poemas`;
      if (empty) empty.hidden = n > 0;
    };

    if (input) {
      input.addEventListener('input', apply);
      input.addEventListener('focus', () => {
        if (input.value) return;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('poemas')?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
    chips.forEach((ch) =>
      ch.addEventListener('click', () => {
        cat = ch.dataset.cat;
        chips.forEach((x) => x.setAttribute('aria-pressed', String(x === ch)));
        apply();
      }),
    );
    const q = new URLSearchParams(location.search).get('q');
    if (q && input) input.value = q;
    apply();
  }

  /* Verso aleatório (home) */
  const dataEl = document.getElementById('versos');
  const box = document.getElementById('verso-texto');
  if (dataEl && box) {
    let verses = [];
    try { verses = JSON.parse(dataEl.textContent); } catch (e) { /* ignora */ }
    const link = document.getElementById('verso-link');
    const autor = document.getElementById('verso-autor');
    const btn = document.getElementById('outro-verso');
    let last = -1;

    const show = () => {
      if (!verses.length) return;
      let i;
      do { i = Math.floor(Math.random() * verses.length); } while (verses.length > 1 && i === last);
      last = i;
      const v = verses[i];
      box.style.opacity = 0;
      setTimeout(() => {
        box.replaceChildren();
        v.v.forEach((line, k) => {
          if (k) box.appendChild(document.createElement('br'));
          box.appendChild(document.createTextNode(line.replace(/\*+/g, '').trim()));
        });
        link.textContent = v.t;
        link.href = v.u;
        autor.textContent = v.a ? `— ${v.a}` : '';
        box.style.opacity = 1;
      }, 180);
    };
    if (btn) btn.addEventListener('click', show);
    if (verses.length > 1) show();
  }

  /* Copiar poema */
  const copyBtn = document.getElementById('copiar');
  const poem = document.getElementById('poema');
  if (copyBtn && poem) {
    copyBtn.addEventListener('click', async () => {
      const title = document.querySelector('.poem-head h1')?.textContent || '';
      const text = `${title}\n\n${poem.innerText.trim()}`;
      const old = copyBtn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copiado ✓';
      } catch (e) {
        copyBtn.textContent = 'Não foi possível copiar';
      }
      setTimeout(() => (copyBtn.textContent = old), 1800);
    });
  }
})();
