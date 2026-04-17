// code.js — runs inside the Figma sandbox
// Communicates with ui.html via postMessage.

figma.showUI(__html__, {
  width: 420,
  height: 860,
  title: 'token-frog',
});

var MAX_FRAMES = 15;
var scannedNodeIds = [];

// ─── Send selection count to UI whenever it changes ─────────────────────────

function sendSelectionCount() {
  var rawCount = figma.currentPage.selection.length;
  figma.ui.postMessage({
    type: 'selection-changed',
    count: Math.min(rawCount, MAX_FRAMES),
    isMaxed: rawCount > MAX_FRAMES,
  });
}

sendSelectionCount();
figma.on('selectionchange', function () {
  sendSelectionCount();
});

// ─── Listen for messages from UI ────────────────────────────────────────────

// Helper: get selection capped at MAX_FRAMES
function getCappedSelection() {
  var sel = figma.currentPage.selection;
  if (sel.length <= MAX_FRAMES) return sel;
  var capped = [];
  for (var i = 0; i < MAX_FRAMES; i++) capped.push(sel[i]);
  return capped;
}

// Helper: get stored selection (for re-scan)
async function getStoredSelection() {
  var nodes = [];
  for (var i = 0; i < scannedNodeIds.length; i++) {
    var node = await figma.getNodeByIdAsync(scannedNodeIds[i]);
    if (node) nodes.push(node);
  }
  return nodes;
}

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'scan') {
    // On the first category of a scan, capture the current selection's node IDs
    if (msg.category === 'colors') {
      var sel = getCappedSelection();
      scannedNodeIds = [];
      for (var s = 0; s < sel.length; s++) {
        scannedNodeIds.push(sel[s].id);
      }
    }
    var result;
    if (msg.category === 'typography') {
      result = await scanTypography();
    } else if (msg.category === 'corner-radius') {
      result = await scanCornerRadius();
    } else if (msg.category === 'border-width') {
      result = await scanBorderWidth();
    } else if (msg.category === 'effects') {
      result = await scanEffects();
    } else {
      result = await scanColors();
    }
    figma.ui.postMessage({ type: 'scan-results', category: msg.category || 'colors', result: result });
  }

  if (msg.type === 're-scan') {
    var result;
    if (msg.category === 'typography') {
      result = await scanTypographyStored();
    } else if (msg.category === 'corner-radius') {
      result = await scanCornerRadiusStored();
    } else if (msg.category === 'border-width') {
      result = await scanBorderWidthStored();
    } else if (msg.category === 'effects') {
      result = await scanEffectsStored();
    } else {
      result = await scanColorsStored();
    }
    figma.ui.postMessage({ type: 'scan-results', category: msg.category || 'colors', result: result });
  }

  if (msg.type === 'refresh-selection') {
    sendSelectionCount();
  }

  if (msg.type === 'select-nodes') {
    await selectNodesById(msg.ids);
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

// ─── Select nodes by ID ─────────────────────────────────────────────────────

async function selectNodesById(ids) {
  var nodes = [];
  for (var i = 0; i < ids.length; i++) {
    var node = await figma.getNodeByIdAsync(ids[i]);
    if (node) nodes.push(node);
  }
  if (nodes.length > 0) {
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }
}

// ─── Stored-selection scan functions (for re-scan) ──────────────────────────

async function scanColorsStored() {
  var selection = await getStoredSelection();
  if (selection.length === 0) return { error: 'No stored selection to re-scan.' };
  var entries = [];
  for (var i = 0; i < selection.length; i++) await walkForColors(selection[i], entries);
  return { entries: entries };
}

async function scanTypographyStored() {
  var selection = await getStoredSelection();
  if (selection.length === 0) return { error: 'No stored selection to re-scan.' };
  var entries = [];
  for (var i = 0; i < selection.length; i++) await walkForTypography(selection[i], entries);
  return { entries: entries };
}

async function scanCornerRadiusStored() {
  var selection = await getStoredSelection();
  if (selection.length === 0) return { error: 'No stored selection to re-scan.' };
  var entries = [];
  for (var i = 0; i < selection.length; i++) await walkForRadius(selection[i], entries);
  return { entries: entries };
}

async function scanBorderWidthStored() {
  var selection = await getStoredSelection();
  if (selection.length === 0) return { error: 'No stored selection to re-scan.' };
  var entries = [];
  for (var i = 0; i < selection.length; i++) await walkForBorderWidth(selection[i], entries);
  return { entries: entries };
}

async function scanEffectsStored() {
  var selection = await getStoredSelection();
  if (selection.length === 0) return { error: 'No stored selection to re-scan.' };
  var entries = [];
  for (var i = 0; i < selection.length; i++) await walkForEffects(selection[i], entries);
  return { entries: entries };
}

// ─── Color scan ─────────────────────────────────────────────────────────────
// Classification:
//   theme     → variable is in a collection whose name contains "theme"
//   primitive → variable is bound but NOT in a theme collection
//   no-token  → no variable bound at all

async function scanColors() {
  var selection = getCappedSelection();

  if (selection.length === 0) {
    return { error: 'Select at least one frame to scan.' };
  }

  var entries = [];

  for (var i = 0; i < selection.length; i++) {
    await walkForColors(selection[i], entries);
  }

  return { entries: entries };
}

async function walkForColors(node, entries) {
  await collectNodeColors(node, entries);

  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      await walkForColors(node.children[i], entries);
    }
  }
}

