// The client-side search index: every docs page's title, group, headings,
// and plain text.
import { flatNav, docsHref } from '../lib/nav';

interface MarkdownPage {
  frontmatter: { title: string; lead?: string };
  url: string;
  rawContent(): string;
  getHeadings(): { depth: number; text: string }[];
}

export function GET() {
  const modules = import.meta.glob<MarkdownPage>('./docs/**/*.md', { eager: true });
  const groups = new Map(flatNav().map((p) => [docsHref(p.href), p.group]));
  const entries = Object.values(modules).map((page) => {
    const url = page.url.endsWith('/') ? page.url : page.url + '/';
    const text = (page.frontmatter.lead ?? '') + ' ' + page.rawContent();
    return {
      title: page.frontmatter.title,
      url,
      group: groups.get(url) ?? 'Docs',
      headings: page.getHeadings().filter((h) => h.depth <= 3).map((h) => h.text),
      text: text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[#*_`|>[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase(),
    };
  });
  entries.sort((a, b) => [...groups.keys()].indexOf(a.url) - [...groups.keys()].indexOf(b.url));
  return new Response(JSON.stringify(entries), { headers: { 'content-type': 'application/json' } });
}

export const prerender = true;
