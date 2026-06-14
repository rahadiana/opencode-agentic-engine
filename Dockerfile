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

# Create opencode config with plugin
RUN mkdir -p /root/.config/opencode
RUN echo '{ "plugin": ["/workspace/dist/index.js"] }' > /root/.config/opencode/opencode.json

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4096

ENV OPENCODE_SERVER_HOSTNAME=0.0.0.0
ENV OPENCODE_SERVER_PORT=4096

ENTRYPOINT ["/entrypoint.sh"]
