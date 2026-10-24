// Browser behavior shared by every page: theme toggle, search, copy
// buttons, the source viewer on the landing page, and scroll spies.

interface SearchEntry {
  title: string;
  url: string;
  group: string;
  headings: string[];
  text: string;
}

function copy(text: string, button: HTMLElement) {
  navigator.clipboard?.writeText(text).then(() => {
    button.dataset.copied = '';
    setTimeout(() => delete button.dataset.copied, 1400);
  });
}

function initTheme() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('theme', next);
    });
  }
}

function initCopy() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-code]')) {
    button.addEventListener('click', () => {
      const code = button.closest('.code-frame')?.querySelector('pre');
      if (code) copy(code.innerText.replace(/\n$/, ''), button);
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', () => copy(button.dataset.copy ?? '', button));
  }
}

function initViewer() {
  for (const viewer of document.querySelectorAll<HTMLElement>('[data-viewer]')) {
    const buttons = viewer.querySelectorAll<HTMLButtonElement>('[data-open-file]');
    const files = viewer.querySelectorAll<HTMLElement>('[data-file]');
    const label = viewer.querySelector<HTMLElement>('[data-viewer-name]');
    const note = viewer.querySelector<HTMLElement>('[data-viewer-note]');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const name = button.dataset.openFile;
        for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
        for (const f of files) f.hidden = f.dataset.file !== name;
        if (label) label.textContent = name ?? '';
        if (note) note.textContent = button.dataset.note ?? '';
      });
    }
  }
}

function initSpy() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-spy] a[href*="#"]')];
  if (links.length === 0) return;
  const attr = links[0].closest('[data-spy]')?.getAttribute('data-spy') || 'location';
  const targets = links
    .map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
    .filter((t): t is HTMLElement => t !== null);
  const update = () => {
    let current: HTMLElement | undefined;
    for (const t of targets) {
      if (t.getBoundingClientRect().top <= 120) current = t;
    }
    for (const a of links) {
      if (current && a.hash === `#${current.id}`) a.setAttribute('aria-current', attr);
      else a.removeAttribute('aria-current');
    }
  };
  addEventListener('scroll', update, { passive: true });
  update();
}

function initSearch() {
  const dialog = document.querySelector<HTMLDialogElement>('[data-search]');
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  const list = document.querySelector<HTMLUListElement>('[data-search-results]');
  const empty = document.querySelector<HTMLElement>('[data-search-empty]');
  if (!dialog || !input || !list || !empty) return;
  let index: SearchEntry[] | null = null;
  let selected = 0;

  const load = async () => {
    if (index) return index;
    const url = document.documentElement.dataset.searchIndex ?? '';
    index = (await (await fetch(url)).json()) as SearchEntry[];
    return index;
  };

  const render = async () => {
    const entries = await load();
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = entries
      .map((e) => {
        if (terms.length === 0) return { e, score: 1, heading: '' };
        let score = 0;
        let heading = '';
        for (const term of terms) {
          const inTitle = e.title.toLowerCase().includes(term);
          const h = e.headings.find((x) => x.toLowerCase().includes(term));
          const inText = e.text.includes(term);
          if (!inTitle && !h && !inText) return { e, score: 0, heading: '' };
          score += (inTitle ? 10 : 0) + (h ? 4 : 0) + (inText ? 1 : 0);
          if (h && !heading) heading = h;
        }
        return { e, score, heading };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    selected = 0;
    list.replaceChildren(
      ...scored.map(({ e, heading }, i) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = e.url;
        a.setAttribute('role', 'option');
        a.setAttribute('aria-selected', String(i === 0));
        const title = document.createElement('span');
        title.className = 'search__hit-title';
        title.textContent = e.title;
        const meta = document.createElement('span');
        meta.className = 'search__hit-meta';
        meta.textContent = heading ? `${e.group} · ${heading}` : e.group;
        a.append(title, meta);
        li.append(a);
        return li;
      }),
    );
    empty.hidden = scored.length > 0;
  };

  const move = (delta: number) => {
    const options = [...list.querySelectorAll('a')];
    if (options.length === 0) return;
    selected = (selected + delta + options.length) % options.length;
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === selected)));
    options[selected].scrollIntoView({ block: 'nearest' });
  };

  const open = () => {
    dialog.showModal();
    input.select();
    render();
  };

  for (const button of document.querySelectorAll('[data-search-open]')) {
    button.addEventListener('click', open);
  }
  addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      const target = list.querySelectorAll('a')[selected];
      if (target) location.href = target.href;
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

export function initSite() {
  initTheme();
  initCopy();
  initViewer();
  initSpy();
  initSearch();
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    for (const kbd of document.querySelectorAll('[data-kbd]')) kbd.textContent = '⌘K';
  }
  for (const button of document.querySelectorAll('[data-scroll-top]')) {
    button.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  }
}
