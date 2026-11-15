---
name: JI
description: A small, extensible TypeScript runtime for LLM agents, presented as ink ground on an ink stone.
colors:
  scorched-ink: 'oklch(0.18 0.003 260)'
  thick-ink: 'oklch(0.215 0.003 260)'
  heavy-ink: 'oklch(0.25 0.004 260)'
  light-ink: 'oklch(0.33 0.004 260)'
  clear-ink: 'oklch(0.44 0.005 260)'
  rubbing-paper: 'oklch(0.935 0.004 85)'
  aged-paper: 'oklch(0.77 0.004 85)'
  ash-paper: 'oklch(0.66 0.004 85)'
  qinglv-mineral: 'oklch(0.8 0.1 168)'
  cinnabar: 'oklch(0.55 0.15 35)'
  ochre: 'oklch(0.75 0.09 58)'
  gamboge: 'oklch(0.84 0.095 90)'
  azurite: 'oklch(0.77 0.08 245)'
  rouge: 'oklch(0.73 0.1 14)'
typography:
  display:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: 'clamp(2.25rem, 3.6vw, 3.5rem)'
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: '-0.035em'
  headline:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: 'clamp(1.75rem, 2.6vw, 2.25rem)'
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: '-0.025em'
  title:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: 1.4
  lead:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 400
    lineHeight: 1.75
  body:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.6
  meta:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: 'Commit Mono, ui-monospace, monospace'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '1.7rem'
rounded:
  sm: '2px'
  seal: '3px'
  md: '4px'
spacing:
  gutter: 'clamp(1rem, 4vw, 3rem)'
  section: 'clamp(5rem, 11vw, 9rem)'
  code-pad: '1.5rem'
  measure: '80rem'
components:
  button-primary:
    backgroundColor: '{colors.rubbing-paper}'
    textColor: '{colors.thick-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.sm}'
    padding: '0 24px'
    height: '48px'
  link-text:
    textColor: '{colors.rubbing-paper}'
    typography: '{typography.body}'
  hook-tab:
    textColor: '{colors.rubbing-paper}'
    typography: '{typography.code}'
    height: '56px'
  hook-tab-selected:
    textColor: '{colors.qinglv-mineral}'
    typography: '{typography.code}'
    height: '56px'
  code-print:
    backgroundColor: '{colors.scorched-ink}'
    textColor: '{colors.rubbing-paper}'
    typography: '{typography.code}'
    rounded: '{rounded.md}'
    padding: '{spacing.code-pad}'
  inline-code:
    backgroundColor: '{colors.scorched-ink}'
    textColor: '{colors.rubbing-paper}'
    typography: '{typography.code}'
    rounded: '{rounded.sm}'
    padding: '2px 6px'
  icon-button:
    textColor: '{colors.aged-paper}'
    rounded: '{rounded.sm}'
    size: '40px'
  icon-button-hover:
    backgroundColor: '{colors.heavy-ink}'
    textColor: '{colors.rubbing-paper}'
    rounded: '{rounded.sm}'
    size: '40px'
---

# Design System: JI

## 1. Overview

**Creative North Star: "The Ink Stone 砚台"**

The page is ground ink. Five ink tones, from scorched to clear, do the work that colours do elsewhere: they separate sections, hold code, draw frames and mark structure. Text is paper laid on that ink. One mineral colour, qinglv 石青绿, is the drop of pigment on the stone, and it means exactly one thing: a hook. The seal is the one other colour, stamped in cinnabar 朱砂 as seals always are. Inside code wells, four more mineral pigments from Chinese painting separate token kinds, and they never leave the well. Depth comes from how thick the ink is, never from light or shadow.

