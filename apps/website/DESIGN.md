---
name: JI
description: A small, extensible TypeScript runtime for LLM agents, presented as ink ground on an ink stone.
colors:
  scorched-ink: 'oklch(0.155 0.012 58)'
  thick-ink: 'oklch(0.19 0.014 58)'
  heavy-ink: 'oklch(0.225 0.015 60)'
  light-ink: 'oklch(0.31 0.014 64)'
  clear-ink: 'oklch(0.42 0.013 70)'
  rubbing-paper: 'oklch(0.925 0.018 82)'
  aged-paper: 'oklch(0.76 0.016 78)'
  ash-paper: 'oklch(0.64 0.014 75)'
  qinglv-mineral: 'oklch(0.78 0.095 172)'
  ochre: 'oklch(0.74 0.085 58)'
  gamboge: 'oklch(0.84 0.1 90)'
  azurite: 'oklch(0.76 0.075 248)'
  rouge: 'oklch(0.72 0.1 12)'
typography:
  display:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: 'clamp(2.625rem, 6.4vw, 5.5rem)'
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: '-0.04em'
  headline:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: 'clamp(1.875rem, 3.4vw, 2.75rem)'
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: '-0.025em'
  title:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: 1.4
  lead:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 400
    lineHeight: 1.75
  body:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: 'Schibsted Grotesk Variable, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.6
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

The page is ground ink. Five ink tones, from scorched to clear, do the work that colours do elsewhere: they separate sections, hold code, draw frames and mark structure. Text is paper laid on that ink. One mineral colour, qinglv 石青绿, is the drop of pigment on the stone, and it means exactly one thing: a hook. Inside code wells, four more mineral pigments from Chinese painting separate token kinds, and they never leave the well. Depth comes from how thick the ink is, never from light or shadow.

The system is carved, exact and unhurried. Its reference is a stele rubbing (碑帖拓片): the JI logo is the etched mark pulled in paper white, with the cuts left open so the ink shows through. It closes the page in the footer like a colophon; the first screen belongs to code. Density is low and deliberate. Sections breathe on a fluid rhythm (`spacing.section`), content sits in an 80rem measure, and body copy stays under 42rem. The only Chinese on the page is a meaning, never an ornament: 极, 极简, and the seal glyph, which is drawn as a vector so no CJK font is loaded.

It rejects, by name: AI product templates (purple/blue gradients, glowing grids, three-column icon card rows); 国潮 pastiche (auspicious clouds, ink-landscape stock art, full-screen brush calligraphy, red-and-gold); pure-black Vercel-style engineering monochrome (`#000` ground, hairline grays, no warmth); and editorial-magazine styling (italic display serif headlines, tiny all-caps tracked labels, ruled multi-column layouts). Ink here is a material, never a motif. The `/brand` asset page is the one exception to the ink ground: it keeps a warm-paper light theme (`.theme-paper`) because it shows logos as they will be used on light surfaces.

**Key Characteristics:**

- Dark ground chosen for a scene, not a mood: a developer reading code at length, where paper-on-ink keeps long code blocks calm.
- Five ink steps carry all depth; nothing floats.
- Qinglv appears only on `before`, `after`, `intercept` and the active hook path.
- Code is the main visual. Annotations sit beside the line they explain, like side inscriptions (边款) on a seal.
- Motion happens once, on first paint, and never under `prefers-reduced-motion: reduce`.

## 2. Colors: The Grinding Palette

Five ink tones, three paper tones, one hook mineral, and four syntax pigments that live only in code. Every neutral is tinted warm (hue 58–82); nothing is pure black or pure white.

### Primary

- **Qinglv Mineral 石青绿** (`qinglv-mineral`): the only hue outside code. Hook helpers (bold, in code) in highlighted code, the selected hook tab underline and label, the active path and frame in the hook diagram, and the focus ring. Contrast 9.6:1 on thick ink.

### Secondary: syntax pigments

Used only by the Shiki theme, inside scorched-ink code wells. All read at 8:1 or better on scorched ink and are defined once as `--code-*` variables in `src/styles.css`.

- **Ochre 赭石** (`ochre`): keywords and storage (`import`, `const`, `await`, `for`, `of`).
- **Gamboge 藤黄** (`gamboge`): strings.
- **Azurite 石青** (`azurite`): function names, shell commands, types. A blue (hue 248), kept well away from qinglv (hue 172) so a call never reads as a hook.
- **Rouge 胭脂** (`rouge`): numbers and language constants, the rarest tokens.

### Neutral

- **Scorched Ink 焦墨** (`scorched-ink`): the deepest well. Code blocks, inline code, the footer. Ink you look _into_.
- **Thick Ink 浓墨** (`thick-ink`): the page ground and the default background of every section. Also the text colour on paper buttons and the seal glyph.
- **Heavy Ink 重墨** (`heavy-ink`): raised bands that need to be told apart from the ground: the hook-model band and the "Run it offline" band. Also the icon-button hover fill.
- **Light Ink 淡墨** (`light-ink`): every hairline. Section borders, row dividers in the capability list, the tab rail, code-block rings (at 60%).
- **Clear Ink 清墨** (`clear-ink`): the faintest structure. Link underlines at rest, dashed preset frames, inactive diagram strokes, hover borders on tabs.
- **Rubbing Paper 拓纸** (`rubbing-paper`): headings, names in code, primary text, the footer rubbing, the primary button. 14.8:1 on thick ink.
- **Aged Paper 旧纸** (`aged-paper`): supporting copy under headings, note text, keywords and punctuation in code. 8.6:1.
- **Ash Paper 灰纸** (`ash-paper`): the quietest readable text. Comments in code, note numerals, captions, status lines, link arrows. 5.5:1, so it still passes AA for body text.