// ─── Collect colors from a single node ──────────────────────────────────────

async function collectNodeColors(node, entries) {
  var fillResult = await checkColorBinding(node, 'fills');
  var strokeResult = await checkColorBinding(node, 'strokes');

  // Also check for style-bound colors (fillStyleId, strokeStyleId)
  var fillStyleResult = await checkStyleBinding(node, 'fillStyleId', 'fill');
  var strokeStyleResult = await checkStyleBinding(node, 'strokeStyleId', 'stroke');

  // Merge: variable bindings take priority, then style bindings
  var fillBound = fillResult.bound.length > 0 || fillStyleResult.bound.length > 0;
  var strokeBound = strokeResult.bound.length > 0 || strokeStyleResult.bound.length > 0;

  // Add variable-bound entries
  var i;
  for (i = 0; i < fillResult.bound.length; i++) {
    var b = fillResult.bound[i];
    entries.push({
      hex: b.hex, alpha: b.alpha, tier: b.tier,
      tokenName: b.tokenName, collectionName: b.collectionName,
      aliasOf: b.aliasOf || null, property: 'fill',
      layerId: node.id, layerName: node.name, layerType: node.type,
    });
  }
  for (i = 0; i < strokeResult.bound.length; i++) {
    var s = strokeResult.bound[i];
    entries.push({
      hex: s.hex, alpha: s.alpha, tier: s.tier,
      tokenName: s.tokenName, collectionName: s.collectionName,
      aliasOf: s.aliasOf || null, property: 'stroke',
      layerId: node.id, layerName: node.name, layerType: node.type,
    });
  }

  // Add style-bound entries (only if no variable was bound for that property)
  if (fillResult.bound.length === 0) {
    for (i = 0; i < fillStyleResult.bound.length; i++) {
      var fs = fillStyleResult.bound[i];
      entries.push({
        hex: fs.hex, alpha: fs.alpha, tier: fs.tier,
        tokenName: fs.tokenName, collectionName: fs.collectionName,
        aliasOf: fs.aliasOf || null, property: 'fill',
        layerId: node.id, layerName: node.name, layerType: node.type,
      });
    }
  }
  if (strokeResult.bound.length === 0) {
    for (i = 0; i < strokeStyleResult.bound.length; i++) {
      var ss = strokeStyleResult.bound[i];
      entries.push({
        hex: ss.hex, alpha: ss.alpha, tier: ss.tier,
        tokenName: ss.tokenName, collectionName: ss.collectionName,
        aliasOf: ss.aliasOf || null, property: 'stroke',
        layerId: node.id, layerName: node.name, layerType: node.type,
      });
    }
  }

  // If nothing was bound at all, check for raw color
  if (!fillBound) {
    var rawFill = extractRawPaint(node, 'fills');
    if (rawFill) {
      entries.push({
        hex: rawFill.hex, alpha: rawFill.alpha, tier: 'no-token',
        tokenName: null, collectionName: null, aliasOf: null,
        property: 'fill', layerId: node.id, layerName: node.name, layerType: node.type,
      });
    }
  }

  if (!strokeBound) {
    var rawStroke = extractRawPaint(node, 'strokes');
    if (rawStroke) {
      entries.push({
        hex: rawStroke.hex, alpha: rawStroke.alpha, tier: 'no-token',
        tokenName: null, collectionName: null, aliasOf: null,
        property: 'stroke', layerId: node.id, layerName: node.name, layerType: node.type,
      });
    }
  }
}

