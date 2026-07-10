/* ============================================================
   wxgame_harness.js —— 《狐狸快跑呀》微信小游戏版 node 冒烟测试机
   用法: node tools/wxgame_harness.js
   干什么: 不用真机、不用开发者工具，直接在 node 里把 game.js 跑起来——
   模拟 wx 环境 + 假画布 + 虚拟时钟，自动跳/滑/死几轮，看会不会崩。
   ============================================================ */
'use strict';
const fs = require('fs');
const vm = require('vm');
const GAME = '/Users/yangjie/我的小游戏/微信小游戏/game.js';

/* —— 虚拟时钟：接管 Date.now，测试想跑多快跑多快 —— */
let NOW = 1000000;
Date.now = () => NOW;

/* —— 假 2D 画布：所有绘制都是空操作，只求"调用不崩" —— */
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
function makeCanvas(w, h){
  const c = { width: w || 1170, height: h || 540 };
  const cx = makeCtx(); cx.canvas = c;
  c.getContext = () => cx;
  return c;
}

/* —— 假 WebAudio：合成音效走这里，全部空转 —— */
function makeAC(){
  const gainNode = () => ({
    gain: { value: 1, setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){}, cancelScheduledValues(){} },
    connect(){ return {}; }, disconnect(){},
  });
  return {
    get currentTime(){ return NOW / 1000; },
    sampleRate: 44100, destination: {}, state: 'running',
    createBuffer(ch, len, sr){ const d = new Float32Array(len); return { getChannelData(){ return d; }, duration: len / sr }; },
    createBufferSource(){ return { buffer: null, connect(){ return {}; }, start(){}, stop(){}, loop: false, playbackRate: { value: 1 }, onended: null }; },
    createGain: gainNode,
    createOscillator(){ return { type: '', frequency: { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} }, detune: { value: 0 }, connect(){ return {}; }, start(){}, stop(){}, onended: null }; },
    createBiquadFilter(){ return { type: '', frequency: { value: 0, setValueAtTime(){} }, Q: { value: 1 }, gain: { value: 0 }, connect(){ return {}; } }; },
    createDynamicsCompressor(){ return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect(){ return {}; } }; },
    resume(){ return Promise.resolve(); }, suspend(){ return Promise.resolve(); }, close(){ return Promise.resolve(); },
  };
}

/* —— 假 wx 接口层 —— */
const storage = {};
const touchHandlers = { start: [], move: [], end: [], cancel: [] };
global.wx = {
  getWindowInfo(){ return { windowWidth: 780, windowHeight: 360, pixelRatio: 1.5, safeArea: { left: 40, right: 780, top: 0, bottom: 360 } }; },
  getSystemInfoSync(){ return this.getWindowInfo(); },
  createCanvas(){ return makeCanvas(); },
  createImage(){
    const img = { complete: false, naturalWidth: 0, width: 0, height: 0, onload: null, onerror: null };
    let src = '';
    Object.defineProperty(img, 'src', {
      get(){ return src; },
      set(v){ src = v; img.complete = true; img.naturalWidth = 100; img.width = 100; img.height = 100; if(img.onload) img.onload(); },
    });
    return img;
  },
  createWebAudioContext(){ return makeAC(); },
  createRewardedVideoAd(){ return { onLoad(){}, onError(){}, offError(){}, offLoad(){}, load(){ return Promise.resolve(); }, show(){ return Promise.resolve(); }, onClose(){} }; },
  getMenuButtonBoundingClientRect(){ return { left: 690, right: 770, top: 6, bottom: 32, width: 80, height: 26 }; },
  getLaunchOptionsSync(){ return { query: {} }; },
  getOpenDataContext(){ return { postMessage(){}, canvas: makeCanvas() }; },
  getStorageSync(k){ return storage[k] === undefined ? '' : storage[k]; },
  setStorageSync(k, v){ storage[k] = v; },
  removeStorageSync(k){ delete storage[k]; },
  onHide(){}, onShow(){}, onWindowResize(){},
  onTouchStart(cb){ touchHandlers.start.push(cb); },
  onTouchMove(cb){ touchHandlers.move.push(cb); },
  onTouchEnd(cb){ touchHandlers.end.push(cb); },
  onTouchCancel(cb){ touchHandlers.cancel.push(cb); },
  onKeyboardConfirm(){}, showKeyboard(){}, hideKeyboard(){},
  onShareAppMessage(){}, onShareTimeline(){}, shareAppMessage(){}, showShareMenu(){},
  setUserCloudStorage(){}, setClipboardData(){}, setKeepScreenOn(){},
  showToast(){}, vibrateShort(){},
  chooseImage(){}, canvasToTempFilePath(o){ if(o && o.success) o.success({ tempFilePath: 'mock://share.png' }); },
};
global.GameGlobal = global;

/* —— rAF 捕获：主循环的每一帧由测试机手动推进 —— */
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; return 1; };
global.cancelAnimationFrame = () => {};

