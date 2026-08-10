#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '../..');
const ignoredDirectories = new Set(['.agent', '.git', 'coverage', 'dist', 'node_modules']);

function markdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }
  return files;
}

function githubSlug(value) {
  return value
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/<[^>]+>/gu, '')
    .replace(/[`*_~]/gu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/gu, '-');
}

function anchorsFor(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const anchors = new Set();
  const duplicates = new Map();

  for (const line of content.split(/\r?\n/u)) {
    const explicit = /<a\s+(?:[^>]*\s)?id=["']([^"']+)["'][^>]*>/giu;
    for (const match of line.matchAll(explicit)) {
      anchors.add(match[1]);
    }

    const heading = /^#{1,6}\s+(.+?)\s*#*$/u.exec(line);
    if (!heading) {
      continue;
    }
    const base = githubSlug(heading[1]);
    const count = duplicates.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    duplicates.set(base, count + 1);
  }

  return anchors;
}

function localLinks(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const links = [];
  const pattern = /(?<!!)\[[^\]]*\]\(([^)]+)\)/gu;
  for (const match of content.matchAll(pattern)) {
    const raw = match[1].trim().replace(/^<|>$/gu, '');
    const destination = raw.split(/\s+["']/u, 1)[0];
    if (!destination || /^(?:https?:|mailto:|tel:|data:)/iu.test(destination)) {
      continue;
    }
    links.push({ destination, index: match.index });
  }
  return links;
}

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/u).length;
}

const failures = [];
const files = markdownFiles(projectRoot).sort();
const anchorCache = new Map();

for (const source of files) {
  const content = readFileSync(source, 'utf8');
  for (const { destination, index } of localLinks(source)) {
    const [rawPath, rawAnchor] = destination.split('#', 2);
    let target = rawPath ? resolve(dirname(source), decodeURIComponent(rawPath)) : source;

    if (!existsSync(target)) {
      failures.push(
        `${relative(projectRoot, source)}:${lineNumber(content, index)} missing ${destination}`,
      );
      continue;
    }

    if (statSync(target).isDirectory()) {
      if (!rawAnchor) {
        continue;
      }
      target = resolve(target, 'README.md');
      if (!existsSync(target)) {
        failures.push(
          `${relative(projectRoot, source)}:${lineNumber(content, index)} cannot resolve anchor in directory ${destination}`,
        );
        continue;
      }
    }

    if (rawAnchor && extname(target).toLocaleLowerCase('en-US') === '.md') {
      const anchors = anchorCache.get(target) ?? anchorsFor(target);
      anchorCache.set(target, anchors);
      const anchor = decodeURIComponent(rawAnchor).toLocaleLowerCase('ru-RU');
      if (!anchors.has(anchor)) {
        failures.push(
          `${relative(projectRoot, source)}:${lineNumber(content, index)} missing anchor #${rawAnchor} in ${relative(projectRoot, target)}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Documentation link check failed:');
  for (const failure of failures) {
    console.error('- ' + failure);
  }
  process.exitCode = 1;
} else {
  console.log(`Documentation links are valid across ${files.length} Markdown files.`);
}
