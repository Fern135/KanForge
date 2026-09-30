# syntax=docker/dockerfile:1.7

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# Production dependencies only.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Full dependency set, used by `make test` and the dev stack.
FROM base AS dev
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY . .
USER node
CMD ["npm", "run", "dev"]

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
# Source stays owned by root, so the node user can read it but not modify it.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json migrate-mongo-config.js ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