// ─── Check style bindings (fillStyleId / strokeStyleId) ─────────────────────
// Some tokens are applied as Figma Styles rather than Variables.
// These show up in node.fillStyleId / node.strokeStyleId instead of boundVariables.

async function checkStyleBinding(node, styleProp, category) {
  var result = { bound: [] };

  if (!(styleProp in node)) return result;
  var styleId = node[styleProp];
  if (!styleId || styleId === figma.mixed) return result;

  var style = await figma.getStyleByIdAsync(styleId);
  if (!style) return result;

  // Resolve the color from the style's paints
  var hex = '#000000';
  var alpha = 1;
  if (style.type === 'PAINT' && style.paints && style.paints.length > 0) {
    var paint = style.paints[0];
    if (paint.type === 'SOLID') {
      hex = rgbToHex(
        Math.round(paint.color.r * 255),
        Math.round(paint.color.g * 255),
        Math.round(paint.color.b * 255)
      );
      alpha = paint.opacity !== undefined ? paint.opacity : 1;
    }
  }

  // Classify: if it's not from an Athena collection, it's foreign
  // Styles don't have collections like variables, so we check the name
  var styleName = style.name;
  var tier = 'foreign'; // default for styles — they're not Athena variables

  result.bound.push({
    hex: hex,
    alpha: alpha,
    tier: tier,
    tokenName: styleName,
    collectionName: 'Style',
    aliasOf: null,
  });

  return result;
}

// ─── Check bound variables for a color property ─────────────────────────────

async function checkColorBinding(node, property) {
  var result = { bound: [] };

  if (!('boundVariables' in node) || !node.boundVariables) return result;

  var binding = node.boundVariables[property];
  if (!binding) return result;

  var bindings = Array.isArray(binding) ? binding : [binding];

  for (var i = 0; i < bindings.length; i++) {
    var b = bindings[i];
    if (!b) continue;

    var varId = b.id;
    if (!varId) continue;

    var variable = await figma.variables.getVariableByIdAsync(varId);
    if (!variable) continue;

    // Only process COLOR type variables
    if (variable.resolvedType !== 'COLOR') continue;

    // Get the collection to classify
    var collection = await figma.variables.getVariableCollectionByIdAsync(
      variable.variableCollectionId
    );
    var collectionName = collection ? collection.name : '';

    var tier = classifyTier(collectionName);

    var resolved = await resolveVariableValue(variable, collection);
    var hex = (resolved && resolved.hex) ? resolved.hex : '#000000';
    var alpha = (resolved && resolved.alpha !== undefined) ? resolved.alpha : 1;

    result.bound.push({
      hex: hex,
      alpha: alpha,
      tier: tier,
      tokenName: variable.name,
      collectionName: collectionName,
      aliasOf: (resolved && resolved.aliasOf) ? resolved.aliasOf : null,
    });
  }

  return result;
}

// ─── Extract raw color from a paint array ───────────────────────────────────

