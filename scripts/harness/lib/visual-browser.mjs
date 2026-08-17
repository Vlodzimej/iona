import { chromium } from 'playwright';
import { isAllowedVisualRequest } from './visual-registry.mjs';

export const visualDeviceProfiles = Object.freeze({
  desktop: Object.freeze({ width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false }),
  'iphone-15': Object.freeze({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true }),
  'pixel-8': Object.freeze({ width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true }),
});

export function browserSnapshot({ maximumNodes }) {
  const ignoredTags = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'HEAD', 'PATH']);
  const nodes = [];

  function safeToken(value) {
    const token = String(value || '').trim();
    return /^[a-zA-Z][a-zA-Z0-9_-]{0,80}$/u.test(token) ? token : '';
  }

  function segment(element) {
    const testId = safeToken(element.getAttribute('data-testid'));
    if (testId) return `${element.localName}[data-testid=${testId}]`;
    const id = safeToken(element.id);
    if (id) return `${element.localName}#${id}`;
    let position = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.localName === element.localName) position += 1;
      sibling = sibling.previousElementSibling;
    }
    return `${element.localName}:nth-of-type(${position})`;
  }

  function selector(element) {
    const segments = [];
    let current = element;
    while (current && segments.length < 8) {
      segments.unshift(segment(current));
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        segments.unshift('::shadow');
        current = root.host;
      } else {
        current = current.parentElement;
      }
      if (current?.localName === 'html') {
        segments.unshift('html');
        break;
      }
    }
    return segments.join(' > ');
  }

  function directElementChildren(element) {
    const children = [...element.children];
    if (element.shadowRoot) children.push(...element.shadowRoot.children);
    return children.filter((child) => !ignoredTags.has(child.tagName));
  }

  function visit(element, parentIndex, depth) {
    if (nodes.length >= maximumNodes || ignoredTags.has(element.tagName)) return;
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const visible =
      styles.display !== 'none' &&
      styles.visibility !== 'hidden' &&
      Number.parseFloat(styles.opacity || '1') > 0 &&
      rect.width > 0 &&
      rect.height > 0;
    let currentParent = parentIndex;
    if (visible) {
      const tag = element.localName;
      const role = safeToken(element.getAttribute('role')) || null;
      const interactive =
        ['button', 'input', 'select', 'textarea', 'summary'].includes(tag) ||
        (tag === 'a' && element.hasAttribute('href')) ||
        ['button', 'checkbox', 'link', 'menuitem', 'radio', 'slider', 'switch', 'tab'].includes(
          role,
        );
      const accessibleSource =
        element.getAttribute('aria-label') ||
        element.getAttribute('alt') ||
        element.getAttribute('title') ||
        [...(element.labels || [])].map((label) => label.textContent).join(' ') ||
        (element.getAttribute('aria-labelledby') || '')
          .split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ') ||
        element.textContent;
      currentParent = nodes.length;
      const children = directElementChildren(element);
      nodes.push({
        index: currentParent,
        parentIndex,
        depth,
        tag,
        selector: selector(element),
        role,
        interactive,
        hasAccessibleName: !interactive || Boolean(String(accessibleSource || '').trim()),
        leaf: children.length === 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        layout: {
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight,
        },
        styles: {
          display: styles.display,
          position: styles.position,
          overflowX: styles.overflowX,
          overflowY: styles.overflowY,
          fontSize: styles.fontSize,
          lineHeight: styles.lineHeight,
          gap: styles.gap,
          padding: styles.padding,
          margin: styles.margin,
          zIndex: styles.zIndex,
        },
      });
    }
    for (const child of directElementChildren(element)) {
      visit(child, currentParent, depth + 1);
      if (nodes.length >= maximumNodes) break;
    }
  }

  visit(document.documentElement, -1, 0);
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio,
    },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    },
    nodes,
    truncated: nodes.length >= maximumNodes,
  };
}

export class PlaywrightVisualBrowser {
  async open(target, profileName) {
    const url = typeof target === 'string' ? target : target.url;
    const profile = visualDeviceProfiles[profileName];
    if (!profile) throw new Error('Unknown visual device profile: ' + profileName + '.');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.deviceScaleFactor,
      isMobile: profile.isMobile,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    await context.route('**/*', async (route) => {
      if (isAllowedVisualRequest(route.request().url(), url)) {
        await route.continue();
      } else {
        await route.abort('blockedbyclient');
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.addStyleTag({
        content:
          '*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;transition:none!important;caret-color:transparent!important}',
      });
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });
    } catch (error) {
      await browser.close();
      throw error;
    }
    return { browser, context, page, profileName, profile };
  }

  async snapshot(handle, maximumNodes = 500) {
    return handle.page.evaluate(browserSnapshot, { maximumNodes });
  }

  async screenshot(handle, path) {
    await handle.page.screenshot({ path, type: 'png', fullPage: false, animations: 'disabled' });
  }

  async close(handle) {
    await handle.browser.close();
  }
}
