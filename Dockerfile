FROM node:20-slim AS builder
WORKDIR /app

# Install bun
RUN npm install -g bun

# Install all dependencies (including devDeps for build)
COPY package.json bun.lock ./
RUN bun install

# Copy source
COPY . .

# Build renderer (no Electron needed) and server bundle
RUN bun run build:renderer:web
RUN node scripts/build-server.mjs

# ---- Runtime image ----
FROM oven/bun:latest AS runtime
WORKDIR /app

# Install Node.js (required for some child processes) and Claude Code CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    nodejs \
    npm \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# Copy only build artifacts and production deps
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/out/renderer ./out/renderer
COPY package.json bun.lock ./
RUN bun install --production

ENV PORT=3000
ENV NODE_ENV=production
ENV ALLOW_REMOTE=true
ENV DATA_DIR=/data
# HOME=/data ensures Claude Code OAuth tokens persist on the mounted PVC
# across pod restarts instead of being lost in the ephemeral container filesystem
ENV HOME=/data

# SQLite data volume — mount with: -v $(pwd)/data:/data
VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "dist-server/server.mjs"]