function extractRawPaint(node, property) {
  if (!(property in node)) return null;
  var paints = node[property];
  if (paints === figma.mixed || !Array.isArray(paints)) return null;

  for (var i = 0; i < paints.length; i++) {
    var paint = paints[i];
    if (paint.visible !== false && paint.type === 'SOLID') {
      return {
        hex: rgbToHex(
          Math.round(paint.color.r * 255),
          Math.round(paint.color.g * 255),
          Math.round(paint.color.b * 255)
        ),
        alpha: paint.opacity !== undefined ? paint.opacity : 1,
      };
    }
  }
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Classify based on exact collection name:
//   "Collection"        → theme (Athena semantic/theme tokens)
//   "Primitive Colors"  → primitive (Athena raw palette tokens)
//   anything else       → foreign (non-Athena variable)
function classifyTier(collectionName) {
  if (collectionName === 'Collection') return 'theme';
  if (collectionName === 'Primitive Colors') return 'primitive';
  return 'foreign';
}

async function resolveVariableValue(variable, collection) {
  if (!collection) {
    collection = await figma.variables.getVariableCollectionByIdAsync(
      variable.variableCollectionId
    );
  }
  if (!collection) return null;

  var modeId = collection.defaultModeId;
  var value = variable.valuesByMode[modeId];
  if (!value) return null;

  // Direct color { r, g, b, a }
  if (typeof value === 'object' && 'r' in value) {
    return {
      type: 'color',
      hex: rgbToHex(
        Math.round(value.r * 255),
        Math.round(value.g * 255),
        Math.round(value.b * 255)
      ),
      alpha: value.a !== undefined ? value.a : 1,
    };
  }

  // Alias → another variable (theme → primitive)
  if (typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    var source = await figma.variables.getVariableByIdAsync(value.id);
    if (source) {
      var resolved = await resolveVariableValue(source, null);
      if (resolved) {
        resolved.aliasOf = source.name;
        return resolved;
      }
      return { type: 'color', hex: '#000000', alpha: 1, aliasOf: source.name };
    }
  }

  return null;
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY SCAN
// ═══════════════════════════════════════════════════════════════════════════
// Classification:
//   theme    → text style name starts with "Athena/"
//   foreign  → text style applied but name does NOT start with "Athena/"
//   no-token → text node with no text style applied (raw font values)

async function scanTypography() {
  var selection = getCappedSelection();

  if (selection.length === 0) {
    return { error: 'Select at least one frame to scan.' };
  }

  var entries = [];

  for (var i = 0; i < selection.length; i++) {
    await walkForTypography(selection[i], entries);
  }

  return { entries: entries };
}

async function walkForTypography(node, entries) {
  await collectNodeTypography(node, entries);

  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      await walkForTypography(node.children[i], entries);
    }
  }
}

async function collectNodeTypography(node, entries) {
  // Only process TEXT nodes
  if (node.type !== 'TEXT') return;

  // Check if a text style is applied
  var textStyleId = node.textStyleId;

  if (textStyleId && textStyleId !== figma.mixed) {
    var style = await figma.getStyleByIdAsync(textStyleId);
    if (style) {
      var styleName = style.name;
      var tier = styleName.indexOf('Athena/') === 0 ? 'theme' : 'foreign';

      entries.push({
        tier: tier,
        styleName: styleName,
        fontFamily: getFontFamily(node),
        fontSize: getFontSize(node),
        fontWeight: getFontWeight(node),
        lineHeight: getLineHeight(node),
        layerId: node.id,
        layerName: node.name,
        layerType: node.type,
      });
      return;
    }
  }

  // No text style → no-token
  entries.push({
    tier: 'no-token',
    styleName: null,
    fontFamily: getFontFamily(node),
    fontSize: getFontSize(node),
    fontWeight: getFontWeight(node),
    lineHeight: getLineHeight(node),
    layerId: node.id,
    layerName: node.name,
    layerType: node.type,
  });
}

// ─── Typography helpers ─────────────────────────────────────────────────────

