import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'three',
      '@photo-sphere-viewer/core',
      '@photo-sphere-viewer/equirectangular-video-adapter',
      '@photo-sphere-viewer/video-plugin',
    ],
  },
  resolve: {
    dedupe: [
      'three',
      '@photo-sphere-viewer/core',
      '@photo-sphere-viewer/video-plugin',
    ],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mockapi': fileURLToPath(new URL('../mockapi', import.meta.url)),
      three: fileURLToPath(new URL('./node_modules/three', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
