# syntax=docker/dockerfile:1.7

# Pages served at / next to the app (a landing page, for example). Empty here, so
# a server opens straight into the app. A hosted build passes its own folder:
#   docker build --build-context site=<folder> --build-arg VITE_SITE_URL=/ ...
FROM scratch AS site

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Where the app links back to (sign-in's "Back to home", pricing links). Unset:
# no such links, since a self-hosted server has no site of its own.
ARG VITE_SITE_URL=
ENV VITE_SITE_URL=$VITE_SITE_URL
RUN npm run build

# Vite dev server with hot reload, used by `make dev`.
FROM build AS dev
RUN chown -R node:node /app
USER node
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Unprivileged nginx: runs as uid 101 and listens on high ports.
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:26b0bf6fbf07297983cb341998d79c831508787de26627dd2a112321b9c3a4af AS runtime
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf nginx/proxy.conf /etc/nginx/snippets/
# Our own web root, so nothing from the base image (its welcome page) is ever served.
COPY --from=site / /usr/share/kanforge/www
COPY --from=build /app/dist /usr/share/kanforge/www/app
EXPOSE 8080 8443
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- --no-check-certificate https://127.0.0.1:8443/ >/dev/null || exit 1