function getFontFamily(node) {
  if (!node.fontName || node.fontName === figma.mixed) return 'Mixed';
  return node.fontName.family || 'Unknown';
}

function getFontSize(node) {
  if (node.fontSize === figma.mixed) return 'Mixed';
  return node.fontSize;
}

function getFontWeight(node) {
  if (!node.fontName || node.fontName === figma.mixed) return 'Mixed';
  return node.fontName.style || 'Unknown';
}

function getLineHeight(node) {
  if (!node.lineHeight || node.lineHeight === figma.mixed) return 'Mixed';
  if (node.lineHeight.unit === 'AUTO') return 'Auto';
  if (node.lineHeight.unit === 'PIXELS') return node.lineHeight.value + 'px';
  if (node.lineHeight.unit === 'PERCENT') return Math.round(node.lineHeight.value) + '%';
  return 'Unknown';
}

// ═══════════════════════════════════════════════════════════════════════════
// CORNER RADIUS SCAN
// ═══════════════════════════════════════════════════════════════════════════
// Classification (for numeric tokens):
//   "Numbers" → theme | "Collection" → primitive | other → foreign | none → no-token

async function scanCornerRadius() {
  var selection = getCappedSelection();

  if (selection.length === 0) {
    return { error: 'Select at least one frame to scan.' };
  }

  var entries = [];

  for (var i = 0; i < selection.length; i++) {
    await walkForRadius(selection[i], entries);
  }

  return { entries: entries };
}

async function walkForRadius(node, entries) {
  await collectNodeRadius(node, entries);

  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      await walkForRadius(node.children[i], entries);
    }
  }
}

async function collectNodeRadius(node, entries) {
  if (!('cornerRadius' in node)) return;

  var cornerProps = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
  var boundCorners = [];
  var hasBound = false;

  // Check BOTH uniform and per-corner bindings to find the best tier
  var uniformInfo = await getRadiusBindingRaw(node, 'cornerRadius');
  var perCornerInfos = [];
  for (var p = 0; p < cornerProps.length; p++) {
    var info = await getRadiusBindingRaw(node, cornerProps[p]);
    if (info) perCornerInfos.push(info);
  }

  // Decide which bindings to use:
  // If uniform exists, it holds the variable the user actually applied.
  // Per-corner bindings may be alias-resolved copies (primitives).
  if (uniformInfo) {
    hasBound = true;
    boundCorners.push(uniformInfo);
  } else if (perCornerInfos.length > 0) {
    hasBound = true;

    boundCorners = perCornerInfos;
  }

  if (hasBound) {
    // Group bound corners by token name to create entries
    var tokenMap = {};
    var tokenOrder = [];
    for (var b = 0; b < boundCorners.length; b++) {
      var bc = boundCorners[b];
      var key = bc.tokenName;
      if (!tokenMap[key]) {
        tokenMap[key] = {
          tier: bc.tier,
          tokenName: bc.tokenName,
          collectionName: bc.collectionName,
          value: bc.value,
          corners: [],
        };
        tokenOrder.push(key);
      }
      tokenMap[key].corners.push(bc.corner);
    }

    for (var t = 0; t < tokenOrder.length; t++) {
      var tk = tokenMap[tokenOrder[t]];
      entries.push({
        tier: tk.tier,
        tokenName: tk.tokenName,
        collectionName: tk.collectionName,
        value: tk.value,
        corners: tk.corners,
        isUniform: tk.corners.length === 4 || tk.corners.indexOf('cornerRadius') !== -1,
        layerId: node.id,
        layerName: node.name,
        layerType: node.type,
      });
    }
  } else {
    // No variable bound — check for raw radius value
    var rawRadius = node.cornerRadius;
    if (rawRadius === figma.mixed) {
      // Mixed per-corner values, no tokens
      var tl = node.topLeftRadius || 0;
      var tr = node.topRightRadius || 0;
      var bl = node.bottomLeftRadius || 0;
      var br = node.bottomRightRadius || 0;
      if (tl > 0 || tr > 0 || bl > 0 || br > 0) {
        var isUniform = (tl === tr && tr === bl && bl === br);
        entries.push({
          tier: 'no-token',
          tokenName: null,
          collectionName: null,
          value: isUniform ? tl : tl + '/' + tr + '/' + bl + '/' + br,
          corners: isUniform ? ['all'] : ['TL:' + tl, 'TR:' + tr, 'BL:' + bl, 'BR:' + br],
          isUniform: isUniform,
          layerId: node.id,
          layerName: node.name,
          layerType: node.type,
        });
      }
    } else if (rawRadius > 0) {
      entries.push({
        tier: 'no-token',
        tokenName: null,
        collectionName: null,
        value: rawRadius,
        corners: ['all'],
        isUniform: true,
        layerId: node.id,
        layerName: node.name,
        layerType: node.type,
      });
    }
  }
}

