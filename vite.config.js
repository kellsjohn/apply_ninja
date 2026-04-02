import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const entry = process.env.ENTRY;

const contentScriptConfig = defineConfig({
  build: {
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(__dirname, `src/${entry || 'content-script'}.js`),
      name: 'ApplyNinja',
      fileName: () => `assets/${entry || 'content-script'}.js`,
      formats: ['iife'],
    },
  },
});

const popupConfig = defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background.js'),
      },
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});

export default entry === 'content-script' || entry === 'glassdoor-script' ? contentScriptConfig : popupConfig;
