import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import WebSocket, { WebSocketServer } from 'ws';
import { z } from 'zod';

const PORT = Number(process.env.FIGMA_BRIDGE_PORT || 3055);
const HOST = '127.0.0.1';
const TIMEOUT_MS = 30000;
const NO_PLUGIN = 'Плагин Figma не подключён. Открой файл в Figma Desktop и запусти плагин "Claude Code Bridge".';

// ВАЖНО: в stdio-режиме stdout занят MCP, логи только в stderr
const log = (...a) => console.error('[figma-bridge]', ...a);

let seq = 0;
const pending = new Map(); // id -> { resolve, reject, timer } | { remote, origId, timer }

// ---------- Режим 1: ХАБ (первый процесс, занявший порт) ----------
let isHub = false;
let plugin = null;

function startHub() {
  // Пускаем только плагин Figma (Origin "null" / figma.com) и процессы без Origin (Claude Code).
  // Обычные сайты в браузере всегда шлют свой http(s)-Origin и получают отказ.
  const originOk = (origin) => !origin || origin === 'null' || /^https:\/\/([a-z0-9-]+\.)*figma\.com$/i.test(origin);
  const wss = new WebSocketServer({
    host: HOST,
    port: PORT,
    verifyClient: (info, done) => {
      const origin = info.origin || info.req.headers.origin;
      if (originOk(origin)) return done(true);
      log('Отклонено подключение с сайта:', origin);
      done(false, 403, 'Forbidden');
    },
  });
  wss.on('listening', () => { isHub = true; log(`Хаб: слушаю ws://localhost:${PORT}`); });
  wss.on('error', (e) => {
    if (e.code === 'EADDRINUSE') startClient();
    else log('Ошибка WebSocket:', e.message);
  });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.role === 'plugin') { plugin = ws; log('Плагин Figma подключён'); return; }
      if (msg.role === 'mcp') { ws.isMcp = true; log('Подключился другой MCP-процесс'); return; }

      if (ws.isMcp) {
        // запрос от другого процесса Claude Code -> пересылаем плагину
        if (!plugin || plugin.readyState !== 1) {
          return ws.send(JSON.stringify({ id: msg.id, error: NO_PLUGIN }));
        }
        const hid = ++seq;
        const timer = setTimeout(() => {
          pending.delete(hid);
          ws.send(JSON.stringify({ id: msg.id, error: 'Таймаут ответа от Figma' }));
        }, TIMEOUT_MS);
        pending.set(hid, { remote: ws, origId: msg.id, timer });
        plugin.send(JSON.stringify({ ...msg, id: hid }));
        return;
      }

      // ответ плагина
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (p.remote) {
        if (p.remote.readyState === 1) p.remote.send(JSON.stringify({ id: p.origId, data: msg.data, error: msg.error }));
      } else {
        msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.data);
      }
    });
    ws.on('close', () => {
      if (plugin === ws) { plugin = null; log('Плагин отключён'); }
    });
  });
}

// ---------- Режим 2: КЛИЕНТ (порт уже занят другим мостом) ----------
let client = null;

function startClient() {
  isHub = false;
  const ws = new WebSocket(`ws://${HOST}:${PORT}`);
  ws.on('open', () => {
    client = ws;
    ws.send(JSON.stringify({ role: 'mcp' }));
    log('Клиент: подключился к хабу на порту', PORT);
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.data);
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    client = null;
    // хаб пропал — пробуем стать хабом сами
    setTimeout(startHub, 500 + Math.random() * 1000);
  });
}

// ---------- Вызов команды ----------
function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const target = isHub ? plugin : client;
    if (!target || target.readyState !== 1) {
      return reject(new Error(isHub ? NO_PLUGIN : 'Нет связи с хабом моста. Повтори через пару секунд.'));
    }
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Таймаут ответа от Figma'));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    target.send(JSON.stringify({ type, id, ...payload }));
  });
}

startHub();

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message || e) }] });

const server = new McpServer({ name: 'figma-claude-bridge', version: '1.2.0' });

const BUILD_DOC = `Build a node tree from compact JSON (cheapest way to create UI). Node: {t:'frame'|'text'|'ellipse'|'rect'|'icon', name, ch:[children]}.
frame: dir:'h'|'v' (auto-layout), gap, px, py, main/cross:'start'|'center'|'end'|'between', w/h: number | 'fill', grow:1, fill, r(radius), stroke:[hex,opacity,weight], shadow:[hex,alpha,x,y,blur], clip:1, x,y.
text: s, size, weight:'regular'|'medium'|'semibold'|'bold', color, mono:1, w. ellipse/rect: size|w,h, fill, arc:[startRad,endRad] (ellipse). icon: d (path data M L C Q Z, no arcs), size, color, weight.
Colors: '#hex' | ['#hex',opacity] | {g:[[pos,'#hex',alpha?],...],a:angleDeg}. Fonts load automatically. Returns ids.`;

server.tool('figma_build', BUILD_DOC,
  { spec: z.any().describe('Node or array of nodes'), parentId: z.string().optional().describe('Container id; default current page') },
  async ({ spec, parentId }) => { try { return ok(await call('build', { spec, parentId })); } catch (e) { return fail(e); } });

server.tool('figma_tree', 'Compact text outline of a node subtree (id type name size text). Use instead of screenshots to inspect structure.',
  { nodeId: z.string().optional(), depth: z.number().optional().describe('default 2') },
  async ({ nodeId, depth }) => { try { return { content: [{ type: 'text', text: await call('tree', { nodeId, depth }) }] }; } catch (e) { return fail(e); } });

server.tool('figma_info', 'Open file name, current page, pages, selection.', {},
  async () => { try { return ok(await call('info')); } catch (e) { return fail(e); } });

server.tool('figma_execute', 'Run JS (async function body) with `figma` (Plugin API) and `H` (helpers: await H.build(spec,parent), H.tree(node,depth)). Use for edits that figma_build cannot express. Load fonts before editing text. Return a value with `return`.',
  { code: z.string() },
  async ({ code }) => { try { return ok(await call('exec', { code })); } catch (e) { return fail(e); } });

server.tool('figma_screenshot', 'PNG of a node or selection, downscaled to maxSide (default 800px). Costs many tokens: use once at the end, not after every step.',
  { nodeId: z.string().optional(), maxSide: z.number().optional(), scale: z.number().optional() },
  async ({ nodeId, maxSide, scale }) => {
    try {
      const r = await call('screenshot', { nodeId, maxSide, scale });
      return { content: [{ type: 'image', data: r.base64, mimeType: r.mimeType }] };
    } catch (e) { return fail(e); }
  });

await server.connect(new StdioServerTransport());
log('MCP-сервер запущен');