async function getRadiusBindingRaw(node, prop) {
  if (!('boundVariables' in node) || !node.boundVariables) return null;
  var binding = node.boundVariables[prop];
  if (!binding) return null;

  var b = Array.isArray(binding) ? binding[0] : binding;
  if (!b || !b.id) return null;

  var variable = await figma.variables.getVariableByIdAsync(b.id);
  if (!variable) return null;

  var collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
  var collectionName = collection ? collection.name : '';

  // Resolve the actual numeric value (follow aliases if needed)
  var value = null;
  if (collection) {
    var modeId = collection.defaultModeId;
    var raw = variable.valuesByMode[modeId];
    if (typeof raw === 'number') {
      value = raw;
    } else if (typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
      var source = await figma.variables.getVariableByIdAsync(raw.id);
      if (source) {
        var srcColl = await figma.variables.getVariableCollectionByIdAsync(source.variableCollectionId);
        if (srcColl) {
          var srcVal = source.valuesByMode[srcColl.defaultModeId];
          if (typeof srcVal === 'number') value = srcVal;
        }
      }
    }
  }

  return {
    tier: classifyRadiusTier(collectionName),
    tokenName: variable.name,
    collectionName: collectionName,
    value: value || node[prop] || 0,
    corner: prop,
    varId: variable.id,
  };
}

function classifyRadiusTier(collectionName) {
  if (collectionName === 'Numbers') return 'theme';
  if (collectionName === 'Collection') return 'primitive';
  return 'foreign';
}

// ═══════════════════════════════════════════════════════════════════════════
// BORDER WIDTH SCAN
// ═══════════════════════════════════════════════════════════════════════════
// Classification same as radius:
//   "Numbers" → theme | "Collection" → primitive | other → foreign | none → no-token

async function scanBorderWidth() {
  var selection = getCappedSelection();

  if (selection.length === 0) {
    return { error: 'Select at least one frame to scan.' };
  }

  var entries = [];

  for (var i = 0; i < selection.length; i++) {
    await walkForBorderWidth(selection[i], entries);
  }

  return { entries: entries };
}

async function walkForBorderWidth(node, entries) {
  await collectNodeBorderWidth(node, entries);

  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      await walkForBorderWidth(node.children[i], entries);
    }
  }
}

