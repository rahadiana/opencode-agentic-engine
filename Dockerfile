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

# Install plugin to project-level .opencode/plugins/ directory (auto-loaded by opencode)
RUN mkdir -p /workspace/.opencode/plugins/agentic-engine
RUN cp /workspace/dist/index.js /workspace/.opencode/plugins/agentic-engine/index.js
# Copy package.json for plugin metadata
RUN echo '{"name":"opencode-agentic-engine","version":"0.1.0","main":"./index.js","type":"module"}' > /workspace/.opencode/plugins/agentic-engine/package.json

# Create opencode config with local plugin reference
RUN echo '{"plugin": ["/workspace/.opencode/plugins/agentic-engine"]}' > /workspace/.opencode/opencode.json

ENV OPENCODE_SERVER_HOSTNAME=0.0.0.0
ENV OPENCODE_SERVER_PORT=4096

EXPOSE 4096

CMD ["opencode", "web", "--hostname", "0.0.0.0", "--port", "4096"]
