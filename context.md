# Athena Token Inspector — Full Project Context

## Overview

**What:** A Figma plugin that audits design token usage in the Athena Design System. It inspects selected frames and classifies every design property into tiers based on whether proper design tokens are used.

**Why:** When developers hand off a design, they have to manually dig through layers to find which tokens are used. This plugin surfaces that information automatically, making dev handoff smoother and reducing errors. It also helps designers catch places where raw values were used instead of proper tokens.

**Design System:** Athena Design System (Mosaic Wellness)

---

## Scope — What the Plugin Does

The plugin has **5 inspection categories**, each accessible via a top-level tab:

| Category | What it inspects | Tiers |
|---|---|---|
| **Colors** | Fill and stroke colors on all nodes | No Token / Foreign / Primitive / Theme |
| **Typography** | Text styles on TEXT nodes | No Token / Foreign / Theme |
| **Corner Radius** | Border radius values on nodes with corners | No Token / Foreign / Primitive / Theme |
| **Border Width** | Stroke weight on nodes with visible strokes | No Token / Foreign / Primitive / Theme |
| **Effects** | Drop shadows, blurs, and other effects | No Token / Foreign / Theme |

### Tier Definitions

| Tier | Meaning | Example |
|---|---|---|
| **No Token** | Raw/hardcoded value with no variable or style attached | `background: #FF0000;` |
| **Foreign** | A variable or style IS attached, but it's not from the Athena design system | `Light/Brand/Primary/500` (non-Athena style) |
| **Primitive** | An Athena raw palette token (low-level building block) | `--athena-color-magenta-6` |
| **Theme** | An Athena semantic/role-based token (references a primitive) | `--athena-theme-color-background-brand-5` |

### Key Behaviors
- Works on **selection only** — user must select at least one frame
- Live selection tracking via `figma.on('selectionchange')`
- Results grouped by value (hex code, font signature, radius value, etc.)
- "Select in Figma" buttons that highlight the relevant layers
- Badge counts on each tier sub-tab
- Default sub-tab is always "No Token" (the most actionable view)

---

## Design System Token Structure

### Color Tokens

**Primitive (Tier 1):**
```
--athena-color-{palette}-{number}
e.g. --athena-color-milan_blue-5, --athena-color-gray-1
```
~197 primitive color tokens across 28 palettes.

**Theme (Tier 2):**
```
--athena-theme-color-{category}-{variant}
e.g. --athena-theme-color-text-primary, --athena-theme-color-background-pop
```
Categories: text, border, background.

### Typography Tokens
Applied via Figma Text Styles (not variables).
- Athena styles named: `Athena/Mobile/Heading/Regular/Title 1`
- If style name starts with `Athena/` -> theme, otherwise -> foreign

### Numeric Tokens (Radius, Border Width)
Applied via Figma Variables in collections:
- Corner radius, border width, spacing values

### Effect Tokens
Applied via Figma Effect Styles (not variables).
- If style name starts with `Athena/` -> theme, otherwise -> foreign
- Types: Drop Shadow, Inner Shadow, Layer Blur, Background Blur

---

## Architecture

### File Structure

```
athena-token-inspector/
  manifest.json   — Plugin manifest (ID, entry points, API version)
  code.js         — Sandbox code (runs inside Figma's JS engine)
  ui.html         — Plugin UI (HTML/CSS/JS, rendered in an iframe)
  context.md      — This file (project reference)
```

### How Figma Plugins Work

A Figma plugin has two parts that communicate via message passing:

```
┌─────────────────────┐       postMessage        ┌──────────────────┐
│   code.js           │ ◄─────────────────────► │   ui.html         │
│   (Figma Sandbox)   │                          │   (iframe)        │
│                     │                          │                   │
│ - Access to Figma   │                          │ - HTML/CSS/JS     │
│   document, nodes,  │                          │ - User interface  │
│   variables, styles │                          │ - Event handling  │
│ - No DOM access     │                          │ - No Figma access │
└─────────────────────┘                          └──────────────────┘
```

**Sandbox (code.js):**
- Runs in a restricted JS environment (older engine, no spread operator `{...obj}`, use `var` not `const`/`let` to be safe)
- Has access to `figma.*` API — nodes, variables, styles, selection
- Sends data to UI via `figma.ui.postMessage(data)`
- Receives messages from UI via `figma.ui.onmessage = function(msg) {}`

**UI (ui.html):**
- Standard HTML/CSS/JS rendered in an iframe
- Sends messages to sandbox via `parent.postMessage({ pluginMessage: data }, '*')`
- Receives messages from sandbox via `window.onmessage = function(event) { event.data.pluginMessage }`

