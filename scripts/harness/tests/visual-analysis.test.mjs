import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDomSnapshot, scoreVisualDetections } from '../lib/visual-analysis.mjs';

function node(index, selector, overrides = {}) {
  return {
    index,
    parentIndex: -1,
    depth: 1,
    tag: 'div',
    selector,
    role: null,
    interactive: false,
    hasAccessibleName: true,
    leaf: true,
    rect: { x: 0, y: index * 60, width: 100, height: 50 },
    layout: { clientWidth: 100, clientHeight: 50, scrollWidth: 100, scrollHeight: 50 },
    styles: {
      display: 'block',
      position: 'static',
      overflowX: 'visible',
      overflowY: 'visible',
    },
    ...overrides,
  };
}

test('DOM analyzer detects bounded accessibility and layout defects without false positives', () => {
  const snapshot = {
    viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
    nodes: [
      node(0, '#small', {
        interactive: true,
        rect: { x: 10, y: 10, width: 32, height: 36 },
      }),
      node(1, '#unnamed', {
        interactive: true,
        hasAccessibleName: false,
        rect: { x: 60, y: 10, width: 48, height: 48 },
      }),
      node(2, '#overflow', {
        leaf: false,
        layout: { clientWidth: 100, clientHeight: 50, scrollWidth: 170, scrollHeight: 50 },
        styles: {
          display: 'block',
          position: 'static',
          overflowX: 'hidden',
          overflowY: 'hidden',
        },
      }),
      node(3, '#good'),
    ],
  };
  const result = analyzeDomSnapshot(snapshot);
  const expected = [
    { type: 'touch-target', selector: '#small' },
    { type: 'accessible-name', selector: '#unnamed' },
    { type: 'content-overflow-x', selector: '#overflow' },
  ];
  assert.deepEqual(result.summary.counts, {
    'touch-target': 1,
    'accessible-name': 1,
    'content-overflow-x': 1,
  });
  assert.deepEqual(scoreVisualDetections(expected, result.violations), {
    expected: 3,
    detected: 3,
    truePositives: 3,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 1,
    recall: 1,
    f1: 1,
  });
});

test('DOM analyzer ignores intentional scroll containers and ancestor overlap', () => {
  const parent = node(0, '#scroller', {
    leaf: false,
    layout: { clientWidth: 100, clientHeight: 50, scrollWidth: 200, scrollHeight: 100 },
    styles: {
      display: 'block',
      position: 'static',
      overflowX: 'auto',
      overflowY: 'scroll',
    },
  });
  const child = node(1, '#child', {
    parentIndex: 0,
    rect: { x: 0, y: 0, width: 100, height: 50 },
  });
  assert.equal(
    analyzeDomSnapshot({ viewport: { width: 390, height: 844 }, nodes: [parent, child] }).summary
      .violations,
    0,
  );
});

test('DOM analyzer accepts normal vertical document scrolling but detects horizontal page overflow', () => {
  const longPage = {
    viewport: { width: 390, height: 844 },
    document: { scrollWidth: 390, scrollHeight: 1600 },
    nodes: [
      node(0, 'html', {
        tag: 'html',
        leaf: false,
        layout: { clientWidth: 390, clientHeight: 844, scrollWidth: 390, scrollHeight: 1600 },
      }),
    ],
  };
  assert.equal(analyzeDomSnapshot(longPage).summary.violations, 0);
  longPage.document.scrollWidth = 430;
  const result = analyzeDomSnapshot(longPage);
  assert.deepEqual(result.summary.counts, { 'document-overflow-x': 1 });
});
