# syntax=docker/dockerfile:1
# 山寺 · 单进程镜像：Node 同时托管 dist/ 静态页与 /ws 同修服务
#
#   docker build -t shansi .
#   docker run -p 8787:8787 -e MAX_PLAYERS=12 shansi
#
# 状态（players / seats）只在内存里，因此只能跑单实例，不要横向扩容。

# ——— 构建阶段：装上 devDependencies，跑 tsc + vite ———
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ——— 运行阶段：只留生产依赖 + server + dist ———
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    MAX_PLAYERS=12
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
USER node
CMD ["node", "server/index.mjs"]
