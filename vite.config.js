import { defineConfig } from 'vite';

// GitHub Pages is served under /test12/ so base must be repo-relative.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/test12/',
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // Core logic tests are pure JS and must not need a browser.
    testTimeout: 10000,
  },
});
