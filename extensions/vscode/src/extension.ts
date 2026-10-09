import * as vscode from 'vscode';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Bridge, isRecord } from './bridge';
import { renderWebview } from './webview';

interface Run {
  runId: string;
  repository: string;
}
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

class HarnessView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly bridge: Bridge;
  private busy = false;
  private history: Message[];
  private run: Run | undefined;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.run = context.workspaceState.get<Run>('iona.run');
    const storedHistory = context.workspaceState.get<unknown>('iona.history');
    this.history = Array.isArray(storedHistory)
      ? storedHistory
          .filter(
            (item): item is Message =>
              isRecord(item) &&
              (item.role === 'user' || item.role === 'assistant') &&
              typeof item.content === 'string',
          )
          .slice(-40)
      : [];
    this.bridge = new Bridge(context, (event) => {
      if (!isRecord(event)) return;
      if (
        event.type === 'run' &&
        typeof event.runId === 'string' &&
        typeof event.repository === 'string'
      ) {
        this.run = { runId: event.runId, repository: event.repository };
        void context.workspaceState.update('iona.run', this.run);
      }
      this.post(event);
    });
  }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };
    const nonce = randomBytes(24).toString('hex');
    const script = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media/panel.js'),
    );
    const style = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media/panel.css'),
    );
    view.webview.html = renderWebview(
      readFileSync(this.context.asAbsolutePath('media/panel.html'), 'utf8'),
      {
        csp: view.webview.cspSource,
        nonce,
        script: script.toString(),
        markdown: view.webview
          .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist/markdown-it.min.js'))
          .toString(),
        style: style.toString(),
      },
    );
    view.webview.onDidReceiveMessage(
      (value: unknown) => {
        void this.receive(value);
      },
      undefined,
      this.context.subscriptions,
    );
  }
  private post(value: unknown): void {
    void this.view?.webview.postMessage(value);
  }
  connectionState(): void {
    const settings = vscode.workspace.getConfiguration('iona');
    this.post({
      type: 'connection',
      provider: settings.get<string>('provider', 'ollama'),
      model: settings.get<string>('model', ''),
    });
  }
  private async connection(): Promise<Record<string, unknown>> {
    const settings = vscode.workspace.getConfiguration('iona');
    const config: Record<string, unknown> = {};
    for (const name of [
      'provider',
      'pairEngine',
      'baseUrl',
      'model',
      'maximumTokens',
      'temperature',
      'timeoutMs',
      'reasoningEffort',
    ])
      config[name] = settings.get(name);
    config.apiKey = await this.context.secrets.get(this.keyId());
    return config;
  }
  private keyId(): string {
    const settings = vscode.workspace.getConfiguration('iona');
    return (
      'iona.key.' +
      createHash('sha256')
        .update(
          JSON.stringify([
            settings.get('provider'),
            settings.get('pairEngine'),
            settings.get('baseUrl'),
          ]),
        )
        .digest('hex')
    );
  }
  async apiKey(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: 'API key for the current provider and endpoint',
      password: true,
      prompt: 'Leave empty to clear. Stored only in VS Code SecretStorage.',
    });
    if (value === undefined) return;
    if (value.trim()) await this.context.secrets.store(this.keyId(), value.trim());
    else await this.context.secrets.delete(this.keyId());
  }
  private async repository(): Promise<string> {
    const folders = vscode.workspace.workspaceFolders?.filter(
      (folder) => folder.uri.scheme === 'file',
    );
    if (!folders?.length) throw new Error('Open a local Git workspace first.');
    if (folders.length === 1 && folders[0]) return folders[0].uri.fsPath;
    const choice = await vscode.window.showQuickPick(
      folders.map((folder) => ({ label: folder.name, path: folder.uri.fsPath })),
      { title: 'Repository for the agent task' },
    );
    if (!choice) throw new Error('Repository selection cancelled.');
    return choice.path;
  }
  private async confirmation(title: string, message: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(message, { modal: true }, title)) === title;
  }
  private async receive(value: unknown): Promise<void> {
    if (!isRecord(value) || typeof value.type !== 'string') return;
    if (value.type === 'copy') {
      if (
        typeof value.text !== 'string' ||
        value.text.length > 4_000_000 ||
        !Number.isSafeInteger(value.requestId)
      )
        return;
      try {
        await vscode.env.clipboard.writeText(value.text);
        this.post({ type: 'copied', requestId: value.requestId, ok: true });
      } catch {
        this.post({ type: 'copied', requestId: value.requestId, ok: false });
      }
      return;
    }
    if (value.type === 'ready') {
      this.post({ type: 'history', messages: this.history });
      this.post({ type: 'run', ...this.run });
      this.post({ type: 'busy', value: this.busy });
      this.connectionState();
      if (this.run) {
        try {
          this.runStatus(await this.bridge.request('status', { ...this.run }));
        } catch {
          this.post({ type: 'progress', text: 'The saved isolated task is unavailable.' });
        }
      }
      return;
    }
    if (value.type === 'settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'iona');
      return;
    }
    if (value.type === 'key') {
      await this.apiKey();
      return;
    }
    if (value.type === 'cancel') {
      this.bridge.cancel();
      return;
    }
    if (this.busy) return;
    if (!vscode.workspace.isTrusted) {
      this.post({ type: 'error', text: 'Trust the workspace to use the harness.' });
      return;
    }
    this.busy = true;
    this.post({ type: 'busy', value: true });
    try {
      if (value.type === 'prepare') {
        this.result(await this.bridge.request('prepare', {}));
      } else if (value.type === 'models') {
        const result = await this.bridge.request('models', { config: await this.connection() });
        if (!Array.isArray(result) || !result.every((item) => typeof item === 'string'))
          throw new Error('Invalid model list.');
        const model = await vscode.window.showQuickPick(result as string[], {
          title: 'Connection OK — select a model',
        });
        if (model)
          await vscode.workspace
            .getConfiguration('iona')
            .update('model', model, vscode.ConfigurationTarget.Global);
        this.post({
          type: 'progress',
          text: model ? 'Model: ' + model : 'Connection OK. No model selected.',
        });
      } else if (value.type === 'clear') {
        this.history = [];
        await this.context.workspaceState.update('iona.history', undefined);
        this.post({ type: 'history', messages: [] });
      } else if (value.type === 'chat' || value.type === 'start') {
        if (typeof value.task !== 'string' || !value.task.trim() || value.task.length > 24000)
          throw new Error('Enter a task up to 24,000 characters.');
        if (value.type === 'start' && this.run)
          throw new Error('Discard or apply the current run before starting another.');
        const params: Record<string, unknown> = {
          task: value.task,
          config: await this.connection(),
        };
        if (value.type === 'start') {
          params.repository = await this.repository();
        } else {
          params.history = this.history;
          if (value.includeSelection === true) {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.scheme !== 'file' || editor.selection.isEmpty)
              throw new Error('Select code in a workspace file first.');
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!folder) throw new Error('Selected file must belong to the workspace.');
            const content = editor.document.getText(editor.selection);
            if (content.length > 12000) throw new Error('Select at most 12,000 characters.');
            params.selection = {
              repository: folder.uri.fsPath,
              path: editor.document.uri.fsPath,
              content,
            };
          }
        }
        this.post({ type: 'accepted' });
        this.addMessage({ role: 'user', content: value.task });
        const result = await this.bridge.request(value.type, params);
        this.result(result);
      } else if (
        ['status', 'diff', 'continue', 'apply', 'discard', 'approve', 'reject'].includes(value.type)
      ) {
        if (!this.run) throw new Error('No active run.');
        const params: Record<string, unknown> = { ...this.run };
        let method = value.type;
        if (method === 'diff' || method === 'apply' || method === 'approve') {
          const diff = await this.bridge.request('diff', params);
          const text = isRecord(diff) && typeof diff.patch === 'string' ? diff.patch : '';
          if (method === 'approve') {
            const status = await this.bridge.request('status', params);
            if (
              !isRecord(status) ||
              !isRecord(status.approval) ||
              typeof status.approval.id !== 'string'
            )
              throw new Error('No pending approval.');
            // The pending protected patch is shown separately from the already-applied worktree diff.
            const approval = await this.bridge.request('approval', params);
            if (!isRecord(approval) || typeof approval.patch !== 'string')
              throw new Error('Cannot review protected patch.');
            params.approvalId = approval.approvalId;
            params.hash = approval.hash;
            await this.showDiff(approval.patch);
          } else await this.showDiff(text);
          if (method === 'diff') return;
        }
        if (
          ['apply', 'discard', 'approve', 'reject'].includes(method) &&
          !(await this.confirmation(
            method,
            method === 'apply'
              ? 'Apply this validated diff to the primary checkout?'
              : method === 'approve'
                ? 'Approve the exact protected patch shown in the editor? Continue the run to retry it.'
                : method + ' the current run or pending approval?',
          ))
        )
          return;
        if (method === 'reject') {
          const status = await this.bridge.request('status', params);
          if (!isRecord(status) || !isRecord(status.approval))
            throw new Error('No pending approval.');
          params.approvalId = status.approval.id;
        }
        if (method === 'approve' || method === 'reject') {
          params.decision = method === 'approve' ? 'approved' : 'rejected';
          method = 'decide';
        }
        if (method === 'continue') params.config = await this.connection();
        const result = await this.bridge.request(method, params);
        this.result(result);
        if (method === 'apply' || method === 'discard') {
          this.run = undefined;
          await this.context.workspaceState.update('iona.run', undefined);
          this.post({ type: 'run' });
        }
      }
    } catch (error) {
      this.post({
        type: 'error',
        text: error instanceof Error ? error.message : 'Operation failed.',
      });
    } finally {
      this.busy = false;
      this.post({ type: 'busy', value: false });
    }
  }
  private async showDiff(patch: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content: patch || 'No changes.',
      language: 'diff',
    });
    await vscode.window.showTextDocument(document, { preview: true });
  }
  private result(value: unknown): void {
    if (!isRecord(value)) return;
    const text = typeof value.text === 'string' ? value.text : undefined;
    const summary = typeof value.summary === 'string' ? value.summary : undefined;
    if (text) this.addMessage({ role: 'assistant', content: text });
    if (summary && summary !== text) this.addMessage({ role: 'assistant', content: summary });
    this.runStatus(value);
  }
  private runStatus(value: unknown): void {
    if (!isRecord(value) || typeof value.status !== 'string') return;
    this.post({ type: 'progress', text: 'Run: ' + value.status });
    this.post({ type: 'runStatus', status: value.status });
    if (value.status === 'waiting_approval')
      this.post({
        type: 'progress',
        text: 'Protected patch waiting for review. Choose Approve or Reject, then Continue.',
      });
  }
  private addMessage(message: Message): void {
    this.history = [...this.history, message].slice(-40);
    void this.context.workspaceState.update('iona.history', this.history);
    this.post({ type: 'message', role: message.role, text: message.content });
  }
  dispose(): void {
    this.bridge.dispose();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new HarnessView(context);
  context.subscriptions.push(
    provider,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('iona')) provider.connectionState();
    }),
    vscode.window.registerWebviewViewProvider('iona.chat', provider),
    vscode.commands.registerCommand('iona.open', () =>
      vscode.commands.executeCommand('iona.chat.focus'),
    ),
    vscode.commands.registerCommand('iona.settings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'iona'),
    ),
    vscode.commands.registerCommand('iona.apiKey', () => provider.apiKey()),
  );
}
