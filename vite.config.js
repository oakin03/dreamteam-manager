import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer learns its edition at build time. The shared builds set DT_EDITION=pro / basic; the
// user's normal build leaves it unset, so __DT_EDITION__ is 'full' and nothing changes.
const EDITION = ['pro', 'basic'].includes(process.env.DT_EDITION) ? process.env.DT_EDITION : 'full';

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __DT_EDITION__: JSON.stringify(EDITION)
  },
  build: {
    outDir: process.env.DT_RENDERER_OUTDIR || 'dist',
    emptyOutDir: true
  }
});
