# ==================== Stage 1: Builder ====================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

# Minimal build-time env (satisfies Zod)
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV NEXTAUTH_SECRET=dummy-build-secret-32-chars-long-for-build-only
ENV ADMIN_KEY=dummy-admin-key-for-build
ENV UPSTASH_REDIS_REST_URL=https://dummy.upstash.io
ENV UPSTASH_REDIS_REST_TOKEN=dummy-token-for-build
ENV NODE_ENV=production
ENV NEXT_PUBLIC_BASE_URL=https://api.alex-io.com

RUN npm run build

# ==================== Stage 2: Runner ====================
FROM node:22-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# IMPORTANT: Create cache directory with correct ownership
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]