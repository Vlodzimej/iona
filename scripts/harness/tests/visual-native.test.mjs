import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import {
  AndroidWebViewAdapter,
  AppiumWebViewAdapter,
  IosSimulatorAdapter,
} from '../lib/visual-native.mjs';

function png() {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(255);
  return PNG.sync.write(image);
}

class FakeWebSocket {
  constructor() {
    this.listeners = new Map();
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(name, callback) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(callback);
    this.listeners.set(name, listeners);
  }

  emit(name, event) {
    for (const listener of this.listeners.get(name) || []) listener(event);
  }

  send(value) {
    const request = JSON.parse(value);
    let result = {};
    if (request.method === 'Runtime.evaluate') {
      result = {
        result: {
          value: {
            viewport: { width: 100, height: 200, deviceScaleFactor: 2 },
            document: { scrollWidth: 100, scrollHeight: 200 },
            nodes: [],
            truncated: false,
          },
        },
      };
    }
    if (request.method === 'Page.captureScreenshot') result = { data: png().toString('base64') };
    queueMicrotask(() =>
      this.emit('message', { data: JSON.stringify({ id: request.id, result }) }),
    );
  }

  close() {
    this.emit('close', {});
  }
}

test('Android adapter exposes only bounded WebView DOM and screenshot operations', async () => {
  const calls = [];
  const runCommand = (_executable, args) => {
    calls.push(args);
    if (args[0] === 'devices') return 'List of devices attached\nemulator-5554\tdevice\n';
    if (args.includes('pidof')) return '321\n';
    if (args.includes('tcp:0')) return '40123\n';
    return '';
  };
  const adapter = new AndroidWebViewAdapter({
    runCommand,
    WebSocketClass: FakeWebSocket,
    request: async () => ({
      ok: true,
      json: async () => [
        {
          type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1:40123/devtools/page/1',
        },
      ],
    }),
  });
  const root = mkdtempSync(resolve(tmpdir(), 'ionic-android-visual-'));
  try {
    const handle = await adapter.open({
      serial: 'emulator-5554',
      applicationId: 'dev.example.app',
    });
    const snapshot = await adapter.snapshot(handle, 25);
    assert.equal(snapshot.viewport.width, 100);
    const path = resolve(root, 'actual.png');
    await adapter.screenshot(handle, path);
    assert.doesNotThrow(() => PNG.sync.read(readFileSync(path)));
    await adapter.close(handle);
    assert.ok(calls.some((args) => args.includes('localabstract:webview_devtools_remote_321')));
    assert.ok(calls.some((args) => args.includes('--remove')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('iOS Simulator adapter validates a booted exact UDID and captures a screenshot', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ionic-ios-visual-'));
  const udid = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
  const adapter = new IosSimulatorAdapter({
    runCommand: (_executable, args) => {
      if (args.includes('list')) {
        return JSON.stringify({ devices: { runtime: [{ udid, state: 'Booted' }] } });
      }
      writeFileSync(args.at(-1), png());
      return '';
    },
  });
  try {
    const handle = await adapter.open({ udid });
    const path = resolve(root, 'simulator.png');
    await adapter.screenshot(handle, path);
    assert.equal(existsSync(path), true);
    await assert.rejects(() => adapter.snapshot(), /Appium/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Appium adapter reuses but never deletes a human-owned WebView session', async () => {
  const requests = [];
  const adapter = new AppiumWebViewAdapter({
    request: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET' });
      const value = url.endsWith('/screenshot')
        ? png().toString('base64')
        : url.endsWith('/execute/sync')
          ? { viewport: { width: 390, height: 844 }, nodes: [] }
          : { sessionId: 'session-1' };
      return { ok: true, json: async () => ({ value }) };
    },
  });
  const root = mkdtempSync(resolve(tmpdir(), 'ionic-appium-visual-'));
  try {
    const handle = await adapter.open({ url: 'http://127.0.0.1:4723/', sessionId: 'session-1' });
    assert.equal((await adapter.snapshot(handle, 50)).viewport.width, 390);
    await adapter.screenshot(handle, resolve(root, 'device.png'));
    await adapter.close(handle);
    assert.deepEqual(
      requests.map(({ method }) => method),
      ['GET', 'POST', 'GET'],
    );
    assert.equal(
      requests.some(({ method }) => method === 'DELETE'),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native adapter errors do not expose registered connection details', async () => {
  const android = new AndroidWebViewAdapter({
    runCommand: () => {
      throw new Error('adb -s secret-device shell failed');
    },
  });
  await assert.rejects(
    () => android.open({ serial: 'secret-device', applicationId: 'dev.secret.app' }),
    (error) =>
      !error.message.includes('secret-device') && /authorized Android/u.test(error.message),
  );

  const appium = new AppiumWebViewAdapter({
    request: async () => {
      throw new Error('connect http://127.0.0.1:4723/session/private-session');
    },
  });
  await assert.rejects(
    () =>
      appium.open({
        url: 'http://127.0.0.1:4723/',
        sessionId: 'private-session',
      }),
    (error) =>
      error.message === 'Registered Appium session is unavailable.' &&
      !error.message.includes('private-session'),
  );
});
