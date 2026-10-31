# syntax=docker/dockerfile:1
# Referzen production image.
#   docker build -t referzen .
#   docker run -p 3000:3000 -v referzen-storage:/app/storage referzen

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup -S referzen && adduser -S referzen -G referzen
COPY --from=build --chown=referzen:referzen /app/.next ./.next
COPY --from=build --chown=referzen:referzen /app/node_modules ./node_modules
COPY --from=build --chown=referzen:referzen /app/public ./public
COPY --from=build --chown=referzen:referzen /app/scripts ./scripts
COPY --from=build --chown=referzen:referzen /app/package.json /app/server.js /app/next.config.ts ./
RUN mkdir -p storage && chown referzen:referzen storage
USER referzen
VOLUME ["/app/storage"]
EXPOSE 3000
CMD ["node", "server.js"]
