import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { browserSnapshot, PlaywrightVisualBrowser } from './visual-browser.mjs';

const maximumScreenshotBytes = 20 * 1024 * 1024;

function command(executable, args, options = {}) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

function pngFromBase64(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error('Native debugger returned an invalid screenshot.');
  }
  const image = Buffer.from(value, 'base64');
  if (image.byteLength > maximumScreenshotBytes) {
    throw new Error('Native screenshot exceeds the 20 MiB limit.');
  }
  return image;
}

function safeWebSocketUrl(value, port) {
  const url = new URL(value);
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLocaleLowerCase('en-US')) ||
    (url.port || '80') !== String(port) ||
    url.username ||
    url.password
  ) {
    throw new Error('Android WebView returned an unsafe DevTools endpoint.');
  }
  return url.toString();
}

class RestrictedCdpClient {
  constructor(socket, timeoutMs = 10_000) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error)
        pending.reject(new Error('DevTools command failed: ' + message.error.message));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Android WebView debugger disconnected.'));
      }
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    const allowed = new Set([
      'Runtime.enable',
      'Runtime.evaluate',
      'Page.enable',
      'Page.captureScreenshot',
    ]);
    if (!allowed.has(method)) throw new Error('DevTools command is not allowed.');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Android WebView debugger timed out.'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function connectSocket(url, WebSocketClass) {
  const socket = new WebSocketClass(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Android WebView debugger timed out.'));
    }, 5000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        socket.close();
        reject(new Error('Cannot connect to the Android WebView debugger.'));
      },
      { once: true },
    );
  });
  return socket;
}

export class AndroidWebViewAdapter {
  constructor({
    runCommand = command,
    request = fetch,
    WebSocketClass = globalThis.WebSocket,
  } = {}) {
    this.runCommand = runCommand;
    this.request = request;
    this.WebSocketClass = WebSocketClass;
  }

  async open(target) {
    let devices;
    let cdp;
    try {
      devices = this.runCommand('adb', ['devices']).split(/\r?\n/u);
    } catch {
      throw new Error('Cannot query authorized Android devices.');
    }
    if (!devices.some((line) => line.trim() === target.serial + '\tdevice')) {
      throw new Error('Registered Android device is not connected and authorized.');
    }
    let pid;
    try {
      pid = this.runCommand('adb', ['-s', target.serial, 'shell', 'pidof', target.applicationId])
        .trim()
        .split(/\s+/u)[0];
    } catch {
      throw new Error('Registered Android application is not running.');
    }
    if (!/^\d+$/u.test(pid || ''))
      throw new Error('Registered Android application is not running.');
    let port;
    try {
      port = this.runCommand('adb', [
        '-s',
        target.serial,
        'forward',
        'tcp:0',
        'localabstract:webview_devtools_remote_' + pid,
      ]).trim();
    } catch {
      throw new Error('Cannot create a restricted Android WebView debugger forward.');
    }
    if (!/^\d{2,5}$/u.test(port)) throw new Error('ADB did not allocate a DevTools port.');
    try {
      const response = await this.request('http://127.0.0.1:' + port + '/json', {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Android WebView DevTools discovery failed.');
      const targets = await response.json();
      const page = Array.isArray(targets)
        ? targets.find((item) => item?.type === 'page' && item.webSocketDebuggerUrl)
        : null;
      if (!page) throw new Error('No debuggable Android WebView page is available.');
      const socket = await connectSocket(
        safeWebSocketUrl(page.webSocketDebuggerUrl, port),
        this.WebSocketClass,
      );
      cdp = new RestrictedCdpClient(socket);
      await cdp.call('Runtime.enable');
      await cdp.call('Page.enable');
      return { cdp, port, serial: target.serial };
    } catch {
      cdp?.close();
      try {
        this.runCommand('adb', ['-s', target.serial, 'forward', '--remove', 'tcp:' + port]);
      } catch {
        // Do not expose connection details from a failed cleanup command.
      }
      throw new Error('Cannot attach to the registered Android WebView target.');
    }
  }

  async snapshot(handle, maximumNodes = 500) {
    const expression = `(${browserSnapshot.toString()})(${JSON.stringify({ maximumNodes })})`;
    const result = await handle.cdp.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails || !result.result?.value) {
      throw new Error('Cannot capture the Android WebView DOM snapshot.');
    }
    return result.result.value;
  }

  async screenshot(handle, path) {
    const result = await handle.cdp.call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    writeFileSync(path, pngFromBase64(result.data), { mode: 0o600 });
  }

  async close(handle) {
    try {
      handle.cdp.close();
    } finally {
      try {
        this.runCommand('adb', ['-s', handle.serial, 'forward', '--remove', 'tcp:' + handle.port]);
      } catch {
        throw new Error('Cannot remove the restricted Android WebView debugger forward.');
      }
    }
  }
}

export class IosSimulatorAdapter {
  constructor({ runCommand = command } = {}) {
    this.runCommand = runCommand;
  }

