/* ============================================================
   fox_harness.js —— 《狐狸快跑》网页版 node 冒烟测试机
   用法: node tools/fox_harness.js
   干什么: 把 狐狸快跑.html 里的 <script> 抠出来，配上假 DOM/假画布/
   虚拟时钟在 node 里跑，自动跳/滑/死几轮，看会不会崩。
   ============================================================ */
'use strict';
const fs = require('fs');
const vm = require('vm');
const HTML = '/Users/yangjie/我的小游戏/狐狸快跑.html';

/* —— 虚拟时钟 —— */
let NOW = 1000000;
Date.now = () => NOW;
global.performance = { now: () => NOW };

/* —— 假 2D 画布 —— */
function makeCtx(){
  const grad = () => ({ addColorStop(){} });
  return {
    canvas: null,
    save(){}, restore(){}, beginPath(){}, closePath(){}, fill(){}, stroke(){}, clip(){},
    moveTo(){}, lineTo(){}, arc(){}, arcTo(){}, ellipse(){}, rect(){}, roundRect(){},
    quadraticCurveTo(){}, bezierCurveTo(){},
    fillRect(){}, strokeRect(){}, clearRect(){}, fillText(){}, strokeText(){},
    translate(){}, rotate(){}, scale(){}, transform(){}, setTransform(){}, resetTransform(){},
    drawImage(){}, setLineDash(){}, getLineDash(){ return []; },
    measureText(t){ return { width: String(t == null ? '' : t).length * 8 }; },
    createLinearGradient: grad, createRadialGradient: grad, createPattern(){ return {}; },
    getImageData(){ return { data: new Uint8ClampedArray(4) }; }, putImageData(){},
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0,
  };
}

