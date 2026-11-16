const FULL = { width: 360, height: 380 };
const MINI = { width: 250, height: 76 };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/* ---------------- helpers ---------------- */
function bytesToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += chars[a >> 2] + chars[((a & 3) << 4) | ((b || 0) >> 4)];
    out += b === undefined ? '=' : chars[((b & 15) << 2) | ((c || 0) >> 6)];
    out += c === undefined ? '=' : chars[c & 63];
  }
  return out;
}

function serialize(v, depth) {
  depth = depth || 0;
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return typeof v === 'symbol' ? 'Symbol' : v;
  if (depth > 6) return '[deep]';
  if (Array.isArray(v)) return v.map((x) => serialize(x, depth + 1));
  if (typeof v.type === 'string' && typeof v.id === 'string') return { id: v.id, type: v.type, name: v.name };
  const o = {};
  for (const k of Object.keys(v)) o[k] = serialize(v[k], depth + 1);
  return o;
}

/* ---------------- declarative builder (H.build) ---------------- */
const WEIGHTS = { regular: 'Regular', medium: 'Medium', semibold: 'Semi Bold', bold: 'Bold' };
const fontCache = {};
async function loadFont(mono, weight) {
  const style = WEIGHTS[weight || 'regular'] || 'Regular';
  const want = mono ? { family: 'Roboto Mono', style: 'Regular' } : { family: 'Inter', style };
  const key = want.family + '/' + want.style;
  if (!fontCache[key]) {
    try { await figma.loadFontAsync(want); fontCache[key] = want; }
    catch (e) { const fb = { family: 'Inter', style }; await figma.loadFontAsync(fb); fontCache[key] = fb; }
  }
  return fontCache[key];
}

function rgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}
// '#hex' | ['#hex', opacity] | { g: [[pos,'#hex',alpha?],...], a: angleDeg }
function paint(v) {
  if (!v) return null;
  if (typeof v === 'string') return { type: 'SOLID', color: rgb(v) };
  if (Array.isArray(v)) return { type: 'SOLID', color: rgb(v[0]), opacity: v[1] };
  if (v.g) {
    const t = ((v.a == null ? 90 : v.a) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    return {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[c, s, 0.5 - 0.5 * c - 0.5 * s], [-s, c, 0.5 + 0.5 * s - 0.5 * c]],
      gradientStops: v.g.map((x) => ({ position: x[0], color: Object.assign(rgb(x[1]), { a: x[2] == null ? 1 : x[2] }) })),
    };
  }
  return null;
}
function fills(v) { const p = paint(v); return p ? [p] : []; }
function shadow(s) { // [hex, alpha, x, y, blur]
  return { type: 'DROP_SHADOW', color: Object.assign(rgb(s[0]), { a: s[1] }), offset: { x: s[2], y: s[3] }, radius: s[4], spread: 0, visible: true, blendMode: 'NORMAL' };
}
const ALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };

function applyCommon(n, s) {
  if (s.name) n.name = s.name;
  if (s.x != null) n.x = s.x;
  if (s.y != null) n.y = s.y;
  if (s.opacity != null) n.opacity = s.opacity;
  if (s.r != null && 'cornerRadius' in n) n.cornerRadius = s.r;
  if (s.stroke) {
    n.strokes = [paint([s.stroke[0], s.stroke[1] == null ? 1 : s.stroke[1]])];
    n.strokeWeight = s.stroke[2] || 1;
    if ('strokeAlign' in n && n.type !== 'VECTOR') n.strokeAlign = 'INSIDE';
  }
  if (s.shadow) n.effects = (Array.isArray(s.shadow[0]) ? s.shadow : [s.shadow]).map(shadow);
}

// sizing that needs the node to be inside its parent
function applySizing(n, s, parent) {
  const inAuto = parent && 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  if (inAuto) {
    if (s.w === 'fill') n.layoutSizingHorizontal = 'FILL';
    if (s.h === 'fill') n.layoutSizingVertical = 'FILL';
    if (s.grow) n.layoutGrow = 1;
  }
}

