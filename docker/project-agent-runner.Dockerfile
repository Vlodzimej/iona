FROM ionic-llm-agent-runner:node-26

ARG HARNESS_DEPENDENCY_DIGEST
LABEL io.ionic-llm-harness.dependencies=$HARNESS_DEPENDENCY_DIGEST

WORKDIR /opt/agent
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY runner.mjs /opt/agent/runner.mjs
RUN chmod 0555 /opt/agent/runner.mjs

ENTRYPOINT ["node", "/opt/agent/runner.mjs"]