/* —— 加载游戏 + 追加"后门"导出（拿到 const/let 的内部状态） —— */
let code = fs.readFileSync(GAME, 'utf8');
code += `
;GameGlobal.__T = {
  get game(){ return game; }, get player(){ return player; }, get bgTime(){ return bgTime; },
  get petPos(){ return (typeof petPos === 'undefined') ? null : petPos; },
  get save(){ return save; }, get paused(){ return paused; }, set paused(v){ paused = v; },
  startGame, die, startSlide, pressJump, releaseJump,
};`;
vm.runInThisContext(code, { filename: 'game.js' });
const T = global.__T;

/* —— 推进 N 帧（每帧 16.7 毫秒虚拟时间） —— */
let frames = 0;
function step(n){
  for(let i = 0; i < n; i++){
    NOW += 16.7;
    const cb = rafCb; rafCb = null;
    if(!cb) throw new Error('主循环断了：requestAnimationFrame 没有被续上');
    cb(NOW);
    frames++;
    const p = T.player;
    // 每帧体检：形变必须有界、坐标必须是有效数字
    if(!isFinite(p.squash) || Math.abs(p.squash) > 0.51) throw new Error(`squash 出界: ${p.squash} @frame ${frames}`);
    if(!isFinite(p.y) || !isFinite(p.vy) || !isFinite(p.deadSpin)) throw new Error(`player 出现 NaN @frame ${frames}: y=${p.y} vy=${p.vy} spin=${p.deadSpin}`);
  }
}

let fails = 0;
function check(name, ok){
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if(!ok) fails++;
}

/* ============ 冒烟流程 ============ */
step(30);                      // 主页空转
T.startGame();
T.paused = false;              // 有些入口会带 3-2-1 倒计时，直接放行
step(30);
check('开局后进入 playing', T.game.state === 'playing');

// 普通单跳（按下→两帧后松开）
T.pressJump('pointer'); step(2); T.releaseJump('pointer');
step(10);
check('起跳离地', !T.player.grounded || T.player.y < 250);
// 等落地
step(80);
check('落回地面', T.player.grounded && T.player.y === 256);

// 二段跳（需要角色支持才有空翻；橙狐单跳,flipT 不强求）
T.pressJump('pointer'); step(2); T.releaseJump('pointer');
step(3);
T.pressJump('pointer'); step(2); T.releaseJump('pointer');
step(90);

// 滑铲
T.startSlide();
check('滑铲进入', T.player.sliding === true);
step(60);
check('滑铲自动结束', T.player.sliding === false && T.player.h === 36);

// 长跑 20 秒：随机跳/滑，考验综合稳定性
for(let i = 0; i < 60; i++){
  const r = i % 6;
  if(r === 0){ T.pressJump('pointer'); }
  else if(r === 1){ T.releaseJump('pointer'); }
  else if(r === 3){ T.startSlide(); }
  step(20);
  if(T.game.state === 'dead'){ T.startGame(); T.paused = false; step(10); }
}
check('长跑 20 秒无崩溃', true);

// —— 死亡小剧场：撞死 ——
if(T.game.state !== 'playing'){ T.startGame(); T.paused = false; step(10); }
T.die('hit');
check('撞死进入 dead', T.game.state === 'dead');
check('撞死被弹起(vy<0)', T.player.vy < 0);
step(150);   // 2.5 秒：弹起→翻滚→砸地→躺平
const p = T.player;
check('尸体最终落回地面', Math.abs(p.y - 256) < 0.5);
check('翻滚已停(settled)', p.deadSettled === true);
check('躺平角度≈四脚朝天(π+整圈)', Math.abs(((p.deadSpin % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) < 0.2);

// —— 死亡小剧场：掉坑 ——
T.startGame(); T.paused = false; step(10);
T.player.y = 400; T.player.vy = 300; T.player.inPit = true;   // 手动塞进坑里
T.die('pit');
step(150);
check('掉坑死不产生 NaN', isFinite(T.player.y) && isFinite(T.player.deadSpin));

// —— 复活后站直 ——
T.startGame(); T.paused = false; step(10);
T.die('hit'); step(100);
T.save.freeReviveUsed = false;
const revive = global.revive || (() => {});
revive();
check('复活回 playing 且站直', T.game.state === 'playing' && T.player.deadSpin === 0 && T.player.h === 36);
step(60);


// —— 完赛/过关(finish)是胜利:绝不能演死亡翻滚 ——
if(T.game.state !== 'playing'){ T.startGame(); T.paused = false; step(10); }
T.game.state = 'dead'; T.game.deathBy = 'finish'; T.game.deadAt = T.bgTime;
step(90);
check('完赛不翻滚(deadSpin保持0)', T.player.deadSpin === 0 && T.player.deadSettled === false);
check('完赛角色站在地面', T.player.y === 256);

// —— 宠物跟随 ——
try{
  T.save.petOwned = T.save.petOwned || {}; T.save.petOwned.star = true; T.save.petActive = 'star';
  step(30);
  check('宠物跟随位置已初始化', T.petPos && isFinite(T.petPos.x));
}catch(e){ check('宠物跟随（跳过: ' + e.message + '）', false); }

console.log(`\n共跑 ${frames} 帧虚拟时间 ${(frames * 16.7 / 1000).toFixed(1)} 秒`);
if(fails){ console.log(`\n有 ${fails} 项没过`); process.exit(1); }
console.log('全部通过 🎉');
process.exit(0);   // 游戏里有循环定时器（音乐调度），必须强制退出，否则 node 会挂着不走