### Named Rules

**The One Pigment Rule.** Qinglv marks a hook and nothing else. Never on a CTA, a heading, a link, a badge or a decoration. If removing the hook concept would leave qinglv on the page, that use is wrong. In code, hooks are also bold, so they outrank every syntax pigment.

**The Ink Order Rule.** Lighter ink is closer. A surface that sits _inside_ another is darker (code well in scorched ink inside a thick-ink section); a band that sits _beside_ the ground is lighter (heavy ink). Never put scorched ink directly against scorched ink: a code well inside a footer-coloured band disappears.

**The Code Ink Rule.** Syntax pigments stay inside code wells; never use ochre, gamboge, azurite or rouge for page text, links, diagrams or decoration. Names stay in rubbing paper and punctuation and operators recede into aged paper, so colour lands on meaning, not on structure. The Shiki theme in `vite-plugins/highlight.ts` only references `var(--code-*)`; change colours in `src/styles.css`, never in the theme.

## 3. Typography

**Display Font:** Schibsted Grotesk Variable (with system-ui)
**Body Font:** Schibsted Grotesk Variable (with system-ui)
**Mono Font:** Commit Mono 400 (with ui-monospace)

**Character:** One grotesk at many weights, cut tight at display sizes, so headings read as carved blocks rather than editorial headlines. Commit Mono is plain and even, so code reads as text, not as decoration.

### Hierarchy

- **Display** (800, `clamp(2.625rem, 6.4vw, 5.5rem)`, 0.98, −0.04em): the hero sentence only. Balanced wrapping.
- **Headline** (700, `clamp(1.875rem, 3.4vw, 2.75rem)`, 1.08, −0.025em): one per section, written as a full sentence ending in a period ("Run it offline."). Max 42rem wide.
- **Title** (700, 1.25rem): sub-columns inside a section, e.g. the coding-agent aside.
- **Lead** (400, 1.125rem, 1.75): the hero subtitle, in aged paper, max 34rem.
- **Body** (400, 1.0625rem, 1.75): all prose. Keep paragraphs under 42rem (~70ch).
- **Label** (400–600, 0.875rem): tab effects, footer lists, captions, the copy status message. Never uppercase, never letter-spaced.
- **Code** (Commit Mono 400, 0.875rem on a 1.7rem line): blocks, inline code (at 0.875em), package names, hook tab names, diagram labels.

### Named Rules

**The Sentence Heading Rule.** Headings are sentences in sentence case, with a period. No eyebrows, no kicker labels, no section numbers above them.

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

### Hook tabs (signature)

- A three-column rail with a 1px light-ink bottom border. Each tab stacks the hook name in code type over its effect in label type.
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

- Scorched-ink chip, 2px corners, 2px 6px padding, never wraps internally.

### Hero

- **One subject:** the first screen leads with real code, never with a brand image. The 40px 极 seal sits alone at the top, with no wordmark beside it; there is exactly one mark per screen.
- **Layout:** headline (`clamp(2.25rem, 3.6vw, 3.5rem)`, 800, three lines on desktop), lead, CTAs and status line on the left; a code print titled with its file name (`block-shell.ts`) on the right, top-aligned with the headline. Side by side from 1280px; stacked below. Hero code lines stay at 60 characters or fewer so the well never scrolls on desktop.
- **Motion:** text rises in a 70ms stagger, then the code well soaks in from the top (mask reveal, 1.1s, ease-out-expo, 0.55s delay).
- **Rhythm:** the hero is content-height, not full-viewport, so the next section's heading shows at the bottom of a 900px-tall screen.

### Footer rubbing

- The paper-white rubbing appears once, whole and uncropped, at the head of the footer's first column (144px tall), lazy-loaded. Never crop the mark, and never show it on the same screen as the seal.

## 6. Do's and Don'ts

### Do:

- **Do** separate surfaces with ink steps: thick ink ground, heavy ink bands, scorched ink wells, light-ink hairlines.
- **Do** keep qinglv to hooks only, and keep its share of any screen well under 5%.
- **Do** keep syntax pigments inside code wells, with names in paper and punctuation in aged paper.
- **Do** let code carry the page: real snippets from the repository, highlighted at build time, with side notes aligned to lines.
- **Do** write headings as full sentences in sentence case ending with a period.
- **Do** meet WCAG 2.2 AA: ash paper (5.5:1) is the lightest allowed text tone; every interactive element shows the 2px qinglv focus outline.
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
- **Don't** use `border-left` or `border-right` wider than 1px as a coloured accent; the only vertical rule is the 1px light-ink column divider.
- **Don't** add em dashes to copy; use commas, colons or periods.
