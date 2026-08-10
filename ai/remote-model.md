# Remote model connection

The harness talks to any OpenAI-compatible Chat Completions endpoint. Keep
connection details outside Git in `.env.local-ai`; the repository contains no
host names, user names, private addresses, credentials, or deployment-specific
network topology.

## 1. Configure the endpoint

Copy the ignored local configuration and set values for your environment:

```bash
cp .env.local-ai.example .env.local-ai
```

```dotenv
LOCAL_AI_BASE_URL=https://model.example.com/v1
LOCAL_AI_MODEL=gpt-oss-20b
LOCAL_AI_API_KEY=<token-if-required>
```

For a model server running on the same machine, use its loopback URL instead.
Never commit `.env.local-ai`, keys, passwords, certificates, or private host
details.

## 2. Optional protected tunnel

If the endpoint is reachable only through SSH, keep the target and ports in
your shell environment and open a local tunnel:

```bash
export REMOTE_SSH_TARGET='<ssh-user>@<model-host>'
export REMOTE_MODEL_PORT='<remote-api-port>'
export LOCAL_TUNNEL_PORT='<local-port>'

ssh -N \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -L "127.0.0.1:${LOCAL_TUNNEL_PORT}:127.0.0.1:${REMOTE_MODEL_PORT}" \
  "${REMOTE_SSH_TARGET}"
```

Then set `LOCAL_AI_BASE_URL` to
`http://127.0.0.1:${LOCAL_TUNNEL_PORT}/v1`. A TLS-protected authenticated
gateway is also suitable. Do not expose an unauthenticated model port to an
untrusted network.

## 3. Verify the connection

The repository scripts load `.env.local-ai` automatically:

```bash
npm run ai:doctor
npm run ai:smoke
```

The smoke check must find the exact configured model ID. Stop and investigate
if the endpoint times out, returns an authentication error, or does not list
the configured model.

For a direct API check:

```bash
curl -sS --max-time 10 \
  -H "Authorization: Bearer ${LOCAL_AI_API_KEY}" \
  "${LOCAL_AI_BASE_URL}/models"
```

Omit the authorization header only when the endpoint is local and explicitly
configured without authentication.

## 4. Use the harness

```bash
npm run ai:ask -- "Объясни, как выбрать Capacitor-плагин для камеры"
npm run ai:ask -- --task-file ai/evals/tasks/capacitor-plugin-selection.json
```

Every request includes compact excerpts from the live `angular-developer` and
`capacitor-plugins` skills plus task-relevant references. Application code is
excluded unless `--with-project-reference` is passed explicitly. The scripts
print model output but do not authorize the model to edit files, run suggested
commands, access excluded data, or send private code to another service.

## 5. Response handling

The user-facing answer is `choices[0].message.content`. Do not expose or append
`choices[0].message.reasoning` to the conversation. Check `finish_reason`; a
value of `length` means the completion was truncated and should be retried with
a larger token budget.

Treat raw service markers such as `<|channel|>` in `content` as a template or
parser failure. Retry once, then report the issue if it repeats. For multi-turn
chat, resend the visible user and assistant messages, never hidden reasoning.

Use `reasoning_effort=low` as the default and tune context, completion, and
retrieval budgets through the versioned evaluations in `ai/evals`.

## 6. Disconnect

For an optional tunnel, press `Ctrl+C` in its terminal and confirm that the SSH
process exits. Do not leave unused tunnels running.
