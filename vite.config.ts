import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        validation: resolve(__dirname, 'validation.html')
      }
    }
  },
  plugins: [
    {
      name: 'validation-route-plugin',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/validation' || req.url === '/validation/') {
            req.url = '/validation.html';
          }
          next();
        });
      }
    }
  ]
});
