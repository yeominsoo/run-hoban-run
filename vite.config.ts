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
        mafia: resolve(__dirname, 'mafia/index.html'),
        halligalli: resolve(__dirname, 'halligalli/index.html'),
        yutnori: resolve(__dirname, 'yutnori/index.html'),
        'strategy-yutnori': resolve(__dirname, 'strategy-yutnori/index.html'),
        'aim-trainer': resolve(__dirname, 'aim-trainer/index.html'),
        'color-slider': resolve(__dirname, 'color-slider/index.html'),
        'ball-dodge': resolve(__dirname, 'ball-dodge/index.html'),
        'tower-stack': resolve(__dirname, 'tower-stack/index.html'),
        snake: resolve(__dirname, 'snake/index.html'),
        'typing-survival': resolve(__dirname, 'typing-survival/index.html'),
        '2048-hex': resolve(__dirname, '2048-hex/index.html'),
        'endless-runner': resolve(__dirname, 'endless-runner/index.html'),
        'idle-farm': resolve(__dirname, 'idle-farm/index.html'),
        'pinball-rogue': resolve(__dirname, 'pinball-rogue/index.html'),
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
