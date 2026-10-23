# syntax=docker/dockerfile:1
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The lockfile is produced with npm 11 (the base image ships npm 10, which reports it out of sync).
RUN npm install -g npm@11 && npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY registry ./registry
# The app only needs node: drop the npm bundled in the base image (smaller attack surface, fewer CVEs to track).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
# Cloud Run injects PORT (default 8080); the app listens on it.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/main.js"]
