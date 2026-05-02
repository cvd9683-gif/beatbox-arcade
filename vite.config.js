import { defineConfig } from 'vite';

// GitHub Pages serves project sites from a subpath:
// https://<user>.github.io/<repo>/. Setting `base` makes Vite rewrite
// every asset URL in the built index.html to start with that subpath
// so JS/CSS/wasm requests resolve correctly. Repo name MUST match.
//
// Trade-off: `base: '/beatbox-arcade/'` produces absolute URLs that
// work on Pages but break when opening dist/index.html as a file://
// (it would look up '/beatbox-arcade/...' from the filesystem root).
// Use `npm run preview` to validate locally instead.
export default defineConfig({
  base: '/beatbox-arcade/',
  server: {
    host: true,
  },
});
