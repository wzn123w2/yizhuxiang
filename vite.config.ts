import { defineConfig } from 'vite';

/** 开发时前端在 5174，同修服务器在 8787；把 /ws 代理过去，前端只认同源 */
const NET_PORT = process.env.NET_PORT || '8787';

export default defineConfig({
  server: {
    host: true,
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${NET_PORT}`, ws: true, changeOrigin: true },
    },
  },
});
