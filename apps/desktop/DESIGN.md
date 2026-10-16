---
name: Ji Agent
description: A graphite working console for watching and steering coding-agent sessions, light and dark.
colors:
  background: '#F8F5F0'
  foreground: '#39221E'
  card: '#F8F5F0'
  popover: '#F8F5F0'
  primary: '#307D33'
  primary-foreground: '#FFFFFF'
  secondary: '#DAECDC'
  muted: '#F2E8DC'
  accent: '#CAE5CC'
  muted-foreground: '#653F32'
  destructive: '#AF4A41'
  border: '#E0D2C0'
  input: '#D3C5B3'
  ring: '#4D764D'
  sidebar: '#F6E8D5'
  sidebar-accent: '#C7E2C8'
  sidebar-border: '#E0D2C0'
  info: '#0473A9'
  waiting: '#B05824'
  success: '#067C66'
  thinking: '#557255'
  warning: '#8F6402'
  code-keyword: '#0F5917'
  code-string: '#654703'
  code-number: '#86311B'
  code-type: '#045370'
  background-dark: '#1C2A1F'
  foreground-dark: '#EAE5DF'
  card-dark: '#273929'
  popover-dark: '#314433'
  primary-dark: '#5DAB5F'
  primary-foreground-dark: '#0A1F0C'
  secondary-dark: '#324331'
  muted-dark: '#223024'
  accent-dark: '#344A35'
  muted-foreground-dark: '#BEB4A8'
  destructive-dark: '#EB8276'
  border-dark: '#445543'
  input-dark: '#4E604C'
  ring-dark: '#79A378'
  sidebar-dark: '#142C1A'
  sidebar-accent-dark: '#334934'
  sidebar-border-dark: '#445543'
  info-dark: '#7ED0FE'
  waiting-dark: '#FD9F67'
  success-dark: '#40CFA9'
  thinking-dark: '#9CBB9C'
  warning-dark: '#E9AC4C'
  code-keyword-dark: '#94D394'
  code-string-dark: '#E9BD71'
  code-number-dark: '#FFB09D'
  code-type-dark: '#70CFF9'
typography:
  headline:
    fontFamily: 'SF Pro Text, -apple-system, system-ui, sans-serif'
    fontSize: '17px'
    fontWeight: 500
    letterSpacing: '-0.4px'
  title:
    fontFamily: 'SF Pro Text, -apple-system, system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 600
  body:
    fontFamily: 'SF Pro Text, -apple-system, system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 400
  label:
    fontFamily: 'SF Pro Text, -apple-system, system-ui, sans-serif'
    fontSize: '11px'
    fontWeight: 500
  code:
    fontFamily: 'SF Mono, ui-monospace, Menlo, monospace'
    fontSize: '13px'
    fontWeight: 400
  figures:
    fontFamily: 'SF Mono, ui-monospace, Menlo, monospace'
    fontSize: '11px'
    fontWeight: 400
    fontFeature: '"tnum"'
rounded:
  sm: '4px'
  md: '6px'
  lg: '8px'
  xl: '10px'
  full: '999px'
spacing:
  unit: '4px'
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    rounded: '{rounded.lg}'
    padding: '0 16px'
    height: '36px'
  button-primary-small:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    rounded: '{rounded.lg}'
    padding: '0 12px'
    height: '32px'
  button-secondary:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '0 16px'
    height: '36px'
  button-outline:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '0 16px'
    height: '36px'
  button-ghost-hover:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '0 16px'
    height: '36px'
  button-destructive:
    backgroundColor: '{colors.destructive}'
    textColor: '#FFFFFF'
    rounded: '{rounded.lg}'
    padding: '0 16px'
    height: '36px'
  input:
    backgroundColor: '{colors.card}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '0 12px'
    height: '36px'
  tag-waiting:
    textColor: '{colors.waiting}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '0 6px'
    height: '20px'
  kbd:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.muted-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '0 4px'
    height: '20px'
  badge:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '2px 8px'
  sidebar-item-selected:
    backgroundColor: '{colors.sidebar-accent}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '0 8px'
    height: '32px'
  work-line:
    textColor: '{colors.muted-foreground}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '28px'
  step-row:
    typography: '{typography.figures}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '26px'
  inspector:
    backgroundColor: '{colors.card}'
    width: '400px'
  code-block:
    backgroundColor: '{colors.muted}'
    typography: '{typography.figures}'
    rounded: '{rounded.lg}'
    padding: '0 12px 10px'
    header-height: '32px'
  select-item:
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '32px'
---

