import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import { rehypeDocs } from './src/lib/rehype-docs.mjs';

// Served by GitHub Pages for slopus/happy-docs, which redirects to the org's
// custom domain: https://happy.engineering/happy-docs/enterprise/
const base = '/happy-docs/enterprise';

export default defineConfig({
  site: 'https://happy.engineering',
  base,
  trailingSlash: 'always',
  build: { format: 'directory' },
  // Renamed pages: old URLs keep working.
  redirects: {
    '/docs/concepts/tenancy/': `${base}/docs/concepts/isolation/`,
    '/docs/concepts/organisations/': `${base}/docs/concepts/organizations/`,
    '/docs/api/organisation/': `${base}/docs/api/organization/`,
    '/docs/verification/': `${base}/docs/concepts/isolation/`,
    '/docs/self-hosting/development/': `${base}/docs/self-hosting/`,
  },
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
    processor: unified({
      rehypePlugins: [[rehypeDocs, { base }]],
    }),
  },
});