The system is carved, exact and unhurried. Its reference is a stele rubbing (碑帖拓片): the JI logo is the etched mark pulled in paper white, with the cuts left open so the ink shows through. It closes the page in the footer like a colophon; the first screen belongs to code. Density is low and deliberate. Sections breathe on a fluid rhythm (`spacing.section`), content sits in an 80rem measure, and body copy stays under 42rem. The only Chinese on the page is a meaning, never an ornament: 极, 极简, and the seal glyph, which is drawn as a vector so no CJK font is loaded.

It rejects, by name: AI product templates (purple/blue gradients, glowing grids, three-column icon card rows); 国潮 pastiche (auspicious clouds, ink-landscape stock art, full-screen brush calligraphy, red-and-gold); pure-black Vercel-style engineering monochrome (`#000` ground, hairline grays, no warmth); and editorial-magazine styling (italic display serif headlines, tiny all-caps tracked labels, ruled multi-column layouts). Ink here is a material, never a motif. The `/brand` asset page is the one exception to the ink ground: it keeps a warm-paper light theme (`.theme-paper`) because it shows logos as they will be used on light surfaces. The logo hop (`src/components/logo-hop.tsx`) is the one motion that loops: six colourways jump in turn with squash and stretch, anticipation and a small rebound, and stand still under `prefers-reduced-motion: reduce`. It plays on `/brand`, at the foot of every page under the footer, and on the 404 page; nowhere above the fold of a content page.

**Key Characteristics:**

- Dark ground chosen for a scene, not a mood: a developer reading code at length, where paper-on-ink keeps long code blocks calm.
- Five ink steps carry all depth; nothing floats.
- Qinglv appears only on `before`, `after`, `intercept` and the active hook path.
- Code is the main visual. Annotations sit beside the line they explain, like side inscriptions (边款) on a seal.
- Motion happens once, on first paint, and never under `prefers-reduced-motion: reduce`. The header stomp plays on every visit. The logo hop is the only loop, and only at the end of a page or on 404.

## 2. Colors: The Grinding Palette

Five ink tones, three paper tones, one hook mineral, the cinnabar of the seal, and four syntax pigments that live only in code. The ink is a natural dark: near-neutral gray (hue 260, chroma 0.005 or less), soft rather than black, never `#000`. The paper is a near-neutral white (hue 85, chroma 0.004). Qinglv, at chroma 0.1, is the only saturated hue outside code and the seal. Nothing is pure black or pure white.

### Primary

- **Qinglv Mineral 石青绿** (`qinglv-mineral`): the only hue outside code. Hook helpers (bold, in code) in highlighted code, the selected hook tab underline and label, the active path and frame in the hook diagram, and the focus ring. Contrast 9.8:1 on thick ink. In the docs, every inline code span is qinglv as well (see the One Pigment Rule).

### The seal

- **Cinnabar 朱砂** (`cinnabar`): the 极 seal, the favicon and the two chips the seal sheds in the header stomp, nothing else. A 白文 seal: a cinnabar block with the glyph cut out in near-white paper (`#f4f0e7`, 4.6:1 on cinnabar). The same impression works on both grounds (3.4:1 against thick ink, 4.8:1 against rice paper), so there is one `seal.svg`.

### Secondary: syntax pigments

Used only by the Shiki theme, inside scorched-ink code wells. All read at 8:1 or better on scorched ink and are defined once as `--code-*` variables in `src/styles.css`.

- **Ochre 赭石** (`ochre`): keywords and storage (`import`, `const`, `await`, `for`, `of`).
- **Gamboge 藤黄** (`gamboge`): strings.
- **Azurite 石青** (`azurite`): function names, shell commands, types. A blue (hue 248), kept well away from qinglv (hue 172) so a call never reads as a hook.
- **Rouge 胭脂** (`rouge`): numbers and language constants, the rarest tokens.

### Neutral

