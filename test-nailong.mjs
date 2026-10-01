// 奶龙合成 逻辑自检 + 图标/UI 冒烟测试：node test-nailong.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const gameFile = existsSync(join(here, 'nailong.html')) ? 'nailong.html' : 'index.html';
const html = readFileSync(join(here, gameFile), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: 未找到内联脚本'); process.exit(1); }
const src = m[1];

// ---- 纯逻辑沙箱（无 DOM） ----
const fakeWindow = {};
new Function('window', src)(fakeWindow);
const Logic = fakeWindow.GAME;
const Nailong = fakeWindow.NAILONG;
if (!Logic) { console.error('FAIL: 未导出 GAME'); process.exit(1); }
if (!Nailong) { console.error('FAIL: 未导出 NAILONG'); process.exit(1); }

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('ok - ' + name);
  } catch (e) {
    fail += 1;
    console.error('FAIL - ' + name);
    console.error('  ' + (e && e.message));
  }
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sumBoard(b) { let s = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s += b[r][c]; return s; }
function isPow2(v) { return v > 0 && (v & (v - 1)) === 0; }

function isPacked(b, dir) {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (b[r][c] !== 0) continue;
      if (dir === 'left') { for (let c2 = c + 1; c2 < 4; c2++) if (b[r][c2] !== 0) return false; }
      else if (dir === 'right') { for (let c2 = 0; c2 < c; c2++) if (b[r][c2] !== 0) return false; }
      else if (dir === 'up') { for (let r2 = r + 1; r2 < 4; r2++) if (b[r2][c] !== 0) return false; }
      else { for (let r2 = 0; r2 < r; r2++) if (b[r2][c] !== 0) return false; }
    }
  }
  return true;
}

function randomBoard(rand) {
  const b = Logic.emptyBoard();
  const n = Math.floor(rand() * 17);
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) cells.push([r, c]);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rand() * cells.length);
    const cell = cells.splice(idx, 1)[0];
    b[cell[0]][cell[1]] = Math.pow(2, 1 + Math.floor(rand() * 11));
  }
  return b;
}

// ---- 奶龙图标 ----
await check('12 个等级图标均合法且互不相同', () => {
  const set = new Set();
  for (let lv = 0; lv < 12; lv++) {
    const s = Nailong.makeIcon(lv);
    assert.ok(s.indexOf('<svg') >= 0, '含 <svg');
    assert.ok(s.indexOf('</svg>') >= 0, '含 </svg>');
    assert.ok(s.indexOf('xmlns="http://www.w3.org/2000/svg"') >= 0, '含 xmlns');
    set.add(s);
  }
  assert.equal(set.size, 12, '12 个图标互不相同');
});
await check('iconDataUri 编码正确', () => {
  for (let lv = 0; lv < 12; lv++) {
    const uri = Nailong.iconDataUri(lv);
    assert.ok(uri.indexOf('data:image/svg+xml;charset=utf-8,') === 0, '前缀正确');
    const svg = decodeURIComponent(uri.split(',')[1]);
    assert.ok(svg.indexOf('<svg') >= 0 && svg.indexOf('</svg>') >= 0, '解码后为完整 SVG');
    assert.ok(uri.indexOf('#') === -1, '井号已编码，可安全用于 src');
  }
});
await check('越界等级回退到首尾图标', () => {
  assert.equal(Nailong.makeIcon(-3), Nailong.makeIcon(0), '负等级回退 0');
  assert.equal(Nailong.makeIcon(99), Nailong.makeIcon(11), '超高等级回退 11');
});