# Design System: Ji Agent

## Overview

**Creative North Star: "The Signal Console"**

Ji Agent is a graphite working console kept beside the editor. The ground is quiet and cool, made of three tonal steps (ground, panel, raised) divided by 1px seams, and nothing on it carries hue unless it means something: an action to take, a session running, a session waiting for you, a step that finished or failed, a model thinking. The user glances over, finds the one orange mark, reads the one orange-seamed panel, answers, and goes back to work.

Density is that of a developer tool, not a dashboard: 13px system text, 32px rows, 36px controls, a conversation column capped at 768px and centred in the room it has. Control anatomy and behaviour follow shadcn/ui (new-york-v4) ported to MyGo's immediate-mode widgets; the palette, seams and state colours are Ji's own. Light and dark are both full designs that follow the system appearance; the brand blue is fixed and never follows the macOS accent colour.

The world rejects the neutral grey shadcn shell with a near-black primary: the primary here is a clear brand blue, and the remaining neutrals stay cool and recessive.

**Key Characteristics:**

- Hue is reserved for meaning; every coloured pixel answers "what state, or what action".
- Depth by tonal steps and 1px seams; controls and panels carry no shadow.
- Measurements (durations, counts, usage, cost, times ago) set in tabular figures, SF Mono where they are machine output.
- One waiting colour, one waiting panel: orange appears only where the agent is blocked on the user.
- Same density and wording as the terminal agent.

## Colors

A cool graphite neutral ramp with seven semantic hues, each tuned per appearance; light values carry the base token names, dark values the `-dark` suffix.

### Primary

- **Console Blue** (`primary` / `primary-dark`): the brand. Primary buttons (Yes, Send answer), the focus ring and composer focus, text selection (30% alpha), the running spinner in the sidebar, work lines and status line, the inspected step's tint (14% alpha), and toast actions. The selected sidebar row sits on its blue-tinted fill (`sidebar-accent`).

### Semantic hues

- **Waiting Ember** (`waiting` / `waiting-dark`): only for "waiting for you". The Approval tag on a sidebar row, the 8px dot and 70%-alpha seam of the question/approval panel, and the status-line spinner while an answer is awaited. Nowhere else.
- **Done Green** (`success` / `success-dark`): a tool call that succeeded (check), the connected dot, Done notices, added diff lines.
- **Signal Red** (`destructive` / `destructive-dark`): failed tool calls and sessions, connection and request errors, destructive buttons, removed diff lines, context at 90% of its limit, the "outside the folder" tag.
- **Thought Tint** (`thinking` / `thinking-dark`): the Thinking disclosure label. Only reasoning. The brand's own hue at less than half its chroma, so it follows the scheme and stays quieter than an action; never violet.
- **Caution Amber** (`warning` / `warning-dark`): less-careful approval modes (anything but `ask`), what a yes has allowed, context filling past 70%, Warning notices.
- **Queue Cyan** (`info` / `info-dark`): the count of steers queued for delivery.

### Code