async function build(s, parent) {
  let n;
  switch (s.t || 'frame') {
    case 'text': {
      n = figma.createText();
      n.fontName = await loadFont(s.mono, s.weight);
      n.fontSize = s.size || 14;
      n.characters = String(s.s == null ? '' : s.s);
      n.fills = fills(s.color || '#000000');
      if (s.align) n.textAlignHorizontal = s.align.toUpperCase();
      if (s.lh) n.lineHeight = { unit: 'PIXELS', value: s.lh };
      if (typeof s.w === 'number') { n.textAutoResize = 'HEIGHT'; n.resize(s.w, n.height); }
      break;
    }
    case 'ellipse': {
      n = figma.createEllipse();
      n.resize(s.w || s.size || 24, s.h || s.size || 24);
      n.fills = fills(s.fill);
      if (s.arc) n.arcData = { startingAngle: s.arc[0], endingAngle: s.arc[1], innerRadius: s.arc[2] || 0 };
      break;
    }
    case 'rect': {
      n = figma.createRectangle();
      n.resize(s.w || s.size || 24, s.h || s.size || 24);
      n.fills = fills(s.fill);
      break;
    }
    case 'icon': { // SVG-like path data: M L C Q Z (no arcs)
      n = figma.createVector();
      n.vectorPaths = [{ windingRule: 'NONE', data: s.d }];
      n.fills = [];
      n.strokes = fills(s.color || '#000000');
      n.strokeWeight = s.weight || 2;
      n.strokeCap = 'ROUND'; n.strokeJoin = 'ROUND';
      if (s.size) { const k = s.size / Math.max(n.width, n.height); n.resize(n.width * k, n.height * k); }
      break;
    }
    default: { // frame
      n = figma.createFrame();
      n.fills = fills(s.fill);
      n.clipsContent = !!s.clip;
      if (s.dir) {
        n.layoutMode = s.dir === 'h' ? 'HORIZONTAL' : 'VERTICAL';
        n.primaryAxisSizingMode = 'AUTO'; n.counterAxisSizingMode = 'AUTO';
        n.itemSpacing = s.gap || 0;
        n.paddingLeft = n.paddingRight = s.px || 0;
        n.paddingTop = n.paddingBottom = s.py || 0;
        n.primaryAxisAlignItems = ALIGN[s.main || 'start'];
        n.counterAxisAlignItems = ALIGN[s.cross || 'start'] === 'SPACE_BETWEEN' ? 'MIN' : ALIGN[s.cross || 'start'];
      }
      if (parent) parent.appendChild(n);
      for (const c of s.ch || []) await build(c, n);
      if (typeof s.w === 'number' || typeof s.h === 'number') {
        const w = typeof s.w === 'number' ? s.w : n.width, h = typeof s.h === 'number' ? s.h : n.height;
        n.resize(w, h);
        if (s.dir) {
          if (typeof s.w !== 'number') n.layoutSizingHorizontal = 'HUG';
          if (typeof s.h !== 'number') n.layoutSizingVertical = 'HUG';
        }
      }
      applyCommon(n, s);
      applySizing(n, s, parent);
      return n;
    }
  }
  if (parent) parent.appendChild(n);
  applyCommon(n, s);
  applySizing(n, s, parent);
  return n;
}

function tree(n, depth, ind) {
  ind = ind || '';
  let line = ind + n.id + ' ' + n.type + ' "' + n.name + '" ' + Math.round(n.width) + 'x' + Math.round(n.height);
  if (n.type === 'TEXT') line += ' "' + n.characters.slice(0, 40) + '"';
  let out = line + '\n';
  if (depth > 0 && 'children' in n) for (const c of n.children) out += tree(c, depth - 1, ind + '  ');
  return out;
}

const H = { build, tree, rgb, paint, loadFont };

/* ---------------- message handler ---------------- */
async function onMessage(msg) {
  // служебные сообщения окна (не команды от Claude)
  if (msg.type === 'ready') {
    figma.ui.postMessage({ type: 'init', mini: !!(await figma.clientStorage.getAsync('mini')) });
    return;
  }
  if (msg.type === 'resize') {
    const s = msg.mini ? MINI : FULL;
    figma.ui.resize(s.width, s.height);
    if (msg.save) await figma.clientStorage.setAsync('mini', !!msg.mini);
    return;
  }
  if (msg.type === 'close') { figma.closePlugin(); return; }

  const reply =(payload) => figma.ui.postMessage(Object.assign({ type: 'result', id: msg.id }, payload));
  try {
    if (msg.type === 'exec') {
      const fn = new AsyncFunction('figma', 'H', msg.code);
      reply({ data: serialize(await fn(figma, H)) });
    } else if (msg.type === 'build') {
      const parent = msg.parentId ? await figma.getNodeByIdAsync(msg.parentId) : figma.currentPage;
      if (!parent || !('appendChild' in parent)) throw new Error('parentId is not a container');
      const specs = Array.isArray(msg.spec) ? msg.spec : [msg.spec];
      const made = [];
      for (const s of specs) made.push(await build(s, parent));
      reply({ data: made.map((n) => ({ id: n.id, name: n.name })) });
    } else if (msg.type === 'tree') {
      const n = msg.nodeId ? await figma.getNodeByIdAsync(msg.nodeId) : figma.currentPage;
      if (!n) throw new Error('node not found');
      reply({ data: tree(n, msg.depth == null ? 2 : msg.depth) });
    } else if (msg.type === 'screenshot') {
      const node = msg.nodeId ? await figma.getNodeByIdAsync(msg.nodeId) : figma.currentPage.selection[0];
      if (!node || !('exportAsync' in node)) throw new Error('No node: select something or pass nodeId');
      const maxSide = msg.maxSide || 800;
      const scale = msg.scale || Math.min(1, maxSide / Math.max(node.width, node.height));
      const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
      reply({ data: { mimeType: 'image/png', base64: bytesToBase64(bytes), nodeId: node.id } });
    } else if (msg.type === 'info') {
      reply({
        data: {
          file: figma.root.name,
          page: figma.currentPage.name,
          pages: figma.root.children.map((p) => p.name),
          selection: figma.currentPage.selection.map((n) => ({ id: n.id, type: n.type, name: n.name })),
        },
      });
    }
  } catch (e) {
    reply({ error: String((e && e.message) || e) });
  }
}

(async () => {
  const mini = !!(await figma.clientStorage.getAsync('mini'));
  figma.showUI(__html__, Object.assign({ themeColors: false }, mini ? MINI : FULL));
  figma.ui.onmessage = onMessage;
})();
