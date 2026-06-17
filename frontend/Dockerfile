FROM ghcr.io/pnpm/pnpm:11 AS base
RUN pnpm runtime set node 26 -g

# Rebuild the source code only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- Stage 2: Builder ---
FROM base AS builder

ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=true

WORKDIR /app
COPY . .

COPY --from=deps /app/node_modules ./node_modules

RUN pnpm build

# Production image, copy all the files and run next
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 -g nodejs nextjs

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Leverage Next.js standalone output tracing
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js is generated automatically by Next.js standalone mode
CMD ["node", "server.js"]
