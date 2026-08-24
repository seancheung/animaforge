# syntax=docker/dockerfile:1.7

# === Stage 1: install dependencies ===========================================
FROM node:22-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# === Stage 2: build app ======================================================
FROM node:22-alpine AS builder
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    STANDALONE_OUTPUT=1

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs ./
COPY messages ./messages
COPY src ./src

RUN npm run build

# === Stage 3: runtime ========================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/database.sqlite3 \
    MIGRATION_PATH=/app/migrations

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY knexfile.cjs ./
COPY migrations ./migrations
COPY docker-entrypoint.sh ./

RUN chmod +x /app/docker-entrypoint.sh

VOLUME ["/app/data"]
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
