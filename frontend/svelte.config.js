import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // SiGit is a pure client-side SPA (no SSR modules): the build emits static
    // files served by Caddy/nginx, with index.html as the SPA fallback.
    adapter: adapter({ fallback: "index.html" }),
    prerender: { entries: [] },
  },
};

export default config;
