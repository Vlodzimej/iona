import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { repositoryStateRoot, resolveRepository } from './registry.mjs';

const visualIdPattern = /^[a-z0-9][a-z0-9-]{0,80}-[a-f0-9]{12}$/u;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,60}$/u;
const maximumImageBytes = 20 * 1024 * 1024;
const maximumImagePixels = 16_000_000;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const adbSerialPattern = /^[a-zA-Z0-9._:-]{1,128}$/u;
const applicationIdPattern = /^[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*)+$/u;
const simulatorUdidPattern = /^[a-fA-F0-9-]{8,64}$/u;
const appiumSessionPattern = /^[a-zA-Z0-9._-]{1,256}$/u;
const capabilitiesByKind = Object.freeze({
  web: Object.freeze(['dom', 'screenshot']),
  'android-webview': Object.freeze(['dom', 'screenshot']),
  'ios-simulator': Object.freeze(['screenshot']),
  'appium-webview': Object.freeze(['dom', 'screenshot']),
});

function secureJsonWrite(path, value) {
  const temporary = path + '.tmp-' + randomBytes(4).toString('hex');
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function visualRoot(stateRoot, repositoryId) {
  resolveRepository(stateRoot, repositoryId);
  const root = resolve(repositoryStateRoot(stateRoot, repositoryId), 'visual');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return root;
}

function registryPath(stateRoot, repositoryId) {
  return resolve(visualRoot(stateRoot, repositoryId), 'registry.json');
}

function loadRegistry(stateRoot, repositoryId) {
  const path = registryPath(stateRoot, repositoryId);
  if (!existsSync(path)) {
    return { schemaVersion: 1, targets: {}, baselines: {} };
  }
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  if (registry.schemaVersion !== 1 || !registry.targets || !registry.baselines) {
    throw new Error('Unsupported visual registry.');
  }
  return registry;
}

function slug(value, fallback) {
  const candidate = String(value || fallback)
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  if (!slugPattern.test(candidate)) {
    throw new Error('Visual registry name must contain lowercase letters, digits, or hyphens.');
  }
  return candidate;
}

function identified(prefix, name, value) {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return slug(name, prefix) + '-' + digest;
}

export function normalizeLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Visual target URL is invalid.');
  }
  const hostname = url.hostname.toLocaleLowerCase('en-US');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error('Visual targets must use an HTTP loopback URL.');
  }
  if (url.username || url.password) {
    throw new Error('Visual target URL must not contain credentials.');
  }
  url.hash = '';
  return url.toString();
}