async function collectNodeBorderWidth(node, entries) {
  // Only process nodes that have strokes and strokeWeight
  if (!('strokeWeight' in node)) return;
  if (!('strokes' in node)) return;

  // Skip nodes with no visible strokes
  var strokes = node.strokes;
  if (strokes === figma.mixed || !Array.isArray(strokes) || strokes.length === 0) return;
  var hasVisibleStroke = false;
  for (var s = 0; s < strokes.length; s++) {
    if (strokes[s].visible !== false) { hasVisibleStroke = true; break; }
  }
  if (!hasVisibleStroke) return;

  var sideProps = ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'];
  var sideLabels = ['Top', 'Right', 'Bottom', 'Left'];

  // Check uniform strokeWeight binding first
  var uniformInfo = await getBorderWidthBinding(node, 'strokeWeight');

  if (uniformInfo) {
    // Uniform binding covers all sides
    entries.push({
      tier: uniformInfo.tier,
      tokenName: uniformInfo.tokenName,
      collectionName: uniformInfo.collectionName,
      value: uniformInfo.value,
      sides: ['all'],
      isUniform: true,
      layerId: node.id,
      layerName: node.name,
      layerType: node.type,
    });
    return;
  }

  // No uniform binding — check each side individually.
  // Some sides may have tokens, others may be raw values.
  var boundTokenMap = {};
  var boundTokenOrder = [];
  var unboundSides = [];

  for (var p = 0; p < sideProps.length; p++) {
    var prop = sideProps[p];
    var info = await getBorderWidthBinding(node, prop);

    if (info) {
      // This side has a token bound
      var key = info.tokenName;
      if (!boundTokenMap[key]) {
        boundTokenMap[key] = {
          tier: info.tier,
          tokenName: info.tokenName,
          collectionName: info.collectionName,
          value: info.value,
          sides: [],
        };
        boundTokenOrder.push(key);
      }
      boundTokenMap[key].sides.push(sideLabels[p]);
    } else {
      // No token — get raw value for this side
      var rawVal = (prop in node) ? node[prop] : 0;
      if (rawVal > 0) {
        unboundSides.push({ label: sideLabels[p], value: rawVal });
      }
    }
  }

  // Emit entries for token-bound sides
  for (var t = 0; t < boundTokenOrder.length; t++) {
    var tk = boundTokenMap[boundTokenOrder[t]];
    entries.push({
      tier: tk.tier,
      tokenName: tk.tokenName,
      collectionName: tk.collectionName,
      value: tk.value,
      sides: tk.sides,
      isUniform: tk.sides.length === 4,
      layerId: node.id,
      layerName: node.name,
      layerType: node.type,
    });
  }

  // Emit entries for unbound (no-token) sides
  if (unboundSides.length > 0) {
    // Group unbound sides by value
    var rawMap = {};
    var rawOrder = [];
    for (var u = 0; u < unboundSides.length; u++) {
      var rv = String(unboundSides[u].value);
      if (!rawMap[rv]) {
        rawMap[rv] = { value: unboundSides[u].value, sides: [] };
        rawOrder.push(rv);
      }
      rawMap[rv].sides.push(unboundSides[u].label);
    }

    for (var r = 0; r < rawOrder.length; r++) {
      var rg = rawMap[rawOrder[r]];
      entries.push({
        tier: 'no-token',
        tokenName: null,
        collectionName: null,
        value: rg.value,
        sides: rg.sides,
        isUniform: false,
        layerId: node.id,
        layerName: node.name,
        layerType: node.type,
      });
    }
  }

  // If nothing was bound AND nothing had raw values, check uniform raw weight
  if (boundTokenOrder.length === 0 && unboundSides.length === 0) {
    var rawWeight = node.strokeWeight;
    if (rawWeight !== figma.mixed && rawWeight > 0) {
      entries.push({
        tier: 'no-token',
        tokenName: null,
        collectionName: null,
        value: rawWeight,
        sides: ['all'],
        isUniform: true,
        layerId: node.id,
        layerName: node.name,
        layerType: node.type,
      });
    }
  }
}

