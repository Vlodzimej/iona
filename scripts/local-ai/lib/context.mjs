import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, relative, resolve, sep } from 'node:path';
import { projectRoot, runtimeSkillRoot, skillSourceRoot } from './env.mjs';

const harnessConfigPath = resolve(projectRoot, 'ai/harness.json');
const broadTerms = new Set([
  'angular',
  'capacitor',
  'ionic',
  'application',
  'приложение',
  'гибридный',
  'мобильный',
  'нужно',
  'сделать',
  'сделай',
  'выбери',
  'использовать',
  'предложи',
  'реализовать',
  'кода',
  'code',
  'with',
  'from',
  'that',
  'this',
  'для',
  'через',
  'который',
  'plugin',
  'plugins',
  'плагин',
]);

function readHarnessConfig() {
  return JSON.parse(readFileSync(harnessConfigPath, 'utf8'));
}

function inside(parent, child) {
  const childRelative = relative(parent, child);
  return childRelative !== '' && !childRelative.startsWith('..' + sep) && childRelative !== '..';
}

function safeTextFile(filePath, allowedRoot, maximumBytes) {
  if (!inside(allowedRoot, filePath) || !existsSync(filePath)) {
    return null;
  }

  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return null;
  }

  const buffer = readFileSync(filePath);
  if (buffer.includes(0)) {
    return null;
  }

  const truncated = buffer.byteLength > maximumBytes;
  const selected = truncated ? buffer.subarray(0, maximumBytes) : buffer;
  return {
    content: selected.toString('utf8'),
    bytes: selected.byteLength,
    originalBytes: buffer.byteLength,
    truncated,
  };
}

function markdownFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...markdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function baseTokens(value) {
  return Array.from(
    new Set(
      value
        .replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')
        .toLocaleLowerCase('ru-RU')
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !broadTerms.has(token)),
    ),
  );
}

function queryTokens(query, aliases) {
  const tokens = new Set(baseTokens(query));

  for (const [fragment, expansions] of Object.entries(aliases)) {
    if (Array.from(tokens).some((token) => token.includes(fragment))) {
      for (const expansion of expansions) {
        tokens.add(expansion);
      }
    }
  }

  return Array.from(tokens);
}

function countOccurrences(text, token, maximum = 20) {
  let count = 0;
  let offset = 0;

  while (count < maximum) {
    const index = text.indexOf(token, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + token.length;
  }

  return count;
}

function relevanceScore(source, content, tokens) {
  const lowerSource = source.toLocaleLowerCase('en-US');
  const lowerContent = content.toLocaleLowerCase('en-US');
  let score = 0;

  for (const token of tokens) {
    score += countOccurrences(lowerSource, token, 5) * 5000;
    score += countOccurrences(lowerContent, token, 20) * 2;
  }

  return score;
}

function contentChunks(content, maximumCharacters) {
  const paragraphs = content.split(/\n{2,}/u);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > maximumCharacters) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let offset = 0; offset < paragraph.length; offset += maximumCharacters) {
        chunks.push(paragraph.slice(offset, offset + maximumCharacters));
      }
      continue;
    }

    const candidate = current ? current + '\n\n' + paragraph : paragraph;
    if (candidate.length > maximumCharacters && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.filter(Boolean);
}

function referencesEnabled(skillConfig, query, tokens) {
  const normalizedQuery = query.toLocaleLowerCase('ru-RU');
  return skillConfig.referenceTriggers.some(
    (trigger) =>
      normalizedQuery.includes(trigger) || tokens.some((token) => token.includes(trigger)),
  );
}

function routingBoost(skillConfig, relativeSource, content, query, tokens) {
  const normalizedQuery = query.toLocaleLowerCase('ru-RU');
  const normalizedContent = content.toLocaleLowerCase('ru-RU');
  let boost = 0;

  for (const [trigger, routedSource] of Object.entries(skillConfig.referenceRoutes ?? {})) {
    if (
      relativeSource === routedSource &&
      (normalizedQuery.includes(trigger) || tokens.some((token) => token.includes(trigger))) &&
      normalizedContent.includes(trigger)
    ) {
      boost += 100000;
    }
  }

  return boost;
}