### manifest.json

```json
{
  "name": "Athena Token Inspector",
  "id": "athena-token-inspector-dev",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"]
}
```

---

## How Token Detection Works

### Two Mechanisms for Token Binding in Figma

Figma stores design tokens in two different ways. The plugin must check both:

**1. Figma Variables (`boundVariables`)**
Used for: colors, corner radius, border width, spacing, and other numeric values.

```javascript
// Check if a node has a variable bound to a property
node.boundVariables.fills        // color fills
node.boundVariables.strokes      // color strokes
node.boundVariables.cornerRadius // uniform radius
node.boundVariables.topLeftRadius // per-corner radius
node.boundVariables.strokeWeight  // uniform border width
node.boundVariables.strokeTopWeight // per-side border width
```

Each binding has an `id` that resolves to a Variable object:
```javascript
var variable = figma.variables.getVariableById(binding.id);
var collection = figma.variables.getVariableCollectionById(variable.variableCollectionId);
// collection.name tells you which token set it belongs to
```

**2. Figma Styles (`fillStyleId`, `textStyleId`, `effectStyleId`)**
Used for: some colors (especially non-Athena/foreign), typography, and effects.

```javascript
node.fillStyleId      // paint style for fills
node.strokeStyleId    // paint style for strokes
node.textStyleId      // text style
node.effectStyleId    // effect style

var style = figma.getStyleById(node.fillStyleId);
// style.name tells you the style name (e.g. "Athena/Mobile/Heading/Regular/Title 1")
```

### Classification Logic Per Category

**Colors:**
- Variables classified by collection name:
  - `"Collection"` -> theme
  - `"Primitive Colors"` -> primitive
  - anything else -> foreign
- Styles (via `fillStyleId`/`strokeStyleId`) -> always foreign
- No variable AND no style -> no-token
- Priority: variable bindings > style bindings > raw values

**Typography:**
- Classified by text style name:
  - Starts with `"Athena/"` -> theme
  - Other style name -> foreign
  - No text style -> no-token
- Shows: font family, font size, font weight, line height

**Corner Radius:**
- Variables classified by collection name:
  - `"Numbers"` -> theme
  - `"Collection"` -> primitive
  - anything else -> foreign
- Checks uniform `cornerRadius` first, falls back to per-corner (`topLeftRadius`, etc.)
- Shows diff values only if corners differ, otherwise uniform

**Border Width:**
- Same collection classification as radius (`"Numbers"` -> theme, `"Collection"` -> primitive)
- Checks uniform `strokeWeight` first, falls back to per-side
- Handles mixed cases: one side can be theme while others are no-token

**Effects:**
- Classified by effect style name:
  - Starts with `"Athena/"` -> theme
  - Other style name -> foreign
  - No effect style -> no-token
- Shows: effect type (Drop Shadow, Inner Shadow, Layer Blur, BG Blur), offset, blur, spread, color

---

## Important Figma API Gotchas

These are lessons learned during development that apply to any Figma plugin:

### 1. Sandbox JS Restrictions
The Figma sandbox runs an older JS engine. Avoid:
- Spread operator: `{...obj}` will throw a syntax error. Mutate objects instead.
- `const`/`let`: Use `var` to be safe (though some versions support them).
- Modern array methods may not all be available.

### 2. Variable Names vs CSS Names
Figma's internal variable names use **slash notation** (`text/primary`, `Magenta/60`), NOT the CSS output names (`--athena-theme-color-text-primary`). Don't try to match by CSS name — classify by **collection name** instead.

### 3. Alias Resolution in boundVariables
When a theme variable aliases to a primitive, `boundVariables` on per-corner/per-side properties may store the **resolved primitive** variable ID, not the original theme variable. The uniform property (`cornerRadius`, `strokeWeight`) is more likely to hold the original variable.

Strategy: Check the uniform property first. If only per-side bindings exist, the tier of the resolved variable may not reflect what the user actually applied.

### 4. Variables vs Styles
Some tokens are applied as Figma Variables (`boundVariables`), others as Figma Styles (`fillStyleId`, `textStyleId`, etc.). Always check both. Variables take priority over styles when both exist.

### 5. figma.mixed
Properties that vary across a selection or across a text range return `figma.mixed` instead of a value. Always check for this before using a property value.

### 6. Collection Names Are Not Standardized
Different design systems use different collection names. In Athena:
- Color variables: `"Collection"` (theme), `"Primitive Colors"` (primitive)
- Numeric variables: `"Numbers"` (theme), `"Collection"` (primitive)

These may seem counterintuitive. Always verify with debug logging against actual data.