async function getBorderWidthBinding(node, prop) {
  if (!('boundVariables' in node) || !node.boundVariables) return null;
  var binding = node.boundVariables[prop];
  if (!binding) return null;

  var b = Array.isArray(binding) ? binding[0] : binding;
  if (!b || !b.id) return null;

  var variable = await figma.variables.getVariableByIdAsync(b.id);
  if (!variable) return null;

  var collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
  var collectionName = collection ? collection.name : '';

  // Resolve the actual numeric value (follow aliases if needed)
  var value = null;
  if (collection) {
    var modeId = collection.defaultModeId;
    var raw = variable.valuesByMode[modeId];
    if (typeof raw === 'number') {
      value = raw;
    } else if (typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
      var source = await figma.variables.getVariableByIdAsync(raw.id);
      if (source) {
        var srcColl = await figma.variables.getVariableCollectionByIdAsync(source.variableCollectionId);
        if (srcColl) {
          var srcVal = source.valuesByMode[srcColl.defaultModeId];
          if (typeof srcVal === 'number') value = srcVal;
        }
      }
    }
  }

  return {
    tier: classifyRadiusTier(collectionName),
    tokenName: variable.name,
    collectionName: collectionName,
    value: value || node[prop] || 0,
    side: prop,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EFFECTS SCAN
// ═══════════════════════════════════════════════════════════════════════════
// Classification (like typography — via effect styles):
//   style name starts with "Athena/" → theme
//   other style name → foreign
//   no style applied → no-token

async function scanEffects() {
  var selection = getCappedSelection();

  if (selection.length === 0) {
    return { error: 'Select at least one frame to scan.' };
  }

  var entries = [];

  for (var i = 0; i < selection.length; i++) {
    await walkForEffects(selection[i], entries);
  }

  return { entries: entries };
}

async function walkForEffects(node, entries) {
  await collectNodeEffects(node, entries);

  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      await walkForEffects(node.children[i], entries);
    }
  }
}

async function collectNodeEffects(node, entries) {
  // Only process nodes that have effects
  if (!('effects' in node)) return;
  var effects = node.effects;
  if (!effects || !Array.isArray(effects) || effects.length === 0) return;

  // Check for visible effects
  var visibleEffects = [];
  for (var i = 0; i < effects.length; i++) {
    if (effects[i].visible !== false) visibleEffects.push(effects[i]);
  }
  if (visibleEffects.length === 0) return;

  // Check if an effect style is applied
  var effectStyleId = node.effectStyleId;

  if (effectStyleId && effectStyleId !== figma.mixed) {
    var style = await figma.getStyleByIdAsync(effectStyleId);
    if (style) {
      var styleName = style.name;
      var tier = styleName.indexOf('Athena/') === 0 ? 'theme' : 'foreign';

      entries.push({
        tier: tier,
        styleName: styleName,
        effectSummary: summarizeEffects(visibleEffects),
        effectCount: visibleEffects.length,
        layerId: node.id,
        layerName: node.name,
        layerType: node.type,
      });
      return;
    }
  }

  // No effect style → no-token
  entries.push({
    tier: 'no-token',
    styleName: null,
    effectSummary: summarizeEffects(visibleEffects),
    effectCount: visibleEffects.length,
    layerId: node.id,
    layerName: node.name,
    layerType: node.type,
  });
}

function summarizeEffects(effects) {
  var parts = [];
  for (var i = 0; i < effects.length; i++) {
    var e = effects[i];
    var type = e.type;
    var desc = '';

    if (type === 'DROP_SHADOW' || type === 'INNER_SHADOW') {
      var label = type === 'DROP_SHADOW' ? 'Drop Shadow' : 'Inner Shadow';
      var ox = e.offset ? e.offset.x : 0;
      var oy = e.offset ? e.offset.y : 0;
      var blur = e.radius || 0;
      var spread = e.spread || 0;
      var color = e.color ? rgbToHex(
        Math.round(e.color.r * 255),
        Math.round(e.color.g * 255),
        Math.round(e.color.b * 255)
      ) : '#000000';
      var alpha = (e.color && e.color.a !== undefined) ? Math.round(e.color.a * 100) : 100;
      desc = label + ' ' + ox + ',' + oy + ' b' + blur;
      if (spread !== 0) desc += ' s' + spread;
      desc += ' ' + color;
      if (alpha < 100) desc += ' ' + alpha + '%';
    } else if (type === 'LAYER_BLUR') {
      desc = 'Layer Blur ' + (e.radius || 0) + 'px';
    } else if (type === 'BACKGROUND_BLUR') {
      desc = 'BG Blur ' + (e.radius || 0) + 'px';
    } else {
      desc = type;
    }

    parts.push(desc);
  }
  return parts.join(' + ');
}