/* —— 万能假元素：什么属性都有、什么方法都不报错 —— */
function makeEl(id){
  const listeners = {};
  const cls = new Set(id === 'home' ? [] : ['hidden']);   // 主页默认开着,其他弹窗默认藏着(和真页面一致)
  const el = {
    id, dataset: {}, children: [], style: {},
    classList: {
      add(c){ cls.add(c); }, remove(c){ cls.delete(c); },
      toggle(c, f){ if(f === undefined){ cls.has(c) ? cls.delete(c) : cls.add(c); } else if(f){ cls.add(c); } else { cls.delete(c); } },
      contains(c){ return cls.has(c); },
    },
    textContent: '', innerHTML: '', value: '', checked: false, disabled: false, hidden: false, src: '',
    offsetWidth: 900, offsetHeight: 300, clientWidth: 900, clientHeight: 300,
    scrollTop: 0, scrollHeight: 600, naturalWidth: 0, complete: false,
    width: 900, height: 300,
    getContext(){ if(!el._ctx){ el._ctx = makeCtx(); el._ctx.canvas = el; } return el._ctx; },
    appendChild(x){ el.children.push(x); return x; }, removeChild(){}, insertBefore(){}, remove(){}, prepend(){},
    addEventListener(t, cb){ (listeners[t] = listeners[t] || []).push(cb); },
    removeEventListener(){},
    __fire(t, e){ (listeners[t] || []).forEach(cb => cb(e || { preventDefault(){}, stopPropagation(){} })); },
    querySelector(){ return makeEl('q'); }, querySelectorAll(){ return []; }, closest(){ return null; },
    getBoundingClientRect(){ return { left: 0, top: 0, width: 900, height: 300, right: 900, bottom: 300 }; },
    focus(){}, blur(){}, click(){}, select(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    play(){ return Promise.resolve(); }, pause(){},
    toDataURL(){ return 'data:image/png;base64,x'; },
  };
  return el;
}
const elCache = {};
const getEl = id => (elCache[id] = elCache[id] || makeEl(id));

/* —— 假 document / window / navigator —— */
global.document = {
  getElementById: getEl,
  createElement(tag){ return makeEl('new-' + tag); },
  createTextNode(){ return {}; },
  querySelector(){ return makeEl('q'); }, querySelectorAll(){ return []; },
  addEventListener(){}, removeEventListener(){},
  body: makeEl('body'), documentElement: makeEl('html'),
  hidden: false, visibilityState: 'visible', title: '',
  fonts: { ready: Promise.resolve(), load(){ return Promise.resolve(); } },
};
global.window = global;
global.addEventListener = (t, cb) => { (global.__winL = global.__winL || {})[t] = (global.__winL[t] || []).concat(cb); };
global.removeEventListener = () => {};
global.dispatchWin = (t, e) => { ((global.__winL || {})[t] || []).forEach(cb => cb(e)); };
global.devicePixelRatio = 2;
global.innerWidth = 900; global.innerHeight = 300;
global.location = { href: 'http://localhost/', search: '', hash: '', origin: 'http://localhost', protocol: 'http:', pathname: '/', replace(){}, reload(){} };
global.history = { replaceState(){}, pushState(){} };
Object.defineProperty(global, 'navigator', {   // node 26 自带只读 navigator，得强行覆盖
  value: {
    userAgent: 'node-harness', vibrate(){ return true; }, language: 'zh-CN',
    clipboard: { writeText(){ return Promise.resolve(); } },
    share: undefined, maxTouchPoints: 0,
  },
  writable: true, configurable: true,
});
const storage = {};
global.localStorage = {
  getItem(k){ return storage[k] === undefined ? null : storage[k]; },
  setItem(k, v){ storage[k] = String(v); },
  removeItem(k){ delete storage[k]; },
};
global.Image = function(){
  const img = { complete: false, naturalWidth: 0, onload: null, onerror: null, width: 0, height: 0 };
  let src = '';
  Object.defineProperty(img, 'src', {
    get(){ return src; },
    set(v){ src = v; img.complete = true; img.naturalWidth = 100; if(img.onload) img.onload(); },
  });
  return img;
};
global.alert = () => {}; global.confirm = () => true; global.prompt = () => '';

/* —— 假 WebAudio —— */
function gainNode(){
  return {
    gain: { value: 1, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){}, cancelScheduledValues(){} },
    connect(){ return {}; }, disconnect(){},
  };
}
global.AudioContext = function(){
  return {
    get currentTime(){ return NOW / 1000; },
    sampleRate: 44100, destination: {}, state: 'running',
    createBuffer(ch, len, sr){ const d = new Float32Array(len); return { getChannelData(){ return d; }, duration: len / sr }; },
    createBufferSource(){ return { buffer: null, connect(){ return {}; }, start(){}, stop(){}, loop: false, playbackRate: { value: 1 }, onended: null }; },
    createGain: gainNode,
    createOscillator(){ return { type: '', frequency: { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} }, detune: { value: 0 }, connect(){ return {}; }, start(){}, stop(){}, onended: null }; },
    createBiquadFilter(){ return { type: '', frequency: { value: 0, setValueAtTime(){} }, Q: { value: 1 }, gain: { value: 0 }, connect(){ return {}; } }; },
    createDynamicsCompressor(){ return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect(){ return {}; } }; },
    resume(){ return Promise.resolve(); }, close(){ return Promise.resolve(); },
  };
};
global.webkitAudioContext = global.AudioContext;

/* —— rAF 捕获 —— */
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; return 1; };
global.cancelAnimationFrame = () => {};

