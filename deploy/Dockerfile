# syntax=docker/dockerfile:1
# Detter · 自托管镜像（Node 运行时 + node:sqlite）
#
# 构建：docker build -f deploy/Dockerfile -t detter .
# 运行：docker run -d -p 8787:8787 -v detter-data:/data -e SETUP_TOKEN=xxx detter

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache tini
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @detter/api... || pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @detter/api build:node

FROM base AS runner
ENV NODE_ENV=production
ENV DETTER_DB=/data/detter.sqlite
ENV PORT=8787
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/migrations ./migrations
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