- **Scorched Ink 焦墨** (`scorched-ink`): the deepest well. Code blocks, inline code, the footer. Ink you look _into_.
- **Thick Ink 浓墨** (`thick-ink`): the page ground and the default background of every section. Also the text colour on paper buttons.
- **Heavy Ink 重墨** (`heavy-ink`): raised bands that need to be told apart from the ground: the hook-model band and the "Run it offline" band. Also the icon-button hover fill.
- **Light Ink 淡墨** (`light-ink`): every hairline. Section borders, row dividers in the capability list, the tab rail, code-block rings (at 60%).
- **Clear Ink 清墨** (`clear-ink`): the faintest structure. Link underlines at rest, dashed preset frames, inactive diagram strokes, hover borders on tabs.
- **Rubbing Paper 拓纸** (`rubbing-paper`): headings, names in code, primary text, the footer rubbing, the primary button. 14.5:1 on thick ink.
- **Aged Paper 旧纸** (`aged-paper`): supporting copy under headings, note text, keywords and punctuation in code. 8.5:1.
- **Ash Paper 灰纸** (`ash-paper`): the quietest readable text. Comments in code, note numerals, captions, status lines, link arrows. 5.6:1, so it still passes AA for body text.

### Light theme: ink on paper

The page follows the system colour scheme and offers a sun/moon toggle in the site header; a manual choice is stored in `localStorage` (`ji-theme`). An inline script in `__root.tsx` sets `data-theme` on `<html>` before first paint; without JavaScript the page stays on ink. The token names are roles, not lightness: `ink-*` stay surfaces and rules, `paper-*` stay text, and `:root[data-theme='light']` in `src/styles.css` swaps their values (ground `oklch(0.972 0.008 85)`, warm rice paper; text `oklch(0.21 0.004 260)`, a near-neutral ink). Wells stay darker than the ground, so the Ink Order Rule holds. Qinglv and the syntax pigments are re-cut darker for paper (4.8:1 or better on the well). Marks made for one ground use `.dark-only` / `.light-only` (the sun and moon of the toggle; the header JI, paper white on ink and charcoal on paper), and the footer rubbing is pulled in ink (`.rubbing`). The cinnabar seal needs no swap.

### Named Rules

**The One Pigment Rule.** Qinglv marks a hook and nothing else. Never on a CTA, a heading, a link, a badge or a decoration. If removing the hook concept would leave qinglv on the page, that use is wrong. In code, hooks are also bold, so they outrank every syntax pigment. One exception, set by type rather than by meaning: in the docs, inline code (Markdown backticks) is qinglv, so API names in prose and tables stand out from the aged-paper text. It is coloured by the Markdown type, never from a word list.

**The Ink Order Rule.** Lighter ink is closer. A surface that sits _inside_ another is darker (code well in scorched ink inside a thick-ink section); a band that sits _beside_ the ground is lighter (heavy ink). Never put scorched ink directly against scorched ink: a code well inside a footer-coloured band disappears.

**The Seal Rule.** Cinnabar is the seal's ink and appears nowhere else: never on a link, a button, a heading, an error or a decoration. One seal per screen, so the page never turns red-and-gold.

**The Code Ink Rule.** Syntax pigments stay inside code wells; never use ochre, gamboge, azurite or rouge for page text, links, diagrams or decoration. Names stay in rubbing paper and punctuation and operators recede into aged paper, so colour lands on meaning, not on structure. The Shiki theme in `vite-plugins/highlight.ts` only references `var(--code-*)`; change colours in `src/styles.css`, never in the theme.

## 3. Typography

**Display Font:** Schibsted Grotesk Variable (with system-ui)
**Body Font:** Schibsted Grotesk Variable (with system-ui)
**Mono Font:** Commit Mono 400 (with ui-monospace)

**Character:** One grotesk at many weights, cut tight at display sizes, so headings read as carved blocks rather than editorial headlines. Commit Mono is plain and even, so code reads as text, not as decoration.

### Hierarchy

