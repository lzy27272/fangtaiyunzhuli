# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS web-builder
WORKDIR /build

COPY apps/ota-standalone-web/package.json \
  apps/ota-standalone-web/pnpm-lock.yaml \
  apps/ota-standalone-web/pnpm-workspace.yaml \
  ./apps/ota-standalone-web/

WORKDIR /build/apps/ota-standalone-web
RUN corepack enable \
  && pnpm install --frozen-lockfile

COPY apps/ota-standalone-web/ ./
RUN pnpm run build

FROM ${NODE_IMAGE} AS api
RUN addgroup -S -g 10001 ota \
  && adduser -S -D -H -u 10001 -G ota ota
WORKDIR /app

COPY tools/uat/*.mjs ./tools/uat/
COPY tools/uat/wecom/src/ ./tools/uat/wecom/src/

USER 10001:10001
EXPOSE 8091
ENTRYPOINT ["node", "/app/tools/uat/ota-standalone-review-api.mjs"]

FROM caddy:2.11-alpine AS web
COPY --from=web-builder /build/apps/ota-standalone-web/dist/ /srv/
COPY infra/ota-standalone-server/Caddyfile /etc/caddy/Caddyfile
EXPOSE 5180
