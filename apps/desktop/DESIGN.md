---
name: Ji Agent
description: A graphite working console for watching and steering coding-agent sessions, light and dark.
colors:
  background: '#F8F5F0'
  foreground: '#3E2723'
  card: '#F8F5F0'
  popover: '#F8F5F0'
  primary: '#447944'
  primary-foreground: '#FFFFFF'
  secondary: '#E8F5E9'
  muted: '#F0E9E0'
  accent: '#CDE4CE'
  muted-foreground: '#6D4C41'
  destructive: '#A0564E'
  border: '#E0D6C9'
  input: '#E0D6C9'
  ring: '#557354'
  sidebar: '#F0E9E0'
  sidebar-accent: '#CDE4CE'
  sidebar-border: '#E0D6C9'
  info: '#2C729E'
  waiting: '#A2613F'
  success: '#0E7C66'
  thinking: '#597059'
  warning: '#8B651E'
  background-dark: '#1C2A1F'
  foreground-dark: '#EAE5DF'
  card-dark: '#2B382C'
  popover-dark: '#354236'
  primary-dark: '#6FA66F'
  primary-foreground-dark: '#0A1F0C'
  secondary-dark: '#364235'
  muted-dark: '#252F26'
  accent-dark: '#374937'
  muted-foreground-dark: '#B6AEA4'
  destructive-dark: '#DB8D83'
  border-dark: '#424E41'
  input-dark: '#4C594B'
  ring-dark: '#81A080'
  sidebar-dark: '#1C2A1F'
  sidebar-accent-dark: '#364836'
  sidebar-border-dark: '#424E41'
  info-dark: '#83CFFB'
  waiting-dark: '#EDA77F'
  success-dark: '#6DC9AC'
  thinking-dark: '#A0B9A0'
  warning-dark: '#DDB06F'
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
  tool-panel:
    backgroundColor: '{colors.card}'
    rounded: '{rounded.lg}'
    padding: '10px 14px'
  code-block:
    backgroundColor: '{colors.muted}'
    typography: '{typography.figures}'
    rounded: '{rounded.lg}'
    padding: '8px 12px'
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

- **Console Blue** (`primary` / `primary-dark`): the brand. Primary buttons (Yes, Send answer), the focus ring and composer focus, text selection (30% alpha), the running spinner in the sidebar, tool rows and status line, and toast actions. The selected sidebar row sits on its blue-tinted fill (`sidebar-accent`).

### Semantic hues

- **Waiting Ember** (`waiting` / `waiting-dark`): only for "waiting for you". The Approval tag on a sidebar row, the 8px dot and 70%-alpha seam of the question/approval panel, and the status-line spinner while an answer is awaited. Nowhere else.
- **Done Green** (`success` / `success-dark`): a tool call that succeeded (check), the connected dot, Done notices, added diff lines.
- **Signal Red** (`destructive` / `destructive-dark`): failed tool calls and sessions, connection and request errors, destructive buttons, removed diff lines, context at 90% of its limit, the "outside the folder" tag.
- **Thought Tint** (`thinking` / `thinking-dark`): the Thinking disclosure label. Only reasoning. The brand's own hue at less than half its chroma, so it follows the scheme and stays quieter than an action; never violet.
- **Caution Amber** (`warning` / `warning-dark`): less-careful approval modes (anything but `ask`), what a yes has allowed, context filling past 70%, Warning notices.
- **Queue Cyan** (`info` / `info-dark`): the count of steers queued for delivery.

### Neutral

- **Graphite Ground** (`background`): the conversation canvas; cool off-white `#F7F8FA` in light, near-black graphite in dark.
- **Sidebar Panel** (`sidebar`): the session list, one step off the ground.
- **Raised Panel** (`card`, `popover`): tool rows, the approval panel, the composer, inputs, menus and toasts.
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

**The Legible Diff Rule.** Diff lines sit on a 12% band of their hue; in light mode the line's text mixes 30% toward the foreground and the band drops to 60% of that strength so the text holds 4.5:1.

## Typography

**Body Font:** SF Pro (the macOS system face, at the system size: 13px)
**Mono Font:** SF Mono (`monospace`)

**Character:** The system face does all prose and interface work at native macOS size; SF Mono carries anything the machine produced: tool names, arguments, output, diffs, durations and usage figures.

### Hierarchy

- **Headline** (500, 17px, -0.4px tracking): empty-state titles only ("What should we work on?").
- **Title** (600, 13px): the window title, the Sessions header, a question's title.
- **Body** (400, 13px): conversation text, sidebar rows (500 when selected), buttons (500).
- **Label** (500, 11px): tags (0.2px tracking), badges, Kbd caps, extra-small buttons, help section titles, times ago.
- **Code** (SF Mono 400, 13px for tool names at 500; 11px for args, output and diffs).
- **Figures** (SF Mono, 11px, tabular): durations, status-line counts, usage line.

### Named Rules

**The Steady Figures Rule.** Any number that changes while you watch (seconds elapsed, counts, tokens, cost, times ago) uses tabular figures (`tnum`), so what follows it does not jiggle.

**The Sentence Case Rule.** Headers and section names are sentence case at body or title size ("Sessions", folder names); the build uses no letter-spaced caps headers.

## Layout

Two panes: a sidebar of sessions grouped by project folder (48px header row, 32px session rows padded 8px, sections collapsible) and the session pane (48px header with a bottom seam carrying title, model, thinking select and folder separated by middle dots). The conversation, the approval panel and the composer share one centred column, max 768px, with user messages right-aligned at up to 80% of it. Below the composer sit two 20px/16px lines: the status line (activity, mode, queue, menu position, then right-aligned key hints) and the usage line.

Spacing runs on a 4px unit; recurring steps are 4, 6, 8, 12, 16 and 24 (empty states pad 48 with a 24 gap). The approval panel pads 16 with a 12 gap; tool rows pad 10x14.

## Elevation & Depth

Flat by default. Depth is conveyed by three tonal steps (ground, sidebar panel, raised panel; dark mode adds a recessed muted well below the ground) and by 1px seams. Controls, panels, tool rows and the approval panel carry no shadow. Floating layers, and only those, keep a soft offset shadow so they lift off the content they overlay.

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

- **Tool row:** raised panel, 1px seam, 8px radius, 10x14 padding; status glyph (blue spinner, green check, red X), SF Mono name and args, right-aligned tabular duration; Details disclosure underneath.
- **Approval / question panel:** raised panel, 16px padding, seamed in waiting orange at 70%, an 8px waiting dot before the title; the only panel in that colour.
- **User message:** secondary fill, 1px seam, 8x12 padding, right-aligned.
- **Code well:** muted fill, 8x12 padding, SF Mono 11px.

### Inputs / Fields

- **Style:** 36px tall, card fill, 1px input-colour edge, 8px radius; the composer is the same skin grown into a multi-line group.
- **Focus:** edge turns ring blue with the 3px half-strength ring.

### Navigation

- **Sidebar rows:** 32px, title left, state at right (orange Approval tag, blue spinner, red Failed tag, or tabular time ago). Selected row: sidebar-accent blue tint, foreground text at 500.
- **Inline select:** reads as text in quiet ink with a small chevron at 60%, accent fill on hover; its popover marks the chosen option with a check.
- **Slash-command menu:** popover above the composer, 32px items at 6px radius, accent highlight, matched letters in primary.

### Disclosure

Muted trigger, 16px chevron rotating 90 degrees as it opens, hover to foreground; tinted with the thinking token only for Thinking.

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
- **Don't** use a near-black or grey primary; primary actions are brand blue.
- **Don't** use violet anywhere, or cyan for anything but queued steers.
