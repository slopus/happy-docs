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
