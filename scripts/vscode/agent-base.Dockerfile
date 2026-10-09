FROM node:26.7.0-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ripgrep ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/agent
COPY docker/agent-runner.mjs /opt/agent/runner.mjs
ENTRYPOINT ["node", "/opt/agent/runner.mjs"]
