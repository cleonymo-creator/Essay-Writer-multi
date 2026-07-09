import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build config for the frontend. index.html at the repo root is the entry;
// it loads src/main.jsx as a module (replacing the former in-browser Babel).
// Library globals (marked, DOMPurify, firebase, pdfjsLib) are still loaded via
// <script> tags in index.html and referenced as runtime globals, so they are
// intentionally NOT bundled.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // The app is currently one large module; silence the chunk-size warning
    // until it is split into route-level chunks (later Phase 3 work).
    chunkSizeWarningLimit: 4000,
  },
});
