import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as vscode from 'vscode';

export class Bridge implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | undefined;
  private sequence = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly event: (value: unknown) => void,
  ) {}

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const nodePath = vscode.workspace.getConfiguration('iona').get<string>('nodePath', 'node');
    const child = spawn(
      nodePath,
      [
        this.context.asAbsolutePath('dist/runtime/scripts/vscode/bridge.mjs'),
        this.context.globalStorageUri.fsPath,
      ],
      {
        shell: false,
        windowsHide: true,
        // No model credentials are passed in arguments or inherited from workspace env files.
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      },
    );
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line: string) => {
      try {
        const value: unknown = JSON.parse(line);
        if (!isRecord(value)) return;
        if ('event' in value) {
          this.event(value.event);
          return;
        }
        if (typeof value.id !== 'number') return;
        const pending = this.pending.get(value.id);
        if (!pending) return;
        this.pending.delete(value.id);
        if (typeof value.error === 'string') pending.reject(new Error(value.error));
        else pending.resolve(value.result);
      } catch {
        this.fail('Invalid response from harness bridge.');
        child.kill();
      }
    });
    // Drain stderr without persisting provider errors or hidden reasoning.
    child.stderr.resume();
    child.stdin.on('error', () => this.fail('Harness bridge input closed.'));
    child.on('error', () => {
      if (this.child === child) this.child = undefined;
      this.fail('Cannot start bridge. Configure Node >=24.15 in Iona settings.');
    });
    child.on('exit', () => {
      lines.close();
      if (this.child === child) {
        this.child = undefined;
        this.fail('Harness bridge stopped. Isolated runs are retained.');
      }
    });
    return child;
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  cancel(): void {
    this.child?.stdin.write(JSON.stringify({ method: 'cancel' }) + '\n');
  }
  private fail(message: string): void {
    for (const request of this.pending.values()) request.reject(new Error(message));
    this.pending.clear();
  }
  dispose(): void {
    this.child?.kill();
    this.child = undefined;
    this.fail('Extension closed.');
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