### 7. Plugin Window Size
Set via `figma.showUI(__html__, { width: 420, height: 860 })`. Figma has maximum limits. If the UI feels cramped, increase the height.

### 8. Selection Tracking
```javascript
figma.on('selectionchange', function() {
  figma.ui.postMessage({
    type: 'selection-changed',
    count: figma.currentPage.selection.length
  });
});
```

### 9. Selecting Nodes Programmatically
```javascript
figma.currentPage.selection = nodes;       // Set selection
figma.viewport.scrollAndZoomIntoView(nodes); // Scroll to them
```

---

## Code Patterns

### Walking a Node Tree
Every scan category uses the same recursive walk pattern:

```javascript
function walkForX(node, entries) {
  collectNodeX(node, entries);  // Process this node

  if ('children' in node) {     // Recurse into children
    for (var i = 0; i < node.children.length; i++) {
      walkForX(node.children[i], entries);
    }
  }
}
```

### Message Routing
The sandbox routes scan requests by category:

```javascript
figma.ui.onmessage = function(msg) {
  if (msg.type === 'scan') {
    var result;
    if (msg.category === 'typography') result = scanTypography();
    else if (msg.category === 'corner-radius') result = scanCornerRadius();
    else if (msg.category === 'border-width') result = scanBorderWidth();
    else if (msg.category === 'effects') result = scanEffects();
    else result = scanColors();

    figma.ui.postMessage({
      type: 'scan-results',
      category: msg.category || 'colors',
      result: result
    });
  }
};
```

### UI Data Flow
1. User clicks "Scan Selection"
2. UI sends `{ type: 'scan', category: activeCategory }` to sandbox
3. Sandbox walks the selection, builds entries array, sends back `{ type: 'scan-results', result: { entries } }`
4. UI splits entries by tier, groups them, stores in data objects, renders active tab

### Grouping Strategy
- Colors: grouped by hex code
- Typography: grouped by style name (theme/foreign) or font signature (no-token)
- Radius: grouped by value (no-token) or token name (other tiers)
- Border Width: grouped by value (no-token) or token name (other tiers)
- Effects: grouped by style name (theme/foreign) or effect summary (no-token)

---

## UI Structure

```
┌──────────────────────────────────────────┐
│ Athena Token Inspector                    │  Header
│ Surfaces design tokens from Athena DS     │
├──────────────────────────────────────────┤
│ Colors | Typography | Radius | Border | FX│  Category Tabs
├──────────────────────────────────────────┤
│ ● 2 layers selected                      │  Selection Status
│ [       Scan Selection       ]            │  Scan Button
├──────────────────────────────────────────┤
│ No Token (3)  Foreign (1)  Theme (5)      │  Tier Sub-tabs
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │ [swatch] #FF6600       [Select]    │   │  Result Card
│ │ token-name → alias-name            │   │
│ │ ◻ Layer Name 1                     │   │  Layer List
│ │ ◻ Layer Name 2                     │   │
│ └────────────────────────────────────┘   │
│ ┌────────────────────────────────────┐   │
│ │ ...more results...                 │   │  More Cards
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

---

## Debugging Approach

Since you can't run Figma plugin code locally, debugging is iterative:

1. Add `console.log()` statements in `code.js`
2. Run the plugin in Figma
3. Open Figma's developer console (Menu > Plugins > Development > Open Console)
4. Read the output, fix the logic
5. Remove debug logs when done

Useful debug pattern:
```javascript
console.log('[SECTION] "' + node.name + '" | binding: ' + JSON.stringify(binding));
```

---

## How to Load the Plugin in Figma

1. In Figma desktop app: Menu > Plugins > Development > Import plugin from manifest
2. Point to the `manifest.json` file in this folder
3. Run via: Menu > Plugins > Development > Athena Token Inspector
4. To reload after code changes: close the plugin and re-run it

**Important:** If you have multiple copies of the plugin folder on your machine, Figma may load an old one. Delete duplicates and re-import the manifest.

---

## Tech Stack

- **Runtime:** Figma Plugin API (JavaScript sandbox)
- **UI:** Plain HTML + CSS + vanilla JS (single `ui.html` file)
- **No build step:** The plugin runs directly from `code.js` and `ui.html` — no bundler, no TypeScript compilation needed
- **No external dependencies:** Everything is self-contained

---

## Future Improvements (Not Implemented)

- Spacing token inspection (gap, padding, margin)
- Export scan results as JSON/CSV
- Diff mode: compare token usage between two frames
- Auto-fix suggestions (replace raw values with nearest token)
- Support for multi-mode variables (light/dark theme)
- Batch selection across multiple categories
