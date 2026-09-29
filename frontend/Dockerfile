# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Vite dev server with hot reload, used by `make dev`.
FROM build AS dev
RUN chown -R node:node /app
USER node
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Unprivileged nginx: runs as uid 101 and listens on high ports.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf nginx/proxy.conf /etc/nginx/snippets/
COPY --from=build /app/site /usr/share/nginx/html
COPY --from=build /app/dist /usr/share/nginx/html/app
EXPOSE 8080 8443
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- --no-check-certificate https://127.0.0.1:8443/ >/dev/null || exit 1
