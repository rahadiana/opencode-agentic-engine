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

# Work directory
WORKDIR /workspace

# Copy plugin source and build
COPY package.json package-lock.json tsconfig.json esbuild.config.mjs ./
RUN npm install --ignore-scripts
COPY src/ ./src/
RUN npm run build

# Install plugin as auto-loaded local file in .opencode/plugins/ (no subfolder)
RUN mkdir -p /workspace/.opencode/plugins
RUN cp /workspace/dist/index.js /workspace/.opencode/plugins/agentic-engine.js
RUN echo '{"name":"opencode-agentic-engine","version":"0.1.0"}' > /workspace/.opencode/package.json

# Copy agentic-engine prompt for default agent config
COPY agentic-agent-prompt.md /workspace/agentic-agent-prompt.md

# Entrypoint to generate opencode.json with dynamic provider config
COPY entrypoint-opencode.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV OPENCODE_SERVER_HOSTNAME=0.0.0.0
ENV OPENCODE_SERVER_PORT=4096

EXPOSE 4096

ENTRYPOINT ["/entrypoint.sh"]
CMD ["opencode", "web", "--hostname", "0.0.0.0", "--port", "4096"]
