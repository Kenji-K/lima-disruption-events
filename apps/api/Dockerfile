# Production image for the API (ADR-006). No build step: raw TS source run via
# tsx, matching dev exactly. Build context is the repo root (fly.toml lives there).
FROM node:24-slim

# pnpm via corepack — version + SHA-512 pinned by packageManager in package.json.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production
RUN corepack enable

WORKDIR /app

# Manifests first so the dependency layer caches across source-only changes.
# Every workspace package.json must be present for --frozen-lockfile validation,
# including apps/web's, even though the --filter keeps web out of the install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

# Prod deps for the API and its workspace dependencies (db, shared). tsx is a
# production dependency (ADR-006) — it IS the runtime.
RUN pnpm install --prod --frozen-lockfile --filter @disruption-intelligence/api...

COPY packages ./packages
COPY apps/api ./apps/api

# CWD mirrors `pnpm -F api start` so relative behavior (root-.env probing in
# packages/db/src/client.ts) is identical in dev and prod.
WORKDIR /app/apps/api

EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
