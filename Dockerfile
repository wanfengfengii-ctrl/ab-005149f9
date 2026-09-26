# syntax=docker/dockerfile:1

# ---- 依赖基座：测试 / 构建 / verify 共用 ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 构建阶段：类型检查 + 产出静态资源 ----
FROM base AS build
COPY . .
RUN npm run build

# ---- verify 一次性服务：测试 + 构建 + 冒烟，完成后自行退出 ----
FROM base AS verify
COPY . .
CMD ["sh", "scripts/verify.sh"]

# ---- 运行阶段：nginx 托管静态页面，内置 /health 健康端点 ----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
