import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_FILE_BYTES = 64 * 1024;
const MAX_LIST_FILES = 600;
const MAX_SEARCH_RESULTS = 80;
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
    throw new Error('file exceeds local-agent read limit: ' + safe);
  }
  return content.toString('utf8');
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
      const content = await readRepoFile(cwd, path);
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].includes(query)) continue;
        matches.push({
          path,
          line: index + 1,
          text: lines[index].slice(0, 500),
        });
        if (matches.length >= MAX_SEARCH_RESULTS) break;
      }
    } catch {
      // Binary, oversized, or otherwise unreadable files are ignored for search.
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

  const current = await readRepoFile(cwd, safe);
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

  const next =
    current.slice(0, first) +
    newText +
    current.slice(first + oldText.length);
  const { target } = await assertNoSymlinkEscape(cwd, safe);
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
    action?.action === 'read_file' &&
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

function serializeToolResultForModel(action, result) {
  if (
    action.action === 'read_file' &&
    typeof result?.content === 'string'
  ) {
    const compacted = compactTextForModel(
      result.content,
      MAX_MODEL_TOOL_RESULT_CHARS - 500,
    );

    return JSON.stringify({
      toolResult: {
        path: result.path,
        content: compacted.text,
        toolResultTruncated: compacted.truncated,
        originalChars: compacted.originalChars,
      },
    });
  }

  const serialized = JSON.stringify({ toolResult: result });
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

function systemPrompt() {
  return [
    'You are a bounded coding agent operating inside one repository.',
    'Return exactly one JSON object per turn. Do not use Markdown fences.',
    'Allowed actions:',
    '{"action":"list_files"}',
    '{"action":"read_file","path":"relative/path"}',
    '{"action":"search_text","query":"literal text"}',
    '{"action":"replace_text","path":"relative/path","old_text":"exact old text","new_text":"exact replacement"}',
    '{"action":"write_file","path":"relative/path","content":"complete new file content"}',
    '{"action":"finish","summary":"what changed"}',
    'You have no shell tool. Do not ask to execute commands.',
    'Inspect before editing. Make the smallest correct change.',
    'Prefer replace_text for small edits. Use write_file only when replacing or creating an entire file.',
    'Never attempt to access .git or paths outside the repository.',
  ].join('\n');
}

export async function runToolAgent({
  cwd,
  taskPrompt,
  complete,
  maxSteps = 24,
}) {
  if (typeof complete !== 'function') {
    throw new Error('complete must be a function');
  }
  if (typeof taskPrompt !== 'string' || taskPrompt.trim() === '') {
    throw new Error('task prompt must be non-empty');
  }

  const transcript = [];
  const messages = [
    { role: 'system', content: systemPrompt() },
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

    let result;
    try {
      result = await applyAction(cwd, action);
    } catch (error) {
      const recoverable = recoverableToolError(action, error);
      if (!recoverable) throw error;
      result = recoverable;
    }

    transcript.push({ step, action: action.action, request: action, result });

    messages.push({
      role: 'assistant',
      content: serializeActionForModel(action),
    });
    messages.push({
      role: 'user',
      content: serializeToolResultForModel(action, result),
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