  async open(target) {
    let devices;
    try {
      devices = JSON.parse(
        this.runCommand('xcrun', ['simctl', 'list', 'devices', '--json']),
      ).devices;
    } catch {
      throw new Error('Cannot query iOS Simulator devices.');
    }
    const all = Object.values(devices || {}).flat();
    const device = all.find((item) => item.udid === target.udid);
    if (!device || device.state !== 'Booted') {
      throw new Error('Registered iOS Simulator is not booted.');
    }
    return { udid: target.udid };
  }

  async snapshot() {
    throw new Error(
      'DOM inspection is unavailable for a screenshot-only iOS Simulator target; use a registered Appium WebView session.',
    );
  }

  async screenshot(handle, path) {
    try {
      this.runCommand('xcrun', ['simctl', 'io', handle.udid, 'screenshot', '--type=png', path]);
    } catch {
      throw new Error('Cannot capture the registered iOS Simulator.');
    }
  }

  async close() {}
}

export class AppiumWebViewAdapter {
  constructor({ request = fetch } = {}) {
    this.request = request;
  }

  endpoint(target, suffix = '') {
    const base = target.url.endsWith('/') ? target.url : target.url + '/';
    return new URL('session/' + encodeURIComponent(target.sessionId) + suffix, base).toString();
  }

  async requestJson(url, options = {}) {
    try {
      const response = await this.request(url, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (body?.value?.error) throw new Error();
      return body?.value;
    } catch {
      throw new Error('Registered Appium session is unavailable.');
    }
  }

  async open(target) {
    await this.requestJson(this.endpoint(target));
    return { target };
  }

  async snapshot(handle, maximumNodes = 500) {
    return this.requestJson(this.endpoint(handle.target, '/execute/sync'), {
      method: 'POST',
      body: JSON.stringify({
        script: `return (${browserSnapshot.toString()})(arguments[0]);`,
        args: [{ maximumNodes }],
      }),
    });
  }

  async screenshot(handle, path) {
    const value = await this.requestJson(this.endpoint(handle.target, '/screenshot'));
    writeFileSync(path, pngFromBase64(value), { mode: 0o600 });
  }

  async close() {
    // The human-owned Appium session remains active and is never deleted by the model-facing layer.
  }
}

export class VisualTargetAdapter {
  constructor({
    web = new PlaywrightVisualBrowser(),
    android = new AndroidWebViewAdapter(),
    iosSimulator = new IosSimulatorAdapter(),
    appium = new AppiumWebViewAdapter(),
  } = {}) {
    this.adapters = {
      web,
      'android-webview': android,
      'ios-simulator': iosSimulator,
      'appium-webview': appium,
    };
  }

  async open(target, profileName) {
    const adapter = this.adapters[target.kind || 'web'];
    if (!adapter) throw new Error('Unsupported visual target kind: ' + target.kind + '.');
    return { adapter, inner: await adapter.open(target, profileName) };
  }

  snapshot(handle, maximumNodes) {
    return handle.adapter.snapshot(handle.inner, maximumNodes);
  }

  screenshot(handle, path) {
    return handle.adapter.screenshot(handle.inner, path);
  }

  close(handle) {
    return handle.adapter.close(handle.inner);
  }
}
