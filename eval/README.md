# eval

Benchmark runs of the JI coding agent, through [Harbor](https://docs.harborframework.com). Background and the
plan: `rfcs/bench-gap/README.md`.

## Layout

- `ji_eval/harbor_agent.py`: `JiCodingAgent`, a Harbor installed agent. It installs Node 24, pnpm and this repository in
  the task container and runs `apps/coding-agent/src/headless.ts` on the task; the run's events, answer, progress and
  exit code land in the trial's agent log directory.
- `jobs/`: Harbor's job results (ignored by git).

## Setup

A [uv](https://docs.astral.sh/uv/) project: Harbor is pinned in `pyproject.toml` and `uv.lock`, and `uv run` puts
`ji_eval` on the path.

```sh
cd eval
uv sync                         # Harbor and the dev tools, into .venv
docker --version                # task containers
export DEEPSEEK_API_KEY=...     # the model's key; passed into the container for the run only
```

Lint and format with ruff: `uv run ruff check` and `uv run ruff format` (from the repository root, `pnpm lint:eval`
checks both).

## One task

The Terminal-Bench 2 tasks are directories in https://github.com/harbor-framework/terminal-bench-2. Try the changes of a
local checkout first (`source` uploads the working tree), then pin a pushed commit (`ref`) for anything reported:

```sh
uv run harbor run -p /path/to/terminal-bench-2/fix-code-vulnerability \
  -a ji_eval.harbor_agent:JiCodingAgent -m deepseek/deepseek-v4-flash \
  --ak source=.. --ak thinking=high --ak timeout_sec=800 \
  -o jobs -y
```

Agent options (`--ak key=value`): `ref` (git ref, default `main`), `repo`, `source` (local checkout instead of a clone),
`thinking`, `max_steps`, `timeout_sec` (JI's own wall-clock limit; keep it below the task's agent timeout so the log
gets its `run_end`). A custom endpoint goes through the provider's base URL variable, `DEEPSEEK_BASE_URL` for DeepSeek.

## A model the catalog lacks

`-m provider/id` must be in pi-ai's catalog. For a newer model of a listed provider, name a catalog entry it shares
the API and limits with (`like`) and its price (`cost`, USD per million tokens: in, out, cache read, cache write), or
the cost is the entry's. Claude Sonnet 5.5 through OpenRouter, with `OPENROUTER_API_KEY` set:

```sh
uv run harbor run -p <task> -a ji_eval.harbor_agent:JiCodingAgent -m openrouter/anthropic/claude-sonnet-5.5 \
  --ak like=openrouter/anthropic/claude-sonnet-4.5 --ak cost=2,10,0.2,2.5 --ak thinking=high -o jobs -y
```

## Terminal-Bench 4.0

The current set lives on Harbor Hub, not in the GitHub registry: `-d terminal-bench/terminal-bench@4.0.0` (66 tasks,
3 of them need a GPU, every task has an 8-hour agent timeout, and the official runs use 5 trials per task, `-k 5`).
`harbor dataset download terminal-bench/terminal-bench@4.0.0 -o <dir>` fetches the task directories to pick from with
`-p`. Terminal-Bench 2.0 (`-d terminal-bench@2.0`, 89 tasks) is the one in the registry.

## What a trial leaves behind

In `jobs/<job>/<trial>/agent/`:

- `ji.jsonl`: every event of the run; its `run_end` line carries the outcome and the usage summary.
- `answer.txt`, `progress.txt`, `exit_code.txt`: the CLI's stdout, stderr and exit code (0 done, 1 the run failed, 2 bad invocation).

The trial's `result.json` gets `n_input_tokens` (cache included, as Harbor counts it), `n_cache_tokens`, `n_output_tokens`,
`cost_usd`, and in `metadata` the outcome, exit code, turns, model and tool time, and the error of a failed run.
Auxiliary model calls (compaction) are in the totals.

## Rules of a reported run

Fix the JI commit, the task set and its revision, the model, thinking level, timeouts and `max_steps`; a different model
is a different experiment. Report every attempt's tokens and cost, not just the successful ones, and never claim a
full benchmark score from a subset.
