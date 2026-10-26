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
      { title: 'How it fits', href: 'how-it-fits/' },
      { title: 'Web app', href: 'web-app/' },
      { title: 'Quickstart', href: 'quickstart/' },
    ],
  },
  {
    group: 'Examples',
    items: [
      { title: 'Use cases', href: 'examples/' },
      { title: 'Machine maintenance', href: 'examples/maintenance/' },
      { title: 'Document management', href: 'examples/documents/' },
      { title: 'Car sales', href: 'examples/car-sales/' },
      { title: 'Agentic dev team', href: 'examples/dev-team/' },
      { title: 'Smart home', href: 'examples/home/' },
    ],
  },
  {
    group: 'Concepts',
    items: [
      { title: 'Organizations and isolation', href: 'concepts/isolation/' },
      { title: 'Users, teams, permissions', href: 'concepts/organizations/' },
      { title: 'Authentication', href: 'concepts/authentication/' },
      { title: 'Two-factor authentication', href: 'concepts/two-factor/' },
      { title: 'The ontology', href: 'concepts/ontology/' },
      { title: 'Validators and formats', href: 'concepts/validators/' },
      { title: 'Timeseries', href: 'concepts/timeseries/' },
      { title: 'Business actions', href: 'concepts/actions/' },
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
      { title: 'Organization', href: 'api/organization/' },
      { title: 'Members, agents, invites', href: 'api/members/' },
      { title: 'Teams', href: 'api/teams/' },
      { title: 'Ontology schema', href: 'api/ontology-schema/' },
      { title: 'Objects and links', href: 'api/ontology-objects/' },
      { title: 'Validators and formats', href: 'api/validators/' },
      { title: 'Timeseries', href: 'api/timeseries/' },
      { title: 'Actions', href: 'api/actions/' },
      { title: 'Event stream', href: 'api/events/' },
      { title: 'OAuth endpoints', href: 'api/oauth/' },
      { title: 'MCP tools and scopes', href: 'api/mcp/' },
      { title: 'Management API', href: 'api/management/' },
    ],
  },
  {
    group: 'Run it yourself',
    items: [
      { title: 'Self-hosting', href: 'self-hosting/' },
      { title: 'Configuration', href: 'self-hosting/configuration/' },
      { title: 'Performance', href: 'self-hosting/performance/' },
    ],
  },
];

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