Code in a well is colored as it reads, the one place hue names no state: **Code Keyword** (`code-keyword`, the brand's own hue), **Code String** (`code-string`), **Code Number** (`code-number`, numbers, literals and constants) and **Code Type** (`code-type`, types, builtins and attributes), three hues apart from the brand and from each other, each 7:1 or more on the well, the card and the ground, as code is set a step under the body. Comments are quiet ink, punctuation halfway to it, the rest ink. Each scheme tunes its own four, never violet.

### Neutral

- **Graphite Ground** (`background`): the conversation canvas; cool off-white `#F7F8FA` in light, near-black graphite in dark.
- **Sidebar Panel** (`sidebar`): the session list, one step off the ground. Over the window's material it is a veil of that color, 60% in dark and 35% in light, as the light material is already washed pale, so the panel keeps the scheme's hue whatever the wallpaper tints the material, and stays translucent.
- **Raised Panel** (`card`, `popover`): the inspector, the approval panel, the composer, inputs, menus and toasts.
- **Secondary Fill** (`secondary`): user messages and secondary buttons.
- **Muted Well** (`muted`): code and diff wells, the empty-state tile; in dark it sits below the ground, a recessed well.
- **Hover Fill** (`accent`): hover on ghost buttons, triggers and menu items; Kbd caps.
- **Seam** (`border`, `sidebar-border`): every 1px division and panel outline.
- **Field Edge** (`input`): the composer and input outlines, outline buttons in dark.
- **Ink** (`foreground`) and **Quiet Ink** (`muted-foreground`): text, and everything secondary (args, durations, metadata, collapsed triggers, key hints).

### Named Rules

**The Hue Means Something Rule.** A colour other than the graphite neutrals appears only to name a state or an action. Decoration never borrows a semantic hue.

**The One Waiting Colour Rule.** Orange (`waiting`) marks only what is blocked on the user. If nothing waits, no orange is on screen.

**The Tinted State Rule.** State tags are the state's own colour as text, on a 10% fill of it, inside a 45% seam of it; never a solid fill.

**The Stepped Light Rule.** Hue stays low, so the light surfaces part by lightness: the well, the bubble, the seam and the field edge sit at least 0.03, 0.04, 0.09 and 0.13 (OKLCH) below the ground, and quiet ink reads at 5.5:1 or more on the well. Code, a message and a table stand off the text around them without a shadow.

**The Legible Diff Rule.** Diff lines sit on a 12% band of their hue, their sign in it and their code in its colors; in light mode the band drops to 60% of that strength. Where a changed line differs from the one it replaced, that part sits on a band 2.5 times as strong.

## Typography

**Body Font:** SF Pro (the macOS system face, at the system size: 13px)
**Mono Font:** SF Mono (`monospace`)

**Character:** The system face does all prose and interface work at native macOS size; SF Mono carries anything the machine produced: tool names, arguments, output, diffs, durations and usage figures.

### Hierarchy

- **Headline** (500, 17px, -0.4px tracking): empty-state titles only ("What should we work on?").
- **Title** (600, 13px): the window title, the Sessions header, a question's title.
- **Body** (400, 13px): conversation text, sidebar rows (500 when selected), buttons (500).
- **Label** (500, 11px): tags (0.2px tracking), badges, Kbd caps, extra-small buttons, help section titles, times ago.
- **Code** (SF Mono 400, 13px for tool names at 500; 12px in a reply's wells; 11px for args, output and diffs).
- **Figures** (SF Mono, 11px, tabular): durations, status-line counts, the context gauge's percentage; 12px in the usage popover.

### Named Rules

**The Steady Figures Rule.** Any number that changes while you watch (seconds elapsed, counts, tokens, cost, times ago) uses tabular figures (`tnum`), so what follows it does not jiggle.

**The Sentence Case Rule.** Headers and section names are sentence case at body or title size ("Sessions", folder names); the build uses no letter-spaced caps headers.

## Layout

Two panes: a sidebar of sessions grouped by project folder (48px header row, 32px session rows padded 8px, sections collapsible) and the session pane (48px header with a bottom seam carrying title, model, thinking select and folder separated by middle dots). The conversation, the approval panel and the composer share one centred column, max 768px, with user messages right-aligned at up to 80% of it. A step chosen opens the inspector at the right (400px by default, 320px at least, dragged wider from its edge); with less than 440px left for the conversation it covers the conversation instead, with a back button. The composer carries the 20px status line above its text (activity, mode, queue, menu position, then right-aligned key hints) and, under it, the context gauge at the left of the row that holds Stop and Send.

Spacing runs on a 4px unit; recurring steps are 4, 6, 8, 12, 16 and 24 (empty states pad 48 with a 24 gap). The approval panel pads 16 with a 12 gap; work lines and step rows pad 0x8, pulled out by 8 so their text keeps the column's edge.

## Elevation & Depth

Flat by default. Depth is conveyed by three tonal steps (ground, sidebar panel, raised panel; dark mode adds a recessed muted well below the ground) and by 1px seams. Controls, panels, work lines and the approval panel carry no shadow. Floating layers, and only those, keep a soft offset shadow so they lift off the content they overlay.

### Shadow Vocabulary

- **Popover lift** (`0 4px 6px -1px rgba(0,0,0,0.1)`): select popovers and the slash-command menu.
- **Toast lift** (`0 4px 12px 0 rgba(0,0,0,0.1)`): toasts.
- **Focus ring** (`0 0 0 3px` ring at 50% alpha, with a 1px ring border on fields): keyboard focus and the focused composer; a state, not elevation.

### Named Rules

**The Seam Rule.** Separation is a 1px `border` line or a tonal step; never a shadow on anything that is part of the page.

## Shapes

Gently curved rectangles. The base radius is 8px (buttons, inputs, panels, code wells, popovers); 6px for items inside popovers and the inline select trigger; 4px for small marks (tags, Kbd, disclosure and mode triggers); 10px for toasts and the empty-state tile; full pills only for badges, the send button and status dots. Outlines are always 1px.

## Components

### Buttons

Quiet, compact, shadcn anatomy.

- **Shape:** 8px radius; heights 36 / 32 / 24 (default, small, extra-small), icon-only squares at 32 and 24.
- **Primary:** brand blue fill, primary-foreground text, weight 500; hover drops to 90% alpha.
- **Secondary / Outline / Ghost:** secondary fill; background with a 1px seam (dark: input at 30% with an input seam); transparent with an accent hover.
- **Destructive:** red fill with white text (dark: red at 60%).
- **Focus:** 3px ring at 50% alpha; colours fade over 150ms. Disabled at 50% opacity.
- **Approval row:** blue Yes and outline siblings at small size; No is pushed to the far right so it is not hit for a yes.

### Tags and Badges

- **Tag:** 20px tall, 4px radius, 11px/500 text in the state colour on a 10% fill inside a 45% seam ("Approval", "Failed", "outside the folder").
- **Badge:** pill, 2x8 padding, primary, secondary, outline or destructive.
- **Kbd:** 20px cap, accent fill, quiet ink, 11px/500.

### Cards / Containers

- **Work line:** the thinking and calls between two stretches of the reply fold into one 28px line, no panel: state glyph (blue spinner, waiting spinner while an answer is awaited, green check, red X), what the work did in quiet ink ("Thought, searched for "onSubmit", read 2 files"), tabular duration, a chevron that turns as it opens; accent fill on hover. While it runs, the line says what runs now (SF Mono name and target, or "Thinking" in the thinking tint with its last words) and counts the steps done.
- **Step rows:** the work open, a 26px row a step on a thread: a 1px line in quiet ink at 30% that stops short of each 5px mark (green done, red failed, quiet stopped, thinking tint, a 12px spinner while running); SF Mono 11px name at 500 and target, edits' +/− counts, tabular duration. The step in the inspector sits on the brand at 14%.
- **Outcome lines:** under the work line, open or closed, the files it changed (pencil, SF Mono path, green +n, red −n) and the calls that failed (red X, name, the output's first line); a click shows the step.
- **Inspector:** raised panel at the right with a 1px seam; a frosted 48px bar with the step's state, SF Mono name, duration, "3 of 9", previous and next, copy (a green check for 1.5s once copied) and close. Under it the subject in SF Mono 13px, then 11px/500 headings (Input, Changes, Output, Error) over muted wells of numbered lines in color (a read in its file's language, numbered from where it started; the input as JSON; a command as shell), an edit's diff on its bands; thinking reads at body size.
- **Approval / question panel:** raised panel, 16px padding, seamed in waiting orange at 70%, an 8px waiting dot before the title; the only panel in that colour.
- **User message:** secondary fill, 1px seam, 8x12 padding, right-aligned.
- **Code well:** muted fill, SF Mono 11px at 1.5 line height, 12px sides. In the reply, a fenced block is 12px inside a 1px seam, with a 32px head with its language in quiet ink and a quiet Copy (a green check for 1.5s once copied); its lines take their colors as each ends while the reply streams in.
- **Reply text:** the reply and the thinking read as Markdown (goldmark, with GitHub's tables, task lists and strikethrough) at body size and 1.625 line height, 12px between blocks, its prose at most 43 times the body size wide (about 85 characters, 43 of CJK) while code and tables take the column; the text reads at 11:1 to 14:1 on the ground. Headings at 600 (20px, 17px, 15px, then body size) with 24px (20px from the third level) above and 8px below. List items hang from a 20px gutter of quiet bullets (•, ◦, ▪ by depth) or tabular numbers, 4px apart in a tight list and 8px under the line that leads in; a task shows a 14px box, filled with the brand and a check once done. A quote has a 2px bar of quiet ink at 50% 12px before its text, in ink 40% of the way to quiet ink. Inline code is SF Mono 1px under the body, in the hue of what it names, each on its own hue at 14%: a path, glob or file name in Code String, a call or member in Code Type, any other word in Emphasis on the brand; a link is in the brand drawn 30% toward the ink and opens in the browser; a table sits in a 1px seam with its head on the muted fill, its columns only as wide as they need. A line that may still turn into a fence, heading, item, rule or table row waits until it ends, so marks never flash as text. Tool output is never Markdown: it is shown as it came.

### Inputs / Fields

- **Style:** 36px tall, card fill, 1px input-colour edge, 8px radius; the composer is the same skin grown into a multi-line group.
- **Focus:** edge turns ring blue with the 3px half-strength ring.
- **Choice cards:** a choice that needs its consequence read, as the settings' Approvals: one card per option, 1px seam at the 10px radius, padded 12px 16px, a 16px radio before the name at 500 and its line in quiet ink. Chosen, the seam and the radio's dot take the brand, on a 6% fill of it; yolo takes Caution Amber instead and adds a line in it, with a warning icon, saying what it lets through.

### Navigation

- **Sidebar rows:** 32px, title left, state at right (orange Approval tag, blue spinner, red Failed tag, or tabular time ago). Selected row: sidebar-accent blue tint, foreground text at 500.
- **Context gauge:** the terminal's usage line folded into one 24px trigger at the left of the composer's button row: a 14px ring filled clockwise from the top on a track of quiet ink at 25%, and the percentage in figures (`~` while estimated), both in quiet ink, Caution Amber past 70% and Signal Red past 90%, then, after middle dots in quiet ink, the cost to the cent and `cache 99%`; the terminal's `ctx 149k/200k` under the pointer. Pressed, a popover opens over it (240px, popover skin): Context with its tokens against the limit, a 4px bar in the gauge's color and when it compacts, then a seam, then Cost to the cent (`<$0.01` under one), Input, Output, Cache hit and Speed, names in quiet ink and values in ink at 12px figures. Blank until the first call has ended.
- **Compaction seam:** where the history became a summary, a row in the conversation: a 1px border hairline across it, broken in the middle by quiet-ink 12px text. While it runs, `Summarizing what came before`, and the status line says `Compacting 164k tokens`; once done, `Summarized above · 182k → 31.2k tokens`, the sizes in figures. Kept as it was, it is no seam but a notice that says why: a Warning when the summary failed or was stopped (`The conversation goes on in full.`), a Note when there was nothing new to summarize. Never an alert, never a confirmation: nothing the person can read is lost.
- **Inline select:** reads as text in quiet ink with a small chevron at 60%, accent fill on hover; its popover marks the chosen option with a check.
- **Slash-command menu:** popover above the composer, 32px items at 6px radius, accent highlight, matched letters in primary.

### Disclosure

Muted trigger, 16px chevron rotating 90 degrees as it opens, hover to foreground; tinted with the thinking token only for Thinking.

### Motion

Things come to rest slowly: ease-out-expo (`1 - 2^(-10t)`), never a bounce, and none of it while the system asks for less motion.

- **Opening the work:** the steps grow into view over 200ms, each row a moment after the one before (200ms + 28ms a row, from 4px above), and what is below makes way as they do.
- **What runs now:** each step's name rises 6px into the line as the last one rises away (260ms); the spinner gives way to the check the same way.
- **Compaction:** while the history is summarized, a primary-blue light 35% of a half's length runs along each half of the seam into the middle every 1.4s (ease-in-out), fading as it nears the words: the history pressed together. Drawn 60 times a second, each other frame with the spinner's Tick: a light gliding that far steps visibly at 30, and 120 cost too much. Those frames only paint again. As the summary comes, the light stops, the sizes rise into the words' place (260ms), and the context gauge's arc runs down to the new size (320ms); a rise, after every reply, shows at once. With less motion, the seam stays still and the status line's spinner says it runs.
- **The inspector:** comes in 32px from the right over 320ms as the conversation narrows to make room; another step's lines rise 6px into it (240ms). It keeps up with its edge while dragged.

## Do's and Don'ts

### Do:

- **Do** give every coloured element a state or action to name; reach for the palette token by its meaning (`waiting`, `success`, `thinking`), not by its hue.
- **Do** separate surfaces with a 1px `border` seam or a tonal step.
- **Do** set changing numbers in tabular figures, and machine output in SF Mono.
- **Do** mark states with the tinted Tag (10% fill, 45% seam) rather than a solid fill.
- **Do** design both appearances; every token has a light and a `-dark` value.
- **Do** isolate the negative choice of an approval at the far end of its row.

### Don't:

- **Don't** use `waiting` orange for anything but what blocks on the user.
- **Don't** put shadows on controls, panels or rows; only popovers, menus and toasts lift.
- **Don't** follow the macOS accent colour; the brand blue is fixed.
- **Don't** use a near-black or grey primary; primary actions are brand blue. The one exception is the Monochrome scheme, grey by design: there a link is underlined at rest, as its hue cannot set it off.
- **Don't** use violet anywhere, or cyan for anything but queued steers.
