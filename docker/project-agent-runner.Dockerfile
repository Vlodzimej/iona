FROM node:26.7.0-bookworm-slim

ARG HARNESS_DEPENDENCY_DIGEST
LABEL io.ionic-llm-harness.dependencies=$HARNESS_DEPENDENCY_DIGEST

RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/agent
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY runner.mjs /opt/agent/runner.mjs
RUN chmod 0555 /opt/agent/runner.mjs

ENTRYPOINT ["node", "/opt/agent/runner.mjs"]
