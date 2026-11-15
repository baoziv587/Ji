# Product

## Register

brand

## Users

TypeScript developers who build or tinker with LLM agents and have felt the weight of large agent frameworks. They arrive curious and skeptical, often after work, and read code before prose. Many will judge JI in the first screen of code they see. A secondary group wants a small coding agent to learn from or use personally.

## Product Purpose

ji.dev is the home of JI (极, jí, "the utmost"): a small, extensible TypeScript runtime for LLM agents. The core stays as small as it can be; plugins take it as far as needed. One hook model (`before`, `after`, `intercept`) covers everything from small transforms to full middleware, and plugins compose as nested lists.

The site succeeds when a visitor leaves understanding the hook model well enough to imagine writing their own plugin. GitHub is the destination for the source; packages are not on npm yet, so the site never pretends they are.

## Brand Personality

Carved, exact, unhurried. The voice of a stone rubbing: nothing is decorative, every mark was cut on purpose, and the restraint itself is the confidence. Copy is plain English, short, and technical; it explains instead of selling. Chinese appears only where it carries meaning (the 极 glyph and its gloss), never as ornament.

## Anti-references

- AI product templates: purple/blue gradients, glowing grids, "build agents 10x faster" copy, three-column icon card rows.
- 国潮 pastiche: auspicious clouds, ink-landscape stock art, full-screen brush calligraphy, red-and-gold.
- Pure-black Vercel-style engineering monochrome: `#000` ground, hairline grays, no warmth.
- Editorial-magazine styling: italic display serif headlines, tiny all-caps tracked labels, ruled multi-column layouts.

## Design Principles

1. **Code is the artifact.** The page is built around real JI code; prose and diagrams exist to make that code legible, never to replace it.
2. **Show the shape of the idea.** Where a concept is structural (where a hook sits, how plugins nest), draw the structure instead of describing it.
3. **Cut, don't add.** Like the runtime, the page keeps its core small. A section that does not help someone understand or try JI goes.
4. **Material, not motif.** The Eastern character comes from ink, rubbing, and seal layout as materials and composition, not from cultural decoration.
5. **Honest status.** Say plainly what is in development and what is not published.

## Accessibility & Inclusion

- WCAG 2.2 AA: body text and code at 4.5:1 or better against their surfaces; faint ink tones are for non-text only.
- Restrained motion: one entrance sequence on the first screen; everything honors `prefers-reduced-motion`.
- All content is prerendered and readable without JavaScript; interactive parts degrade to static content.
- Color never carries meaning alone; the accent always pairs with a label or position.
