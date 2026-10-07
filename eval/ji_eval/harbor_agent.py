"""The JI coding agent as a Harbor installed agent (rfcs/bench-gap).

Harbor builds the task container, calls ``install`` once to put Node and this repository in it, then ``run`` once per
task: the coding agent's headless CLI solves the task where the container's shell starts, and writes every event of
the run to the agent log directory, which Harbor syncs back to the host. ``populate_context_post_run`` reads that
log for the tokens, cost and outcome.

    cd eval && uv run harbor run -p <task dir> -a ji_eval.harbor_agent:JiCodingAgent \\
        -m deepseek/deepseek-flash --ak ref=<git commit> --ak thinking=high

The repository is cloned at ``ref`` for a reproducible run, or uploaded from ``source``, a checkout on the host, to
try changes that are not pushed yet. The model key comes from the provider's environment variable on the host
(DEEPSEEK_API_KEY), passed into the container for the run only; it never lands in a log.
"""

import asyncio
import json
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Literal, override

from harbor.agents.capabilities import AgentCapabilities
from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.model_connection import ModelConnectionSpec
from harbor.agents.options import InstalledAgentOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from pydantic import Field

NODE_MAJOR = 24
PNPM_VERSION = "12.5.1"
REPO_URL = "https://github.com/baoziv587/Ji.git"
INSTALL_DIR = "/installed-agent/ji"
HEADLESS = "apps/coding-agent/src/headless.ts"

LOG_FILENAME = "ji.jsonl"
ANSWER_FILENAME = "answer.txt"
PROGRESS_FILENAME = "progress.txt"
EXIT_CODE_FILENAME = "exit_code.txt"

# The headless CLI's exit codes
EXIT_DONE = 0
EXIT_RUN_FAILED = 1
EXIT_BAD_INVOCATION = 2


class JiOptions(InstalledAgentOptions):
    ref: str = Field(
        default="main", description="Git ref of the JI repository to install: a commit for a reproducible run."
    )
    repo: str = Field(default=REPO_URL, description="Where the JI repository is cloned from.")
    source: str | None = Field(
        default=None,
        description="A checkout on the host to upload instead of cloning: what git sees, nothing ignored",
    )
    like: str | None = Field(
        default=None,
        description="For a model pi-ai's catalog lacks: the catalog entry (provider/id) it shares API and limits with",
    )
    cost: str | None = Field(
        default=None, description="USD per million tokens of a `like` model: in,out,cacheRead,cacheWrite"
    )
    thinking: Literal["off", "minimal", "low", "medium", "high", "xhigh", "max"] | None = Field(
        default=None, description="Thinking level; the CLI's default (high) when omitted."
    )
    max_steps: int | None = Field(
        default=None, ge=1, description="Steps before the run gives up; none when omitted: the timeouts bound the run."
    )
    timeout_sec: int | None = Field(
        default=None,
        ge=1,
        description="The run's own wall-clock limit, seconds; keep it below the task's, so the log gets its run_end",
    )