export function isAllowedVisualRequest(value, registeredTargetUrl) {
  if (value === 'about:blank' || value.startsWith('data:') || value.startsWith('blob:'))
    return true;
  try {
    const url = new URL(value);
    const loopback =
      ['http:', 'ws:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLocaleLowerCase('en-US')) &&
      !url.username &&
      !url.password;
    if (!loopback) return false;
    if (!registeredTargetUrl) return true;
    const target = new URL(registeredTargetUrl);
    const effectivePort = (candidate) => candidate.port || '80';
    return (
      url.hostname.toLocaleLowerCase('en-US') === target.hostname.toLocaleLowerCase('en-US') &&
      effectivePort(url) === effectivePort(target)
    );
  } catch {
    return false;
  }
}

export function registerVisualTarget(stateRoot, repositoryId, { name, url }) {
  const normalizedUrl = normalizeLoopbackUrl(url);
  const registry = loadRegistry(stateRoot, repositoryId);
  const id = identified('target', name, normalizedUrl);
  const previous = registry.targets[id];
  registry.targets[id] = {
    schemaVersion: 1,
    id,
    name: slug(name, 'target'),
    kind: 'web',
    capabilities: ['dom', 'screenshot'],
    url: normalizedUrl,
    registeredAt: previous?.registeredAt || new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  };
  secureJsonWrite(registryPath(stateRoot, repositoryId), registry);
  return { id, name: registry.targets[id].name, registeredAt: registry.targets[id].registeredAt };
}

function nativeTarget(stateRoot, repositoryId, { name, kind, identity, capabilities, details }) {
  const registry = loadRegistry(stateRoot, repositoryId);
  const id = identified(kind, name, JSON.stringify([kind, identity]));
  const previous = registry.targets[id];
  registry.targets[id] = {
    schemaVersion: 1,
    id,
    name: slug(name, kind),
    kind,
    capabilities,
    ...details,
    registeredAt: previous?.registeredAt || new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  };
  secureJsonWrite(registryPath(stateRoot, repositoryId), registry);
  return {
    id,
    name: registry.targets[id].name,
    kind,
    capabilities,
    registeredAt: registry.targets[id].registeredAt,
  };
}

export function registerAndroidWebViewTarget(
  stateRoot,
  repositoryId,
  { name, serial, applicationId },
) {
  if (!adbSerialPattern.test(String(serial || ''))) {
    throw new Error('Android device serial is invalid.');
  }
  if (!applicationIdPattern.test(String(applicationId || ''))) {
    throw new Error('Android application ID is invalid.');
  }
  return nativeTarget(stateRoot, repositoryId, {
    name,
    kind: 'android-webview',
    identity: [serial, applicationId],
    capabilities: ['dom', 'screenshot'],
    details: { serial, applicationId },
  });
}

export function registerIosSimulatorTarget(stateRoot, repositoryId, { name, udid, bundleId }) {
  if (!simulatorUdidPattern.test(String(udid || ''))) {
    throw new Error('iOS Simulator UDID is invalid.');
  }
  if (bundleId && !applicationIdPattern.test(String(bundleId))) {
    throw new Error('iOS bundle ID is invalid.');
  }
  return nativeTarget(stateRoot, repositoryId, {
    name,
    kind: 'ios-simulator',
    identity: [udid, bundleId || ''],
    capabilities: ['screenshot'],
    details: { udid, bundleId: bundleId || null },
  });
}

export function registerAppiumWebViewTarget(
  stateRoot,
  repositoryId,
  { name, url, sessionId, platform },
) {
  const normalizedUrl = normalizeLoopbackUrl(url);
  if (!appiumSessionPattern.test(String(sessionId || ''))) {
    throw new Error('Appium session ID is invalid.');
  }
  if (!['android', 'ios'].includes(platform)) {
    throw new Error('Appium platform must be android or ios.');
  }
  return nativeTarget(stateRoot, repositoryId, {
    name,
    kind: 'appium-webview',
    identity: [normalizedUrl, sessionId, platform],
    capabilities: ['dom', 'screenshot'],
    details: { url: normalizedUrl, sessionId, platform },
  });
}

export function registerVisualBaseline(stateRoot, repositoryId, { name, imagePath }) {
  const source = realpathSync(resolve(imagePath));
  const input = readFileSync(source);
  if (input.byteLength > maximumImageBytes) {
    throw new Error('Visual baseline exceeds the 20 MiB limit.');
  }
  if (
    input.byteLength < 24 ||
    !input.subarray(0, pngSignature.byteLength).equals(pngSignature) ||
    input.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Visual baseline must be a valid PNG image.');
  }
  const declaredWidth = input.readUInt32BE(16);
  const declaredHeight = input.readUInt32BE(20);
  if (
    declaredWidth === 0 ||
    declaredHeight === 0 ||
    declaredWidth * declaredHeight > maximumImagePixels
  ) {
    throw new Error('Visual baseline exceeds the 16 megapixel limit.');
  }
  let image;
  try {
    image = PNG.sync.read(input, { skipRescale: true });
  } catch {
    throw new Error('Visual baseline must be a valid PNG image.');
  }
  if (
    image.width !== declaredWidth ||
    image.height !== declaredHeight ||
    image.width * image.height > maximumImagePixels
  ) {
    throw new Error('Visual baseline exceeds the 16 megapixel limit.');
  }
  const normalized = PNG.sync.write(image, { colorType: 6 });
  const fallback = basename(source).replace(/\.png$/iu, '') || 'baseline';
  const id = identified('baseline', name || fallback, normalized);
  const root = visualRoot(stateRoot, repositoryId);
  const baselineRoot = resolve(root, 'baselines');
  mkdirSync(baselineRoot, { recursive: true, mode: 0o700 });
  const destination = resolve(baselineRoot, id + '.png');
  if (!existsSync(destination)) {
    writeFileSync(destination, normalized, { mode: 0o600 });
    chmodSync(destination, 0o600);
  }
  const registry = loadRegistry(stateRoot, repositoryId);
  registry.baselines[id] = {
    schemaVersion: 1,
    id,
    name: slug(name, fallback),
    file: id + '.png',
    sha256: createHash('sha256').update(normalized).digest('hex'),
    width: image.width,
    height: image.height,
    registeredAt: registry.baselines[id]?.registeredAt || new Date().toISOString(),
  };
  secureJsonWrite(registryPath(stateRoot, repositoryId), registry);
  const baseline = registry.baselines[id];
  return {
    id,
    name: baseline.name,
    width: baseline.width,
    height: baseline.height,
    registeredAt: baseline.registeredAt,
  };
}

export function listVisualAssets(stateRoot, repositoryId) {
  const registry = loadRegistry(stateRoot, repositoryId);
  return {
    targets: Object.values(registry.targets)
      .map(({ id, name, kind = 'web', capabilities = ['dom', 'screenshot'], registeredAt }) => ({
        id,
        name,
        kind,
        capabilities,
        registeredAt,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    baselines: Object.values(registry.baselines)
      .map(({ id, name, width, height, registeredAt }) => ({
        id,
        name,
        width,
        height,
        registeredAt,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function resolveVisualTarget(stateRoot, repositoryId, targetId) {
  if (!visualIdPattern.test(targetId)) throw new Error('Invalid visual target ID.');
  const target = loadRegistry(stateRoot, repositoryId).targets[targetId];
  if (!target) throw new Error('Visual target is not registered: ' + targetId + '.');
  const kind = target.kind || 'web';
  if (!capabilitiesByKind[kind]) throw new Error('Unsupported visual target kind.');
  let normalizedUrl;
  if (kind === 'web') normalizedUrl = normalizeLoopbackUrl(target.url);
  if (
    kind === 'android-webview' &&
    (!adbSerialPattern.test(String(target.serial || '')) ||
      !applicationIdPattern.test(String(target.applicationId || '')))
  ) {
    throw new Error('Registered Android WebView target is invalid.');
  }
  if (
    kind === 'ios-simulator' &&
    (!simulatorUdidPattern.test(String(target.udid || '')) ||
      (target.bundleId && !applicationIdPattern.test(String(target.bundleId))))
  ) {
    throw new Error('Registered iOS Simulator target is invalid.');
  }
  if (
    kind === 'appium-webview' &&
    (!appiumSessionPattern.test(String(target.sessionId || '')) ||
      !['android', 'ios'].includes(target.platform))
  ) {
    throw new Error('Registered Appium WebView target is invalid.');
  }
  if (kind === 'appium-webview') normalizedUrl = normalizeLoopbackUrl(target.url);
  return {
    ...target,
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
    kind,
    capabilities: [...capabilitiesByKind[kind]],
  };
}

export function resolveVisualBaseline(stateRoot, repositoryId, baselineId) {
  if (!visualIdPattern.test(baselineId)) throw new Error('Invalid visual baseline ID.');
  const baseline = loadRegistry(stateRoot, repositoryId).baselines[baselineId];
  if (!baseline) throw new Error('Visual baseline is not registered: ' + baselineId + '.');
  return {
    ...baseline,
    path: resolve(visualRoot(stateRoot, repositoryId), 'baselines', baseline.file),
  };
}

export function visualRunsRoot(stateRoot, repositoryId) {
  const root = resolve(visualRoot(stateRoot, repositoryId), 'runs');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return root;
}
