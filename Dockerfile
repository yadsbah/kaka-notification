# --- dashboard build ---
FROM oven/bun:1.3 AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# --- runtime ---
FROM oven/bun:1.3 AS app
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production
COPY prisma ./prisma
RUN bunx prisma generate --schema=./prisma/schema
COPY src ./src
COPY scripts ./scripts
COPY --from=web /app/web/dist ./web/dist

ENV NODE_ENV=production \
    DATABASE_PATH=/data/app.db \
    PORT=8080
RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Migrations are idempotent and run on every start.
CMD ["sh", "-c", "bun run scripts/migrate.ts deploy && exec bun run src/index.ts"]
