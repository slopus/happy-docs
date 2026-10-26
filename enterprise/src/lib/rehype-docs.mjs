// Rehype plugin for the docs pages:
// * prefixes root-relative links and image sources with the site base path,
// * gives headings ids and anchor links,
// * turns `### GET /v1/path` headings into endpoint headings,
// * wraps tables in a scroll container and code blocks in a titled frame.
import GithubSlugger from 'github-slugger';

const ENDPOINT = /^((?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*)\s+(\S+)$/;

const LANGUAGES = {
  json: 'JSON',
  jsonc: 'JSON',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  console: 'Shell',
  http: 'HTTP',
  python: 'Python',
  py: 'Python',
  rust: 'Rust',
  rs: 'Rust',
  lean: 'Lean',
  lean4: 'Lean',
  sql: 'SQL',
  toml: 'TOML',
  yaml: 'YAML',
  yml: 'YAML',
  text: 'Text',
  plaintext: 'Text',
  txt: 'Text',
  nginx: 'nginx',
  js: 'JavaScript',
  ts: 'TypeScript',
};

function text(node) {
  if (node.type === 'text') return node.value;
  return (node.children ?? []).map(text).join('');
}

function el(tagName, properties, children = []) {
  return { type: 'element', tagName, properties, children };
}

function walk(node, visit, parent = null, index = 0) {
  const replaced = visit(node, parent, index);
  if (replaced === 'skip') return;
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) {
    walk(children[i], visit, node, i);
  }
}

export function rehypeDocs({ base }) {
  return (tree) => {
    const slugger = new GithubSlugger();
    const rooted = (url) => typeof url === 'string' && url.startsWith('/') && !url.startsWith(base + '/') && !url.startsWith('//');
    walk(tree, (node) => {
      if (node.type !== 'element') return;
      if (node.tagName === 'a' && rooted(node.properties?.href)) node.properties.href = base + node.properties.href;
      if (node.tagName === 'img' && rooted(node.properties?.src)) node.properties.src = base + node.properties.src;
    });
    walk(tree, (node, parent, index) => {
      if (node.type !== 'element') return;

      if (/^h[2-4]$/.test(node.tagName)) {
        const label = text(node).trim();
        const endpoint = node.tagName === 'h3' ? label.match(ENDPOINT) : null;
        if (endpoint) {
          const [, method, path] = endpoint;
          node.properties.id ??= slugger.slug(`${method}-${path}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
          node.properties.className = ['endpoint'];
          const badges = method.split('/').map((m) =>
            el('span', { className: ['ep-method', `ep-${m.toLowerCase()}`] }, [{ type: 'text', value: m }]),
          );
          node.children = [
            el('a', { className: ['heading-anchor'], href: `#${node.properties.id}` }, [
              ...badges,
              { type: 'text', value: ' ' },
              el('code', { className: ['ep-path'] }, [{ type: 'text', value: path }]),
            ]),
          ];
        } else {
          node.properties.id ??= slugger.slug(label);
          node.children = [el('a', { className: ['heading-anchor'], href: `#${node.properties.id}` }, node.children)];
        }
        return 'skip';
      }

      if (node.tagName === 'table' && parent && !parent.properties?.className?.includes?.('table-scroll')) {
        parent.children[index] = el('div', { className: ['table-scroll'], tabIndex: 0 }, [node]);
        return 'skip';
      }

      if (node.tagName === 'pre' && parent) {
        const language = String(node.properties?.dataLanguage ?? 'text');
        const label = LANGUAGES[language] ?? language.toUpperCase();
        parent.children[index] = el('figure', { className: ['code-frame'] }, [
          el('figcaption', { className: ['code-head'] }, [
            el('span', { className: ['code-lang'] }, [{ type: 'text', value: label }]),
            el('button', { type: 'button', className: ['code-copy'], ariaLabel: 'Copy code', dataCopyCode: '' }, []),
          ]),
          node,
        ]);
        return 'skip';
      }
    });
  };
}
