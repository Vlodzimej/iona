# Iona for VS Code

A desktop VS Code 1.141+ extension for Ionic and Capacitor development with local
models. Iona provides chat, isolated coding tasks and a controlled agent harness.
It supports Ollama, LM Studio, NVIDIA PAIR and custom OpenAI-compatible servers.

## Build and install

From the repository root, with Node >=24.15 (Node 26 recommended):

```bash
npm ci --prefix extensions/vscode
npm run vscode:build
npm run vscode:test
npm run vscode:package
code --install-extension extensions/vscode/iona-0.2.4.vsix
```

Alternatively select **Iona extension** in Run and Debug and press
F5 after installing extension dependencies. The Angular application's build is
independent of the extension. The VSIX bundles an explicit runtime file allowlist;
it does not require this checkout after installation.

## Connect a model

Open **Iona: Open** from the Command Palette. **Iona**
appears in the Secondary Side Bar, alongside other assistant tabs. Use the gear
button for **Connection settings**:

| Provider                | Default API base URL        |
| ----------------------- | --------------------------- |
| Ollama                  | `http://127.0.0.1:11434/v1` |
| LM Studio               | `http://127.0.0.1:1234/v1`  |
| NVIDIA PAIR / Ollama    | `http://127.0.0.1:11434/v1` |
| NVIDIA PAIR / LM Studio | `http://127.0.0.1:1234/v1`  |
| NVIDIA PAIR / llama.cpp | `http://127.0.0.1:8080/v1`  |

Enable the server in Ollama or LM Studio. Choose a provider, optionally set the
base URL, then use **Check connection / select model** in the gear menu to choose an exact ID.
Clear a previous custom base URL when changing providers to use its default.
Use **API key** in the gear menu when required; keys are scoped to provider, PAIR engine and endpoint
in VS Code SecretStorage. They are never stored in workspace settings or passed
as process arguments. Reasoning effort is omitted unless explicitly configured.

Assistant messages render Markdown, including tables, lists and code blocks. Raw HTML
is displayed as text; images are not fetched. **Copy** on a completed message copies
its original Markdown through the VS Code clipboard. Streaming messages become
copyable only after the complete response passes validation.

Chat streams public content; conversation history is stored in VS Code workspace state until cleared.
Truncated or incomplete responses are rejected, and provisional text is removed
on failure. Reasoning fields are ignored. Project files are not automatically
attached to chat. Enable **Include selected code in chat** to send a bounded
excerpt from the active editor; denied paths remain excluded.

The composer stays at the bottom. Choose **Chat** or **Agent**, click the model
name to change models, and press Enter to send (Shift+Enter adds a newline). Task
controls appear only for an active run; the task menu contains approval, apply,
and discard actions. The stop button cancels inference while a request is running.

VS Code remembers customized view locations. If an upgraded panel remains on the
left, right-click its title and choose **Move View → Secondary Side Bar**, or drag
the Iona tab next to Codex. The extension does not move other views.

## NVIDIA PAIR

Install PAIR on the machine running the extension host and join it to the desired
cluster. Choose **pair** and its engine, then copy that engine's URL from PAIR's
**Endpoints** window into the base URL setting; a bare host URL gets `/v1` appended.
Use the exact model ID returned by the proxy. PAIR routes independent requests to
eligible nodes; a single inference request runs on one node. The extension does
not configure cluster membership or install models.

PAIR accepts loopback clients only, so the extension rejects remote PAIR URLs.
With SSH, WSL or Dev Containers, the extension host runs in that environment:
`localhost`, Node, Git, Docker and external skills refer to that host. Install
PAIR there if supported, or open a local desktop workspace. Connecting directly
to a remote engine is a separate custom-provider configuration.

Source: [NVIDIA PAIR setup and endpoint guide](https://build.nvidia.com/rtx/pair/app-setup).

## Agent tasks

Install the external skills listed in [ai/harness.json](../../ai/harness.json)
under `~/.agents/skills` on the extension host. Skills are retrieved dynamically,
labelled in context and never bundled. Docker and Git are required for agent mode.
Use **Prepare Docker runner** in the gear menu once; it builds the trusted base image. Project
validation automatically builds/caches a dependency image using the target's
package manifests. Image preparation requires network access; checks run with
network disabled.

Open a trusted Git workspace, describe the change, and choose **Agent** in the composer, then send the task.
For multi-root workspaces select a repository. The controller uses only the
[agent tool registry](../../ai/agent.json), edits through validated unified diffs,
and keeps state/worktrees outside the target repository in VS Code global storage.
Lockfiles, environments and harness-generated reports are excluded from tools.

- **Review diff** opens the current worktree patch in a diff-language editor.
- **Approve protected patch** opens the exact pending patch before confirmation.
  Approval is tied to its ID and hash. Choose **Continue** after approving/rejecting.
- **Apply validated changes** reviews the diff and applies only a ready, sealed
  run after confirmation. The harness rejects changed HEADs or modified patches.
- **Discard run** removes the isolated worktree after confirmation.
- **Cancel model request** aborts inference. A synchronous Docker check/preparation
  finishes before the bridge can process cancellation; the worktree is retained.

Run references and pending patches survive reload. Conversations and model
reasoning are not saved. Continue reconstructs context and inspects the retained
worktree; it does not replay a stored conversation. Chat and agent operations
are serialized per panel. There is no arbitrary shell tool or automatic application
of changes to the primary checkout.

If the bridge cannot start, set `iona.nodePath` to an absolute Node >=24.15
executable. For failed operations, check server availability, selected model,
external skills, Docker daemon and the target's validation scripts. Agent models
must support function calls or the harness's JSON tool fallback. Test a model on
small tasks before relying on larger changes.

Official APIs: [VS Code Webviews](https://code.visualstudio.com/api/extension-guides/webview),
[Ollama compatibility](https://docs.ollama.com/api/openai-compatibility),
[LM Studio compatibility](https://lmstudio.ai/docs/developer/openai-compat).