- **Display** (700, `clamp(2.25rem, 3.6vw, 3.5rem)`, 1.02, −0.035em): the hero sentence, and the 404 and docs titles (capped at 3rem). Balanced wrapping.
- **Headline** (700, `clamp(1.75rem, 2.6vw, 2.25rem)`, 1.1, −0.025em): one per section, written as a full sentence ending in a period ("Run it offline."). Max 42rem wide. At least 1.4× smaller than Display, so the two never read as neighbours.
- **Title** (700, 1.25rem): sub-columns inside a section, e.g. the coding-agent aside.
- **Lead** (400, 1.25rem, 1.625): the hero subtitle and section subtitles, in aged paper, max 34rem. A clear step above body.
- **Body** (400, 1.0625rem, 1.75): all prose. Keep paragraphs under 42rem (~70ch).
- **Secondary** (400–600, 0.9375rem): navigation, the footer, "On this page", side notes, docs tables, hook tab names. Never uppercase, never letter-spaced.
- **Meta** (400, 0.8125rem): the hero status line, code-well labels ("Terminal", file names), hook tab effects, previous/next labels, the copy status message.
- **Code** (Commit Mono 400, 0.875rem on a 1.7rem line): blocks, inline code (at 0.875em), package names, diagram labels. Line numbers are 0.6875rem, the smallest size on the page.

One weight carries every heading (700); the body is 400 and labels go no higher than 600. Outside code the scale is Display, Headline, Lead and Title (both 1.25rem), Body, Secondary and Meta, each a clear step from the next; do not add a size in between.

### Named Rules

**The Sentence Heading Rule.** Headings are sentences in sentence case, with a period. No eyebrows, no kicker labels, no section numbers above them.

**The Two Lines Rule.** Right of the left edge, things start on one of two vertical lines: the **half line** (a two-column grid with a 4rem gap; 752px at 1440) and the **notes line** (a `minmax(0,1fr) 16rem` grid with a 2.5rem gap; 1056px at 1440). The hero code, the compose column, the capability descriptions and the footer's Packages sit on the half line; code notes, the "Run it offline" aside and the footer's Docs sit on the notes line. A new column snaps to one of them, never to a third.

**The Fixed Line Rule.** Code line height is the token `--code-lh` (1.7rem) and block padding is `--code-pad` (1.5rem). Annotation positions are computed from both, so never change one without checking that notes still line up.

## 4. Elevation

Flat. There are no shadows anywhere on the ink page. Depth is tonal: a surface is either the ground (thick ink), a raised band (heavy ink), or a well cut into the ground (scorched ink), and it is separated by a 1px light-ink hairline when tone alone is too subtle. Focus is shown with a 2px qinglv outline, offset 3px (or −2px inside tabs so it never overlaps a neighbour).

### Named Rules

**The No-Light Rule.** Nothing glows, nothing floats, nothing blurs. If a surface needs to stand out, change its ink, not its shadow.

## 5. Components

### Buttons

Firm and quiet. There is one filled button per screen.

- **Shape:** nearly square corners (`rounded.sm`, 2px).
- **Primary:** rubbing paper fill, thick-ink text, semibold, 48px tall, 24px side padding, trailing 16px icon. Hover lowers the fill to 85% opacity.
- **Secondary:** not a button. A text link with a trailing arrow, 48px tall to share the primary's baseline.
- **Icon button** (copy): 40px square, aged-paper icon, heavy-ink fill and paper icon on hover. Paired with a `role="status"` message so the result is announced.

### Links

- **Inline / external:** rubbing paper, 1px underline in clear ink offset 0.3em, underline brightens to paper on hover. External links end in a small up-right arrow in ash paper that stays inline with the last word.
- **Footer:** aged paper with no visible underline at rest; paper text and an ash underline on hover.

### Site header

- The same row on every page: the 40px JI mark (a link home) on the left; on the right a **Docs** tab, a **GitHub** link with the up-right arrow, and the theme toggle. The space above it is `--header-pt` (`clamp(3.5rem, 6vw, 4.5rem)`), sized so the stomp never leaves the page.
- The Docs tab is a tab, not a button: aged-paper label at rest, paper label with a 2px paper underline on any `/docs` page. Never qinglv (The One Pigment Rule).

