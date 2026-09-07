import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'frontend',
  plugins: [vue(), tailwind(), viteSingleFile()],
  build: { outDir: '../ui', emptyOutDir: true, target: 'es2022' },
  test: { environment: 'jsdom', include: ['**/*.test.ts'] },
});
