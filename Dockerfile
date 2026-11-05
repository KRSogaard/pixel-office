# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm --filter @pixel-office/server build && pnpm --filter @pixel-office/web build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S office && adduser -S office -G office && mkdir -p /data && chown office:office /data
COPY --from=build /src/packages/server/dist/server.js /app/server.js
COPY --from=build /src/packages/web/dist /app/web
COPY plugins /app/plugins
ENV NODE_ENV=production \
    PIXEL_OFFICE_HOST=0.0.0.0 \
    PIXEL_OFFICE_PORT=4790 \
    PIXEL_OFFICE_DATA_DIR=/data \
    PIXEL_OFFICE_WEB_DIR=/app/web
USER office
VOLUME /data
EXPOSE 4790
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4790/health >/dev/null || exit 1
ENTRYPOINT ["node", "/app/server.js"]
CMD ["serve"]
