import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { findForbiddenSourceOnlyPaths } from '../path-policy.mjs';

const MAX_FILE_BYTES = 64 * 1024;
const MAX_LIST_FILES = 600;
const MAX_SEARCH_RESULTS = 80;
const MAX_READ_LINES = 400;
const MAX_MODEL_CONTEXT_CHARS = 24_000;
const MAX_MODEL_TOOL_RESULT_CHARS = 10_000;

export function validateRepoRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('path must be a non-empty string inside the repository');
  }

  const normalized = value.trim().replaceAll('\\', '/');
  if (
    isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized === '.git' ||
    normalized.startsWith('.git/')
  ) {
    throw new Error('path must stay inside the repository');
  }

  return normalized.replace(/^\.\//, '');
}

function insideRoot(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

async function assertNoSymlinkEscape(cwd, relativePath) {
  const root = await realpath(cwd);
  const segments = validateRepoRelativePath(relativePath).split('/').filter(Boolean);
  let current = root;

  for (let i = 0; i < Math.max(0, segments.length - 1); i += 1) {
    current = resolve(current, segments[i]);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error('path must stay inside the repository and may not traverse symlinks');
      }
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
  }

  const target = resolve(root, ...segments);
  if (!insideRoot(root, target)) {
    throw new Error('path must stay inside the repository');
  }

  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error('path must stay inside the repository and may not target symlinks');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return { root, target };
}

async function walkFiles(root, current = root, result = []) {
  if (result.length >= MAX_LIST_FILES) return result;

  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (result.length >= MAX_LIST_FILES) break;
    if (entry.name === '.git' || entry.name === 'node_modules') continue;

    const absolute = resolve(current, entry.name);
    const rel = relative(root, absolute).replaceAll('\\', '/');

    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkFiles(root, absolute, result);
    } else if (entry.isFile()) {
      result.push(rel);
    }
  }

  return result;
}

async function listFiles(cwd) {
  const root = await realpath(cwd);
  return walkFiles(root);
}

async function readRepoFile(cwd, path) {
  const safe = validateRepoRelativePath(path);
  const { target } = await assertNoSymlinkEscape(cwd, safe);
  const content = await readFile(target);
  if (content.byteLength > MAX_FILE_BYTES) {
    const error = new Error(
      'file exceeds local-agent read limit: ' +
        safe +
        '; use search_text or read_lines',
    );
    error.code = 'FILE_TOO_LARGE';
    error.bytes = content.byteLength;
    throw error;
  }
  return content.toString('utf8');
}