class JiCodingAgent(BaseInstalledAgent):
    """``@ji.dev/coding-agent`` run headless inside the task container."""

    # A task's skills_dir goes to the CLI as --skills: the model is told what is there and reads a SKILL.md itself
    capabilities = AgentCapabilities(skills=True)
    MODEL_CONNECTION = ModelConnectionSpec(passthrough=True)

    options_model = JiOptions
    options: JiOptions

    @staticmethod
    @override
    def name() -> str:
        return "ji-coding-agent"

    @override
    def version(self) -> str | None:
        return "source" if self.options.source is not None else self.options.ref

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        # The same system packages as Harbor's Codex adapter, plus git for the clone: ripgrep is what the grep tool
        # runs, and the system node is what the task's shell sees, as it does under Codex
        await self.ensure_system_dependencies(environment, ("curl", "git", "bash", "nodejs", "npm", "ripgrep"))
        await self._install_dir(environment)

        if self.options.source is None:
            fetch = (
                f"git clone --filter=blob:none {shlex.quote(self.options.repo)} {INSTALL_DIR} && "
                f"cd {INSTALL_DIR} && git checkout --detach {shlex.quote(self.options.ref)}"
            )
        else:
            await self._upload_source(environment, self.options.source)
            fetch = f"cd {INSTALL_DIR}"

        # --ignore-scripts skips lefthook's git-hook install, which has no business in a task container.
        # Nothing is built: Node 24 runs the TypeScript sources as they are. The CLI with no task exits 2.
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f"{nvm_node_install_snippet(NODE_MAJOR)} && "
                f"npm install -g pnpm@{PNPM_VERSION} && "
                f"{fetch} && pnpm install --frozen-lockfile --ignore-scripts && "
                f"node {HEADLESS} </dev/null >/dev/null 2>&1 || test $? -eq {EXIT_BAD_INVOCATION}"
            ),
        )

    async def _install_dir(self, environment: BaseEnvironment) -> None:
        """An empty INSTALL_DIR the agent user owns; setup() made its parent as root."""
        command = f"rm -rf {INSTALL_DIR} && mkdir -p {INSTALL_DIR}"
        if environment.default_user is not None:
            command += f" && chown {shlex.quote(str(environment.default_user))} {INSTALL_DIR}"
        await self.exec_as_root(environment, command=command)

    async def _upload_source(self, environment: BaseEnvironment, source: str) -> None:
        with tempfile.TemporaryDirectory(prefix="ji-source-") as temp:
            staging = Path(temp)
            await asyncio.to_thread(stage_checkout, source, staging)
            await environment.upload_dir(staging, INSTALL_DIR)

        if environment.default_user is not None:
            owner = shlex.quote(str(environment.default_user))
            await self.exec_as_root(environment, command=f"chown -R {owner} {INSTALL_DIR}")

    @with_prompt_template
    @override
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")

        access = self.model_connection
        logs = self.environment_logs_dir
        flags = [f"--model {shlex.quote(self.model_name)}", f"--log {shlex.quote(str(logs / LOG_FILENAME))}"]
        if access.configured_base_url is not None:
            flags.append(f"--base-url {shlex.quote(access.configured_base_url)}")
        if self.options.like is not None:
            flags.append(f"--like {shlex.quote(self.options.like)}")
        if self.options.cost is not None:
            flags.append(f"--cost {shlex.quote(self.options.cost)}")
        if self.options.thinking is not None:
            flags.append(f"--thinking {self.options.thinking}")
        if self.options.max_steps is not None:
            flags.append(f"--max-steps {self.options.max_steps}")
        if self.options.timeout_sec is not None:
            flags.append(f"--timeout {self.options.timeout_sec}")
        if self.skills_dir:
            flags.append(f"--skills {shlex.quote(self.skills_dir)}")

        # Exit 1 is a run that failed (timed out, too many steps, the provider): the task may still be partly done, so
        # the trial goes on to the verifier and the code is kept for the context. Exit 2 is a bad invocation: raised.
        await self.exec_as_agent(
            environment,
            command=(
                f". ~/.nvm/nvm.sh; mkdir -p {shlex.quote(str(logs))}; "
                f"node {INSTALL_DIR}/{HEADLESS} {' '.join(flags)} {shlex.quote(instruction)} "
                f"> {shlex.quote(str(logs / ANSWER_FILENAME))} 2> {shlex.quote(str(logs / PROGRESS_FILENAME))}; "
                f"code=$?; echo $code > {shlex.quote(str(logs / EXIT_CODE_FILENAME))}; "
                f"test $code -ne {EXIT_BAD_INVOCATION}"
            ),
            env=dict(access.env),
        )

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        metadata: dict[str, Any] = {"exit_code": self._exit_code()}
        end = self._run_end()
        if end is None:
            metadata["outcome"] = "no run_end in the log"
            context.metadata = metadata
            return

        summary = end["summary"]
        usage = summary["usage"]
        # JI's `input` leaves the cache out; Harbor's n_input_tokens includes it (RFC: no double counting either way)
        context.n_input_tokens = usage["input"] + usage["cacheRead"] + usage["cacheWrite"]
        context.n_cache_tokens = usage["cacheRead"]
        context.n_output_tokens = usage["output"]
        context.cost_usd = usage["cost"]

        metadata.update(
            outcome=end["outcome"],
            session=end.get("session"),
            turns=summary["turns"],
            inputs=summary["inputs"],
            rewrites=summary["rewrites"],
            model_ms=summary["modelMs"],
            tool_ms=summary["toolMs"],
            tools=summary["tools"],
        )
        if end["outcome"] == "failed":
            metadata["error"] = end["error"]
        context.metadata = metadata

    def _exit_code(self) -> int | None:
        path = self.logs_dir / EXIT_CODE_FILENAME
        try:
            return int(path.read_text().strip())
        except (OSError, ValueError):
            return None

    def _run_end(self) -> dict[str, Any] | None:
        """The last run_end of the log: the run's outcome and what it spent, failed runs included."""
        path = self.logs_dir / LOG_FILENAME
        try:
            lines = path.read_text().splitlines()
        except OSError:
            return None

        for line in reversed(lines):
            if '"run_end"' not in line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "run_end":
                return event
        return None


def stage_checkout(checkout: str, staging: Path) -> None:
    """Copies the checkout's files as git sees them: tracked and untracked, nothing ignored, so no node_modules."""
    source = Path(checkout).expanduser()
    listed = subprocess.run(
        ["git", "-C", str(source), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        check=True,
        capture_output=True,
    )
    for relative in listed.stdout.decode().split("\0"):
        # A symlink to a directory is listed like a file; nothing of the kind is needed in the container
        if relative == "" or not (source / relative).is_file():
            continue
        target = staging / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, target)