// ---- 核心规则（与 2048 同引擎） ----
await check('slideLine [2,2,2,0] -> [4,2,0,0]', () => assert.deepEqual(Logic.slideLine([2,2,2,0]).result, [4,2,0,0]));
await check('slideLine [4,4,4,4] -> [8,8,0,0]', () => assert.deepEqual(Logic.slideLine([4,4,4,4]).result, [8,8,0,0]));
await check('四方向移动', () => {
  assert.equal(Logic.move([[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], 'left').board[0][0], 4);
  assert.equal(Logic.move([[0,0,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]], 'right').board[0][3], 4);
  assert.equal(Logic.move([[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]], 'up').board[0][0], 4);
  assert.equal(Logic.move([[0,0,0,0],[0,0,0,0],[2,0,0,0],[2,0,0,0]], 'down').board[3][0], 4);
});
await check('随机棋盘 move 不变量（1500 棋盘）', () => {
  const rand = rng(42);
  for (let iter = 0; iter < 1500; iter++) {
    const b = randomBoard(rand);
    for (const dir of ['left','right','up','down']) {
      const res = Logic.move(b, dir);
      for (const row of res.board) for (const v of row) assert.ok(v === 0 || isPow2(v), '数值为 2 的幂');
      assert.equal(sumBoard(b), sumBoard(res.board), '总和守恒');
      const mgSum = res.merges.reduce((s, mg) => s + mg.value, 0);
      assert.equal(res.scoreGained, mgSum, '得分 = 合并值之和');
      if (!res.moved) assert.deepEqual(res.board, b, '未移动则棋盘一致');
      else assert.ok(isPacked(res.board, dir), '移动后沿该方向已压实');
    }
  }
});
await check('随机棋盘 resolveTiles 与棋盘一致（1500 棋盘）', () => {
  const rand = rng(2024);
  for (let iter = 0; iter < 1500; iter++) {
    const b = randomBoard(rand);
    const orig = new Map();
    let id = 1;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (b[r][c] !== 0) { orig.set(id, { id, r, c, value: b[r][c] }); id += 1; }
    }
    for (const dir of ['left','right','up','down']) {
      const res = Logic.move(b, dir);
      const copy = new Map();
      orig.forEach((t) => copy.set(t.id, { id: t.id, r: t.r, c: t.c, value: t.value }));
      const rt = Logic.resolveTiles(res, copy);
      for (const sv of rt.survivors) sv.tile.value = sv.value;
      assert.equal(rt.absorbed.size, res.merges.length, '被吸收棋子数 = 合并数');
      const cellMap = new Map();
      copy.forEach(function (t) {
        if (rt.absorbed.has(t.id)) return;
        const key = t.r + ',' + t.c;
        assert.ok(!cellMap.has(key), '一格至多一个棋子');
        cellMap.set(key, t);
      });
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const v = res.board[r][c];
          const t = cellMap.get(r + ',' + c);
          if (v === 0) assert.equal(t, undefined, '空格无棋子');
          else { assert.ok(t, '有值格有棋子'); assert.equal(t.value, v, '棋子值与棋盘一致'); }
        }
      }
    }
  }
});
await check('随机完整对局：150 局均正常结束', () => {
  const dirs = ['left','right','up','down'];
  for (let g = 0; g < 150; g++) {
    const rand = rng(5000 + g);
    let b = Logic.emptyBoard();
    Logic.addRandomTile(b, rand);
    Logic.addRandomTile(b, rand);
    let moves = 0;
    while (!Logic.isGameOver(b)) {
      let made = false;
      const order = [0,1,2,3].sort(function () { return rand() - 0.5; });
      for (let i = 0; i < 4; i++) {
        const res = Logic.move(b, dirs[order[i]]);
        if (res.moved) { b = res.board; Logic.addRandomTile(b, rand); made = true; break; }
      }
      if (!made) { assert.equal(sumBoard(b), 0, '有空格却无合法移动'); break; }
      moves += 1;
      assert.ok(moves < 50000, '对局步数异常');
    }
  }
});

// ---- UI 冒烟测试（DOM 桩） ----
function makeFakeEl() {
  return {
    style: {},
    children: [],
    className: '',
    textContent: '',
    clientWidth: 400,
    offsetWidth: 0,
    disabled: false,
    removed: false,
    src: '',
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); }
    },
    appendChild(ch) { this.children.push(ch); return ch; },
    addEventListener() {},
    remove() { this.removed = true; },
    querySelector(sel) { return makeFakeEl(); }
  };
}

await check('UI 冒烟：初始化渲染图标 + 键盘移动不抛异常', async () => {
  const registry = new Map();
  const handlers = {};
  const doc = {
    getElementById(id) {
      if (!registry.has(id)) registry.set(id, makeFakeEl());
      return registry.get(id);
    },
    createElement() { return makeFakeEl(); },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  };
  const win = {
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {}
  };
  new Function('window', 'document', src)(win, doc);
  const grid = registry.get('grid');
  const layer = registry.get('layer');
  assert.equal(grid.children.length, 16, '背景 16 格');
  assert.equal(layer.children.length, 2, '初始 2 个棋子');
  // 每个棋子：face 内含 img(奶龙图标) + badge(数值)
  for (const tile of layer.children) {
    const face = tile.children[0];
    assert.ok(face && face.children.length === 2, 'face 含 img 与 badge');
    const img = face.children[0];
    assert.ok(img.src.indexOf('data:image/svg+xml;charset=utf-8,') === 0, '图标为内联 SVG');
    const badge = face.children[1];
    assert.ok(badge.textContent === 2 || badge.textContent === 4, 'badge 显示数值');
  }
  assert.equal(String(registry.get('score').textContent), '0', '分数显示 0');
  assert.equal(registry.get('overlay').classList.contains('hidden'), true, '初始无弹层');
  assert.ok(handlers.keydown && handlers.keydown.length >= 2, '键盘处理器已注册');
  handlers.keydown[1]({ key: 'ArrowLeft', preventDefault() {} });
  await new Promise((r) => setTimeout(r, 400));
  const count = layer.children.filter((c) => !c.removed).length;
  assert.ok(count === 2 || count === 3, '移动+生成后棋子数应为 2 或 3，实际 ' + count);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
