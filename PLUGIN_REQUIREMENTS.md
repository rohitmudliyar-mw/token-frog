# Figma Token Inspector — Plugin Requirements

## What this plugin does
Detects design tokens used in a Figma file and surfaces them clearly so developers know exactly what tokens are being referenced — without having to inspect every layer manually.

## The problem it solves
When developers hand off a design, they have to manually dig through layers to find which tokens are used. This plugin surfaces that information automatically, making the dev handoff smoother and reducing errors.

## Design system context
- **Design system:** Athena Design System (Mosaic Wellness)
- **Figma file:** https://www.figma.com/design/BDQcwlEDS11SnKNN0rZj88/Athena_Design-System?node-id=55-323

---

## What we learned from exploring the Athena file

### Token naming conventions (confirmed)

Athena uses two tiers of tokens, both stored as CSS custom properties:

**Tier 1 — Primitive tokens** (raw color values):
```
--athena-color-{palette}-{number}
e.g. --athena-color-milan_blue-5
     --athena-color-gray-1
     --athena-color-grass_green-8
```

**Tier 2 — Semantic/theme tokens** (role-based, reference primitives):
```
--athena-theme-color-{category}-{variant}
e.g. --athena-theme-color-text-primary
     --athena-theme-color-border-hover
     --athena-theme-color-background-pop
```

### Color palettes (Tier 1 — primitives)

| Palette | Shades |
|---------|--------|
| milan_blue, honest_blue, grass_green, gray, magenta, orange, purple, teal, cyan, deep_lemon | 10 shades each (1–10) |
| earth, electric_blue, forest_green, green, pop_blue, pop_purple, red, sea_green, steel_blue, warm_white, yellow | 5 shades each (1–5) |
| pop_yellow | 6 shades |
| dark_opacity, light_opacity | 9 shades each |
| misc | 4 values (black, white, highlight, star) |

**Total: ~197 primitive color tokens across 28 palettes**

### Semantic token categories (Tier 2)

| Category | Variants |
|----------|----------|
| `text` | primary, secondary, tertiary, subtle, brand, disabled, inverse, placeholder |
| `border` | 0, 1, disabled, hover, selected |
| `background` | pop |

### How tokens are stored in Figma

Athena uses **both** Figma Variables and Figma Styles:

- **Figma Variables** → the `--athena-*` CSS-named tokens (both primitive and semantic)
- **Figma Styles** → color styles, typography styles, and effect styles (named using slash notation, e.g. `Gray/100`, `Default/Gray/60`)
- **Typography styles** → `Productive/heading-02`, `body-short-01` (IBM Plex Sans, suggests Carbon Design System influence underneath Athena)
- **Effect styles** → `$ui-03 border - Inner/Border left` (inner shadows used as borders)

### Note on style layers
Some styles follow Carbon Design System naming (`$ui-03`, `Default/Neutral/White`, `Productive/heading-02`). These appear to be a foundation layer that Athena is built on top of. The plugin should surface these too, not just the `--athena-*` variables.

---

## Core features (refined)

### 1. Token detection
- Scan the current page or selected layers for all bound tokens
- Detect tokens from **Figma Variables** (`--athena-color-*`, `--athena-theme-color-*`)
- Detect tokens from **Figma Styles** (color, text, effect styles)
- Support: color fills, strokes, typography, effects

### 2. Token classification
Tag each token by tier:
- **Primitive** — `--athena-color-{palette}-{number}` (raw values)
- **Semantic** — `--athena-theme-color-{category}-{variant}` (role-based aliases)
- **Style** — named Figma Styles (slash-notation: `Gray/100`, `Productive/heading-02`)

Show which **category** the token belongs to (text, border, background, typography, effect).

### 3. Output / display
- List all detected tokens in the plugin panel
- Group by type: Color Variables → Semantic Variables → Styles (color / typography / effects)
- Show **layer name** alongside each token so devs can trace it back
- Show **resolved value** (actual hex/font/etc) next to the token name

---

## Tech stack
- Figma Plugin API (JavaScript)
- HTML/CSS/JS for the plugin UI panel

---

## Open questions (resolved)
- [x] What collections exist in Athena? → Two tiers: Primitive colors + Semantic/theme colors
- [x] Does Athena use Figma Variables, Styles, or both? → **Both**
- [x] Is there a clear foundation vs semantic token split? → Yes: `--athena-color-*` vs `--athena-theme-color-*`
- [x] What naming convention? → `--athena-color-{palette}-{number}` and `--athena-theme-color-{category}-{variant}`

## Remaining open questions
- [ ] Are there spacing/radius/sizing tokens? (only one page was accessible — more pages may exist)
- [ ] Do components use semantic tokens directly, or mix primitive + semantic?
- [ ] Should the plugin scope to Athena tokens only, or surface all bound tokens regardless of naming?

---

## Setup status
- [x] Figma MCP connected
- [x] Athena file explored and token structure documented
- [ ] Plugin project folder not yet created
- [ ] Cursor not yet installed

## Next steps
1. Decide scope: Athena tokens only vs all bound tokens (answer remaining open question above)
2. Set up plugin project folder (`figma-token-inspector/`)
3. Scaffold plugin with `manifest.json` + basic UI shell
4. Implement token detection using `figma.variables.getLocalVariables()` and `figma.getLocalStyles()`
5. Build the display panel UI
6. Test on the Athena file
