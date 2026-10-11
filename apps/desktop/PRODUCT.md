# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who hand coding tasks to Ji's coding agent and follow its work: reading code, editing files, running commands. They keep the window open beside an editor for long stretches, check in on several sessions at once, and step in when a session waits for approval or an answer. (Inferred from the repository; not yet confirmed by the user.)

## Product Purpose

Ji Agent is the desktop window for the coding agent in `apps/coding-agent`. It starts or connects to the agent's HTTP service, lists sessions grouped by project folder, streams each reply (text, thinking, tool calls, notices), and lets the user approve, answer, steer, stop, switch mode, and run slash commands. Success: the user can tell at a glance which session needs them and act without reading every line.

## Positioning

The same small agent as the terminal (`apps/coding-agent`), with the terminal's commands, keys and menu behavior, in a native window that shows many sessions side by side. Part of JI (极): a core kept as small as it can be.

## Operating Context

- Runs on macOS as a native window drawn with MyGo's immediate-mode UI (`github.com/egoist/mygo/ui`), not a web view; the design language is ported from shadcn/ui.
- Long-running sessions; replies stream in while the user works elsewhere.
- States that matter: replying, waiting for approval, waiting for an answer, failed, done, archived.
- Light and dark appearance both follow the system.

## Capabilities and Constraints

- Approvals and questions block the agent until answered; they are the most time-sensitive thing on screen.
- Slash commands, keys and wording follow the terminal agent.
- Colors are defined as tokens in `ui/components/theme.go` and applied through MyGo's `ui.Theme`; controls are custom-drawn on MyGo's `*Base` widgets.
- Offscreen snapshots via `go test ./app -run TestSnapshot`; real-device checks need a packaged `.app`.

## Brand Commitments

- Name: Ji Agent (JI, 极, "the utmost").
- The window uses its own brand color, fixed across systems, with a light and a dark set; it does not follow the macOS accent color. (Confirmed.)
- The current visual style may be replaced; shadcn/ui stays as the basis for control behavior. (Confirmed.)
- `resources/icon.png` (blue-to-violet gradient tile with a ring) exists; whether it is a committed brand mark is undecided.

## Evidence on Hand

- The terminal agent's screenshot: `apps/coding-agent/docs/screen.webp`.
- No marketing copy, testimonials or usage data for the desktop app.

## Product Principles

1. The session that needs the user is visible without reading.
2. Same agent, same words as the terminal.
3. Small core: add nothing that does not earn its place.
