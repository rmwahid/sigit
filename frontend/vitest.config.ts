import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vitest config: the sveltekit() plugin does not transform .svelte files in
// test mode, so component tests use the standalone svelte() plugin with the
// same $lib alias SvelteKit provides.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Vitest resolves packages with node conditions by default, which picks
    // svelte's server build; force the browser build to match the client
    // components produced by the svelte() plugin.
    conditions: ["browser"],
    alias: {
      $lib: path.resolve(root, "src/lib"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
