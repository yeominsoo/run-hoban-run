import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        race: resolve(__dirname, 'race/index.html'),
        team: resolve(__dirname, 'team/index.html'),
        dice: resolve(__dirname, 'dice/index.html'),
        rps: resolve(__dirname, 'rps/index.html'),
        liar: resolve(__dirname, 'liar/index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/examples/jsm/')) {
            return 'three-examples';
          }

          if (id.includes('/node_modules/three/')) {
            return 'three';
          }

          return undefined;
        }
      }
    }
  }
});
