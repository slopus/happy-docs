# happy-docs

Documentation for Happy products, published at https://happy.engineering/happy-docs/.

| Directory | Site | Live |
| --- | --- | --- |
| [`enterprise/`](enterprise/) | Happy Enterprise ([slopus/happy-commons](https://github.com/slopus/happy-commons)) | https://happy.engineering/happy-docs/enterprise/ |

Each site is an [Astro](https://astro.build) project. To work on one:

```sh
cd enterprise
npm ci
npm run dev      # http://localhost:4321/happy-docs/enterprise/
npm run build    # writes dist/
```

Every push to `main` builds all sites and deploys them to GitHub Pages
(`.github/workflows/pages.yml`). The root `index.html` redirects to the
Enterprise docs.

To add a site for another product, put it in its own directory with `base`
set to `/happy-docs/<directory>` in its Astro config, and add a build and copy
step for it in the workflow.