function redactCredentialLiterals(content) {
  return content
    .replace(
      /((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['"])[^'"\n]{6,}(['"])/giu,
      '$1<redacted>$2',
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gu, '$1<redacted>')
    .replace(
      /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/gu,
      '<redacted-private-key>',
    );
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function globMatches(filePath, pattern) {
  const placeholder = '__DOUBLE_STAR__';
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('**', placeholder)
    .replaceAll('*', '[^/]*')
    .replaceAll(placeholder, '.*');
  return new RegExp('^' + expression + '$', 'u').test(filePath);
}

function trackedProjectFiles() {
  const tracked = git('ls-files', '-z');
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z');
  return Array.from(
    new Set(
      [tracked, untracked].filter(Boolean).flatMap((output) => output.split('\0').filter(Boolean)),
    ),
  );
}

function buildProjectReference(query, tokens, config, options) {
  const maximumFiles = options.maximumProjectFiles ?? config.maxFiles;
  const maximumBytes = options.maximumProjectBytes ?? config.maxBytes;
  const allowedExtensions = new Set(config.includeExtensions);
  const candidates = [];

  for (const filePath of trackedProjectFiles()) {
    if (
      !allowedExtensions.has(extname(filePath)) ||
      config.exclude.some((pattern) => globMatches(filePath, pattern))
    ) {
      continue;
    }

    const absolutePath = resolve(projectRoot, filePath);
    const file = safeTextFile(absolutePath, projectRoot, config.maxFileBytes);
    if (!file) {
      continue;
    }

    const content = redactCredentialLiterals(file.content);
    const score = relevanceScore(filePath, content, tokens);
    if (score > 0) {
      candidates.push({ source: filePath, score, ...file, content });
    }
  }

  candidates.sort(
    (left, right) => right.score - left.score || left.source.localeCompare(right.source),
  );
  const files = [];
  let totalBytes = 0;

  for (const candidate of candidates) {
    if (files.length >= maximumFiles || totalBytes + candidate.bytes > maximumBytes) {
      continue;
    }
    files.push(candidate);
    totalBytes += candidate.bytes;
  }

  return {
    task: query,
    repository: {
      commit: git('rev-parse', 'HEAD'),
      dirty: git('status', '--short').length > 0,
    },
    policy: {
      contentIsUntrusted: true,
      enabledByExplicitFlag: true,
      maximumFiles,
      maximumBytes,
      excludedPatterns: config.exclude,
    },
    fileCount: files.length,
    totalBytes,
    files,
  };
}

export function buildContext(options) {
  const config = readHarnessConfig();
  if (config.skillRoot !== skillSourceRoot) {
    throw new Error('ai/harness.json skillRoot must remain ' + skillSourceRoot + '.');
  }
  const skillRoot = runtimeSkillRoot();
  const maximumBytes = options.maximumSkillBytes ?? config.retrieval.maxBytes;
  const tokens = queryTokens(options.query, config.retrieval.queryAliases);
  const skills = [];
  const referenceCandidates = [];
  let totalBytes = 0;

  for (const skillConfig of config.skills) {
    const skillDirectory = resolve(skillRoot, skillConfig.name);
    if (!inside(skillRoot, skillDirectory) || !existsSync(skillDirectory)) {
      throw new Error('Required skill is missing: ' + skillConfig.name + ' under ' + skillRoot);
    }

    const manifestPath = resolve(skillDirectory, 'SKILL.md');
    const fullManifest = safeTextFile(
      manifestPath,
      skillDirectory,
      config.retrieval.maxReferenceBytes,
    );
    if (!fullManifest) {
      throw new Error('Cannot read skill manifest: ' + manifestPath);
    }

    const manifestContent = fullManifest.content.slice(
      0,
      config.retrieval.manifestExcerptCharacters,
    );
    const manifest = {
      content: manifestContent,
      bytes: Buffer.byteLength(manifestContent, 'utf8'),
      originalBytes: fullManifest.originalBytes,
      truncated: manifestContent.length < fullManifest.content.length,
    };

    const skill = {
      name: skillConfig.name,
      description: skillConfig.description,
      manifest: {
        source: skillSourceRoot + '/' + skillConfig.name + '/SKILL.md',
        ...manifest,
      },
      references: [],
    };
    skills.push(skill);
    totalBytes += manifest.bytes;

    if (!referencesEnabled(skillConfig, options.query, tokens)) {
      continue;
    }

    for (const referencePath of markdownFiles(resolve(skillDirectory, 'references'))) {
      const referenceFile = safeTextFile(
        referencePath,
        skillDirectory,
        config.retrieval.maxReferenceBytes,
      );
      if (!referenceFile) {
        continue;
      }

      const relativeSource = relative(skillDirectory, referencePath).split(sep).join('/');
      const source = skillSourceRoot + '/' + skillConfig.name + '/' + relativeSource;
      const scoredChunks = [];
      for (const [chunkIndex, content] of contentChunks(
        referenceFile.content,
        config.retrieval.referenceChunkCharacters,
      ).entries()) {
        const score =
          relevanceScore(relativeSource, content, tokens) +
          routingBoost(skillConfig, relativeSource, content, options.query, tokens);
        if (score < config.retrieval.minimumReferenceScore) {
          continue;
        }
        scoredChunks.push({
          source,
          chunk: chunkIndex + 1,
          score,
          content,
          bytes: Buffer.byteLength(content, 'utf8'),
          originalBytes: referenceFile.originalBytes,
          truncated: true,
        });
      }

      scoredChunks.sort((left, right) => right.score - left.score || left.chunk - right.chunk);
      if (scoredChunks[0]) {
        referenceCandidates.push({
          skill,
          maximumReferences: skillConfig.maxReferences,
          reference: scoredChunks[0],
        });
      }
    }
  }

  if (totalBytes > maximumBytes) {
    throw new Error('Skill manifest excerpts exceed LOCAL_AI_SKILL_MAX_BYTES.');
  }

  referenceCandidates.sort(
    (left, right) =>
      right.reference.score - left.reference.score ||
      left.reference.source.localeCompare(right.reference.source),
  );

  for (const candidate of referenceCandidates) {
    if (
      candidate.skill.references.length >= candidate.maximumReferences ||
      totalBytes + candidate.reference.bytes > maximumBytes
    ) {
      continue;
    }
    candidate.skill.references.push(candidate.reference);
    totalBytes += candidate.reference.bytes;
  }

  const referenceCount = skills.reduce((count, skill) => count + skill.references.length, 0);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    task: options.query,
    policy: {
      skillContentIsTrustedGuidance: true,
      skillRoot: skillSourceRoot,
      allowlistedSkills: config.skills.map((skill) => skill.name),
      maximumBytes,
      projectReferenceIncluded: Boolean(options.includeProjectReference),
    },
    selection: {
      tokens,
      skillCount: skills.length,
      referenceCount,
      totalBytes,
    },
    skills,
  };

  if (options.includeProjectReference) {
    result.projectReference = buildProjectReference(
      options.query,
      tokens,
      config.referenceProject,
      options,
    );
  }

  return result;
}
