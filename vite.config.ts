import { defineConfig } from 'vite';

/** 开发时前端在 5174，同修服务器在 8787；把 /ws 代理过去，前端只认同源 */
const NET_PORT = process.env.NET_PORT || '8787';

export default defineConfig({
  // 用来在设置里显示构建时间：微信缓存很凶，至少能一眼看出跑的是旧包还是新包
  define: {
    __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z'),
  },
  server: {
    host: true,
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${NET_PORT}`, ws: true, changeOrigin: true },
      // 意见箱：开发时也走同一个 Node 进程
      '/api': { target: `http://127.0.0.1:${NET_PORT}`, changeOrigin: true },
    },
  },
});