async function readRepoLines(cwd, path, startLine, endLine) {
  const safe = validateRepoRelativePath(path);

  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine - startLine + 1 > MAX_READ_LINES
  ) {
    throw new Error(
      'read_lines requires 1-based integer start_line/end_line with at most ' +
        MAX_READ_LINES +
        ' lines',
    );
  }

  const { target } = await assertNoSymlinkEscape(cwd, safe);
  const stream = createReadStream(target, { encoding: 'utf8' });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const selected = [];
  let lineNumber = 0;
  let reachedRequestedEnd = false;

  try {
    for await (const line of reader) {
      lineNumber += 1;
      if (lineNumber < startLine) continue;
      if (lineNumber > endLine) {
        reachedRequestedEnd = true;
        break;
      }
      selected.push(line);
      if (lineNumber === endLine) {
        reachedRequestedEnd = true;
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  const actualEndLine =
    selected.length > 0 ? startLine + selected.length - 1 : startLine - 1;

  return {
    path: safe,
    startLine,
    endLine: actualEndLine,
    requestedEndLine: endLine,
    content: selected.length > 0 ? selected.join('\n') + '\n' : '',
    eof: !reachedRequestedEnd,
    nextStartLine: reachedRequestedEnd ? endLine + 1 : null,
  };
}

async function searchRepoFile(cwd, path, query, remaining) {
  const safe = validateRepoRelativePath(path);
  const { target } = await assertNoSymlinkEscape(cwd, safe);
  const stream = createReadStream(target, { encoding: 'utf8' });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const matches = [];
  let lineNumber = 0;

  try {
    for await (const line of reader) {
      lineNumber += 1;
      if (line.includes('\u0000')) break;
      if (!line.includes(query)) continue;

      matches.push({
        path: safe,
        line: lineNumber,
        text: line.slice(0, 500),
      });
      if (matches.length >= remaining) break;
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return matches;
}

async function searchText(cwd, query) {
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('search query must be non-empty');
  }

  const files = await listFiles(cwd);
  const matches = [];

  for (const path of files) {
    if (matches.length >= MAX_SEARCH_RESULTS) break;
    try {
      const found = await searchRepoFile(
        cwd,
        path,
        query,
        MAX_SEARCH_RESULTS - matches.length,
      );
      matches.push(...found);
    } catch {
      // Binary, disappearing, or otherwise unreadable files are ignored for search.
    }
  }

  return matches;
}

async function writeRepoFile(cwd, path, content) {
  if (typeof content !== 'string') {
    throw new Error('write_file content must be a string');
  }
  const safe = validateRepoRelativePath(path);
  const { target } = await assertNoSymlinkEscape(cwd, safe);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return { path: safe, bytes: Buffer.byteLength(content) };
}

async function replaceRepoText(cwd, path, oldText, newText) {
  const safe = validateRepoRelativePath(path);

  if (typeof oldText !== 'string' || oldText.length === 0) {
    const error = new Error(
      'replace_text old_text must be a non-empty string',
    );
    error.code = 'INVALID_REPLACE_ARGUMENT';
    error.field = 'old_text';
    throw error;
  }
  if (typeof newText !== 'string') {
    const error = new Error('replace_text new_text must be a string');
    error.code = 'INVALID_REPLACE_ARGUMENT';
    error.field = 'new_text';
    throw error;
  }

  const { target } = await assertNoSymlinkEscape(cwd, safe);
  const current = await readFile(target, 'utf8');
  const first = current.indexOf(oldText);
  const last = current.lastIndexOf(oldText);

  if (first === -1 || first !== last) {
    const matchCount =
      first === -1 ? 0 : current.split(oldText).length - 1;
    const error = new Error(
      'replace_text old_text must occur exactly once in ' +
        safe +
        '; found ' +
        matchCount,
    );
    error.code = 'REPLACE_MATCH_COUNT';
    error.matchCount = matchCount;
    throw error;
  }

  if (oldText === newText) {
    const error = new Error(
      'replace_text must change file content; old_text and new_text are identical',
    );
    error.code = 'NO_OP_REPLACE';
    throw error;
  }

  const next =
    current.slice(0, first) +
    newText +
    current.slice(first + oldText.length);
  await writeFile(target, next, 'utf8');

  return {
    path: safe,
    replacedBytes: Buffer.byteLength(oldText),
    insertedBytes: Buffer.byteLength(newText),
  };
}

function parseAction(raw) {
  if (typeof raw !== 'string') {
    throw new Error('model completion must be a string');
  }

  let text = raw.trim();
  const fenced = text.match(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i);
  if (fenced) text = fenced[1].trim();

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('model must return exactly one JSON action object');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('model action must be a JSON object');
  }
  if (typeof value.action !== 'string') {
    if (
      value.finish !== undefined &&
      value.path === undefined &&
      value.content === undefined &&
      value.query === undefined
    ) {
      const summary =
        typeof value.finish === 'string'
          ? value.finish
          : typeof value.finish?.summary === 'string'
            ? value.finish.summary
            : 'finished';

      return {
        action: 'finish',
        summary,
      };
    }

    if (
      typeof value.summary === 'string' &&
      value.path === undefined &&
      value.content === undefined &&
      value.query === undefined
    ) {
      return { ...value, action: 'finish' };
    }

    throw new Error('model action must include action');
  }

  if (value.action === 'done' || value.action === 'complete') {
    return { ...value, action: 'finish' };
  }

  return value;
}

async function applyAction(cwd, action) {
  switch (action.action) {
    case 'list_files':
      return { files: await listFiles(cwd) };
    case 'read_file':
      return {
        path: validateRepoRelativePath(action.path),
        content: await readRepoFile(cwd, action.path),
      };
    case 'read_lines':
      return readRepoLines(
        cwd,
        action.path,
        action.start_line,
        action.end_line,
      );
    case 'search_text':
      return {
        query: action.query,
        matches: await searchText(cwd, action.query),
      };
    case 'write_file':
      return writeRepoFile(cwd, action.path, action.content);
    case 'replace_text':
      return replaceRepoText(
        cwd,
        action.path,
        action.old_text,
        action.new_text,
      );
    case 'finish':
      return {
        summary:
          typeof action.summary === 'string' ? action.summary : 'finished',
      };
    default:
      throw new Error('unsupported local-agent action: ' + action.action);
  }
}

function recoverableToolError(action, error) {
  if (
    (action?.action === 'read_file' || action?.action === 'read_lines') &&
    error &&
    typeof error === 'object' &&
    error.code === 'ENOENT'
  ) {
    return {
      toolError: true,
      code: 'ENOENT',
      message: 'file not found: ' + validateRepoRelativePath(action.path),
    };
  }

  if (
    action?.action === 'read_file' &&
    error &&
    typeof error === 'object' &&
    error.code === 'FILE_TOO_LARGE'
  ) {
    return {
      toolError: true,
      code: 'FILE_TOO_LARGE',
      bytes: Number.isInteger(error.bytes) ? error.bytes : null,
      message:
        error.message +
        '. Use search_text to locate relevant code and read_lines for a bounded window.',
    };
  }

  if (
    action?.action === 'replace_text' &&
    error &&
    typeof error === 'object' &&
    error.code === 'ENOENT'
  ) {
    return {
      toolError: true,
      code: 'ENOENT',
      path: validateRepoRelativePath(action.path),
      message: 'file not found: ' + validateRepoRelativePath(action.path),
    };
  }

  if (
    action?.action === 'replace_text' &&
    error &&
    typeof error === 'object' &&
    error.code === 'REPLACE_MATCH_COUNT'
  ) {
    return {
      toolError: true,
      code: 'REPLACE_MATCH_COUNT',
      matchCount:
        Number.isInteger(error.matchCount) ? error.matchCount : null,
      message: error.message,
    };
  }

  if (
    action?.action === 'replace_text' &&
    error &&
    typeof error === 'object' &&
    error.code === 'NO_OP_REPLACE'
  ) {
    return {
      toolError: true,
      code: 'NO_OP_REPLACE',
      path: validateRepoRelativePath(action.path),
      message: error.message,
    };
  }

  if (
    action?.action === 'replace_text' &&
    error &&
    typeof error === 'object' &&
    error.code === 'INVALID_REPLACE_ARGUMENT'
  ) {
    const safePath = validateRepoRelativePath(action.path);
    return {
      toolError: true,
      code: 'INVALID_REPLACE_ARGUMENT',
      field:
        typeof error.field === 'string' ? error.field : null,
      path: safePath,
      message: error.message,
    };
  }

  return null;
}

function compactTextForModel(value, maxChars) {
  if (typeof value !== 'string' || value.length <= maxChars) {
    return {
      text: value,
      truncated: false,
      originalChars: typeof value === 'string' ? value.length : 0,
    };
  }

  const markerText = '\n...[tool result truncated; use search_text or a more targeted read]...\n';
  const available = Math.max(0, maxChars - markerText.length);
  const headChars = Math.ceil(available * 0.7);
  const tailChars = available - headChars;

  return {
    text:
      value.slice(0, headChars) +
      markerText +
      value.slice(Math.max(0, value.length - tailChars)),
    truncated: true,
    originalChars: value.length,
  };
}

function serializeActionForModel(action) {
  if (action.action === 'write_file') {
    return JSON.stringify({
      action: action.action,
      path: action.path,
      contentOmitted: true,
      contentChars:
        typeof action.content === 'string' ? action.content.length : 0,
    });
  }

  if (action.action === 'replace_text') {
    return JSON.stringify({
      action: action.action,
      path: action.path,
      oldTextChars:
        typeof action.old_text === 'string' ? action.old_text.length : 0,
      newTextChars:
        typeof action.new_text === 'string' ? action.new_text.length : 0,
    });
  }

  return JSON.stringify(action);
}

const OBSERVATION_ACTIONS = new Set([
  'list_files',
  'read_file',
  'read_lines',
  'search_text',
]);

function isSuccessfulEditEntry(entry) {
  return (
    (entry?.action === 'replace_text' || entry?.action === 'write_file') &&
    entry?.result?.toolError !== true
  );
}

function observationSignature(action) {
  if (!action || !OBSERVATION_ACTIONS.has(action.action)) return null;

  switch (action.action) {
    case 'list_files':
      return 'list_files';
    case 'read_file':
      return JSON.stringify(['read_file', action.path]);
    case 'read_lines':
      return JSON.stringify([
        'read_lines',
        action.path,
        action.start_line,
        action.end_line,
      ]);
    case 'search_text':
      return JSON.stringify(['search_text', action.query]);
    default:
      return null;
  }
}

function progressState(transcript) {
  let successfulEditCount = 0;
  let lastEditIndex = -1;

  for (let index = 0; index < transcript.length; index += 1) {
    if (!isSuccessfulEditEntry(transcript[index])) continue;
    successfulEditCount += 1;
    lastEditIndex = index;
  }

  const observations = transcript
    .slice(lastEditIndex + 1)
    .filter((entry) => OBSERVATION_ACTIONS.has(entry?.action));

  const counts = new Map();
  let duplicateObservationCount = 0;
  for (const entry of observations) {
    const signature = observationSignature(entry.request);
    if (!signature) continue;
    const seen = counts.get(signature) ?? 0;
    if (seen > 0) duplicateObservationCount += 1;
    counts.set(signature, seen + 1);
  }

  return {
    explorationStreak: observations.length,
    duplicateObservationCount,
    successfulEditCount,
  };
}

function duplicateObservationResult(action, transcript) {
  const signature = observationSignature(action);
  if (!signature) return null;

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (isSuccessfulEditEntry(entry)) break;
    if (observationSignature(entry?.request) !== signature) continue;

    return {
      toolError: true,
      code: 'DUPLICATE_OBSERVATION',
      message:
        'This exact observation was already performed since the last source edit. ' +
        'Use the existing evidence, inspect a different location, or make the smallest supported edit.',
    };
  }

  return null;
}

function makeStepBudget(step, maxSteps, transcript = []) {
  const remaining = Math.max(0, maxSteps - step);
  const warningThreshold = Math.max(2, Math.ceil(maxSteps * 0.25));
  const progress = progressState(transcript);
  const stalled = progress.explorationStreak >= 6;

  let convergenceWarning = null;
  if (stalled) {
    convergenceWarning =
      'No source edit has been made across the recent observation streak. ' +
      'Stop rereading or broad searching. Use the strongest evidence already gathered ' +
      'to make the smallest supported source-code edit now, or finish only if no valid edit remains.';
  } else if (remaining <= warningThreshold) {
    convergenceWarning =
      'Stop broad exploration. Use the strongest evidence already gathered to make the best source-code edit now, or finish if no valid edit remains.';
  }

  return {
    used: step,
    remaining,
    ...progress,
    ...(convergenceWarning ? { convergenceWarning } : {}),
  };
}

function serializeToolResultForModel(action, result, stepBudget) {
  if (
    (action.action === 'read_file' || action.action === 'read_lines') &&
    typeof result?.content === 'string'
  ) {
    const compacted = compactTextForModel(
      result.content,
      MAX_MODEL_TOOL_RESULT_CHARS - 500,
    );

    return JSON.stringify({
      toolResult: {
        path: result.path,
        ...(action.action === 'read_lines'
          ? {
              startLine: result.startLine,
              endLine: result.endLine,
              requestedEndLine: result.requestedEndLine,
              eof: result.eof,
              nextStartLine: result.nextStartLine,
            }
          : {}),
        content: compacted.text,
        toolResultTruncated: compacted.truncated,
        originalChars: compacted.originalChars,
      },
      stepBudget,
    });
  }

  const serialized = JSON.stringify({ toolResult: result, stepBudget });
  if (serialized.length <= MAX_MODEL_TOOL_RESULT_CHARS) {
    return serialized;
  }

  const preview = compactTextForModel(
    serialized,
    MAX_MODEL_TOOL_RESULT_CHARS - 500,
  );

  return JSON.stringify({
    toolResultTruncated: true,
    action: action.action,
    originalChars: serialized.length,
    preview: preview.text,
    stepBudget,
  });
}

function compactMessagesForModel(messages) {
  const total = messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  if (total <= MAX_MODEL_CONTEXT_CHARS) return messages;

  const base = messages.slice(0, 2);
  const baseChars = base.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  const compactionNotice = {
    role: 'user',
    content:
      'Earlier tool turns were compacted to stay within the local model context window. ' +
      'The original task above is authoritative. Re-inspect with search_text or read_file if older evidence is needed.',
  };

  let budget =
    MAX_MODEL_CONTEXT_CHARS -
    baseChars -
    compactionNotice.content.length;
  const recent = [];

  for (let index = messages.length - 1; index >= 2; index -= 1) {
    const message = messages[index];
    if (message.content.length > budget) break;
    recent.push(message);
    budget -= message.content.length;
  }

  recent.reverse();
  return [...base, compactionNotice, ...recent];
}

function normalizeEditPolicy(value) {
  const policy = value ?? 'unrestricted';
  if (policy !== 'unrestricted' && policy !== 'source-only') {
    throw new Error(
      'editPolicy must be "unrestricted" or "source-only"',
    );
  }
  return policy;
}

function editPolicyResult(action, editPolicy) {
  if (
    editPolicy !== 'source-only' ||
    (action?.action !== 'replace_text' && action?.action !== 'write_file')
  ) {
    return null;
  }

  const safePath = validateRepoRelativePath(action.path);
  const forbidden = findForbiddenSourceOnlyPaths([safePath]);
  if (forbidden.length === 0) return null;

  return {
    toolError: true,
    code: 'EDIT_POLICY_FORBIDDEN_PATH',
    path: forbidden[0],
    message:
      'Do not modify test files, conftest files, or hidden authority files in source-only mode. ' +
      'Fix the production/source implementation instead.',
  };
}

function systemPrompt(editPolicy = 'unrestricted') {
  const policy = normalizeEditPolicy(editPolicy);

  return [
    'You are a bounded coding agent operating inside one repository.',
    'Return exactly one JSON object per turn. Do not use Markdown fences.',
    'Allowed actions:',
    '{"action":"list_files"}',
    '{"action":"read_file","path":"relative/path"}',
    '{"action":"read_lines","path":"relative/path","start_line":1,"end_line":120}',
    '{"action":"search_text","query":"literal text"}',
    '{"action":"replace_text","path":"relative/path","old_text":"exact old text","new_text":"exact replacement"}',
    '{"action":"write_file","path":"relative/path","content":"complete new file content"}',
    '{"action":"finish","summary":"what changed"}',
    'You have no shell tool. Do not ask to execute commands.',
    'Inspect before editing. Make the smallest correct change.',
    'If read_file says FILE_TOO_LARGE, use search_text and read_lines instead of requesting the whole file.',
    'Prefer replace_text for small edits. Use write_file only when replacing or creating an entire file.',
    ...(policy === 'source-only'
      ? [
          'Do not modify test files, conftest files, r2e_tests, or .archeagent-hidden authority files. Fix source/production code only.',
        ]
      : []),
    'Do not repeat an identical read/search/list action unless a source edit has changed the evidence.',
    'If several observation steps produce no edit, converge: use the strongest evidence and make the smallest supported source-code change.',
    'Never attempt to access .git or paths outside the repository.',
  ].join('\n');
}

export async function runToolAgent({
  cwd,
  taskPrompt,
  complete,
  maxSteps = 24,
  editPolicy = 'unrestricted',
}) {
  if (typeof complete !== 'function') {
    throw new Error('complete must be a function');
  }
  if (typeof taskPrompt !== 'string' || taskPrompt.trim() === '') {
    throw new Error('task prompt must be non-empty');
  }

  const normalizedEditPolicy = normalizeEditPolicy(editPolicy);
  const transcript = [];
  const messages = [
    { role: 'system', content: systemPrompt(normalizedEditPolicy) },
    { role: 'user', content: taskPrompt },
  ];

  for (let step = 1; step <= maxSteps; step += 1) {
    const raw = await complete(compactMessagesForModel(messages));

    let action;
    try {
      action = parseAction(raw);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const preview =
        raw.length > 600 ? raw.slice(0, 600) + '...[truncated]' : raw;

      transcript.push({
        step,
        action: 'invalid_action',
        request: { preview },
        result: { error: message },
      });

      messages.push({
        role: 'assistant',
        content: preview,
      });
      messages.push({
        role: 'user',
        content: [
          'Your previous response could not be parsed as one JSON action.',
          'Return exactly one compact JSON object and nothing else.',
          'For a small code edit, use replace_text instead of rewriting the whole file.',
          'Inspect/read/search again only if needed.',
        ].join(' '),
      });
      continue;
    }

    let result = editPolicyResult(action, normalizedEditPolicy);
    if (!result) {
      result = duplicateObservationResult(action, transcript);
    }
    if (!result) {
      try {
        result = await applyAction(cwd, action);
      } catch (error) {
        const recoverable = recoverableToolError(action, error);
        if (!recoverable) throw error;
        result = recoverable;
      }
    }

    transcript.push({ step, action: action.action, request: action, result });

    messages.push({
      role: 'assistant',
      content: serializeActionForModel(action),
    });
    messages.push({
      role: 'user',
      content: serializeToolResultForModel(
        action,
        result,
        makeStepBudget(step, maxSteps, transcript),
      ),
    });

    if (action.action === 'finish') {
      return { finished: true, steps: step, transcript };
    }
  }

  return { finished: false, steps: maxSteps, transcript };
}

export function createOpenAICompatibleCompleter({
  baseUrl,
  model,
  apiKey,
  temperature = 0,
}) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new Error('baseUrl is required');
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('model is required');
  }

  const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions';

  return async (messages) => {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        'OpenAI-compatible completion failed ' +
          response.status +
          ': ' +
          body.slice(0, 1000),
      );
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('OpenAI-compatible response did not contain message content');
    }

    return content;
  };
}