/* —— 抠出 <script> 并加载 + 后门导出 —— */
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/g);
if(!m){ console.log('❌ 没找到 <script> 块'); process.exit(1); }
let code = m.map(s => s.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n;\n');
code += `
;window.__T = {
  get game(){ return game; }, get player(){ return player; }, get bgTime(){ return bgTime; },
  get petPos(){ return (typeof petPos === 'undefined') ? null : petPos; },
  get save(){ return save; }, get paused(){ return paused; }, set paused(v){ paused = v; }, set resumeUntil(v){ resumeUntil = v; },
  startGame, die, startSlide, pressJump, releaseJump, revive,
};`;
vm.runInThisContext(code, { filename: '狐狸快跑.html<script>' });
const T = global.__T;

/* —— 推进 N 帧 —— */
let frames = 0;
function step(n){
  for(let i = 0; i < n; i++){
    NOW += 16.7;
    const cb = rafCb; rafCb = null;
    if(!cb) throw new Error('主循环断了');
    cb(NOW);
    frames++;
    const p = T.player;
    if(!isFinite(p.squash) || Math.abs(p.squash) > 0.51) throw new Error(`squash 出界: ${p.squash} @frame ${frames}`);
    if(!isFinite(p.y) || !isFinite(p.vy) || !isFinite(p.deadSpin)) throw new Error(`player NaN @frame ${frames}`);
  }
}
let fails = 0;
function check(name, ok){
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if(!ok) fails++;
}

/* ============ 冒烟流程（和微信版同款） ============ */
step(30);
T.startGame();
T.paused = false; T.resumeUntil = 0;
step(30);
check('开局后进入 playing', T.game.state === 'playing');

T.pressJump('key'); step(2); T.releaseJump('key');
step(10);
check('起跳离地', !T.player.grounded || T.player.y < 250);
step(80);
check('落回地面', T.player.grounded && T.player.y === 256);

T.startSlide();
check('滑铲进入', T.player.sliding === true);
step(60);
check('滑铲自动结束', T.player.sliding === false && T.player.h === 36);

for(let i = 0; i < 60; i++){
  const r = i % 6;
  if(r === 0){ T.pressJump('key'); }
  else if(r === 1){ T.releaseJump('key'); }
  else if(r === 3){ T.startSlide(); }
  step(20);
  if(T.game.state === 'dead'){ T.startGame(); T.paused = false; T.resumeUntil = 0; step(10); }
}
check('长跑 20 秒无崩溃', true);

if(T.game.state !== 'playing'){ T.startGame(); T.paused = false; T.resumeUntil = 0; step(10); }
T.die('hit');
check('撞死进入 dead', T.game.state === 'dead');
check('撞死被弹起(vy<0)', T.player.vy < 0);
step(150);
const p = T.player;
check('尸体最终落回地面', Math.abs(p.y - 256) < 0.5);
check('翻滚已停(settled)', p.deadSettled === true);
check('躺平角度≈四脚朝天(π+整圈)', Math.abs(((p.deadSpin % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) < 0.2);

T.startGame(); T.paused = false; T.resumeUntil = 0; step(10);
T.player.y = 400; T.player.vy = 300; T.player.inPit = true;
T.die('pit');
step(150);
check('掉坑死不产生 NaN', isFinite(T.player.y) && isFinite(T.player.deadSpin));

T.startGame(); T.paused = false; T.resumeUntil = 0; step(10);
T.die('hit'); step(100);
T.save.freeReviveUsed = false;
T.revive();
check('复活回 playing 且站直', T.game.state === 'playing' && T.player.deadSpin === 0 && T.player.h === 36);
step(60);

// —— 完赛/过关(finish)是胜利:绝不能演死亡翻滚 ——
if(T.game.state !== 'playing'){ T.startGame(); T.paused = false; T.resumeUntil = 0; step(10); }
T.game.state = 'dead'; T.game.deathBy = 'finish'; T.game.deadAt = T.bgTime;
step(90);
check('完赛不翻滚(deadSpin保持0)', T.player.deadSpin === 0 && T.player.deadSettled === false);
check('完赛角色站在地面', T.player.y === 256);

try{
  T.save.petOwned = T.save.petOwned || {}; T.save.petOwned.star = true; T.save.petActive = 'star';
  step(30);
  check('宠物跟随位置已初始化', T.petPos && isFinite(T.petPos.x));
}catch(e){ check('宠物跟随（出错: ' + e.message + '）', false); }

console.log(`\n共跑 ${frames} 帧虚拟时间 ${(frames * 16.7 / 1000).toFixed(1)} 秒`);
if(fails){ console.log(`\n有 ${fails} 项没过`); process.exit(1); }
console.log('全部通过 🎉');
process.exit(0);   // 循环定时器会让 node 挂着，必须强制退出
