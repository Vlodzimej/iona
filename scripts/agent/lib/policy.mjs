import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function globMatches(filePath, pattern) {
  const doubleStar = '__DOUBLE_STAR__';
  const doubleStarSlash = '__DOUBLE_STAR_SLASH__';
  const singleCharacter = '__SINGLE_CHARACTER__';
  const expression = pattern
    .replaceAll('**/', doubleStarSlash)
    .replaceAll('**', doubleStar)
    .replaceAll('?', singleCharacter)
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('*', '[^/]*')
    .replaceAll(singleCharacter, '[^/]')
    .replaceAll(doubleStar, '.*')
    .replaceAll(doubleStarSlash, '(?:.*/)?');
  return new RegExp('^' + expression + '$', 'u').test(filePath);
}

export function normalizeRepositoryPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0')) {
    throw new Error('A non-empty repository-relative path is required.');
  }

  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error('Path traversal and absolute paths are not allowed: ' + filePath);
  }

  return normalized;
}

function matchesAny(filePath, patterns) {
  return patterns.some((pattern) => globMatches(filePath, pattern));
}

export function pathAccess(config, filePath, options = {}) {
  const normalized = normalizeRepositoryPath(filePath);
  if (
    matchesAny(normalized, config.deniedPatterns) ||
    matchesAny(
      normalized.toLocaleLowerCase('en-US'),
      config.deniedPatterns.map((pattern) => pattern.toLocaleLowerCase('en-US')),
    )
  ) {
    return { allowed: false, reason: 'denied', path: normalized };
  }

  if (options.write) {
    if (matchesAny(normalized, config.allowedWritePatterns)) {
      return { allowed: true, protected: false, path: normalized };
    }
    if (matchesAny(normalized, config.protectedWritePatterns)) {
      return {
        allowed: options.allowProtected === true,
        protected: true,
        reason: options.allowProtected ? null : 'approval_required',
        path: normalized,
      };
    }
    return { allowed: false, reason: 'outside_write_allowlist', path: normalized };
  }

  return { allowed: true, protected: false, path: normalized };
}

export function safeAbsolutePath(root, filePath, config, options = {}) {
  const access = pathAccess(config, filePath, options);
  if (!access.allowed) {
    throw new Error('Path ' + access.path + ' is not allowed (' + access.reason + ').');
  }

  const absolutePath = resolve(root, access.path);
  const childPath = relative(root, absolutePath);
  if (childPath === '..' || childPath.startsWith('..' + sep)) {
    throw new Error('Resolved path escapes the worktree: ' + access.path);
  }

  let current = root;
  for (const segment of access.path.split('/').slice(0, -1)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('Symbolic-link path components are not allowed: ' + access.path);
    }
  }

  if (existsSync(absolutePath) && lstatSync(absolutePath).isSymbolicLink()) {
    throw new Error('Symbolic-link files are not allowed: ' + access.path);
  }

  return { ...access, absolutePath };
}

export function pathsFromPatch(patch) {
  if (typeof patch !== 'string' || !patch.trim()) {
    throw new Error('Patch must be a non-empty string.');
  }
  if (
    /GIT binary patch|Binary files |(?:new|old) file mode 120000|^index [0-9a-f]+\.\.[0-9a-f]+ 160000$/mu.test(
      patch,
    )
  ) {
    throw new Error('Binary files, symbolic links, and submodules are not supported.');
  }
  if (!patch.split(/\r?\n/u).some((line) => line.startsWith('diff --git '))) {
    throw new Error('Patch must use standard Git diff headers.');
  }

  const paths = new Set();
  let insideHunk = false;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith('diff --git ')) {
      insideHunk = false;
    } else if (line.startsWith('@@ ')) {
      insideHunk = true;
      continue;
    }
    if (insideHunk) {
      continue;
    }
    const mode = /^(?:new file mode|new mode) (\d+)$/u.exec(line);
    if (mode && mode[1] !== '100644') {
      throw new Error('Only regular non-executable file mode 100644 is allowed.');
    }
    let candidate;
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
      if (!match || match[1] !== match[2]) {
        throw new Error('Renames and malformed diff headers are not supported.');
      }
      candidate = match[1];
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      candidate = line.slice(4).split('\t', 1)[0];
      if (candidate === '/dev/null') {
        continue;
      }
      candidate = candidate.replace(/^[ab]\//u, '');
    }

    if (candidate) {
      paths.add(normalizeRepositoryPath(candidate));
    }
  }

  if (paths.size === 0) {
    throw new Error('Patch does not contain any repository file paths.');
  }
  return Array.from(paths);
}
