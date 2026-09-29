// Six made-up trials in the dataset's shape, written to a temporary JSONL file for the tests that import one. Each
// copies a quirk of a real scaffold's recordings, so the import, the selection and the replay meet them all:
//
//   claude-code     Warmup messages before the task, text-only steps, identical parallel calls in one turn
//   terminus-2      a system prompt, one bash_command per step, ends on a tool step (the script adds a closing turn)
//   openhands       system bookkeeping between steps, observations missing (obs: null)
//   codex           cmd recorded as an argv array, an empty trial_id (case_id falls back to trial_name)
//   mini-swe-agent  a long run of the same tool
//   gemini-cli      two tools in one step, only the first with an observation

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface Step {
  src: 'user' | 'agent' | 'system'
  msg: string
  tools: Array<{ fn: string; cmd: unknown }> | null
  obs: string | null
}

const user = (msg: string): Step => ({ src: 'user', msg, tools: null, obs: null })
const system = (msg: string): Step => ({ src: 'system', msg, tools: null, obs: null })
const say = (msg: string): Step => ({ src: 'agent', msg, tools: null, obs: null })
function act(msg: string, calls: Array<[fn: string, cmd: unknown]>, obs: string | null): Step {
  return { src: 'agent', msg, tools: calls.map(([fn, cmd]) => ({ fn, cmd })), obs }
}
const bash = (fn: string, n: number, prefix = ''): Step[] =>
  Array.from({ length: n }, (_, i) => act(`${prefix}step ${i}`, [[fn, `echo ${i}`]], `${i}\n`))

interface Trial {
  agent: string
  model: string
  task: string
  reward: 0 | 1
  trialId: string
  steps: Step[]
}

const TRIALS: Trial[] = [
  {
    agent: 'claude-code',
    model: 'claude-haiku-4-5@anthropic',
    task: 'kv-store',
    reward: 1,
    trialId: '0b1e7c1a-0000-4000-8000-000000000001',
    steps: [
      user('Warmup'),
      user('Warmup'),
      say('Ready to help.'),
      user('Build a key-value store with a gRPC API.'),
      say('Let me plan this.'),
      act(
        'Tracking the work',
        [
          ['TodoWrite', ''],
          ['TodoWrite', ''],
          ['Read', '/app/README'],
        ],
        'todos updated',
      ),
      ...bash('Bash', 4),
      act('Running the tests', [['Bash', 'pytest -q']], '3 passed'),
      say('The store is in place and the tests pass.'),
    ],
  },
  {
    agent: 'terminus-2',
    model: 'qwen3-coder@together_ai',
    task: 'kv-store',
    reward: 1,
    trialId: '0b1e7c1a-0000-4000-8000-000000000002',
    steps: [system('Answer with shell commands.'), user('Build a key-value store.'), ...bash('bash_command', 10)],
  },
  {
    agent: 'openhands',
    model: 'gpt-5-mini@openai',
    task: 'kv-store',
    reward: 0,
    trialId: '0b1e7c1a-0000-4000-8000-000000000003',
    steps: [
      system('You are OpenHands.'),
      user('Build a key-value store.'),
      system('Added workspace context'),
      ...Array.from({ length: 10 }, (_, i) => act(`Running command ${i}`, [['execute_bash', `ls ${i}`]], null)),
      act('', [['finish', '']], null),
      say('I could not finish the task.'),
    ],
  },
  {
    agent: 'codex',
    model: 'gpt-5-nano@openai',
    task: 'kv-store',
    reward: 1,
    trialId: '',
    steps: [
      user('<environment_context>cwd /app</environment_context>'),
      user('Build a key-value store.'),
      say('I will write the server, then test it.'),
      act('Executed shell call_1', [['shell', ['bash', '-lc', 'cat > server.py']]], 'Success.'),
      act('Executed shell call_2', [['shell', ['bash', '-lc', 'python -m pytest']]], '1 passed'),
      act('Executed shell call_3', [['shell', ['bash', '-lc', 'ls']]], 'server.py'),
      act('Executed update_plan', [['update_plan', '{"done":true}']], 'Plan updated'),
      say('Done: server.py serves the store.'),
    ],
  },
  {
    agent: 'mini-swe-agent',
    model: 'claude-sonnet-4-5@anthropic',
    task: 'text-editing',
    reward: 0,
    trialId: '0b1e7c1a-0000-4000-8000-000000000005',
    steps: [user('Rewrite the file with vim macros.'), ...bash('bash', 12, 'THOUGHT: '), say('Giving up.')],
  },
  {
    agent: 'gemini-cli',
    model: 'gemini-2.5-pro@gemini',
    task: 'text-editing',
    reward: 1,
    trialId: '0b1e7c1a-0000-4000-8000-000000000006',
    steps: [
      user('Rewrite the file with vim macros.'),
      act(
        '',
        [
          ['read_file', 'input.csv'],
          ['run_shell_command', 'wc -l input.csv'],
        ],
        'a,b\n1,2',
      ),
      act('', [['run_shell_command', 'vim -s macro input.csv']], ''),
      say('The file is rewritten.'),
    ],
  },
]

/** Writes TRIALS as dataset rows (steps as a JSON string, as in the parquet files) and returns the file's path. */
export function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ji-replay-fixture-'))
  const path = join(dir, 'trials.jsonl')
  const rows = TRIALS.map((t, i) => ({
    task_name: t.task,
    agent: t.agent,
    model: t.model,
    reward: t.reward,
    duration_seconds: 60 + i,
    input_tokens: null,
    output_tokens: null,
    cache_tokens: null,
    cost_cents: 0,
    trial_name: `${t.task}__trial${i}`,
    trial_id: t.trialId,
    started_at: '2026-01-01T00:00:00+00:00',
    ended_at: '2026-01-01T00:01:00+00:00',
    steps: JSON.stringify(t.steps),
  }))
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
  return path
}
