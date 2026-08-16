const defaultRules = Object.freeze({
  minimumTouchWidth: 44,
  minimumTouchHeight: 44,
  geometryTolerance: 1,
  minimumOverlapPixels: 4,
  minimumOverlapRatio: 0.1,
});

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function rectResult(rect) {
  return {
    x: rounded(rect.x),
    y: rounded(rect.y),
    width: rounded(rect.width),
    height: rounded(rect.height),
  };
}

function isAncestor(nodes, possibleAncestor, node) {
  let parent = nodes[node.parentIndex];
  while (parent) {
    if (parent.index === possibleAncestor.index) return true;
    parent = nodes[parent.parentIndex];
  }
  return false;
}

function intersection(left, right) {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: Math.max(0, rightEdge - x),
    height: Math.max(0, bottomEdge - y),
  };
}

function violation(type, node, details, severity = 'error') {
  return { type, severity, selector: node.selector, rect: rectResult(node.rect), details };
}

export function analyzeDomSnapshot(snapshot, overrides = {}) {
  const rules = { ...defaultRules, ...overrides };
  const violations = [];
  const nodes = snapshot.nodes || [];
  const viewport = snapshot.viewport;

  if (snapshot.document?.scrollWidth - viewport.width > rules.geometryTolerance) {
    violations.push({
      type: 'document-overflow-x',
      severity: 'error',
      selector: ':document',
      rect: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      details: {
        delta: rounded(snapshot.document.scrollWidth - viewport.width),
        documentWidth: snapshot.document.scrollWidth,
        viewportWidth: viewport.width,
      },
    });
  }

  for (const node of nodes) {
    const { rect, layout, styles } = node;
    if (node.interactive) {
      if (
        rect.width + rules.geometryTolerance < rules.minimumTouchWidth ||
        rect.height + rules.geometryTolerance < rules.minimumTouchHeight
      ) {
        violations.push(
          violation('touch-target', node, {
            actual: { width: rounded(rect.width), height: rounded(rect.height) },
            minimum: {
              width: rules.minimumTouchWidth,
              height: rules.minimumTouchHeight,
            },
          }),
        );
      }
      if (!node.hasAccessibleName) {
        violations.push(
          violation('accessible-name', node, { expected: 'non-empty accessible name' }),
        );
      }
    }

    const overflowX = layout.scrollWidth - layout.clientWidth;
    const overflowY = layout.scrollHeight - layout.clientHeight;
    if (overflowX > rules.geometryTolerance && ['hidden', 'clip'].includes(styles.overflowX)) {
      violations.push(
        violation('content-overflow-x', node, {
          delta: rounded(overflowX),
          overflow: styles.overflowX,
        }),
      );
    }
    if (overflowY > rules.geometryTolerance && ['hidden', 'clip'].includes(styles.overflowY)) {
      violations.push(
        violation('content-overflow-y', node, {
          delta: rounded(overflowY),
          overflow: styles.overflowY,
        }),
      );
    }

    const outside = {
      left: Math.max(0, -rect.x),
      top: Math.max(0, -rect.y),
      right: Math.max(0, rect.x + rect.width - viewport.width),
      bottom: Math.max(0, rect.y + rect.height - viewport.height),
    };
    if (
      Math.max(...Object.values(outside)) > rules.geometryTolerance &&
      styles.position === 'fixed'
    ) {
      violations.push(violation('viewport-overflow', node, outside));
    }

    let parent = nodes[node.parentIndex];
    while (parent) {
      if (
        ['hidden', 'clip'].includes(parent.styles.overflowX) ||
        ['hidden', 'clip'].includes(parent.styles.overflowY)
      ) {
        const clipsX = ['hidden', 'clip'].includes(parent.styles.overflowX);
        const clipsY = ['hidden', 'clip'].includes(parent.styles.overflowY);
        const clipped = {
          left: clipsX ? Math.max(0, parent.rect.x - rect.x) : 0,
          top: clipsY ? Math.max(0, parent.rect.y - rect.y) : 0,
          right: clipsX
            ? Math.max(0, rect.x + rect.width - (parent.rect.x + parent.rect.width))
            : 0,
          bottom: clipsY
            ? Math.max(0, rect.y + rect.height - (parent.rect.y + parent.rect.height))
            : 0,
        };
        if (Math.max(...Object.values(clipped)) > rules.geometryTolerance) {
          violations.push(
            violation('clipped-by-ancestor', node, {
              ancestor: parent.selector,
              clipped,
            }),
          );
          break;
        }
      }
      parent = nodes[parent.parentIndex];
    }
  }

  const candidates = nodes.filter(
    (node) =>
      (node.interactive || node.leaf) &&
      node.rect.width >= rules.minimumOverlapPixels &&
      node.rect.height >= rules.minimumOverlapPixels,
  );
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      if (isAncestor(nodes, left, right) || isAncestor(nodes, right, left)) continue;
      const overlap = intersection(left.rect, right.rect);
      const overlapArea = overlap.width * overlap.height;
      const smallerArea = Math.min(
        left.rect.width * left.rect.height,
        right.rect.width * right.rect.height,
      );
      if (
        overlap.width < rules.minimumOverlapPixels ||
        overlap.height < rules.minimumOverlapPixels ||
        overlapArea / smallerArea < rules.minimumOverlapRatio
      ) {
        continue;
      }
      violations.push({
        type: 'overlap',
        severity: 'error',
        selector: left.selector,
        relatedSelector: right.selector,
        rect: rectResult(overlap),
        details: { overlapRatio: rounded(overlapArea / smallerArea) },
      });
    }
  }

  const counts = violations.reduce((result, item) => {
    result[item.type] = (result[item.type] || 0) + 1;
    return result;
  }, {});
  return {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    viewport,
    inspectedNodes: nodes.length,
    truncated: Boolean(snapshot.truncated),
    rules,
    summary: {
      passed: violations.length === 0,
      violations: violations.length,
      counts,
    },
    violations,
  };
}

export function scoreVisualDetections(expected, actualViolations) {
  const key = (item) => [item.type, item.selector, item.relatedSelector || ''].join('|');
  const expectedKeys = new Set(expected.map(key));
  const actualKeys = new Set(actualViolations.map(key));
  let truePositives = 0;
  for (const value of actualKeys) {
    if (expectedKeys.has(value)) truePositives += 1;
  }
  const falsePositives = actualKeys.size - truePositives;
  const falseNegatives = expectedKeys.size - truePositives;
  const precision =
    actualKeys.size === 0 ? (expectedKeys.size === 0 ? 1 : 0) : truePositives / actualKeys.size;
  const recall = expectedKeys.size === 0 ? 1 : truePositives / expectedKeys.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    expected: expectedKeys.size,
    detected: actualKeys.size,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: rounded(precision),
    recall: rounded(recall),
    f1: rounded(f1),
  };
}
