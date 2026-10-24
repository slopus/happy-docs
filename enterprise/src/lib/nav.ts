// The docs sidebar, in reading order. `href` is relative to the docs root.
export interface NavItem {
  title: string;
  href: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    group: 'Getting started',
    items: [
      { title: 'What Happy Enterprise is', href: '' },
      { title: 'Quickstart', href: 'quickstart/' },
    ],
  },
  {
    group: 'Concepts',
    items: [
      { title: 'Tenants and isolation', href: 'concepts/tenancy/' },
      { title: 'Users, teams, permissions', href: 'concepts/organisations/' },
      { title: 'Authentication', href: 'concepts/authentication/' },
      { title: 'Two-factor authentication', href: 'concepts/two-factor/' },
      { title: 'The ontology', href: 'concepts/ontology/' },
      { title: 'Custom validators', href: 'concepts/validators/' },
      { title: 'Live events', href: 'concepts/live-events/' },
      { title: 'MCP and OAuth', href: 'concepts/mcp/' },
      { title: 'Files and email', href: 'concepts/files-and-email/' },
      { title: 'Rate limits', href: 'concepts/rate-limits/' },
    ],
  },
  {
    group: 'API reference',
    items: [
      { title: 'Overview and errors', href: 'api/' },
      { title: 'Login and sessions', href: 'api/auth/' },
      { title: 'Your account', href: 'api/me/' },
      { title: 'Organisation', href: 'api/organisation/' },
      { title: 'Members, agents, invites', href: 'api/members/' },
      { title: 'Teams', href: 'api/teams/' },
      { title: 'Ontology schema', href: 'api/ontology-schema/' },
      { title: 'Objects and links', href: 'api/ontology-objects/' },
      { title: 'Validators', href: 'api/validators/' },
      { title: 'Event stream', href: 'api/events/' },
      { title: 'OAuth endpoints', href: 'api/oauth/' },
      { title: 'MCP tools and scopes', href: 'api/mcp/' },
      { title: 'Management API', href: 'api/management/' },
    ],
  },
  {
    group: 'Assurance',
    items: [{ title: 'Formal verification', href: 'verification/' }],
  },
  {
    group: 'Run it yourself',
    items: [
      { title: 'Self-hosting', href: 'self-hosting/' },
      { title: 'Configuration', href: 'self-hosting/configuration/' },
      { title: 'Development', href: 'self-hosting/development/' },
    ],
  },
];

/** The Happy Enterprise source code. */
export const REPO = 'https://github.com/slopus/happy-commons';

/** This site's source, for "Edit this page". */
export const DOCS_SOURCE = 'https://github.com/slopus/happy-docs/blob/main/enterprise';

/** The site base path with a trailing slash, e.g. `/happy-docs/enterprise/`. */
export const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';

export function docsHref(href: string): string {
  return `${BASE}docs/${href}`;
}

export function flatNav(): (NavItem & { group: string })[] {
  return NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));
}