### Header stomp

- Every time the header appears (a page load, or a client-side navigation between home and docs) it opens on the 极 seal. After a 0.6s beat a JI fades in from the right, takes two hops and a leap onto the seal, lands, looks down at it, then stomps: light, light, a held beat, a lean back, and a slam. Each stomp squashes the seal a step flatter (1, 0.7, 0.42, then flat) and the JI rides its top down on the same curve. On the slam the seal spits two cinnabar chips, a ring runs out on the ground, the flat seal slides away and the JI drops into its place (`src/components/header-mark.tsx`, `.stomp-*` in `src/styles.css`, 4s).
- Squash and stretch as in the logo hop: a crouch before every take-off, stretch only while fast, a squash on every landing, a short overshoot at rest. Rhythm over speed: the third stomp is preceded by a pause and a deeper crouch so it lands as the punchline.
- Every jump above the seal is capped by the header's headroom (`--room`), so nothing leaves the top of the page; on phones the JI starts closer (`--start`) to stay clear of the nav.
- The rest state, which is also what reduced motion shows, is the JI alone.

### Docs pages

- Three columns on wide screens: the doc list (12rem, sticky), the article (max 48rem), and "On this page" (13rem, sticky, from 1280px). Below 1024px the doc list becomes a wrapped row above the article, under a hairline.
- The article follows the home type scale: a display-weight title, `h2` as a headline with a light-ink rule above it, body in aged paper with paper for links and strong text, and qinglv for inline code. Code blocks are the same scorched-ink wells as the code prints, without side notes. Tables are ruled with light-ink hairlines only. From 768px, tables of three columns or fewer use a fixed layout at full width, so tables of the same shape share column lines down the page; wider tables keep auto layout and scroll inside themselves.
- Previous and next sit under the article, divided by a hairline; links that leave the site carry the up-right arrow.

### Hook tabs (signature)

- A three-column rail of equal thirds with a 1px light-ink bottom border and a 1rem gutter (1.5rem from 768px). It is a self-contained control, so it keeps equal thirds instead of snapping to the two lines. Each tab stacks the hook name in code type (secondary size) over its effect in meta type.
- **Selected:** a 2px qinglv underline and qinglv name. **Rest:** paper name, transparent underline; hover shows a clear-ink underline.
- ARIA tablist with arrow, Home and End keys. Without JS, every panel shows and the rail hides.

### Code print (signature)

- A scorched-ink well with a 1px light-ink ring at 60% and 4px corners. Optional toolbar row above, separated by a hairline, holding a label ("Terminal") and the copy button.
- **Side notes (边款):** numbered annotations in a 16rem column beside the code on large screens, each aligned to its line. Matching numerals sit in the code's left margin in ash paper. On small screens the notes stack below as a numbered list.
- Long lines scroll horizontally inside the well; the page never scrolls sideways.

### Hook diagram and onion

- Line drawings only: 1px strokes in ash paper or clear ink, 3px corners, monospaced labels. The active hook path turns qinglv at 1.5px; inactive tracks fade to 35% while `intercept` is selected.
- The onion nests 1px frames from outermost plugin to the core; a preset is a dashed clear-ink frame. The core is the one paper-filled block.

### Inline code

- Scorched-ink chip, 2px corners, 2px 6px padding, never wraps internally. Text is rubbing paper on the home page and qinglv in the docs (4.85:1 on the light well).

### Hero

- **One subject:** the first screen leads with real code, never with a brand image. The 40px JI mark sits at the top left of the site header, with no wordmark beside it (it gets there on every visit by stomping the 极 seal flat); there is exactly one mark per screen above the footer.
- **Layout:** headline (Display, three lines on desktop), lead, CTAs and status line on the left; a code print titled with its file name (`block-shell.ts`) on the right, top-aligned with the headline. Side by side from 1280px; stacked below. Hero code lines stay at 60 characters or fewer so the well never scrolls on desktop.
- **Motion:** text rises in a 70ms stagger, then the code well soaks in from the top (mask reveal, 1.1s, ease-out-expo, 0.55s delay).
- **Rhythm:** the hero is content-height, not full-viewport, so the next section's heading shows at the bottom of a 900px-tall screen.

