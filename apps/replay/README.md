# replay：用真实轨迹压测 agent loop 和插件系统

把 [Terminal-Bench 2.0 轨迹数据集](https://huggingface.co/datasets/yoonholee/terminalbench-trajectories)（5.2 万条 trial，26 种 scaffold，49 个模型）导入 DuckDB，按条件挑出 case，在 pi-ai 的 faux provider 上**原样回放**每条轨迹，经过 `@ji.dev/llm` 的完整 agent loop，然后：

- 逐条校验 loop、事件协议和插件钩子的正确性；
- 记录耗时、CPU、内存、GC 和事件循环延迟；
- 输出测试报告，以及 OTEL span、case 指标、原始事件三类数据（Parquet 或 JSONL），之后可以直接用 DuckDB 分析。

```bash
pnpm replay                                         # 交互式向导：选命令、选 case、选参数，并打印等价命令
pnpm replay run                                     # 默认跑全部 34,462 条轨迹；首次运行自动下载并导入（约 220 MB，只下载一次）
pnpm replay cases --agent claude-code --reward 1    # 看某个过滤条件能选出多少 case
pnpm replay run --limit 500 --seed 1 --concurrency 8   # 只跑一个可复现的随机样本
pnpm replay analyze .replay/runs                     # 所有 run 放在一起对比
pnpm replay:shell                                   # 自己写 SQL：数据集 + 所有 run 的结果
pnpm replay cache                                   # 看下载缓存；pnpm replay cache clear 清除
```

数据分两层保存：

- **下载缓存**：`~/.cache/ji-replay/`（遵循 `XDG_CACHE_HOME`，也可以用 `--cache dir` 指定）。parquet 分片按数据集的 revision 存放，同一台机器上的所有 clone 和 worktree 共用，同一个 revision 只下载一次。下载时会校验 sha256，中断后再跑只补缺少的文件。上游发布新版本时下载新 revision，并删掉旧的。连不上 Hugging Face 时直接使用已缓存的最新版本。
- **导入的库**：`.replay/terminalbench.duckdb`，之后的运行直接复用。删掉它、换一个 `--db`，或者跑 `pnpm replay import`，都会从下载缓存重新导入，大约 1 秒，不会重新下载。

case 是分批从库里读出来的（每批 100 条），跑全量时内存里只有当前这一批的 steps。不想下载的话，也可以直接跑仓库自带的 6 条样本：`pnpm replay run --source apps/replay/fixtures/terminalbench-sample.jsonl`。

## 命令

在终端里直接跑 `pnpm replay`（不带子命令）会进入 [clack](https://bomb.sh/docs/clack/basics/getting-started/) 向导：先选要做什么，再选范围（全部、随机样本，或按 agent / model / 结果挑选；多选框里输入文字搜索，按 Tab 选中），最后是并发、附加项和输出格式。向导会打印一行 `Same as pnpm replay run …`，下次可以直接复制这条命令，或者放进 CI。

带了子命令就不再提问，完全由参数决定，所以脚本和 CI 里的行为是确定的。运行时显示进度条，结束后先列出失败的 case（最多 10 个），再给出汇总；Ctrl+C 会中断运行，已经写入的 JSONL 会保留下来。

| 命令                                      | 作用                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `import [--source file\|url] [--db file]` | 从下载缓存（或指定的 parquet / JSONL）导入 `trials` 表，丢掉没有 steps 的行；`run` 和 `cases` 在库为空时会自动导入   |
| `cache` / `cache clear [--all] [--yes]`   | 查看下载缓存（revision、大小、是否完整），或者清除它；`--all` 同时删除导入的库。终端里会先确认，脚本里需要加 `--yes` |
| `cases [过滤条件]`                        | 按 agent × model 分组统计选中的 case 数、解出数、步数中位数、工具调用数，最后一行是合计                              |
| `run [过滤条件] [运行参数]`               | 回放、校验、计量、写文件；不带过滤条件就跑全部；有失败的 case 时退出码为 1                                           |
| `analyze [dir]`                           | 在一个 run 目录或它的上级目录上跑预置查询                                                                            |
| `shell ["<SQL>"] [--runs dir]`            | SQL shell，也可以用 `pnpm replay:shell`；见下文                                                                      |

**过滤条件**（testkit）：`--agent a,b` `--model m` `--task t` `--id case_id` `--reward 0|1` `--min-steps` `--max-steps` `--min-tool-calls` `--max-tool-calls` `--where "<SQL>"` `--limit n` `--seed n`。给了 `--seed` 就按 `hash(case_id, seed)` 排序，`--limit` 取到的就是一个可复现的随机样本。

**运行参数**：

| 参数                                  | 默认    | 说明                                                                 |
| ------------------------------------- | ------- | -------------------------------------------------------------------- |
| `--concurrency`                       | 4       | 同时跑几个 case                                                      |
| `--repeat`                            | 1       | 每个 case 跑几遍；配合“GC 后保留堆”指标可以查泄漏                    |
| `--max-turns`                         | 全部    | 每条轨迹最多回放多少个模型回合（最长的轨迹有 3000 步）               |
| `--tps`                               | 0       | faux 的 token/s；0 表示不限速（全程跑在 microtask 里）               |
| `--tool-updates`                      | 0       | 每次工具调用把输出拆成 n 段 `tool_update`                            |
| `--tool-latency`                      | 0       | 每次工具调用的模拟耗时（ms）                                         |
| `--timeout`                           | 60000   | 单个 case 的超时时间，超时即 abort 并记为失败                        |
| `--format`                            | parquet | `parquet` 或 `jsonl`                                                 |
| `--no-otel` / `--events` / `--checks` |         | 不挂 otel 插件 / 挂 jsonl 插件记录全部事件 / 打开 `checkDeterminism` |
| `--source file`                       |         | 不读导入好的库，直接从文件跑                                         |
| `--plugin ./x.ts`                     |         | 被测插件，可以重复传多个；见下文                                     |

## 轨迹怎么变成回放脚本

数据集中每一步是 `{ src, msg, tools: [{ fn, cmd }], obs }`。[`src/script.ts`](src/script.ts) 按下面的规则转换：

| 轨迹               | 回放                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| 开头的 `system`    | system prompt                                                         |
| `user`             | 开启一个新段：第一段 `send`，后面各段用 `when: 'idle'` 排队，依次投递 |
| 不带工具的 `agent` | 文本，并入下一个模型回合                                              |
| 带工具的 `agent`   | 一个模型回合：文本 + 工具调用；`obs` 作为第一个调用的结果             |
| 段尾               | 补一个纯文本回合，让 agent 进入 idle（没有可用文本时标为 synthetic）  |
| 后续的 `system`    | 丢弃（属于 scaffold 的记账信息，不是对话内容）                        |

每个 `fn` 生成一个回放工具（参数 `{ cmd }`），按 `(name, cmd)` 依次返回录下的 `obs`。同一回合里的工具调用是并发执行的，顺序不固定，所以完全相同的调用会拿到同一份 obs。

## 校验了什么

每个 case 由 [`src/verify.ts`](src/verify.ts) 给出一组失败原因，为空即通过：

- **结果**：run 以 `done` 结束，最终结果是脚本的最后一段文本。
- **历史**：`state.messages` 与脚本逐条一致，包括用户输入、assistant 文本、工具调用（id / name / 参数），以及工具结果。
- **统计**：`summary.turns`、`inputs`，以及各工具的调用次数与脚本一致，没有工具错误。
- **事件协议**：[`src/ledger.ts`](src/ledger.ts) 边收事件边检查：step 不嵌套，同一 step 内的事件 `t` 相同；同一时刻最多一个 model 调用处于打开状态；工具只能在模型发出调用后启动，且只结束一次；`run_end` 恰好出现一次，并且在最后。`observe` 和 `for await (const e of run)` 看到的序列摘要必须相同。
- **流式文本**：主模型的 text delta 拼起来等于脚本文本。
- **插件系统**：[`src/probe.ts`](src/probe.ts) 挂在每一个钩子上。`state.reduce` 的计数要和脚本一致；`request` 看到的是已提交的完整历史，`ctx.own` 与历史一致；`toolCall` 拿回的结果对应它传下去的那个调用；`input` 和 `record` 的执行次数都要对得上。
- **模型侧**：faux 在应答每个请求时检查自己收到的上下文（消息条数、最后一条的角色、system prompt）。这是唯一能看到 loop 实际发出了什么的位置。
- **span**：挂 otel 时，每个 case 恰好一个 `invoke_agent`，每个模型回合一个 `chat`，每次工具调用一个 `execute_tool`，所有 span 都结束且只结束一次。

[`tests/suite.test.ts`](tests/suite.test.ts) 里有三个故意写坏的插件：丢工具结果的 `record`、只发部分历史的 `request`、篡改结果的 `toolCall`。每一个都会被上面的检查抓到，这证明这些检查确实有效。

## 压测你自己的插件

模块的默认导出是一个插件，或者一个返回插件的函数：

```bash
pnpm replay run --agent openhands --min-steps 100 --limit 50 --seed 3 --plugin ./my-plugin.ts
```

也可以在代码里用：

```ts
import { openDb } from './src/dataset.ts'
import { runSuite } from './src/runner.ts'
import { selectCases } from './src/testkit.ts'

const db = await openDb('.replay/terminalbench.duckdb')
const cases = await selectCases(db, {
  agent: 'openhands',
  minSteps: 100,
  limit: 50,
  seed: 3,
})
db.close()

const result = await runSuite(cases, {
  source: 'terminalbench',
  filter: {},
  out: '.replay/runs/my-plugin',
  format: 'parquet',
  concurrency: 4,
  repeat: 1,
  timeoutMs: 60_000,
  tokensPerSecond: 0,
  toolUpdates: 0,
  toolLatencyMs: 0,
  checkDeterminism: true,
  otel: true,
  events: false,
  plugins: [myPlugin()],
})
console.log(result.rows.filter(r => !r.ok))
```

被测插件放在 probe 里层。只观察的插件和透传的中间件应当全部通过；有意改写历史或结果的插件（压缩、截断）会让“历史”一项失败，这是预期行为。

## 计量

整个 suite 共用一个 meter（[`src/metrics.ts`](src/metrics.ts)）：墙钟时间、进程 CPU、堆的起止值和峰值、GC 后仍保留的堆、RSS 的起始值和峰值、GC 次数与耗时、事件循环延迟、事件循环利用率。每个 case 还单独记录墙钟、CPU、堆变化和 events/s。

需要注意：

- 不限速时 faux 在 microtask 里流式输出，一个 case 从头到尾都不让出事件循环，所以这时的事件循环延迟约等于最长 case 的耗时。想模拟网络流，用 `--tps`。
- faux 和被测代码跑在同一个进程里，而且每次请求都要序列化整个上下文来估算 usage，所以它占用的 CPU 会随历史变长而增加。
- CPU 是进程级的数字。并发大于 1 时，case 之间的 CPU 会互相重叠；要看单个 case 的精确 CPU，用 `--concurrency 1`。
- 堆的增长里包含选中的 case 数据本身。判断有没有泄漏要看 `--repeat` 多次时，“GC 后保留”那一项是否随之增长。

## 输出

默认输出到 `.replay/runs/<replay_run_id>/`（已加入 `.gitignore`）：

| 文件             | 内容                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cases.parquet`  | 每个 case 一行：`ok`、`failures[]`、回合数、工具调用数、事件数、token、`wall_ms`、`cpu_*_ms`、`heap_delta_bytes`……                                                                                                                                    |
| `spans.parquet`  | OTLP 风格的 span：`trace_id`、`span_id`、`parent_span_id`、`name`、`kind`、`start/end_time_unix_nano`、`duration_ms`、`status_code`、`attributes`（JSON）、`events`（JSON），以及 resource 列（`replay_run_id`、`case_id`、`task`、`agent`、`model`） |
| `events.parquet` | （`--events`）全部 run 事件：`case_id`、`run_id`、`t`、`type`、`payload`（JSON）                                                                                                                                                                      |
| `summary.json`   | 配置、资源消耗和汇总统计                                                                                                                                                                                                                              |
| `report.md`      | 测试报告                                                                                                                                                                                                                                              |

`--format jsonl` 时是同名的 `.jsonl` 文件，`analyze` 两种格式都能读。

## 用 DuckDB 分析

### `pnpm replay:shell`

不需要安装 duckdb 命令行。打开 `.replay/terminalbench.duckdb`（库为空时先自动导入），里面有一张表和三个视图：

| 名称                         | 内容                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `trials`                     | 数据集本身：`case_id`、`task_name`、`agent`、`model`、`reward`、`n_steps`、`n_tool_calls`、`steps`（JSON）…… |
| `cases` / `spans` / `events` | `.replay/runs` 下所有 run 的输出合在一起（临时视图，不会写进库文件）；`--runs dir` 可以换目录                |

```bash
pnpm replay:shell                                                   # 交互式，语句以 ; 结尾才执行
pnpm replay:shell "SELECT agent, count(*) FROM trials GROUP BY ALL"   # 执行一条就退出
echo "FROM cases WHERE NOT ok LIMIT 5;" | pnpm replay:shell           # 从 stdin 读语句
```

点命令：`.tables`、`.schema <表>`、`.help`、`.quit`。结果最多显示 100 行，超过 60 个字符的值会被截断；想看完整内容，加 `LIMIT` 或只选需要的列。

`cases` 可以和 `trials` 按 `case_id` JOIN，把运行结果和原始轨迹对照着看：

```sql
SELECT t.agent, avg(c.wall_ms) AS wall_ms, avg(t.n_steps) AS steps
FROM cases c JOIN trials t USING (case_id) GROUP BY ALL ORDER BY wall_ms DESC;
```

装了 [duckdb 命令行](https://duckdb.org/docs/installation/)（`brew install duckdb`）的话，也可以直接打开这个库：`duckdb -readonly .replay/terminalbench.duckdb`。DuckDB 同一时间只允许一个进程写库，所以 bench 正在导入时它打不开。

### 直接查询文件

```sql
-- 每个 run 的通过率和每回合 CPU
SELECT replay_run_id, count(*) FILTER (ok) AS passed, count(*) AS cases,
       sum(cpu_user_ms + cpu_system_ms) / sum(model_turns) AS cpu_ms_per_turn
FROM '.replay/runs/*/cases.parquet' GROUP BY ALL ORDER BY 1;

-- 各类 span 的延迟分布
SELECT attributes->>'gen_ai.operation.name' AS op, count(*),
       quantile_cont(duration_ms, [0.5, 0.99]) AS p50_p99
FROM '.replay/runs/*/spans.parquet' GROUP BY ALL;

-- 单个 case 的调用树
SELECT span_id, parent_span_id, name, duration_ms
FROM '.replay/runs/<id>/spans.parquet' WHERE case_id = '<case_id>' ORDER BY start_time_unix_nano;

-- 回合耗时是否随轨迹长度增长（O(n²) 问题会在这里暴露）
SELECT (model_turns // 25) * 25 AS turns_from, avg(wall_ms / model_turns) AS ms_per_turn
FROM '.replay/runs/<id>/cases.parquet' GROUP BY ALL ORDER BY 1;
```

`pnpm replay analyze` 会跑一组类似的预置查询，见 [`src/analyze.ts`](src/analyze.ts)。
