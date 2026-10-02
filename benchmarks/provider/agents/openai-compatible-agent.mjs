#!/usr/bin/env node
import { runToolAgent, createOpenAICompatibleCompleter } from './openai-compatible-agent-lib.mjs';

let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;

const baseUrl =
  process.env.ARCHEAGENT_AGENT_BASE_URL ?? 'http://127.0.0.1:11436/v1';
const model =
  process.env.ARCHEAGENT_AGENT_MODEL ?? 'qwen2.5-14b-am';
const apiKey = process.env.ARCHEAGENT_AGENT_API_KEY || undefined;
const maxSteps = Number(process.env.ARCHEAGENT_AGENT_MAX_STEPS ?? '24');
const editPolicy =
  process.env.ARCHEAGENT_AGENT_EDIT_POLICY ?? 'unrestricted';

const complete = createOpenAICompatibleCompleter({
  baseUrl,
  model,
  apiKey,
  temperature: 0,
});

const result = await runToolAgent({
  cwd: process.cwd(),
  taskPrompt: prompt,
  complete,
  maxSteps,
  editPolicy,
});

process.stdout.write(
  JSON.stringify({
    schema: 'archeagent.openai-compatible-agent.v1',
    model,
    editPolicy,
    finished: result.finished,
    steps: result.steps,
    actions: result.transcript.map((entry) => entry.action),
  }) + '\n',
);

if (!result.finished) process.exitCode = 3;