### Footer rubbing

- The paper-white rubbing appears once, whole and uncropped, at the head of the footer's first column (144px tall), lazy-loaded. Never crop the mark, and never show it on the same screen as the seal.
- Under it sit the name, the one-line description and the **GitHub** link with the up-right arrow (as in the header): the mark, what it is and where it lives read as one block. The other columns are Packages and Docs only.
- **Grid:** the footer is two halves. Packages starts on the half line; from 1280px Docs starts on the notes line beside it, below that it stacks under Packages. All footer text is secondary size.

### Logo hop

- Below the footer grid, the colourways hop in a centred row (`<LogoHop lazy />`), the page's sign-off after the colophon. On the 404 page it sits under the back link, left-aligned and smaller (`--logo-h` 3rem to 4.5rem), as the page's only flourish beside the seal.
- On the site (`ground="theme"`) charcoal and paper white share the last place: charcoal shows on paper, paper white on ink (`.light-only` / `.dark-only`). The `/brand` page is always paper, so it shows charcoal (`ground="paper"`).
- Thumbnails are the `<id>-288.webp` files, not the full logos. Shadows and the landing ring follow the theme (`.logo-hop--theme`).

## 6. Do's and Don'ts

### Do:

- **Do** separate surfaces with ink steps: thick ink ground, heavy ink bands, scorched ink wells, light-ink hairlines.
- **Do** keep qinglv to hooks only, and keep its share of any screen well under 5%.
- **Do** keep syntax pigments inside code wells, with names in paper and punctuation in aged paper.
- **Do** let code carry the page: real snippets from the repository, highlighted at build time, with side notes aligned to lines.
- **Do** write headings as full sentences in sentence case ending with a period.
- **Do** meet WCAG 2.2 AA: ash paper (5.6:1 dark, 5.8:1 light) is the lightest allowed text tone; every interactive element shows the 2px qinglv focus outline.
- **Do** run all motion only under `prefers-reduced-motion: no-preference`, animate only opacity, transform and mask, and use ease-out-expo (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Do** pair qinglv with a label or position every time; colour never carries meaning alone.
- **Do** show the JI rubbing whole; it reads as a mark only when both letters are visible.
- **Do** draw Chinese glyphs as vectors (like the 极 seal) instead of loading a CJK font.

### Don't:

- **Don't** build AI product templates: no purple/blue gradients, no glowing grids, no "build agents 10x faster" copy, no three-column icon card rows, no hero metrics.
- **Don't** make 国潮 pastiche: no auspicious clouds, no ink-landscape stock art, no full-screen brush calligraphy, no red-and-gold.
- **Don't** drift into pure-black Vercel-style engineering monochrome: no `#000` ground, no hairline grays without warmth, no `#fff` text.
- **Don't** drift into editorial-magazine styling: no italic display serif headlines, no tiny all-caps tracked labels, no ruled multi-column layouts.
- **Don't** use shadows, glows, blur or glassmorphism. If it looks lit, it is wrong.
- **Don't** put scorched ink against scorched ink; a code well inside a scorched band disappears.
- **Don't** use qinglv for links, buttons, headings or decoration.
- **Don't** use `border-left` or `border-right` wider than 1px as a coloured accent; the only vertical rule is the 1px light-ink blockquote rule in the docs. Columns are separated by space, not rules.
- **Don't** invent radii: 2px for small things (buttons, chips, focus targets), 4px for code wells, 3px for the seal and diagram boxes, and nothing rounder.
- **Don't** add em dashes to copy; use commas, colons or periods.
