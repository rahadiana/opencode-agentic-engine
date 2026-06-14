FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    unzip \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install opencode globally
RUN npm install -g opencode-ai@latest

# Install cloudflared
RUN curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && cloudflared --version

# Work directory
WORKDIR /workspace

# Copy plugin source and build
COPY package.json package-lock.json tsconfig.json esbuild.config.mjs ./
RUN npm install --ignore-scripts
COPY src/ ./src/
RUN npm run build

# Install plugin to project-level .opencode/plugins/ directory (auto-loaded by opencode)
RUN mkdir -p /workspace/.opencode/plugins/agentic-engine
RUN cp /workspace/dist/index.js /workspace/.opencode/plugins/agentic-engine/index.js

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4096

ENV OPENCODE_SERVER_HOSTNAME=0.0.0.0
ENV OPENCODE_SERVER_PORT=4096

ENTRYPOINT ["/entrypoint.sh"]
