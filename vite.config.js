import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.', // Use current directory as root
  base: './',

  build: {
    outDir: 'dist', // or any temporary folder before copying into oTree
    emptyOutDir: true,
    rollupOptions: {
      input: './mainWorker.js', // <-- important: main.js is in root
    },
  },

  resolve: {
    alias: {
      'three': path.resolve(__dirname, 'node_modules/three'),
      'kalidokit': path.resolve(__dirname, 'node_modules/kalidokit'),
      '@mediapipe/tasks-vision': path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision'),
    }
  }
});