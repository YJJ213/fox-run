"use strict";
/* ============================================================
   《狐狸快跑》—— 一个单文件 HTML5 跑酷小游戏

   双击这个文件就能在浏览器里玩，发给朋友也只需要传这一个文件。

   代码导览（想学的话建议按这个顺序读）：
     1.  常量配置     —— 想调手感和难度，改这里的数字就行
     2.  画布与缩放
     3.  工具函数
     4.  音效与背景音乐 —— 全部用代码现场合成，不需要任何音频文件
     5.  游戏全局状态
     6.  玩家与角色   —— 角色表 CHARS：长相、连跳/滑翔能力、价格
     7.  输入处理     —— 键盘 + 鼠标 + 触屏
     8.  开始 / 死亡 / 重开
     9.  粒子特效
     10. 障碍物与金币的生成
     11. 每帧更新（游戏规则都在这）
     12. 背景与世界绘制（昼夜循环、视差远山）
     13. 界面文字
     14. 渲染一帧
     15. 商店
     16. 主循环

   常用改装指南：
     · 想跳得更高      → 把 JUMP_VY 改成 -900 试试
     · 想更快/更慢     → SPEED_START / SPEED_MAX / SPEED_RAMP
     · 障碍更密/更稀   → update() 里 distToObstacle 的公式
     · 角色/能力/价格  → CHARS（想加新动物：在那里加一行，再到 drawCharacter 里画它）
     · 换背景音乐      → BGM_MELODY / BGM_BASS 里的音符数字
     · 想恢复"撞到就死" → 把 ENDLESS 改成 false
     · 道具时长/效果   → POWER_DUR 和 activatePower()
     · 坑的宽度/出现率 → spawnObstacle 开头的 pits 部分
     · 商店货架与价格  → SHOP_GOODS
   ============================================================ */

/* ========== 1. 常量配置 ========== */
const W = 900, H = 300;        // 游戏画面的逻辑尺寸（实际显示会等比缩放）
const GROUND_Y = 256;          // 地面顶端的 y 坐标。注意：画布的 y 轴朝下，0 在最上方，数字越大越靠下
const GRAVITY  = 2400;         // 重力加速度（像素/秒²）
const JUMP_VY  = -820;         // 起跳瞬间的向上速度（负数代表向上）
const JUMP_CUT = -420;         // 提前松开跳跃键时，上升速度立刻衰减到这个值 →"长按跳更高"（越接近 0，轻点跳得越矮）
const SPEED_START = 330;       // 初始奔跑速度
const SPEED_MAX   = 740;       // 速度上限
const SPEED_RAMP  = 9;         // 每秒增加多少速度（难度曲线）
const COYOTE = 0.08;           // 土狼时间：离开地面后这么多秒内仍允许起跳（经典手感技巧）
const BUFFER = 0.12;           // 跳跃缓冲：落地前这么多秒内按下的跳跃，落地瞬间会自动执行
const CYCLE  = 80;             // 昼夜循环一圈的秒数
const ENDLESS = true;          // true=撞障碍只扣分不致死（但掉坑永远是致命的！）；false=撞到障碍也直接结束

/* ========== 2. 画布与缩放 ========== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// 让画布在任何屏幕（包括高分屏）上都清晰：
// 内部像素 = CSS 尺寸 × devicePixelRatio，再用 transform 把坐标系映射回 900×300
function resize(){
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssW * dpr * H / W);
  canvas.style.height = (cssW * H / W) + 'px';
  ctx.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0);
}
window.addEventListener('resize', resize);
resize();

/* ========== 3. 工具函数 ========== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand  = (a, b) => a + Math.random() * (b - a);
const FONT  = '"PingFang SC","Microsoft YaHei",sans-serif';
const TAU   = Math.PI * 2;   // 一整圈的弧度（= 2π）。画圆的角度用"弧度"表示，转一整圈就是 TAU

// 圆角矩形路径（老一点的浏览器没有自带的 roundRect，所以自己写一个）
function rr(x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
function hexToRgb(h){
  return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
}
function lerpColor(a, b, t){
  const A = hexToRgb(a), B = hexToRgb(b);
  return 'rgb(' + Math.round(A[0]+(B[0]-A[0])*t) + ',' +
                  Math.round(A[1]+(B[1]-A[1])*t) + ',' +
                  Math.round(A[2]+(B[2]-A[2])*t) + ')';
}
const smooth = t => t * t * (3 - 2 * t);   // 让过渡更柔和的小函数

/* ========== 4. 音效 ========== */
let actx = null, muted = false;
try{ muted = localStorage.getItem('fox_muted') === '1'; }catch(e){}

// 浏览器规定：声音必须在用户第一次点击/按键之后才能播放，所以在输入事件里调它
let masterGain = null;   // 总音量开关：所有声音都先经过它，静音=拧到 0（已经发出的音也立刻消失）
function ensureAudio(){
  if(!actx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(AC){
      actx = new AC();
      masterGain = actx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(actx.destination);
    }
  }
  // 只要不在播放状态就尝试恢复（iOS 上来电/切后台会把状态变成 'interrupted'）
  if(actx && actx.state !== 'running') actx.resume().catch(() => {});
}
// 万能小喇叭：给定起始频率、结束频率、时长、波形，就能合成一个音效
function beep(o){
  if(muted || !actx) return;
  const f0 = o.f0, f1 = (o.f1 === undefined ? o.f0 : o.f1);
  const dur = o.dur || 0.1, type = o.type || 'square';
  const vol = o.vol || 0.045, delay = o.delay || 0;
  const t = actx.currentTime + delay;
  const osc = actx.createOscillator(), g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t); osc.stop(t + dur + 0.05);
}
const sfx = {
  jump(mult){ const m = mult || 1;   // mult 越大音调越高（连跳的第二、三段用）
              beep({f0:340*m, f1:680*m, dur:0.13, type:'square', vol:0.04}); },
  land(){ beep({f0:160,  f1:90,   dur:0.07, type:'triangle', vol:0.035}); },
  coin(){ beep({f0:1175, dur:0.06, type:'sine', vol:0.05});
          beep({f0:1568, dur:0.09, type:'sine', vol:0.05, delay:0.06}); },
  hit(){  beep({f0:220,  f1:90,   dur:0.18, type:'sawtooth', vol:0.05 }); },
  power(){ beep({f0:523, dur:0.08, type:'square', vol:0.05});               // 吃到道具：上行琶音
           beep({f0:659, dur:0.08, type:'square', vol:0.05, delay:0.08});
           beep({f0:784, dur:0.14, type:'square', vol:0.05, delay:0.16}); },
  smash(){ beep({f0:140, f1:60, dur:0.12, type:'square',   vol:0.06});      // 撞碎障碍
           beep({f0:90,  f1:40, dur:0.16, type:'sawtooth', vol:0.05, delay:0.02}); },
  die(){  // 经典"游戏结束"下行小旋律：噔-噔-噔-噔……咚
    beep({f0:659, dur:0.12, type:'square',   vol:0.05});
    beep({f0:622, dur:0.12, type:'square',   vol:0.05, delay:0.13});
    beep({f0:587, dur:0.12, type:'square',   vol:0.05, delay:0.26});
    beep({f0:554, dur:0.26, type:'square',   vol:0.05, delay:0.39});
    beep({f0:277, dur:0.5,  type:'triangle', vol:0.07, delay:0.55});
    beep({f0:262, dur:0.8,  type:'triangle', vol:0.07, delay:0.75});
  },
};
/* —— 功能图标用内联 SVG（emoji 是深灰色、压在深色按钮上看不清，各手机渲染还不一致） —— */
const SVG_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
const SVG_PLAY  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
const SVG_CART  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM7.2 14h9.9c.8 0 1.4-.4 1.8-1.1L23 5H6.2L5.3 3H2v2h2l3.6 7.6-1.4 2.4C5.5 16.4 6.5 18 8 18h12v-2H8l-.8-2z"/></svg>';
const SVG_VOL_ON  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
const SVG_VOL_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4-2.7-2.7z"/></svg>';
const muteBtn = document.getElementById('muteBtn');
function refreshMuteBtn(){ muteBtn.innerHTML = muted ? SVG_VOL_OFF : SVG_VOL_ON; }
document.getElementById('shopBtn').innerHTML = SVG_CART;
refreshMuteBtn();
function toggleMute(){
  muted = !muted;
  try{ localStorage.setItem('fox_muted', muted ? '1' : '0'); }catch(e){}
  refreshMuteBtn();
  if(masterGain) masterGain.gain.value = muted ? 0 : 1;   // 总闸立刻生效，连已排队的音符都会消失
  if(muted) stopBGM();
  else { ensureAudio(); startBGM(); }   // 取消静音时把音乐续上
}
muteBtn.addEventListener('click', () => { toggleMute(); muteBtn.blur(); });
const pauseBtn = document.getElementById('pauseBtn');
pauseBtn.addEventListener('click', function(){
  if(game.state === 'playing'){
    if(!paused) paused = true;
    else if(!resumeUntil) resumeUntil = performance.now() + 1500;   // 恢复前先 3-2-1
  }
  this.blur();
});
const reviveBtn = document.getElementById('reviveBtn');
reviveBtn.addEventListener('click', function(){ revive(); this.blur(); });
/* —— 首次进入引导：上传照片创建主角 —— */
const avatarAskEl = document.getElementById('avatarAsk');
function avatarAskOpen(){ return !avatarAskEl.classList.contains('hidden'); }
let startAfterAvatar = false;   // 弹窗关闭后是否直接开局
document.getElementById('avatarAskUp').addEventListener('click', () => {
  document.getElementById('avatarFile').click();
});
document.getElementById('avatarAskSkip').addEventListener('click', () => {
  save.skippedAvatar = true; saveSave();
  avatarAskEl.classList.add('hidden');
  if(startAfterAvatar){ startAfterAvatar = false; startGame(); }
});

/* —— 背景音乐：三首小曲子，跑得越远节奏越快（0~2500米 / 2500~5000 / 5000+） —— */
// 数字是 MIDI 音高（69 = 标准音 A4，每 +12 升一个八度），0 = 休止符
const BGM_TRACKS = [
  { step: 0.25,   // 第一乐章：悠闲（C→G→Am→F 万能四和弦）
    melody: [ 76,79,84,79, 76,79,72,76,  74,79,83,79, 74,79,71,74,
              76,81,84,81, 76,81,72,76,  77,81,84,81, 77,84,81,77 ],
    bass:   [ 48,55,48,55, 43,50,43,50, 45,52,45,52, 41,48,41,48 ] },
  { step: 0.22,   // 第二乐章：加速（Am→F→C→G，更有冲劲）
    melody: [ 81,84,88,84, 81,84,76,81,  77,81,84,81, 77,81,72,77,
              76,79,84,79, 76,79,72,76,  79,83,86,83, 79,83,74,79 ],
    bass:   [ 45,52,45,52, 41,48,41,48, 48,55,48,55, 43,50,43,50 ] },
  { step: 0.19,   // 第三乐章：狂飙（Em→C→G→D，高潮段）
    melody: [ 76,79,83,88, 83,79,76,79,  72,76,79,84, 79,76,72,76,
              79,83,86,91, 86,83,79,83,  74,78,81,86, 81,78,74,78 ],
    bass:   [ 40,47,40,47, 36,43,36,43, 43,50,43,50, 38,45,38,45 ] },
];
// 当前该放第几乐章：按本局跑的里程分段
function bgmTier(){
  if(game.state !== 'playing') return 0;
  const m = game.runDist / 12;
  return m >= 5000 ? 2 : m >= 2500 ? 1 : 0;
}
const bgm = { on: false, step: 0, nextTime: 0, timer: null };

function midiToFreq(m){ return 440 * Math.pow(2, (m - 69) / 12); }
function playNote(midi, t, dur, type, vol){
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = midiToFreq(midi);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(masterGain);
  o.start(t); o.stop(t + dur + 0.05);
}
// WebAudio 的常用玩法：用一个普通定时器，把"接下来一秒多"的音符提前排进播放队列
function scheduleBGM(){
  if(!actx || muted) return;
  if(paused || document.hidden) return;   // 暂停或切到后台时，音乐也跟着停
  // 停了一阵子（暂停/后台回来）的话，把排队起点拉回"现在"，避免一瞬间补播一堆旧音符
  if(bgm.nextTime < actx.currentTime) bgm.nextTime = actx.currentTime + 0.05;
  const trk = BGM_TRACKS[bgmTier()];
  while(bgm.nextTime < actx.currentTime + 1.2){
    const i = bgm.step % trk.melody.length;
    if(trk.melody[i]) playNote(trk.melody[i], bgm.nextTime, trk.step * 0.9, 'square', 0.013);
    if(i % 2 === 0){
      const b = trk.bass[(i / 2) % trk.bass.length];
      if(b) playNote(b, bgm.nextTime, trk.step * 1.7, 'triangle', 0.028);
    }
    bgm.nextTime += trk.step;
    bgm.step++;
  }
}
function startBGM(){
  if(bgm.on || muted || !actx) return;
  bgm.on = true;
  bgm.nextTime = actx.currentTime + 0.05;
  bgm.timer = setInterval(scheduleBGM, 300);
  scheduleBGM();
}
function stopBGM(){
  if(bgm.timer){ clearInterval(bgm.timer); bgm.timer = null; }
  bgm.on = false;
}

/* ========== 5. 游戏全局状态 ========== */
/* —— 存档：钱包金币、皮肤、强化等级（存在浏览器里，关掉网页也不会丢） —— */
function loadSave(){
  const def = { coins: 0, gems: 0, char: 'fox', chars: ['fox'], durLevel: 0,
                avatar: null, useAvatar: false, skippedAvatar: false,
                mount: false, pet: false, board: false, moth: false,
                runs: 0, pitsSeen: 0, freeReviveUsed: false, nick: '',
                lastLogin: '', streak: 0, daily: null, dailyRun: null,
                bestDist: 0, lastBeat: '', skins: {}, skinOn: {} };
  try{
    const s = JSON.parse(localStorage.getItem('fox_save'));
    if(s && typeof s === 'object'){
      const out = Object.assign({}, def, s);
      // 老版本存的是"皮肤"（skin/owned）：自动退款，迁移到新的角色系统
      if(s.owned){
        if(s.owned.includes('snow'))  out.coins += 300;
        if(s.owned.includes('night')) out.coins += 800;
        delete out.skin; delete out.owned;
      }
      if(!Array.isArray(out.chars) || out.chars.length === 0) out.chars = ['fox'];
      if(typeof out.char !== 'string') out.char = 'fox';
      return out;
    }
  }catch(e){}
  return def;
}
const save = loadSave();
function saveSave(){
  try{ localStorage.setItem('fox_save', JSON.stringify(save)); }catch(e){}
}

/* —— 表情系统：撞到=痛苦，吃道具/撞碎=开心，阵亡=X 眼 —— */
const face = { mood: '', until: 0 };   // mood: 'hurt'=痛 | 'joy'=开心 | ''=平常
function setFace(mood, dur){ face.mood = mood; face.until = bgTime + dur; }

/* —— 真人头像：用户上传的照片（存在存档里，角色的头会换成它） —— */
let avatarImg = null;
function loadAvatarImg(){
  if(!save.avatar || typeof Image === 'undefined') return;
  avatarImg = new Image();
  avatarImg.src = save.avatar;
}
loadAvatarImg();

let best = 0;
try{ best = parseInt(localStorage.getItem('fox_best')) || 0; }catch(e){}

const game = {
  state: 'ready',      // ready=开始界面 | playing=游戏中 | dead=游戏结束
  speed: SPEED_START,
  dist: 0,             // 世界总滚动距离（背景视差用，永不清零，保证背景连贯）
  runDist: 0,          // 本局跑过的距离（算分用，每局清零）
  score: 0,
  coinCount: 0,
  penalty: 0,          // 撞障碍攒下的扣分（休闲模式用）
  bonus: 0,            // 撞碎障碍攒下的加分（道具生效时）
  best: best,
  newBest: false,
  startBest: 0,        // 本局开始时的最高分（用来判断"破纪录的那一瞬间"）
  milestone: 0,        // 本局已报喜过的整千米数
  recordShown: false,  // 破纪录横幅本局是否已经放过
  shake: 0,            // 屏幕震动强度（死亡时的"打击感"）
  deathBy: '',         // 这局是怎么结束的：'pit'=掉坑，'hit'=撞死（经典模式）
  deadAt: 0,
};
let bgTime = 0;        // 游戏世界的总时钟（昼夜、各种动画用它驱动）
let paused = false;
const obstacles = [], coins = [], particles = [];
const pits = [];            // 坑：地面上的致命缺口——唯一会让游戏直接结束的东西
let distToObstacle = 750;   // 还要跑多远生成下一个障碍
let distToCoin = 500;       // 还要跑多远生成下一串金币
let invulnUntil = 0;        // 撞到障碍后的短暂无敌截止时刻（防止同一块石头每帧都扣分）

/* —— 道具系统 —— */
const POWER_DUR  = { dash: 4, giant: 7, magnet: 9, coinx2: 8, fly: 6, slow: 5 };   // 各道具的基础持续秒数
const POWER_INFO = {
  dash:   { name: '冲刺', color: '#ffd34d' },   // 高速狂奔，撞碎一切，顺带吸金币
  giant:  { name: '变大', color: '#c77dff' },   // 巨大化，横着撞碎障碍
  magnet: { name: '磁铁', color: '#ff6b6b' },   // 附近的金币自动飞过来
  coinx2: { name: '双倍金币', color: '#5ce1e6' },   // 期间每枚金币算两枚
  shield: { name: '护盾', color: '#8ecaff' },   // 挡下一次撞击（不占道具栏）
  fly:    { name: '飞行', color: '#ffa7e2' },   // 飞上天巡航：无敌 + 自带磁吸
  slow:   { name: '时停', color: '#b0fc38' },   // 世界减速 45%，喘口气仔细操作
};
const power = { type: null, until: 0, total: 1 };   // 移动系道具槽（冲刺/变大/飞行 互斥）
let magnetUntil = 0, magnetTotal = 1;   // 收益系：磁铁——独立计时，可与任何道具叠加
let coinx2Until = 0, coinx2Total = 1;   // 收益系：双倍金币
let slowUntil = 0, slowTotal = 1;       // 收益系：时停（世界慢下来）
let goldStorm = false;                  // 组合技：冲刺 × 双倍金币 = ⚡黄金风暴
const items = [];                                   // 场上漂浮的道具
let distToItem = 2200;      // 还要跑多远出现下一个道具

/* —— v2.0 新系统 —— */
let bonusUntil = 0;         // 超级奖励时间的截止时刻（吃金币攒出来的福利关）
let bonusCount = 0;         // 本局进过几次奖励关（决定轮到哪种玩法）
let bonusKind = 0;          // 本次奖励关玩法：0=大头雨 1=飞天黄金 2=狂暴冲撞
let nextBonusAt = 25;       // 本局再吃到多少枚金币就进奖励关（第一次门槛低，让新手早点看到高光时刻；之后 +100）
let reviveCount = 0;        // 本局已复活次数（复活费一次比一次贵：200、400、600……）
let shieldOn = false;       // 护盾道具：挡一次撞击
let petPulseAt = 0, petPulseUntil = 0;   // 精灵·星宝的吸金币脉冲计时
let bunny = null;           // 钻石兔（场上最多一只）
let distToBunny = 8000;     // 还要跑多远钻石兔才出现
let nextMeteorAt = 5000;    // ☄️ 流星雨事件的下一个触发里程（米，5000 米后的后期内容）
const banner = { text: '', until: 0, color: '#ffd34d' };   // 屏幕中央的大横幅
function showBanner(text, dur, color){
  banner.text = text; banner.until = bgTime + dur; banner.color = color || '#ffd34d';
}

/* —— v3.0：每日系统 / 今日挑战 / 挑战链接 —— */
let challenge = null;        // 从挑战链接进来的对战目标 {score, name}
let dailyMode = false;       // 是否在"今日挑战"模式（全国同一天同一张图）
let recordFlagShown = false; // 本局"接近纪录旗"横幅是否已播
function todayStr(){ return new Date().toDateString(); }
function dateNum(){ const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
// mulberry32：可指定种子的伪随机数生成器——同一个种子永远吐出同一串随机数
// 今日挑战用"今天的日期"当种子，于是全国玩家当天跑到的是同一张图，分数才有可比性
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 冲刺倍速：开局冲刺(花钱买的)比普通冲刺道具更快，更有"开局起飞"的爽感
function dashMult(){
  if(power.type !== 'dash') return 1;
  return boostDist > 0 && game.runDist < boostDist ? 2.2 : 1.8;
}
let seededRng = Math.random;
function srand(){ return dailyMode ? seededRng() : Math.random(); }   // 生成赛道内容专用的随机数
function srange(a, b){ return a + srand() * (b - a); }

/* —— 出发加成（主页里花金币买，下一局生效） —— */
let pendingSprint = 0;    // 开局冲刺的米数（0=没买）
let pendingShield = false;
let resumeUntil = 0;      // 暂停恢复的 3-2-1 倒计时（真实时间毫秒，0=没在倒计时）
let mothUsed = false;     // 月光蝶救援本局是否已用过
let boostDist = 0;        // 本局开局冲刺还要冲到的距离（像素）
let curBgmTier = 0;       // 当前音乐段位（0/1/2，里程越远节奏越快）
let curBiome = 0;         // 当前生物群系（0 草原 / 1 沙漠 / 2 雪夜），与音乐分段同步

// 周末活动：金币双倍！
function weekendBoost(){ const d = new Date().getDay(); return d === 0 || d === 6; }

/* —— 装扮系统：每个角色的配色皮肤（钻石购买） —— */
const SKINS2 = {
  fox:    [ { id: 'sakura', name: '樱花粉', price: 3, c: { body:'#ffb7d0', body2:'#f08bb0', dark:'#d76e9a', tail:'#ffa0c4', scarf:'#9b59d0' } },
            { id: 'shadow', name: '暗影黑', price: 5, c: { body:'#5a6275', body2:'#3d4456', dark:'#2c3242', tail:'#4a5266', belly:'#aeb6c8', scarf:'#ffd34d' } } ],
  pig:    [ { id: 'mint',   name: '薄荷绿', price: 3, c: { body:'#a8e6c9', body2:'#7fcfa8', dark:'#5fb389', snout:'#d2f5e3', scarf:'#ff8a5c' } } ],
  monkey: [ { id: 'snowm',  name: '雪猴白', price: 4, c: { body:'#e8ecf2', body2:'#c9d2de', dark:'#aab6c6', face:'#ffffff', belly:'#ffffff', scarf:'#e84545' } } ],
  snowfox:[ { id: 'dusk',   name: '黄昏金', price: 5, c: { body:'#ffd9a0', body2:'#f0b870', dark:'#d09a50', tail:'#ffcf90', scarf:'#7f6df2' } } ],
  dragon: [ { id: 'void',   name: '暗夜紫', price: 6, c: { body:'#8a6fd0', body2:'#6a4fae', dark:'#54408c', wing:'#c9b8f0', spike:'#7df9ff', belly:'#e6dcff', scarf:'#7df9ff' } } ],
};
// 角色当前的有效配色：穿了皮肤就用皮肤色盖在原色上
function charC(id){
  const base = CHARS[id].c;
  const onId = save.skinOn && save.skinOn[id];
  if(!onId) return base;
  const sk = (SKINS2[id] || []).find(s => s.id === onId);
  return sk ? Object.assign({}, base, sk.c) : base;
}

// 每日签到：跨天首次开局自动发奖，连续签到奖励递增（断签会清零——明天记得回来！）
function dailyCheckIn(){
  const today = todayStr();
  if(save.lastLogin === today) return;
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  save.streak = (save.lastLogin === yest.toDateString()) ? save.streak + 1 : 1;
  save.lastLogin = today;
  const day = ((save.streak - 1) % 7) + 1;
  const coinRwd = [0, 50, 80, 120, 160, 0, 250, 300][day];
  const gemRwd  = [0, 0,  0,  0,   0,  1, 0,   2][day];
  save.coins += coinRwd; save.gems += gemRwd;
  saveSave();
  showBanner('📅 连续签到第 ' + save.streak + ' 天！' +
             (coinRwd ? ' +' + coinRwd + '💰' : '') + (gemRwd ? ' +' + gemRwd + '💎' : ''), 3, '#9ff3ff');
}

// 每日任务：按日期种子抽 3 条，全清追加 1💎
const TASK_POOL = [
  { id: 'coins',  name: '吃到 {g} 枚金币',       goal: 100, type: 'daily' },
  { id: 'meters', name: '单局跑出 {g} 米',       goal: 800, type: 'single' },
  { id: 'smash',  name: '撞碎 {g} 个障碍',       goal: 15,  type: 'daily' },
  { id: 'bonus',  name: '进 {g} 次超级奖励关',   goal: 1,   type: 'daily' },
  { id: 'bunny',  name: '抓住 {g} 只钻石兔',     goal: 1,   type: 'daily' },
  { id: 'items',  name: '吃到 {g} 个道具',       goal: 8,   type: 'daily' },
];
const TASK_REWARDS = [{ coins: 60 }, { coins: 120 }, { gems: 1 }];
function ensureDaily(){
  const today = todayStr();
  if(save.daily && save.daily.date === today) return;
  const rng = mulberry32(dateNum());   // 全国玩家同一天抽到同一组任务
  const pool = TASK_POOL.slice();
  const tasks = [];
  for(let i = 0; i < 3; i++){
    const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    tasks.push({ id: t.id, goal: t.goal, prog: 0, done: false });
  }
  save.daily = { date: today, tasks: tasks, allDone: false };
  saveSave();
}
function taskName(t){
  return TASK_POOL.find(x => x.id === t.id).name.replace('{g}', t.goal);
}
// 任务进度埋点：游戏里的各个事件调它（type=single 的任务取单局最大值）
function taskProg(id, amount, singleValue){
  if(!save.daily || save.daily.date !== todayStr()) return;
  const t = save.daily.tasks.find(x => x.id === id && !x.done);
  if(!t) return;
  const def = TASK_POOL.find(x => x.id === id);
  if(def.type === 'single') t.prog = Math.max(t.prog, singleValue || 0);
  else t.prog += (amount || 1);
  if(t.prog >= t.goal){
    t.done = true;
    const rwd = TASK_REWARDS[save.daily.tasks.indexOf(t)] || { coins: 60 };
    save.coins += rwd.coins || 0; save.gems += rwd.gems || 0;
    showBanner('✅ 任务完成：' + taskName(t) + '  +' + (rwd.coins ? rwd.coins + '💰' : rwd.gems + '💎'), 2.4, '#b8ffb0');
    sfx.power();
    if(save.daily.tasks.every(x => x.done) && !save.daily.allDone){
      save.daily.allDone = true;
      save.gems += 1;
      showBanner('🏆 今日任务全清！额外 +1💎', 2.8, '#7df9ff');
    }
    saveSave();
  }
}

// 死亡结算页的"下一个目标"：第一个还没拥有的角色，或下一级道具时长
function nextGoal(){
  for(const id of ['pig', 'monkey', 'snowfox', 'dragon']){
    if(!save.chars.includes(id)) return { price: CHARS[id].price, label: CHARS[id].name + '·' + (CHARS[id].glide ? '滑翔' : CHARS[id].jumps + '连跳') };
  }
  if(save.durLevel < 3) return { price: [100, 250, 500][save.durLevel], label: '道具时长 Lv' + (save.durLevel + 1) };
  return null;
}

/* —— 挑战链接：把最高分和昵称编进网址，转发即挑战书 —— */
function challengeSum(c, n){
  let s = c * 131;
  for(const ch2 of n) s += ch2.charCodeAt(0) * 7;
  return s % 99991;
}
function updateShareUrl(){
  try{
    if(!(game.best > 0)) return;
    const nick = save.nick || '神秘小狐狸';
    const qs = '?c=' + game.best + '&n=' + encodeURIComponent(nick) + '&s=' + challengeSum(game.best, nick);
    history.replaceState(null, '', location.pathname + qs);
    document.title = nick + ' 在狐狸快跑跑了 ' + game.best + ' 分，不服来战！';
  }catch(e){}
}
try{
  const q = new URLSearchParams(location.search);
  const cc = parseInt(q.get('c')), nn = (q.get('n') || '').slice(0, 12);
  if(cc > 0 && nn && parseInt(q.get('s')) === challengeSum(cc, nn)){
    challenge = { score: cc, name: nn };
    showBanner('⚔️ ' + nn + ' 向你发起挑战：' + cc + ' 分！', 4, '#ff8aa0');
  }
  if(q.get('d')) showBanner('☀️ 朋友喊你来比今日挑战！点左下角 ☀️ 进入', 4, '#ffd34d');
}catch(e){}

/* ========== 6. 玩家与角色 ========== */
// 角色表：每个角色有自己的长相、能力和身价，能力越强越贵！
//   jumps = 总共能跳几段（1=只能地面跳，2=二连跳，3=三连跳）
//   glide = 会不会滑翔（空中按住跳跃键就缓缓飘落）
//   kind  = 用哪套画法（fox/pig/monkey/dragon，见 drawCharacter）
const CHARS = {
  fox: { name:'橙狐', price:0, jumps:1, glide:false, kind:'fox',
    desc:'最初的伙伴，朴实可靠',
    c:{ body:'#f8a155', body2:'#e0731f', dark:'#c96a25', belly:'#ffd9b0', ear:'#7c3f12', tail:'#e8833a', scarf:'#e84545' } },
  pig: { name:'小猪噜噜', price:200, jumps:2, glide:false, kind:'pig',
    desc:'圆滚滚的二连跳选手：空中再按一次跳跃！',
    c:{ body:'#fbb8cd', body2:'#ef8fb0', dark:'#d97fa0', belly:'#ffe3ec', snout:'#ffc7d8', scarf:'#4f87d6' } },
  monkey: { name:'小猴跳跳', price:1200, jumps:3, glide:false, kind:'monkey',
    desc:'灵活的三连跳大师，空中还能再跳两次',
    c:{ body:'#b5805a', body2:'#92603d', dark:'#7c5232', belly:'#e8c79e', face:'#e8c79e', scarf:'#ffd34d' } },
  snowfox: { name:'雪狐飘飘', price:2600, jumps:2, glide:true, kind:'fox',
    desc:'二连跳 + 滑翔：空中按住跳跃键，像羽毛一样飘',
    c:{ body:'#f4f8fd', body2:'#d8e2ee', dark:'#b9c6d6', belly:'#ffffff', ear:'#8aa0b8', tail:'#dce6f2', scarf:'#7fb3ff' } },
  panda: { name:'熊猫滚滚', price:3000, jumps:2, glide:false, kind:'panda', perk:'shield',
    desc:'二连跳 + 每局开局自带一面护盾！',
    c:{ body:'#f4f4f0', body2:'#dcdcd4', dark:'#2a2a2a', belly:'#ffffff', patch:'#2a2a2a', scarf:'#7fd89a' } },
  dragon: { name:'小龙腾腾', price:5000, jumps:3, glide:true, kind:'dragon',
    desc:'传说级！三连跳 + 滑翔，几乎就是在飞',
    c:{ body:'#5fd9ad', body2:'#2f9d7a', dark:'#2a8a6b', belly:'#d8ffe9', spike:'#ffd34d', wing:'#a9f0d6', scarf:'#ff8a5c' } },
};
const player = {
  x: 120, w: 44, h: 36,
  y: GROUND_Y,         // y 记录的是脚底的位置
  vy: 0,
  grounded: true,
  jumpsUsed: 0,        // 这次离地后已经跳了几段（连跳角色用）
  gliding: false,      // 正在滑翔吗
  inPit: false,        // 已经掉进坑里了吗（掉进去就踩不到地了，除非跳回坑口以上）
  phase: 0,            // 跑步动画的相位（驱动腿的摆动）
  squash: 0, sx: 1, sy: 1,   // 压扁/拉伸（落地压扁、起跳拉长，让动作有弹性）
  blinkT: 2, blinking: 0,    // 眨眼计时
  dustT: 0,                  // 跑步扬尘计时
  lastGrounded: 0,           // 最近一次在地面的时刻（土狼时间用）
  lastPress: -1e9,           // 最近一次按跳跃的时刻。-1e9 是科学计数法=负十亿，即"很久以前"=从没按过
};
function resetPlayer(){
  player.x = 120;   // 掉坑时人会跟着世界往左滑，重开时拉回原位
  player.y = GROUND_Y; player.vy = 0; player.grounded = true;
  player.jumpsUsed = 0; player.gliding = false; player.inPit = false;
  player.phase = 0; player.squash = 0;
  player.lastGrounded = 0; player.lastPress = -1e9;
}

/* ========== 7. 输入处理 ========== */
// jumpHeld 记录"跳跃键现在被谁按着"：null=没人 | 'key'=键盘 | 'pointer'=鼠标/手指。
// 按下和松开必须来自同一方才算配对，否则会出现
// "键盘长按大跳时，在别处点了一下鼠标，跳跃被莫名打断"这类怪事。
let jumpHeld = null;
function pressJump(source){
  if(loadingStart) return;   // 加载过场中不接受操作
  ensureAudio();
  if(paused){
    if(!resumeUntil) resumeUntil = performance.now() + 1500;   // 不瞬间续跑：先 3-2-1
    return;
  }
  if(game.state === 'ready'){
    if(homeOpen()) return;   // 主页大厅开着：用大厅里的按钮开始
    startGame(); return;
  }
  if(game.state === 'dead'){
    // 结算卡片上有显式按钮；点屏幕重开只兜底（无复活资格 + 1.2 秒防误触）
    const canRevive = !dailyMode && (!save.freeReviveUsed || save.coins >= 200 * (reviveCount + 1));
    if(!canRevive && bgTime - game.deadAt > 1.2) startGame();
    return;
  }
  jumpHeld = source;
  // 空中连跳：角色还有剩余跳跃段数时，在空中按跳跃就直接再跳一次
  const ch = dailyMode ? CHARS.fox : (CHARS[save.char] || CHARS.fox);   // 日赛统一用橙狐裸跑，分数才可比
  const maxJumps = ch.jumps + ((save.mount || save.board) && !dailyMode ? 1 : 0);   // 坐骑：额外 +1 段跳
  if(!player.grounded && power.type !== 'fly' && bgTime - player.lastGrounded > COYOTE && player.jumpsUsed < maxJumps &&
     player.y < GROUND_Y + 26){   // 掉坑太深就救不回来了
    airJump();
    return;
  }
  player.lastPress = bgTime;
}
function airJump(){
  const p = player;
  p.jumpsUsed++;
  p.vy = JUMP_VY * 0.88;   // 空中跳比地面跳略矮一点
  p.gliding = false;
  sfx.jump(1 + 0.18 * (p.jumpsUsed - 1));   // 第二、三段跳音调依次升高
  burst(p.x + p.w / 2, p.y - 4, 7, ['#ffffff', '#cfe4ff']);   // 蹬空气的小白花
}
function releaseJump(source){
  if(jumpHeld !== source) return;   // 不是按下的那一方松开的，不算数
  jumpHeld = null;
  // 上升途中松手 → 砍掉一部分上升速度，实现"长按跳得更高"
  if(game.state === 'playing' && player.vy < JUMP_CUT) player.vy = JUMP_CUT;
}
window.addEventListener('keydown', e => {
  if(loadingStart) return;   // 加载过场中不响应按键
  if(homeOpen() && game.state === 'ready'){   // 主页：空格/回车 = 开始游戏
    if(e.code === 'Space' || e.code === 'Enter'){
      e.preventDefault();
      homeEl.classList.add('hidden');
      startLoading(() => startGame());
    }
    return;
  }
  if(signOpen()){ if(e.code === 'Escape') signEl.classList.add('hidden'); return; }
  if(avatarAskOpen()){   // "创建主角"弹窗开着时：ESC 可以暂时关掉（下次还会再问）
    if(e.code === 'Escape'){
      avatarAskEl.classList.add('hidden');
      if(startAfterAvatar){ startAfterAvatar = false; startGame(); }
    }
    return;
  }
  if(shopOpen()){   // 商店开着时，键盘只负责关商店
    if(e.code === 'Escape' || e.code === 'KeyB') toggleShop(false);
    return;
  }
  if(e.code === 'Space' || e.code === 'ArrowUp') e.preventDefault();  // 防止空格滚动页面
  if(e.repeat) return;   // 忽略按住不放产生的重复事件
  if(e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') pressJump('key');
  else if(e.code === 'KeyP'){
    if(game.state === 'playing'){
      if(!paused) paused = true;
      else if(!resumeUntil) resumeUntil = performance.now() + 1500;
    }
  }
  else if(e.code === 'KeyM') toggleMute();
  else if(e.code === 'KeyB') toggleShop(true);
  else if(e.code === 'KeyR'){ if(game.state === 'dead' && bgTime - game.deadAt > 0.45) startGame(); }
});
window.addEventListener('keyup', e => {
  if(e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') releaseJump('key');
});
canvas.addEventListener('pointerdown', e => {
  if(e.pointerType === 'mouse' && e.button !== 0) return;   // 鼠标只认左键，右键/中键不跳
  e.preventDefault();
  pressJump('pointer');
});
window.addEventListener('pointerup', () => releaseJump('pointer'));
// 触摸被系统打断（来电、下拉通知栏等）时，浏览器发的是 pointercancel 而不是 pointerup
window.addEventListener('pointercancel', () => releaseJump('pointer'));
// iPhone 的音频解锁有时只认"手指松开"的那一下，所以松开时也尝试解锁并把音乐续上
window.addEventListener('pointerup', () => { ensureAudio(); if(game.state === 'playing') startBGM(); });
window.addEventListener('click',     () => { ensureAudio(); if(game.state === 'playing') startBGM(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());   // 屏蔽画布上的右键菜单
// 切到别的标签页时自动暂停，回来不会突然撞死
document.addEventListener('visibilitychange', () => {
  if(document.hidden){
    if(game.state === 'playing') paused = true;
    saveBest();   // 切走时顺手保存最高分
  }
});
window.addEventListener('pagehide', () => saveBest());   // 关闭/刷新页面前保存最高分

/* ========== 8. 开始 / 死亡 / 重开 ========== */
function startGame(){
  if(dailyMode) seededRng = mulberry32(dateNum());   // 日赛每次重试都从头放同一串随机数
  save.runs = (save.runs || 0) + 1;
  game.state = 'playing';
  game.speed = SPEED_START;
  game.runDist = 0; game.score = 0; game.coinCount = 0;
  game.penalty = 0; game.bonus = 0; invulnUntil = 0;
  game.newBest = false; game.shake = 0; game.deathBy = '';
  power.type = null;
  obstacles.length = 0; coins.length = 0; particles.length = 0; pits.length = 0;
  items.length = 0; floats.length = 0; distToItem = 2200;
  distToObstacle = 750; distToCoin = 500;
  paused = false;
  jumpHeld = null;
  face.until = 0;
  game.startBest = game.best; game.recordShown = false;
  bonusUntil = 0; nextBonusAt = 25; reviveCount = 0; shieldOn = false;
  bonusCount = 0; bonusKind = 0; magnetUntil = 0; coinx2Until = 0; goldStorm = false;
  patQueue = []; nextMeteorAt = 5000; game.milestone = 0; mothUsed = false; slowUntil = 0;
  bunny = null; distToBunny = 6000 + Math.random() * 4000;
  banner.until = 0; petPulseAt = 0; petPulseUntil = 0;
  recordFlagShown = false; curBgmTier = 0;
  // 出发加成：在主页买好的 buff 这一局生效（日赛不可用，保证公平）
  boostDist = 0;
  if(!dailyMode){
    if((CHARS[save.char] || {}).perk === 'shield') shieldOn = true;   // 熊猫滚滚：天生自带护盾
    const sprint = Math.max(pendingSprint, save.board ? 200 : 0);     // 火箭滑板：每局免费冲刺 200 米
    if(sprint > 0){
      boostDist = sprint * 12;
      activatePower('dash');
      showBanner('🚀 开局冲刺 ' + sprint + ' 米！', 2, '#ffd34d');
      pendingSprint = 0;
    }
    if(pendingShield){ shieldOn = true; pendingShield = false; }
  }
  resetPlayer();
  startBGM();
  ensureDaily();      // 跨天换一组每日任务
}
function die(cause){
  game.state = 'dead';
  game.deathBy = cause || 'hit';
  game.deadAt = bgTime;
  game.shake = 13;
  stopBGM();   // 背景音乐停下，让"游戏结束"旋律独奏
  sfx.die();
  burst(player.x + player.w/2, Math.min(player.y - player.h/2, H - 20), 26, ['#ff9b4b','#ffd34d','#ffffff']);
  taskProg('meters', 0, Math.floor(game.runDist / 12));   // "单局跑X米"任务在结算时结算
  if(dailyMode){
    recordDailyRun();
  } else {
    // 和"本局开始时的纪录"比，而不是和实时刷新的 best 比（best 永远 >= score，那样永远判不出新纪录）
    if(game.score > game.startBest){
      game.newBest = true;
      save.bestDist = Math.floor(game.runDist);   // 记下纪录局跑到的距离 → 赛道上的"纪录旗"
    }
  }
  saveBest();
  updateDeadCard();   // 把结算信息填进 DOM 卡片
}
// 日赛成绩记录（与无尽模式的最高分完全分开）
function recordDailyRun(){
  const today = todayStr();
  const dr = (save.dailyRun && save.dailyRun.date === today) ? save.dailyRun : { date: today, best: 0, tries: 0 };
  dr.tries++;
  if(game.score > dr.best) dr.best = game.score;
  save.dailyRun = dr;
  saveSave();
  try{ copyBtn.textContent = '📋 复制战绩发群里'; }catch(e){}   // 复位按钮文案
}
// 日赛跑满 3000 米：完赛！
function finishDaily(){
  game.state = 'dead';
  game.deathBy = 'finish';
  game.deadAt = bgTime;
  stopBGM();
  sfx.power();
  taskProg('meters', 0, Math.floor(game.runDist / 12));
  recordDailyRun();
  updateDeadCard();
  showBanner('🏁 完赛！', 2, '#ffd34d');
}
// 休闲模式下撞到障碍：绊一下——扣 20 分、震屏、短暂无敌闪烁，但游戏继续
function stumble(){
  if(shieldOn){   // 护盾替你挡下这一击！
    shieldOn = false;
    invulnUntil = bgTime + 1.2;
    sfx.hit();
    burst(player.x + player.w / 2, player.y - player.h / 2, 16, ['#8ecaff', '#ffffff']);
    floatText(player.x + player.w / 2, player.y - player.h - 16, '护盾抵挡！', '#8ecaff');
    return;
  }
  invulnUntil = bgTime + 1.0;
  game.penalty += 20;
  game.shake = 8;
  setFace('hurt', 1.0);   // 痛苦表情
  sfx.hit();
  burst(player.x + player.w / 2, player.y - player.h / 2, 14, ['#ff9b4b', '#ffffff']);
  floatText(player.x + player.w / 2, player.y - player.h - 16, '-20', '#ff6b6b');
}
function saveBest(){
  try{ localStorage.setItem('fox_best', String(game.best)); }catch(e){}
  saveSave();   // 顺手把钱包/皮肤也存了
  updateShareUrl();   // 把最新纪录写进网址——随手转发就是挑战书
}
// 超级奖励关：三种玩法轮换，每次进都有"这回轮到哪个"的开箱感
function startBonus(){
  bonusKind = bonusCount % 3;
  bonusCount++;
  bonusUntil = bgTime + 6;
  nextBonusAt = game.coinCount + 100;  // 下次门槛从"当前数量"重新起算，奖励关永远不会连环触发
  taskProg('bonus', 1);
  obstacles.length = 0;
  pits.length = 0;
  const names = ['🌧 大头雨', '🕊 飞天黄金', '💥 狂暴冲撞'];
  showBanner('✨ 超级奖励：' + names[bonusKind] + ' ✨', 2.5, '#ffd34d');
  if(bonusKind === 1){        // 飞天黄金：直接起飞，上天吃金币长龙
    power.type = 'fly'; power.total = 6; power.until = bonusUntil;
  } else if(bonusKind === 2){ // 狂暴冲撞：全程冲刺，障碍墙撞个稀碎
    power.type = 'dash'; power.total = 6; power.until = bonusUntil;
  }
  setFace('joy', 2);
  sfx.power();
}
// 金币复活：扣钱、原地满血复活，并把眼前的危险清掉（首次死亡免费送一次）
function revive(){
  const free = !save.freeReviveUsed;
  const cost = free ? 0 : 200 * (reviveCount + 1);
  if(game.state !== 'dead' || dailyMode || (!free && save.coins < cost)) return;
  if(free) save.freeReviveUsed = true;
  else { save.coins -= cost; reviveCount++; }
  saveSave();
  game.state = 'playing';
  player.x = 120; player.y = GROUND_Y; player.vy = 0; player.grounded = true;
  player.inPit = false; player.jumpsUsed = 0; player.gliding = false;
  invulnUntil = bgTime + 2.5;   // 复活保护期
  pits.length = 0;
  for(let i = obstacles.length - 1; i >= 0; i--){
    if(obstacles[i].x < 700) obstacles.splice(i, 1);   // 清掉眼前的障碍，别复活即死
  }
  showBanner('❤️ 复活！继续冲！', 1.6, '#ff8aa0');
  sfx.power();
  startBGM();   // 音乐重新响起
}

/* ========== 9. 粒子特效 ========== */
function burst(x, y, n, colors){
  for(let i = 0; i < n; i++){
    particles.push({
      x: x, y: y,
      vx: rand(-220, 220), vy: rand(-260, 40),
      life: 0, max: rand(0.4, 0.9),
      size: rand(2, 5),
      color: colors[Math.floor(Math.random() * colors.length)],
      grav: 600,
    });
  }
}
function puff(x, y){   // 跑步、起跳、落地时脚下的小灰尘
  particles.push({
    x: x, y: y,
    vx: rand(-80, -20), vy: rand(-40, -5),
    life: 0, max: rand(0.25, 0.5),
    size: rand(2, 4),
    color: 'rgba(160,140,110,0.8)',
    grav: -30,
  });
}
const floats = [];   // 飘字（吃金币 +5、撞障碍 -20 这类小反馈）
function floatText(x, y, txt, color){
  floats.push({ x: x, y: y, txt: txt, color: color, life: 0 });
}
function updateParticles(dt){
  for(let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.life += dt;
    if(p.life >= p.max){ particles.splice(i, 1); continue; }
    p.vy += p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  // 飘字慢慢往上飘，0.8 秒后消失
  for(let i = floats.length - 1; i >= 0; i--){
    const f = floats[i];
    f.life += dt; f.y -= 34 * dt;
    if(f.life > 0.8) floats.splice(i, 1);
  }
}

/* ========== 10. 障碍物与金币的生成 ========== */
// 设计原则：越高的障碍越窄，保证任何速度下都跳得过去（数值算过账，别随便改高度上限）
// 新障碍要跑一段距离才解锁，开局先用基本三件套熟悉手感
/* —— 障碍编排：不再单个随机刷，而是抽"手工设计的组合段"——
   可识别的套路让玩家形成肌肉记忆，金币也参与冒险设计（坑上的弧线币）—— */
const PATTERNS = [
  { tier: 0, seq: [['rock', 0]] },
  { tier: 0, seq: [['cactus', 0]] },
  { tier: 0, seq: [['rock', 0], ['rock', 360]] },
  { tier: 0, seq: [['double', 0]] },
  { tier: 1, seq: [['pit', 0], ['coinsOver', -1]] },                      // 坑+坑上金币弧：勇者的甜头
  { tier: 1, seq: [['spikes', 0], ['cactus', 380]] },
  { tier: 1, seq: [['rock', 0], ['pit', 320], ['rock', 360]] },
  { tier: 1, seq: [['cactus', 0], ['coinsLow', 240], ['cactus', 240]] },  // 两株仙人掌之间的贴地币：奖励不跳的胆量
  { tier: 2, seq: [['pendulum', 0], ['coinsLine', 230]] },
  { tier: 2, seq: [['birdLow', 0], ['rock', 400]] },
  { tier: 2, seq: [['pit', 0], ['coinsOver', -1], ['birdLow', 460]] },
  { tier: 2, seq: [['spikes', 0], ['pit', 300], ['coinsOver', -1]] },
  { tier: 3, seq: [['birdHigh', 0], ['spikes', 340]] },
  { tier: 3, seq: [['pendulum', 0], ['pendulum', 460]] },                 // 双摆锤：后期精英段
  { tier: 3, seq: [['roller', 0]] },                                      // 滚石：贴地滚来，跳它！
  { tier: 3, seq: [['pit', 0], ['pit', 330], ['coinsOver', -1]] },
];
let patQueue = [];          // 当前组合段里还没入场的元素
let lastPitX = 0;           // 最近一个坑的中心（给"坑上金币弧"定位）
function makeObstacle(type){
  let w, h;
  if(type === 'spikes'){        w = srange(56, 88); h = 20; }
  else if(type === 'birdLow'){  w = 36; h = 26; }
  else if(type === 'birdHigh'){ w = 36; h = 26; }
  else if(type === 'pendulum'){ w = 40; h = 30; }
  else if(type === 'roller'){   w = 36; h = 36; }
  else if(type === 'rock'){     w = srange(26, 46); h = srange(34, 52); }
  else if(type === 'cactus'){   w = srange(22, 32); h = srange(56, 78); }
  else {                        w = srange(58, 72); h = srange(30, 48); }   // double
  const o = { x: W + 80, w: w, h: h, type: type };
  if(type === 'birdLow'){  o.alt = 22; o.extraV = 60; }
  if(type === 'birdHigh'){ o.alt = 62; o.extraV = 60; }
  if(type === 'roller'){   o.extraV = 140; o.roll = 0; }   // 滚石：朝你滚来，可跳可撞碎
  if(type === 'pendulum'){ o.pivotY = 58; o.len = 160; o.phase = srand() * TAU; }
  obstacles.push(o);
  // 空中障碍/摆锤附近清掉散币和道具，别诱人送死（设计好的冒险币 brave 除外）
  if(o.alt){
    for(let i = coins.length - 1; i >= 0; i--){
      if(!coins[i].brave && Math.abs(coins[i].x - o.x) < 260) coins.splice(i, 1);
    }
  }
  if(type === 'pendulum'){
    const px = o.x + 20;
    for(let i = coins.length - 1; i >= 0; i--){
      if(!coins[i].brave && Math.abs(coins[i].x - px) < 200) coins.splice(i, 1);
    }
    for(let i = items.length - 1; i >= 0; i--){
      if(Math.abs(items[i].x - px) < 200) items.splice(i, 1);
    }
  }
}
function spawnPatternCoins(kind, refX){
  if(kind === 'coinsOver'){        // 坑口上方的弧线币：吃到+安全落地=双倍快感
    for(let i = 0; i < 5; i++){
      coins.push({ x: refX - 50 + i * 32, y: 150 - Math.sin(i / 4 * Math.PI) * 26, phase: Math.random() * TAU, brave: true });
    }
  } else if(kind === 'coinsLow'){  // 贴地币：奖励"忍住不跳"的胆量
    coins.push({ x: refX, y: GROUND_Y - 26, phase: Math.random() * TAU, brave: true });
  } else {                         // coinsLine：普通直线币
    for(let i = 0; i < 4; i++){
      coins.push({ x: refX + i * 34, y: 152, phase: Math.random() * TAU, brave: true });
    }
  }
}
function spawnObstacle(){
  const d = game.runDist / 12;   // 米
  // 新手教学坑（前 3 个）：窄坑 + 预警，独立于编排系统
  if(!dailyMode && (save.pitsSeen || 0) < 3 && d > 250 && srand() < 0.2){
    pits.push({ x: W + 80, w: 70, warn: true });
    save.pitsSeen = (save.pitsSeen || 0) + 1;
    showBanner('⚠️ 前方有坑，跳过去！', 1.8, '#ff8aa0');
    return;
  }
  if(!patQueue.length){
    // 抽一个适合当前里程的组合段（前期只抽简单段）
    const tier = d > 2600 ? 3 : d > 1300 ? 2 : d > 500 ? 1 : 0;
    const pool = PATTERNS.filter(p => p.tier <= tier);
    patQueue = pool[Math.floor(srand() * pool.length)].seq.slice();
  }
  // 元素入场；同段后续元素按设计间距排队（高速时稍微拉开，保证跳跃可行）
  const el = patQueue.shift();
  if(el[0] === 'pit'){
    const pw = srange(80, 130);
    pits.push({ x: W + 80, w: pw });
    lastPitX = W + 80 + pw / 2;
  } else if(el[0].indexOf('coins') === 0){
    spawnPatternCoins(el[0], el[0] === 'coinsOver' ? lastPitX : W + 80);
  } else {
    makeObstacle(el[0]);
  }
  while(patQueue.length && patQueue[0][1] <= 0){   // 间距 ≤0 = 贴着上一个元素立刻放
    const el2 = patQueue.shift();
    if(el2[0].indexOf('coins') === 0) spawnPatternCoins(el2[0], lastPitX);
    else makeObstacle(el2[0]);
  }
  if(patQueue.length){
    distToObstacle = patQueue[0][1] * Math.max(1, game.speed / 480);
    return;
  }
  // 段落结束：到下一段的间距用原公式（含密度递增）
  const densK = Math.max(0.65, 1 - d / 9000);
  distToObstacle = (game.speed * dashMult() * 0.6 + 280 + srand() * 320) * densK;
}
function spawnCoins(){
  // 屏幕右侧附近有鸟或摆锤时先不发金币，过 250px 再试（理由见 spawnObstacle 里的注释）
  for(const o of obstacles){
    if((o.alt || o.type === 'pendulum') && o.x > W - 420){ distToCoin = 250; return; }
  }
  const n = 3 + Math.floor(srand() * 3);    // 一串 3~5 枚
  // 高度上限压在最高障碍（78px）之上：保证任何金币都能安全吃到，不会"诱人送死"
  const baseY = srange(140, 170), arc = srange(0, 26);
  for(let i = 0; i < n; i++){
    const t = n === 1 ? 0.5 : i / (n - 1);
    coins.push({
      x: W + 60 + i * 34,
      y: baseY - Math.sin(t * Math.PI) * arc,     // 排成一道小弧线
      phase: Math.random() * TAU,
    });
  }
}
// 飞天黄金：高空一条起伏的金币长龙（飞行高度刚好吃到）
function spawnSkyGold(){
  for(let i = 0; i < 4; i++){
    coins.push({ x: W + 60 + i * 38, y: 135 + Math.sin((bgTime * 2 + i) * 1.3) * 18, phase: Math.random() * TAU });
  }
}
// 超级奖励关专属："大头"从天而降（戴着真人头像时下的就是你的脸！），吃一个 +20 表现分
function spawnBigheads(){
  const n = 3 + Math.floor(Math.random() * 3);
  const baseY = rand(120, 185), arc = rand(0, 30);
  for(let i = 0; i < n; i++){
    const t = n === 1 ? 0.5 : i / (n - 1);
    coins.push({
      x: W + 60 + i * 40,
      y: baseY - Math.sin(t * Math.PI) * arc,
      phase: Math.random() * TAU,
      star: true,   // star=true 表示这是"大头"而不是金币
    });
  }
}
// 障碍的碰撞框：四周各往里收一点（比看上去略小），擦个边不算撞，对玩家宽容些才公平
// alt = 离地高度（鸟类障碍悬在空中，地面障碍不传这个参数就是 0）
function hitbox(x, w, h, alt){
  alt = alt || 0;
  return { x: x + 4, y: GROUND_Y - alt - h + 4, w: w - 8, h: h - 4 };
}
// 大摆锤的锤头位置：用正弦驱动摆角，像钟摆一样来回甩
function pendulumBall(o){
  const ang = Math.sin(bgTime * 2.1 + o.phase) * 0.95;
  return { x: o.x + 20 + Math.sin(ang) * o.len, y: o.pivotY + Math.cos(ang) * o.len };
}
// 一个障碍的所有碰撞框（不同形状的障碍拆法不一样）
function obstacleBoxes(o){
  if(o.type === 'double'){
    // 一高一矮两块石头，拆成两个框，否则矮石上方会有"隐形死区"
    return [ hitbox(o.x,              o.w * 0.55, o.h),
             hitbox(o.x + o.w * 0.45, o.w * 0.55, o.h * 0.72) ];
  }
  if(o.type === 'pendulum'){
    const b = pendulumBall(o);
    return [{ x: b.x - 15, y: b.y - 15, w: 30, h: 30 }];   // 只有锤头能撞到人，链条不算
  }
  if(o.type === 'meteor'){
    const my = meteorY(o);
    if(my === null) return [];               // 还在天上预警，只有影子，不碰撞
    return [{ x: o.x + 4, y: my - 26, w: 22, h: 26 }];
  }
  return [ hitbox(o.x, o.w, o.h, o.alt) ];
}
// 流星当前的"底部 y"：预警期（只有影子）返回 null；坠落 0.45 秒；落地后停留
function meteorY(o){
  const t = bgTime - o.dropAt;
  if(t < 0) return null;
  if(t < 0.45) return -40 + (GROUND_Y + 40) * (t / 0.45);
  return GROUND_Y;
}
// 玩家脚底中心是否悬在坑上（坑的左右各留 8px 的边，站在坑沿上不算掉）
function overPit(){
  const cx = player.x + player.w / 2;
  for(const pt of pits){
    if(cx > pt.x + 8 && cx < pt.x + pt.w - 8) return true;
  }
  return false;
}
function spawnItem(){
  // 和金币一样：右侧有鸟/摆锤时先不出道具，免得诱人撞上去
  for(const o of obstacles){
    if((o.alt || o.type === 'pendulum') && o.x > W - 420){ distToItem = 250; return; }
  }
  const types = ['dash', 'giant', 'magnet', 'coinx2', 'shield', 'fly', 'slow'];
  items.push({
    x: W + 60,
    y: srange(140, 170),   // 和金币同一条安全线：永远悬在最高障碍之上，不"诱人送死"
    type: types[Math.floor(srand() * types.length)],
    phase: Math.random() * TAU,
  });
}
function activatePower(type){
  if(type === 'shield'){   // 护盾不占道具栏：挂在身上，挡一次撞击
    shieldOn = true;
    setFace('joy', 1.0);
    sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '护盾！', POWER_INFO.shield.color);
    return;
  }
  if(type === 'magnet'){   // 收益系走独立计时器，不挤占移动系道具（捡到不再"亏"）
    magnetTotal = POWER_DUR.magnet + save.durLevel * 1.5;
    magnetUntil = bgTime + magnetTotal;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '磁铁！', POWER_INFO.magnet.color);
    return;
  }
  if(type === 'coinx2'){
    coinx2Total = POWER_DUR.coinx2 + save.durLevel * 1.5;
    coinx2Until = bgTime + coinx2Total;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '双倍金币！', POWER_INFO.coinx2.color);
    return;
  }
  if(type === 'slow'){
    slowTotal = POWER_DUR.slow + save.durLevel * 1.5;
    slowUntil = bgTime + slowTotal;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '时停！', POWER_INFO.slow.color);
    return;
  }
  power.type = type;
  power.total = POWER_DUR[type] + save.durLevel * 1.5;   // 商店升级会加时长
  power.until = bgTime + power.total;
  setFace('joy', 1.2);   // 开心表情
  sfx.power();
  floatText(player.x + player.w / 2, player.y - player.h - 24,
            POWER_INFO[type].name + '！', POWER_INFO[type].color);
}

/* ========== 11. 每帧更新（游戏规则都在这里） ========== */
function update(dt){
  bgTime += dt;

  if(game.state === 'ready'){
    game.dist += 60 * dt;          // 开始界面背景慢慢滚动
    player.phase += dt * 9;        // 狐狸原地小跑
    tickPlayerCosmetics(dt);
    updateParticles(dt);
    return;
  }
  if(game.state === 'dead'){
    updateParticles(dt);
    game.shake = Math.max(0, game.shake - 40 * dt);
    return;
  }

  // —— 下面是游戏进行中 ——
  // 开局冲刺：距离没冲完之前，一直维持冲刺状态
  if(boostDist > 0){
    if(game.runDist < boostDist){
      power.type = 'dash';
      power.until = bgTime + 0.5; power.total = 1;
    } else {
      boostDist = 0;
      power.until = bgTime;   // 立即走正常的"到期"流程（含 0.6 秒缓冲无敌）
    }
  }
  // 音乐分段：跑过 2500/5000 米时切换更快节奏的乐章
  const tier = bgmTier();
  if(tier !== curBgmTier){
    curBgmTier = tier;
    if(tier === 1) showBanner('🏜️ 进入沙漠！节奏加快', 2.2, '#ffd9a0');
    else if(tier === 2) showBanner('❄️ 进入雪夜！最终乐章', 2.2, '#bfe3ff');
  }
  if(power.type && bgTime > power.until){
    // 冲刺/变大结束的瞬间给 0.6 秒缓冲无敌：免得"差一帧就能撞碎"的障碍贴脸把你绊倒
    if(power.type === 'dash' || power.type === 'giant' || power.type === 'fly'){
      invulnUntil = Math.max(invulnUntil, bgTime + 0.6);
    }
    power.type = null;   // 道具到点失效
  }

  // 组合技：冲刺 × 双倍金币 = ⚡黄金风暴（撞碎 +5）
  const stormNow = power.type === 'dash' && bgTime < coinx2Until;
  if(stormNow && !goldStorm){
    goldStorm = true;
    showBanner('⚡ 黄金风暴！撞碎奖励 +5', 2.2, '#ffd34d');
    sfx.power();
  }
  if(!stormNow) goldStorm = false;

  game.speed = Math.min(SPEED_MAX, game.speed + SPEED_RAMP * dt);
  // 冲刺道具生效时世界加速 1.8 倍（相对地，就是狐狸在狂奔）
  const move = game.speed * dashMult() * (bgTime < slowUntil ? 0.55 : 1) * dt;   // 时停：世界慢 45%
  game.dist += move; game.runDist += move;

  const inBonus = bgTime < bonusUntil;   // 超级奖励时间：没有任何危险，只有漫天金币

  // 今日挑战：固定 3000 米，跑完即完赛
  if(dailyMode && game.runDist / 12 >= 3000){ finishDaily(); return; }

  // 生成障碍：间距随速度变大（速度越快，留给反应的距离越长）
  if(!inBonus) distToObstacle -= move;
  if(!inBonus && distToObstacle <= 0){
    spawnObstacle();   // 组合段编排：函数内部自己安排好下一个间距
  }
  distToCoin -= move;
  if(distToCoin <= 0){
    if(inBonus){
      if(bonusKind === 1){ spawnSkyGold(); distToCoin = 120; }    // 飞天黄金：高空金币长龙
      else if(bonusKind === 2){ distToCoin = 200; }               // 狂暴冲撞：奖励是可撞碎的墙
      else { spawnBigheads(); distToCoin = 150; }                 // 大头雨
    }
    else { spawnCoins(); distToCoin = 600 + srand() * 700; }
  }
  // 狂暴冲撞专属：奖励关里持续刷"撞碎就加分的墙"
  if(inBonus && bonusKind === 2){
    distToObstacle -= move;
    if(distToObstacle <= 0){
      obstacles.push({ x: W + 80, w: 34, h: 40 + Math.random() * 30, type: 'rock' });
      distToObstacle = 230;
    }
  }

  // 所有东西向左移动，出了屏幕就清理掉
  for(let i = obstacles.length - 1; i >= 0; i--){
    if(obstacles[i].type === 'meteor' && bgTime > obstacles[i].dropAt + 2){ obstacles.splice(i, 1); continue; }   // 流星烧完即散
    obstacles[i].x -= move + (obstacles[i].extraV || 0) * dt;   // 鸟有额外的迎面飞行速度
    const margin = obstacles[i].type === 'pendulum' ? 260 : 60;   // 摆锤会甩得很远，晚点再清
    if(obstacles[i].x + obstacles[i].w < -margin) obstacles.splice(i, 1);
  }
  for(let i = pits.length - 1; i >= 0; i--){
    pits[i].x -= move;
    if(pits[i].x + pits[i].w < -60) pits.splice(i, 1);
  }
  for(let i = coins.length - 1; i >= 0; i--){
    coins[i].x -= move;
    if(coins[i].x < -40) coins.splice(i, 1);
  }

  // 道具：每隔一段路出现一个（奖励关里不出）
  if(!inBonus) distToItem -= move;
  if(distToItem <= 0){ spawnItem(); distToItem = 2000 + srand() * 1800; }
  for(let i = items.length - 1; i >= 0; i--){
    items[i].x -= move;
    if(items[i].x < -40) items.splice(i, 1);
  }

  updatePlayer(dt);
  if(game.state !== 'playing') return;   // 可能刚在 updatePlayer 里掉坑死掉了
  updateParticles(dt);
  game.shake = Math.max(0, game.shake - 40 * dt);

  // 撞障碍判定（碰撞框比画面上看到的略小，对玩家宽容一点，手感更公平）
  const pb = { x: player.x + 7, y: player.y - player.h + 6, w: player.w - 14, h: player.h - 8 };
  if(power.type === 'fly'){
    // 飞行中：在天上巡航，啥也撞不着
  } else if(power.type === 'dash' || power.type === 'giant'){
    // 冲刺/变大期间：碰到障碍直接撞碎，每个 +2 分（判定框放大 8px，撞起来更爽）
    for(let i = obstacles.length - 1; i >= 0; i--){
      const o = obstacles[i];
      const boxes = obstacleBoxes(o);
      let smashed = false;
      for(const ob of boxes){
        if(pb.x < ob.x + ob.w + 8 && pb.x + pb.w > ob.x - 8 &&
           pb.y < ob.y + ob.h + 8 && pb.y + pb.h > ob.y - 8){ smashed = true; break; }
      }
      if(smashed){
        obstacles.splice(i, 1);
        game.bonus += goldStorm ? 5 : 2;
        game.shake = Math.max(game.shake, 5);
        setFace('joy', 0.5);   // 撞碎东西很爽！
        taskProg('smash', 1);
        sfx.smash();
        // 特效画在被撞碎的东西上（摆锤的锤头悬在空中，位置要单独算）
        const fb = o.type === 'pendulum' ? pendulumBall(o) : null;
        const fxX = fb ? fb.x : o.x + o.w / 2;
        const fxY = fb ? fb.y : GROUND_Y - (o.alt || 0) - o.h / 2;
        burst(fxX, fxY, 14, ['#cfd8c2', '#8fa07e', '#ffffff']);
        floatText(fxX, fxY - 18, goldStorm ? '+5' : '+2', '#b8ffb0');
      }
    }
  } else if(bgTime >= invulnUntil){   // 刚撞过的短暂无敌期内，不再重复判定
    for(const o of obstacles){
      const boxes = obstacleBoxes(o);
      for(const ob of boxes){
        if(pb.x < ob.x + ob.w && pb.x + pb.w > ob.x &&
           pb.y < ob.y + ob.h && pb.y + pb.h > ob.y){
          if(!ENDLESS){ die(); return; }   // 经典模式：撞到就结束
          stumble();                       // 休闲模式：绊一下，继续跑
          break;
        }
      }
      if(bgTime < invulnUntil) break;      // 这一帧已经绊到了，别的障碍不用再查
    }
  }

  // 吃道具（变大期间狐狸个头大了，拾取范围也要跟着变大，不然"看着碰到了却没吃到"）
  const pickR = (power.type === 'giant') ? 32 : 20;
  for(let i = items.length - 1; i >= 0; i--){
    const it = items[i];
    const inx = clamp(it.x, pb.x, pb.x + pb.w);
    const iny = clamp(it.y, pb.y, pb.y + pb.h);
    if((it.x - inx) * (it.x - inx) + (it.y - iny) * (it.y - iny) < pickR * pickR){
      items.splice(i, 1);
      activatePower(it.type);
      taskProg('items', 1);
      burst(it.x, it.y, 10, [POWER_INFO[it.type].color, '#ffffff']);
    }
  }

  // ☄️ 流星雨：5000 米后的专属事件（日赛不触发，保证同图）
  if(!dailyMode && !inBonus && game.runDist / 12 >= nextMeteorAt){
    nextMeteorAt = game.runDist / 12 + 800 + Math.random() * 400;
    showBanner('☄️ 流星雨来袭！盯住地上的阴影', 2.2, '#ff8a5c');
    for(let i = 0; i < 3; i++){
      obstacles.push({ type: 'meteor', x: W + 200 + i * 240, w: 30, h: 30, dropAt: bgTime + 1.2 + i * 0.35 });
    }
    sfx.hit();
  }

  // 钻石兔：神出鬼没，追上摸到它就 +1 💎（日赛里不出，保证公平）
  if(!inBonus && !bunny && !dailyMode){
    distToBunny -= move;
    if(distToBunny <= 0){
      bunny = { x: W + 60, mode: 'in', t: 0, base: 0 };
      distToBunny = 9000 + Math.random() * 6000;
      showBanner('💎 钻石兔出现了！跳起来扑住它', 1.8, '#7df9ff');
    }
  }
  if(bunny){
    bunny.t += dt;
    if(bunny.mode === 'in'){             // 从右边跑进来
      bunny.x -= move * 0.5;
      if(bunny.x < player.x + 150){ bunny.mode = 'tease'; bunny.base = bunny.x; bunny.t = 0; }
    } else if(bunny.mode === 'tease'){   // 在你面前晃悠 3 秒：一会儿凑近一会儿跑远
      bunny.base -= 25 * dt;
      bunny.x = bunny.base + Math.sin(bunny.t * 3) * 85;
      if(bunny.t > 3) bunny.mode = 'flee';
    } else {                             // 逗够了，加速逃走
      bunny.x += move * 0.5 + 260 * dt;
      if(bunny.x > W + 120) bunny = null;
    }
    if(bunny){
      // 必须"扑"才能抓到：在空中下落时压到它才算（站着不动蹭到不算，不然白送）
      const bb = { x: bunny.x - 16, y: GROUND_Y - 30, w: 32, h: 30 };
      if(!player.grounded && player.vy > 0 &&
         pb.x < bb.x + bb.w && pb.x + pb.w > bb.x &&
         pb.y < bb.y + bb.h && pb.y + pb.h > bb.y){
        save.gems += 1; saveSave();
        taskProg('bunny', 1);
        burst(bunny.x, GROUND_Y - 20, 16, ['#7df9ff', '#ffffff']);
        showBanner('💎 抓到钻石兔！钻石 +1', 1.8, '#7df9ff');
        setFace('joy', 1.5);
        sfx.power();
        bunny = null;
      }
    }
  }

  // 精灵·星宝：每 8 秒自动帮你吸 1.5 秒金币（日赛里停用，保证公平）
  if(save.pet && !dailyMode && bgTime > petPulseAt){
    petPulseAt = bgTime + 8;
    petPulseUntil = bgTime + 1.5;
  }

  // 磁铁（冲刺也自带吸金币，精灵的脉冲也走这里）：附近的金币自动飞过来
  if(bgTime < magnetUntil || power.type === 'dash' || power.type === 'fly' || bgTime < petPulseUntil){
    const mcx = player.x + player.w / 2, mcy = player.y - player.h / 2;
    for(const c of coins){
      const dx = mcx - c.x, dy = mcy - c.y;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if(dd < 170 && dd > 1){
        c.x += dx / dd * 520 * dt;
        c.y += dy / dd * 520 * dt;
      }
    }
  }

  // 飞行时的粉白星光拖尾
  if(power.type === 'fly'){
    particles.push({ x: player.x - 4, y: player.y - rand(6, player.h),
      vx: -rand(200, 320), vy: rand(-30, 30), life: 0, max: rand(0.2, 0.45),
      size: rand(2, 4), color: Math.random() < 0.5 ? '#ffa7e2' : '#ffffff', grav: 0 });
  }

  // 冲刺时的金色拖尾（开局冲刺期间喷得更猛）
  if(power.type === 'dash'){
    const trailN = (boostDist > 0 && game.runDist < boostDist) ? 3 : 1;
    for(let ti = 0; ti < trailN; ti++){
      particles.push({ x: player.x + rand(-6, 10), y: player.y - rand(4, player.h),
        vx: -rand(380, 560), vy: rand(-25, 25), life: 0, max: rand(0.15, 0.32),
        size: rand(2, 5), color: Math.random() < 0.5 ? '#ffd34d' : '#fff6d8', grav: 0 });
    }
  }

  // 吃金币（圆和矩形的碰撞判定）
  for(let i = coins.length - 1; i >= 0; i--){
    const c = coins[i];
    const nx = clamp(c.x, pb.x, pb.x + pb.w);
    const ny = clamp(c.y, pb.y, pb.y + pb.h);
    const cr = c.star ? 17 : 13;   // 大头比金币大，判定圈也大些
    if((c.x - nx) * (c.x - nx) + (c.y - ny) * (c.y - ny) < cr * cr){
      coins.splice(i, 1);
      if(c.star){   // 奖励关的"大头"：直接加表现分，不算金币（所以不会再连环触发奖励关）
        game.bonus += 20;
        sfx.coin();
        burst(c.x, c.y, 8, ['#ffd34d', '#ffffff']);
        floatText(c.x, c.y - 16, '+20分', '#ffb3f6');
        continue;
      }
      let v = (bgTime < coinx2Until) ? 2 : 1;   // 双倍金币道具：一枚顶两枚
      if(weekendBoost()) v *= 2;                   // 周末活动：金币再双倍！
      game.coinCount += v;
      save.coins += v;
      taskProg('coins', v);
      if(game.coinCount % 10 < v) saveSave();   // 大约每 10 枚存一次档（双倍时一次跳 2，用 < v 兜住）
      sfx.coin();
      burst(c.x, c.y, 6, ['#ffd34d', '#fff3b0']);
      floatText(c.x, c.y - 14, '+' + (v * 5) + '分', '#ffd34d');
      // 本局攒够金币就进超级奖励关！（进行中不重复触发；日赛里没有奖励关，保证赛道一致）
      if(!dailyMode && bgTime >= bonusUntil && game.coinCount >= nextBonusAt) startBonus();
    }
  }

  // 得分 = 距离×里程倍率 + 金币奖励 + 撞碎奖励 - 撞障碍扣分（最低 0 分）
  const meters = game.runDist / 12;
  const distMult = 1 + Math.min(5, Math.floor(meters / 1000)) * 0.1;   // 每 1000 米距离分 +10%，深跑更值钱
  game.score = Math.max(0, Math.floor(meters * distMult) + game.coinCount * 5 + game.bonus - game.penalty);
  // 跨过整千米：撒花报喜
  const mk = Math.floor(meters / 1000);
  if(mk > game.milestone){
    game.milestone = mk;
    showBanner('🏁 ' + mk * 1000 + ' 米！距离分 ×' + (1 + Math.min(5, mk) * 0.1).toFixed(1), 2.2, '#ffd34d');
    burst(player.x + player.w / 2, player.y - player.h - 10, 16, ['#ffd34d', '#ffffff']);
    sfx.power();
  }
  // 破纪录的那一瞬间：金色横幅 + 撒花！（日赛分数独立计算，不影响无尽纪录）
  if(!dailyMode && !game.recordShown && game.startBest > 0 && game.score > game.startBest){
    game.recordShown = true;
    showBanner('🎉 新纪录诞生！', 2.2, '#ffd34d');
    burst(player.x + player.w / 2, player.y - player.h - 10, 20, ['#ffd34d', '#ffffff', '#ff9b4b']);
    setFace('joy', 1.5);
    sfx.power();
  }
  // 挑战链接：超过朋友分数的那一刻
  if(!dailyMode && challenge && save.lastBeat !== challenge.name && game.score > challenge.score){
    save.lastBeat = challenge.name;
    save.coins += 100;
    saveSave();
    showBanner('⚔️ 击败了 ' + challenge.name + '！奖励 +100💰，转发回去让他好看', 3, '#ffd34d');
    sfx.power();
  }
  // 纪录旗快到了：提示一次
  if(!dailyMode && !recordFlagShown && save.bestDist > 1000 &&
     save.bestDist - game.runDist < 1200 && save.bestDist - game.runDist > 0){
    recordFlagShown = true;
    showBanner('🚩 前方就是你的最远纪录！', 1.8, '#ffd34d');
  }
  if(!dailyMode && game.score > game.best) game.best = game.score;   // 积分制：最高纪录实时刷新
}

function updatePlayer(dt){
  const p = player;

  if(power.type === 'fly'){
    // —— 飞行道具：自动巡航在金币带的高度，轻轻上下浮动 ——
    p.grounded = false; p.gliding = false; p.inPit = false;
    p.jumpsUsed = 0;                                   // 飞行结束后可以满状态连跳
    const targetY = 150 + Math.sin(bgTime * 3) * 12;
    p.y += (targetY - p.y) * Math.min(1, dt * 4);
    if(p.x < 120) p.x = Math.min(120, p.x + 160 * dt);   // 飞行时也把偏掉的位置追回来
    p.vy = 0;
    p.phase += dt * 14;                                // 小腿快乐地划拉
    tickPlayerCosmetics(dt);
    return;
  }

  // 起跳判定：跳跃缓冲 + 土狼时间，让操作判定更宽容（很多名作都这么做）
  const canJump = p.grounded || (bgTime - p.lastGrounded <= COYOTE && p.vy >= 0);
  if(bgTime - p.lastPress <= BUFFER && canJump){
    // 缓冲跳触发时按键可能已经松开了：松开的按"轻点"的力度起跳，还按着的才全力起跳
    p.vy = (jumpHeld !== null) ? JUMP_VY : JUMP_VY * 0.8;
    p.grounded = false;
    p.jumpsUsed = 1;      // 地面跳算第 1 段，连跳角色还能在空中续
    p.lastPress = -1e9;   // 设回"很久以前"，表示这次按键已经用掉了
    sfx.jump();
    puff(p.x + 6, GROUND_Y - 2); puff(p.x + p.w - 6, GROUND_Y - 2);
  }

  if(!p.grounded){
    p.vy += GRAVITY * dt;     // 重力把速度往下拉
    // 滑翔：会滑翔的角色在下落时按住跳跃键，就像张开小降落伞一样缓缓飘
    const ch = dailyMode ? CHARS.fox : (CHARS[save.char] || CHARS.fox);
    p.gliding = ch.glide && jumpHeld !== null && p.vy > 0;
    if(p.gliding) p.vy = Math.min(p.vy, 110);
    p.y += p.vy * dt;         // 速度改变位置
    if(p.y < GROUND_Y - 2) p.inPit = false;   // 跳回到坑口以上了，恢复"可以落地"
    if(p.y >= GROUND_Y && !p.inPit && !overPit()){   // 落地（脚下得有地，且不是已坠坑状态）
      p.y = GROUND_Y; p.vy = 0; p.grounded = true;
      p.jumpsUsed = 0; p.gliding = false;   // 落地后连跳次数重置
      p.squash = 0.3;         // 落地压扁一下
      sfx.land();
      puff(p.x + 10, GROUND_Y - 2); puff(p.x + p.w - 10, GROUND_Y - 2);
    } else if(p.y >= GROUND_Y){
      // 月光蝶：每局一次，掉坑瞬间救回空中
      if(save.moth && !mothUsed && !dailyMode){
        mothUsed = true;
        p.vy = -760; p.jumpsUsed = 0; p.inPit = false;
        showBanner('🦋 月光蝶救援！', 1.8, '#d9b8ff');
        burst(p.x + p.w / 2, p.y - 10, 14, ['#d9b8ff', '#ffffff']);
        sfx.power();
        return;
      }
      // 正在坑里下坠：跟着世界一起往左滑，看起来就是掉进了洞里。
      // 标记"已坠坑"——就算坑随后滑出屏幕被清理掉，也不能凭空落地（之前的 bug）
      p.inPit = true;
      p.x -= game.speed * dashMult() * dt;
      if(p.y > H + 30 || p.x + p.w < 0){ die('pit'); return; }   // 掉出屏幕或滑出左边界，这局结束
    }
  } else {
    if(overPit()){
      p.grounded = false;   // 脚下的地没了！开始掉（土狼时间还留 0.08 秒让你起跳自救）
    } else {
      p.lastGrounded = bgTime;
      p.phase += dt * (game.speed / 22);   // 跑得越快腿摆得越快
      // 掉坑自救会让人偏左：脚踏实地时小步跑回原位（不然跑得越久人越靠左）
      if(p.x < 120) p.x = Math.min(120, p.x + 160 * dt);
      p.dustT -= dt;
      if(p.dustT <= 0){ puff(p.x + 8, GROUND_Y - 2); p.dustT = 0.09; }
    }
  }

  tickPlayerCosmetics(dt);
}

// 纯外观的动画（压扁拉伸、眨眼），和游戏规则无关
function tickPlayerCosmetics(dt){
  const p = player;
  const target = p.grounded ? 0 : (p.vy < 0 ? -0.12 : 0.08);
  p.squash += (target - p.squash) * Math.min(1, dt * 10);
  p.sy = 1 - p.squash;
  p.sx = 1 + p.squash * 0.7;
  if(p.blinking > 0) p.blinking -= dt;
  else {
    p.blinkT -= dt;
    if(p.blinkT <= 0){ p.blinking = 0.12; p.blinkT = rand(1.5, 4); }
  }
}

/* ========== 12. 背景与世界绘制 ========== */
// 四组配色：白天 → 黄昏 → 黑夜 → 黎明，随时间平滑过渡
const PALETTES = [
  { top:'#6ec6ff', bot:'#dff4ff', far:'#9fd6b1', near:'#6fbd7f', ground:'#e9dcae' },
  { top:'#54519e', bot:'#ff9d76', far:'#8a7fb0', near:'#5f6f8e', ground:'#d9bd92' },
  { top:'#0e1430', bot:'#27355e', far:'#2c3a5e', near:'#22304e', ground:'#8b86a8' },
  { top:'#3a6fae', bot:'#ffd9a0', far:'#7fb39a', near:'#5da272', ground:'#e0d2a2' },
];
const stars = [];
for(let i = 0; i < 55; i++){
  stars.push({ x: Math.random() * W, y: Math.random() * 150, r: Math.random() * 1.4 + 0.4, tw: Math.random() * TAU });
}
const clouds = [];
for(let i = 0; i < 4; i++){
  clouds.push({ x: Math.random() * W, y: rand(30, 110), s: rand(0.6, 1.3), f: rand(0.05, 0.12) });
}

function skyPalette(){
  const u = (bgTime % CYCLE) / CYCLE * 4;
  // ((x % 4) + 4) % 4 这种写法保证结果一定落在 0~3（JS 的 % 对负数会返回负数）
  const i = ((Math.floor(u) % 4) + 4) % 4;
  const f = smooth(u - Math.floor(u));
  const a = PALETTES[i], b = PALETTES[(i + 1) % 4];
  const mix = {};
  for(const k of ['top', 'bot', 'far', 'near', 'ground']) mix[k] = lerpColor(a[k], b[k], f);
  mix.night = clamp(1 - Math.abs(u - 2.5), 0, 1);   // 0=白天 1=深夜（控制星星和夜色）
  // 生物群系：2500 米进沙漠、5000 米进雪夜（与三段 BGM 同步），200 米渐变过渡
  const bm = game.state === 'playing' ? game.runDist / 12 : 0;
  const BIOME_TARGETS = [
    null,
    { far:'#d8a878', near:'#c08850', ground:'#e8c890', bot:'#ffe2b8' },                 // 沙漠
    { far:'#8fa8c8', near:'#6e8cb8', ground:'#eef4fa', top:'#2c3a5e', bot:'#9fb8d0' },  // 雪夜
  ];
  const bt = bm >= 5000 ? 2 : bm >= 2500 ? 1 : 0;
  if(bt > 0){
    const into = clamp((bm - (bt === 1 ? 2500 : 5000)) / 200, 0, 1);
    const target = BIOME_TARGETS[bt];
    for(const k2 in target) mix[k2] = lerpColor(rgbToHex(mix[k2]), target[k2], into);
  }
  mix.biome = bt;
  return mix;
}
// lerpColor 需要 #rrggbb，而 mix 里已是 rgb(...) 字符串：转一下
function rgbToHex(s){
  if(s[0] === '#') return s;
  const mm = s.match(/\d+/g);
  return '#' + mm.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('');
}

function drawBackground(pal){
  // 天空渐变
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.top); g.addColorStop(1, pal.bot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 星星（夜里才出现，一闪一闪）
  if(pal.night > 0.02){
    for(const s of stars){
      ctx.globalAlpha = pal.night * (0.5 + 0.5 * Math.sin(bgTime * 2 + s.tw));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, s.r * 2, s.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  // 云（夜里会变暗）
  ctx.fillStyle = 'rgba(255,255,255,' + (0.85 - 0.55 * pal.night) + ')';
  for(const c of clouds){
    const span = W + 200;
    // % 取余数让云的位置在 0~span 之间循环（飘出左边就从右边回来）。
    // JS 里负数取余的结果还是负数，所以先 +span 再取一次余，保证结果一定是正数
    const cx = ((c.x - game.dist * c.f) % span + span) % span - 100;
    cloud(cx, c.y, c.s);
  }

  // 远山、近山：移动速度不同 → 产生纵深感（这招叫"视差滚动"）
  drawHills(pal.far,  215, 70, 420, 0.18);
  drawHills(pal.near, 235, 55, 300, 0.4);

  // 地面
  ctx.fillStyle = pal.ground;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, GROUND_Y, W, 3);
  // 地上的小石子跟着世界一起往左跑，速度感全靠它们
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for(let x = -(game.dist % 90); x < W; x += 90){
    ctx.fillRect(x, GROUND_Y + 14, 14, 3);
    ctx.fillRect(x + 40, GROUND_Y + 30, 8, 3);
  }
}
function cloud(x, y, s){
  ctx.beginPath();
  ctx.ellipse(x,        y,         34 * s, 14 * s, 0, 0, TAU);
  ctx.ellipse(x - 22*s, y + 4 * s, 20 * s, 10 * s, 0, 0, TAU);
  ctx.ellipse(x + 24*s, y + 5 * s, 22 * s, 11 * s, 0, 0, TAU);
  ctx.fill();
}
function drawHills(color, baseY, amp, wl, parallax){
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-wl, H);
  const off = -((game.dist * parallax) % wl);
  for(let x = off - wl; x < W + wl; x += wl){
    ctx.lineTo(x, baseY);
    ctx.quadraticCurveTo(x + wl / 2, baseY - amp, x + wl, baseY);
  }
  ctx.lineTo(W + wl, H);
  ctx.closePath();
  ctx.fill();
}

// 坑：地面上的致命缺口，画成一个越往下越黑的深洞
function drawPits(){
  for(const pt of pits){
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, '#3a3142');
    g.addColorStop(1, '#120e1a');
    ctx.fillStyle = g;
    ctx.fillRect(pt.x, GROUND_Y, pt.w, H - GROUND_Y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';   // 洞口两侧的阴影边，提示这里是悬崖
    ctx.fillRect(pt.x, GROUND_Y, 4, H - GROUND_Y);
    ctx.fillRect(pt.x + pt.w - 4, GROUND_Y, 4, H - GROUND_Y);
    if(pt.warn){   // 新手教学坑：洞口上方跳动的红色感叹号
      ctx.fillStyle = '#ff5b5b';
      ctx.font = 'bold 24px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', pt.x + pt.w / 2, GROUND_Y - 20 + Math.sin(bgTime * 7) * 5);
    }
  }
  // 纪录旗：上次破纪录跑到的位置，插一面小金旗（追过它就是新纪录的节奏！）
  if(!dailyMode && game.state === 'playing' && save.bestDist > 1000){
    const fx = player.x + (save.bestDist - game.runDist);
    if(fx > -30 && fx < W + 30){
      ctx.strokeStyle = '#d9a420'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(fx, GROUND_Y); ctx.lineTo(fx, GROUND_Y - 46); ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(fx, GROUND_Y - 46);
      ctx.lineTo(fx + 26 + Math.sin(bgTime * 5) * 2, GROUND_Y - 38);
      ctx.lineTo(fx, GROUND_Y - 30);
      ctx.closePath(); ctx.fill();
    }
  }
}
function drawObstacles(){
  for(const o of obstacles){
    const top = GROUND_Y - o.h;
    if(o.type === 'cactus'){
      const cx = o.x + o.w / 2;
      ctx.fillStyle = '#3f8c4b';
      rr(cx - 7, top, 14, o.h, 7); ctx.fill();                       // 主干
      rr(cx - 19, top + o.h * 0.28, 8, o.h * 0.32, 4); ctx.fill();   // 左臂
      rr(cx - 15, top + o.h * 0.50, 10, 7, 3); ctx.fill();
      rr(cx + 11, top + o.h * 0.18, 8, o.h * 0.30, 4); ctx.fill();   // 右臂
      rr(cx + 5,  top + o.h * 0.38, 10, 7, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      rr(cx - 4, top + 4, 3, o.h - 12, 2); ctx.fill();               // 高光
    } else if(o.type === 'double'){
      rock(o.x, o.w * 0.55, o.h);
      rock(o.x + o.w * 0.45, o.w * 0.55, o.h * 0.72);
    } else if(o.type === 'spikes'){
      // 一排小尖刺
      ctx.fillStyle = '#9aa7b8';
      const n = Math.max(3, Math.round(o.w / 14));
      for(let i = 0; i < n; i++){
        const sx = o.x + i * (o.w / n);
        ctx.beginPath();
        ctx.moveTo(sx, GROUND_Y);
        ctx.lineTo(sx + o.w / n / 2, GROUND_Y - o.h);
        ctx.lineTo(sx + o.w / n, GROUND_Y);
        ctx.closePath(); ctx.fill();
      }
    } else if(o.type === 'birdLow' || o.type === 'birdHigh'){
      drawBird(o);
    } else if(o.type === 'pendulum'){
      drawPendulum(o);
    } else if(o.type === 'roller'){
      o.roll = (o.roll || 0) + 0.22;   // 滚石：带辐条的石轮，越滚越近
      const rx = o.x + 18, ry = GROUND_Y - 18;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(rx, GROUND_Y + 3, 16, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a6a58';
      ctx.beginPath(); ctx.arc(rx, ry, 18, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rx - 14 * Math.cos(o.roll), ry - 14 * Math.sin(o.roll));
      ctx.lineTo(rx + 14 * Math.cos(o.roll), ry + 14 * Math.sin(o.roll));
      ctx.moveTo(rx - 14 * Math.sin(o.roll), ry + 14 * Math.cos(o.roll));
      ctx.lineTo(rx + 14 * Math.sin(o.roll), ry - 14 * Math.cos(o.roll));
      ctx.stroke();
    } else if(o.type === 'meteor'){
      const my = meteorY(o);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';   // 落点阴影（先看到影子才公平）
      ctx.beginPath(); ctx.ellipse(o.x + 15, GROUND_Y + 4, my === null ? 10 + (bgTime % 0.4) * 20 : 16, 5, 0, 0, TAU); ctx.fill();
      if(my !== null){
        if(my < GROUND_Y){   // 坠落拖尾
          ctx.strokeStyle = 'rgba(255,155,75,0.6)'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(o.x + 15, my - 44); ctx.lineTo(o.x + 15, my - 16); ctx.stroke();
        }
        ctx.fillStyle = '#c96a3a';
        ctx.beginPath(); ctx.arc(o.x + 15, my - 13, 14, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff9b4b';
        ctx.beginPath(); ctx.arc(o.x + 11, my - 16, 6, 0, TAU); ctx.fill();
      }
    } else {
      rock(o.x, o.w, o.h);
    }
  }
}
// 大摆锤：顶上一根横梁，吊着带刺的铁球来回甩
function drawPendulum(o){
  const px = o.x + 20;
  const b = pendulumBall(o);
  ctx.fillStyle = '#5a4a66';
  rr(px - 26, o.pivotY - 10, 52, 12, 4); ctx.fill();
  ctx.strokeStyle = '#8d8198'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(px, o.pivotY); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.fillStyle = '#4a3f55';
  for(let i = 0; i < 8; i++){   // 一圈尖刺
    const a = i / 8 * TAU + bgTime;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(a) * 14,        b.y + Math.sin(a) * 14);
    ctx.lineTo(b.x + Math.cos(a + 0.25) * 22, b.y + Math.sin(a + 0.25) * 22);
    ctx.lineTo(b.x + Math.cos(a + 0.5) * 14,  b.y + Math.sin(a + 0.5) * 14);
    ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(b.x, b.y, 16, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath(); ctx.arc(b.x - 5, b.y - 5, 6, 0, TAU); ctx.fill();
}
// 钻石兔：背着一颗大钻石蹦蹦跳跳，抓到它就发财
function drawBunny(){
  const hop = Math.abs(Math.sin(bunny.t * 9)) * 9;
  const bx = bunny.x, by = GROUND_Y - 12 - hop;
  ctx.save();   // 背上的钻石（旋转 45° 的方块）
  ctx.translate(bx + 6, by - 16);
  ctx.rotate(0.785);
  ctx.fillStyle = '#7df9ff';
  ctx.fillRect(-6, -6, 12, 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-6, -6, 12, 12);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(bx, by, 13, 10, 0, 0, TAU); ctx.fill();           // 身体
  ctx.beginPath(); ctx.ellipse(bx - 9, by - 16, 3.5, 9, -0.15, 0, TAU); ctx.fill();  // 长耳朵
  ctx.beginPath(); ctx.ellipse(bx - 3, by - 17, 3.5, 9, 0.1, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffc9d6';
  ctx.beginPath(); ctx.ellipse(bx - 9, by - 16, 1.6, 6, -0.15, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath(); ctx.arc(bx - 8, by - 3, 1.8, 0, TAU); ctx.fill();             // 眼睛
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(bx + 12, by - 2, 4, 0, TAU); ctx.fill();              // 圆尾巴
}
function drawBird(o){
  const bx = o.x + o.w / 2;
  const by = GROUND_Y - (o.alt || 0) - o.h / 2 + Math.sin(bgTime * 6 + o.x * 0.01) * 3;
  const flap = Math.sin(bgTime * 18 + o.x * 0.03) * 10;   // 扇翅膀
  ctx.fillStyle = o.type === 'birdHigh' ? '#7f6df2' : '#4f87d6';   // 高空鸟是紫色的，提醒你别跳
  ctx.beginPath(); ctx.ellipse(bx, by, 15, 10, 0, 0, TAU); ctx.fill();
  ctx.beginPath();   // 翅膀
  ctx.moveTo(bx - 2, by - 2);
  ctx.lineTo(bx + 8, by - 12 - flap);
  ctx.lineTo(bx + 13, by - 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';   // 眼睛
  ctx.beginPath(); ctx.arc(bx - 8, by - 3, 3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(bx - 9, by - 3, 1.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffae3d';   // 嘴朝着玩家
  ctx.beginPath();
  ctx.moveTo(bx - 15, by - 2); ctx.lineTo(bx - 21, by); ctx.lineTo(bx - 15, by + 2);
  ctx.closePath(); ctx.fill();
}
function drawItems(){
  for(const it of items){
    const bob = Math.sin(bgTime * 4 + it.phase) * 5;   // 上下漂浮
    const col = POWER_INFO[it.type].color;
    ctx.save();
    ctx.translate(it.x, it.y + bob);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';   // 气泡底
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.stroke();
    if(it.type === 'dash'){
      ctx.fillStyle = col;   // 闪电
      ctx.beginPath();
      ctx.moveTo(2, -9); ctx.lineTo(-6, 2); ctx.lineTo(-1, 2);
      ctx.lineTo(-2, 9); ctx.lineTo(6, -2); ctx.lineTo(1, -2);
      ctx.closePath(); ctx.fill();
    } else if(it.type === 'giant'){
      ctx.fillStyle = col;   // 药水瓶
      ctx.beginPath();
      ctx.moveTo(-3, -9); ctx.lineTo(3, -9); ctx.lineTo(3, -4);
      ctx.lineTo(7, 6); ctx.quadraticCurveTo(7, 9, 4, 9);
      ctx.lineTo(-4, 9); ctx.quadraticCurveTo(-7, 9, -7, 6);
      ctx.lineTo(-3, -4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-4, -12, 8, 3);   // 瓶口
    } else if(it.type === 'magnet'){
      ctx.strokeStyle = col; ctx.lineWidth = 5;   // 马蹄形磁铁
      ctx.beginPath(); ctx.arc(0, -2, 7, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(-9.5, -2, 5, 8); ctx.fillRect(4.5, -2, 5, 8);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-9.5, 6, 5, 3); ctx.fillRect(4.5, 6, 5, 3);
    } else if(it.type === 'coinx2'){
      ctx.fillStyle = col;   // 金币 ×2
      ctx.beginPath(); ctx.arc(-4, 0, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×2', 7, 1);
    } else if(it.type === 'slow'){
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;   // 时停怀表
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -6); ctx.moveTo(0, 0); ctx.lineTo(4, 2); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(-2, -13, 4, 3);
    } else if(it.type === 'fly'){
      ctx.fillStyle = col;   // 一对小翅膀
      ctx.beginPath(); ctx.ellipse(-5, 0, 8, 4, -0.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5, 0, 8, 4, 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 1, 3, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = col;   // 护盾
      ctx.beginPath();
      ctx.moveTo(-8, -8); ctx.lineTo(8, -8); ctx.lineTo(8, 1);
      ctx.quadraticCurveTo(8, 8, 0, 10);
      ctx.quadraticCurveTo(-8, 8, -8, 1);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 6); ctx.stroke();
    }
    ctx.restore();
  }
}
function rock(x, w, h){
  ctx.fillStyle = ['#6e7d63', '#a8835a', '#9fb8cc'][curBiome] || '#6e7d63';   // 岩石颜色跟着生物群系换
  rr(x, GROUND_Y - h, w, h, Math.min(8, w / 3)); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  rr(x + 3, GROUND_Y - h + 3, w * 0.4, h * 0.3, 3); ctx.fill();
}

// "大头"：奖励关的表现分收集物——平时是当前角色的Q版大头，戴了真人头像就是你的脸
function drawBighead(c0){
  const r = 13 + Math.sin(bgTime * 5 + c0.phase) * 1.5;
  const useAv = save.useAvatar && avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0;
  if(useAv){
    ctx.save();
    ctx.beginPath(); ctx.arc(c0.x, c0.y, r, 0, TAU); ctx.clip();
    ctx.drawImage(avatarImg, c0.x - r, c0.y - r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(c0.x, c0.y, r, 0, TAU); ctx.stroke();
    return;
  }
  const headCol = charC(save.char in CHARS ? save.char : 'fox');
  ctx.fillStyle = headCol.body;
  ctx.beginPath(); ctx.arc(c0.x - 7, c0.y - 10, 5, 0, TAU); ctx.fill();   // 两只耳朵
  ctx.beginPath(); ctx.arc(c0.x + 7, c0.y - 10, 5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(c0.x, c0.y, r, 0, TAU); ctx.fill();            // 大脸
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c0.x, c0.y, r, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#2a1505';                                              // 眼睛
  ctx.beginPath(); ctx.arc(c0.x - 4, c0.y - 2, 2, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(c0.x + 4, c0.y - 2, 2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,120,150,0.5)';                                // 腮红
  ctx.beginPath(); ctx.arc(c0.x - 7, c0.y + 4, 2.5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(c0.x + 7, c0.y + 4, 2.5, 0, TAU); ctx.fill();
}
function drawCoins(){
  for(const c of coins){
    if(c.star){ drawBighead(c); continue; }
    const spin = Math.abs(Math.cos(bgTime * 5 + c.phase));   // 左右压缩模拟旋转
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(Math.max(0.15, spin), 1);
    ctx.fillStyle = '#d9a420';
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(-2, -4, 2, 8);
    ctx.restore();
  }
}

function drawPlayer(){
  const p = player;
  const ch = dailyMode ? CHARS.fox : (CHARS[save.char] || CHARS.fox);
  // 坐骑（画在角色身后）：火箭滑板优先于筋斗云
  if(save.board && !dailyMode){
    ctx.fillStyle = '#ff7847';
    rr(p.x - 4, p.y - 1, 52, 7, 4); ctx.fill();
    ctx.fillStyle = '#ffd34d';
    rr(p.x - 4, p.y - 1, 52, 2, 1); ctx.fill();
    ctx.fillStyle = 'rgba(255,170,60,' + (0.5 + 0.4 * Math.sin(bgTime * 24)) + ')';   // 尾焰
    ctx.beginPath();
    ctx.moveTo(p.x - 4, p.y + 2); ctx.lineTo(p.x - 18 - Math.sin(bgTime * 24) * 5, p.y + 3); ctx.lineTo(p.x - 4, p.y + 5);
    ctx.closePath(); ctx.fill();
  } else if(save.mount && !dailyMode){
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2,      p.y + 3, 26, 9, 0, 0, TAU);
    ctx.ellipse(p.x + p.w / 2 - 16, p.y + 5, 14, 6, 0, 0, TAU);
    ctx.ellipse(p.x + p.w / 2 + 16, p.y + 5, 14, 6, 0, 0, TAU);
    ctx.fill();
  }
  // 精灵·月光蝶：粉紫色小蝴蝶绕着飞
  if(save.moth && !dailyMode){
    const mx = p.x + p.w + 18 + Math.sin(bgTime * 2.2) * 6, my2 = p.y - p.h - 14 + Math.cos(bgTime * 3) * 8;
    const fl = Math.sin(bgTime * 20) * 0.6;
    ctx.fillStyle = '#d9b8ff';
    ctx.save(); ctx.translate(mx, my2);
    ctx.beginPath(); ctx.ellipse(-4, 0, 5, 3, -0.6 + fl, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, 0, 5, 3, 0.6 - fl, 0, TAU); ctx.fill();
    ctx.fillStyle = '#9b59d0';
    ctx.fillRect(-1, -3, 2, 6);
    ctx.restore();
  }
  // 飞行道具：背后一对快速扇动的小翅膀
  if(power.type === 'fly'){
    const flapW = Math.sin(bgTime * 22) * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.save();
    ctx.translate(p.x + 8, p.y - p.h + 6);
    ctx.rotate(-0.4 + flapW);
    ctx.beginPath(); ctx.ellipse(-12, 0, 16, 6, 0, 0, TAU); ctx.fill();
    ctx.rotate(0.8 - flapW * 2);
    ctx.beginPath(); ctx.ellipse(-12, 0, 13, 5, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.save();
  // 刚撞到障碍的短暂无敌期：闪烁提示
  if(game.state === 'playing' && bgTime < invulnUntil){
    ctx.globalAlpha = 0.45 + 0.35 * Math.sin(bgTime * 30);
  }
  ctx.translate(p.x + p.w / 2, p.y);   // 以脚底中心为基准
  const gs = (power.type === 'giant') ? 1.6 : 1;   // 变大药水：整只放大
  ctx.scale(p.sx * gs, p.sy * gs);     // 压扁/拉伸 × 巨大化
  if(p.gliding) ctx.rotate(-0.12);     // 滑翔时身体微微前倾，更有飞行感
  drawCharacter(ctx, ch, {
    time: bgTime,
    grounded: p.grounded,
    swing: p.grounded ? Math.sin(p.phase) * 0.6 : 0,
    gliding: p.gliding,
    blinking: p.blinking,
    dead: game.state === 'dead',
    face: bgTime < face.until ? face.mood : '',
    avatar: (save.useAvatar && avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) ? avatarImg : null,
    pal: dailyMode ? CHARS.fox.c : charC(save.char),   // 日赛统一原色，平时穿皮肤
  });
  ctx.restore();
  // 护盾：一圈呼吸的蓝光
  if(shieldOn){
    ctx.strokeStyle = 'rgba(140,200,255,' + (0.65 + 0.25 * Math.sin(bgTime * 6)) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y - p.h / 2, 36, 0, TAU); ctx.stroke();
  }
  // 精灵·星宝：飘在身边的小光球，吸金币时泛起光圈
  if(save.pet && !dailyMode){
    const px2 = p.x - 24, py2 = p.y - p.h - 22 + Math.sin(bgTime * 4) * 4;
    if(bgTime < petPulseUntil){
      ctx.strokeStyle = 'rgba(125,249,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px2, py2, 12 + (bgTime % 0.5) * 30, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = '#bdfcff';   // 小翅膀
    ctx.beginPath(); ctx.ellipse(px2 - 7, py2, 6, 3, -0.5 + Math.sin(bgTime * 18) * 0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(px2 + 7, py2, 6, 3,  0.5 - Math.sin(bgTime * 18) * 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7df9ff';
    ctx.beginPath(); ctx.arc(px2, py2, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px2 - 1.5, py2 - 1.5, 2, 0, TAU); ctx.fill();
  }
  // 空中剩余的连跳次数：头顶的小白点（还能跳几次就有几个点）
  const maxJumps = ch.jumps + ((save.mount || save.board) && !dailyMode ? 1 : 0);
  if(!p.grounded && maxJumps > 1 && game.state === 'playing'){
    const remain = maxJumps - p.jumpsUsed;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for(let i = 0; i < remain; i++){
      ctx.beginPath();
      ctx.arc(p.x + p.w / 2 - (remain - 1) * 5 + i * 10, p.y - p.h * gs - 14, 3, 0, TAU);
      ctx.fill();
    }
  }
}

/* —— 通用角色绘制：游戏里和商店预览共用同一套画法，保证"所见即所得" ——
   c = 画到哪块画布，ch = CHARS 里的角色，o = 姿态参数（时间/着地/摆腿/滑翔/眨眼/死亡）
   坐标系：原点在角色脚底中心，身体大约占 x -22~22、y -46~0 */
function drawCharacter(c, ch, o){
  const col = o.pal || ch.c;   // o.pal：装扮系统传进来的皮肤配色
  const t = o.time;
  function crr(x, y, w, h, r){   // 这块画布自己的圆角矩形
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function tri(x1, y1, x2, y2, x3, y3){
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.closePath(); c.fill();
  }
  function legs(){
    c.fillStyle = col.dark;
    leg(-12, o.grounded ?  o.swing : -0.5);
    leg(6,   o.grounded ? -o.swing :  0.7);
  }
  function leg(ox, sw){
    c.save(); c.translate(ox, -10); c.rotate(sw * 0.7);
    crr(-3, 0, 7, 11, 3); c.fill();
    c.restore();
  }
  function body(round){
    const g = c.createLinearGradient(0, -36, 0, 0);   // 上浅下深的渐变，更立体
    g.addColorStop(0, col.body); g.addColorStop(1, col.body2);
    c.fillStyle = g;
    crr(-22, -36, 44, 28, round || 12); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 2;   // 描边让角色从背景里"跳"出来
    crr(-22, -36, 44, 28, round || 12); c.stroke();
  }
  function belly(){
    c.fillStyle = col.belly;
    c.beginPath(); c.ellipse(2, -13, 12, 8, 0, 0, TAU); c.fill();
  }
  function eye(ex, ey){
    if(o.dead){
      c.strokeStyle = '#43281a'; c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(ex - 3.5, ey - 3); c.lineTo(ex + 3.5, ey + 3);
      c.moveTo(ex + 3.5, ey - 3); c.lineTo(ex - 3.5, ey + 3);
      c.stroke();
    } else if(o.face === 'hurt'){
      // 痛！眼睛挤成 "＞"，旁边飞出一滴冷汗
      c.strokeStyle = '#43281a'; c.lineWidth = 2.5; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ex - 4, ey - 4); c.lineTo(ex + 3, ey); c.lineTo(ex - 4, ey + 4);
      c.stroke();
      c.fillStyle = 'rgba(110,170,255,0.95)';
      c.beginPath();
      c.moveTo(ex - 9, ey - 12);
      c.quadraticCurveTo(ex - 5, ey - 9, ex - 8, ey - 6);
      c.quadraticCurveTo(ex - 12, ey - 9, ex - 9, ey - 12);
      c.fill();
    } else if(o.face === 'joy'){
      // 开心！眼睛弯成月牙，旁边冒小星星
      c.strokeStyle = '#43281a'; c.lineWidth = 2.5; c.lineCap = 'round';
      c.beginPath(); c.arc(ex, ey + 2, 4.5, Math.PI, TAU); c.stroke();
      sparkle(ex + 9, ey - 10, 3);
      sparkle(ex - 11, ey - 7, 2.2);
    } else if(o.blinking > 0){
      c.strokeStyle = '#43281a'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(ex - 4, ey); c.lineTo(ex + 3, ey); c.stroke();
    } else {
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(ex, ey, 4.5, 0, TAU); c.fill();
      c.fillStyle = '#2a1505';
      c.beginPath(); c.arc(ex + 1.5, ey, 2.2, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.9)';   // 一点高光，眼神更有灵气
      c.beginPath(); c.arc(ex + 0.5, ey - 1.5, 1, 0, TAU); c.fill();
    }
  }
  function sparkle(sx, sy, r){   // 四角小星星（开心特效用）
    c.strokeStyle = '#ffd34d'; c.lineWidth = 1.8; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(sx - r, sy); c.lineTo(sx + r, sy);
    c.moveTo(sx, sy - r); c.lineTo(sx, sy + r);
    c.stroke();
  }
  function scarfTails(){   // 飘在身后的围巾：滑翔时往上扬，平时随风摆
    c.save();
    c.translate(-14, -28);
    c.rotate((o.gliding ? -0.7 : 0.15) + Math.sin(t * 7) * 0.14);
    c.fillStyle = col.scarf;
    crr(-22, -2, 22, 7, 3); c.fill();
    c.rotate(0.3);
    crr(-16, 3, 16, 6, 3); c.fill();
    c.restore();
  }
  function scarfKnot(){    // 脖子后的围巾结，画在身体之上
    c.fillStyle = col.scarf;
    crr(-19, -33, 11, 9, 4); c.fill();
  }

  const wag = Math.sin(t * 9) * 0.25 + (o.grounded ? 0 : 0.45);

  if(ch.kind === 'fox'){
    // —— 狐狸（橙狐 / 雪狐）——
    c.save();   // 大尾巴
    c.translate(-19, -14);
    c.rotate(-0.4 - wag * 0.5 + (o.gliding ? 0.45 : 0));
    c.fillStyle = col.tail;
    c.beginPath();
    c.moveTo(0, 4); c.quadraticCurveTo(-20, 2, -24, -10); c.quadraticCurveTo(-10, -12, 0, -4);
    c.closePath(); c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(-24, -10); c.quadraticCurveTo(-19, -12, -15, -9.5); c.quadraticCurveTo(-19, -6, -24, -10);
    c.closePath(); c.fill();
    c.restore();
    scarfTails();
    legs();
    body();
    scarfKnot();
    belly();
    c.fillStyle = col.body;   // 尖耳朵
    tri(4, -34, 9, -46, 14, -33);
    tri(13, -33, 18, -44, 22, -32);
    c.fillStyle = col.ear;
    tri(7, -35, 9.5, -41, 12, -35);
    eye(12, -24);
    c.fillStyle = '#5b2d0e';   // 鼻子
    c.beginPath(); c.arc(21, -18, 2.5, 0, TAU); c.fill();
  } else if(ch.kind === 'pig'){
    // —— 小猪 ——
    c.save();   // 卷卷的猪尾巴
    c.translate(-21, -20);
    c.strokeStyle = col.dark; c.lineWidth = 3.5; c.lineCap = 'round';
    c.beginPath(); c.arc(-4, 0, 4.5, -0.5 + Math.sin(t * 6) * 0.2, 4.2); c.stroke();
    c.restore();
    scarfTails();
    legs();
    body(16);   // 更圆润
    scarfKnot();
    c.fillStyle = col.belly;
    c.beginPath(); c.ellipse(0, -13, 13, 8, 0, 0, TAU); c.fill();
    c.fillStyle = col.body;   // 耷拉的耳朵
    tri(2, -33, 6, -45, 13, -32);
    tri(12, -32, 17, -44, 22, -31);
    c.fillStyle = col.dark;   // 耳朵尖
    tri(4.5, -38, 6, -45, 9, -37);
    eye(8, -25);
    c.fillStyle = col.snout;   // 猪鼻子
    c.beginPath(); c.ellipse(17, -20, 6.5, 5, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(17, -20, 6.5, 5, 0, 0, TAU); c.stroke();
    c.fillStyle = col.dark;   // 鼻孔
    c.beginPath(); c.arc(15, -20, 1.2, 0, TAU); c.fill();
    c.beginPath(); c.arc(19.5, -20, 1.2, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,120,160,0.35)';   // 腮红
    c.beginPath(); c.arc(4, -17, 3, 0, TAU); c.fill();
  } else if(ch.kind === 'monkey'){
    // —— 小猴 ——
    c.strokeStyle = col.body; c.lineWidth = 5; c.lineCap = 'round';   // 甩来甩去的长尾巴
    c.beginPath();
    c.moveTo(-18, -12);
    c.quadraticCurveTo(-34, -14, -31, -30 + Math.sin(t * 8) * 2);
    c.stroke();
    c.strokeStyle = col.dark; c.lineWidth = 4;
    c.beginPath(); c.arc(-29, -32 + Math.sin(t * 8) * 2, 3.5, 0.5, 4.5); c.stroke();
    scarfTails();
    legs();
    body();
    scarfKnot();
    belly();
    c.fillStyle = col.body;   // 圆耳朵
    c.beginPath(); c.arc(2, -35, 5.5, 0, TAU); c.fill();
    c.fillStyle = col.face;
    c.beginPath(); c.arc(2, -35, 3, 0, TAU); c.fill();
    c.fillStyle = col.face;   // 浅色的口鼻
    c.beginPath(); c.ellipse(15, -21, 8, 7, 0, 0, TAU); c.fill();
    c.fillStyle = col.body;   // 头顶一撮呆毛
    tri(10, -36, 13, -45, 16, -36);
    eye(11, -26);
    c.fillStyle = '#5b3a22';   // 鼻孔和笑嘴
    c.beginPath(); c.arc(17, -21, 1.3, 0, TAU); c.fill();
    c.strokeStyle = '#5b3a22'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(16, -18, 3, 0.2, Math.PI - 0.4); c.stroke();
  } else if(ch.kind === 'panda'){
    // —— 大熊猫：黑耳朵黑眼圈，国宝亲自跑酷 ——
    scarfTails();
    legs();
    body(16);
    scarfKnot();
    belly();
    c.fillStyle = col.patch;   // 圆黑耳朵
    c.beginPath(); c.arc(4, -38, 6, 0, TAU); c.fill();
    c.beginPath(); c.arc(19, -36, 6, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(12, -25, 6, 7, 0.3, 0, TAU); c.fill();   // 黑眼圈
    eye(12, -25);
    c.fillStyle = col.patch;   // 鼻子
    c.beginPath(); c.arc(21, -17, 2.5, 0, TAU); c.fill();
  } else if(ch.kind === 'dragon'){
    // —— 小龙 ——
    c.fillStyle = col.body2;   // 箭头尾巴
    tri(-20, -14, -34, -8 + Math.sin(t * 7) * 2, -22, -22);
    c.fillStyle = col.spike;
    tri(-34, -8, -40, -4, -34, -14);
    // 翅膀：平时小幅扇动，滑翔时完全张开
    c.save();
    c.translate(-4, -32);
    c.rotate(o.gliding ? Math.sin(t * 5) * 0.1 - 0.5 : Math.sin(t * 14) * 0.25);
    const ws = o.gliding ? 1.5 : 1;
    c.scale(ws, ws);
    c.fillStyle = col.wing;
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(-16, -18, -28, -14);
    c.quadraticCurveTo(-20, -6, -14, -4);
    c.quadraticCurveTo(-8, -2, 0, 4);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 1.5; c.stroke();
    c.restore();
    legs();
    body();
    c.fillStyle = col.belly;   // 肚皮鳞甲
    crr(-8, -22, 22, 14, 7); c.fill();
    c.fillStyle = col.spike;   // 背上的小刺
    tri(-14, -36, -10, -44, -6, -36);
    tri(-4, -37, 0, -46, 4, -37);
    tri(6, -36, 10, -44, 14, -35);
    c.fillStyle = '#fff';      // 小龙角
    tri(14, -36, 18, -45, 21, -35);
    eye(12, -24);
    c.fillStyle = '#1f6b52';   // 鼻孔
    c.beginPath(); c.arc(20, -19, 1.5, 0, TAU); c.fill();
  }

  // —— 真人头像模式：把照片裁成圆形"贴纸"盖在头上，表情画在照片周围 ——
  if(o.avatar){
    const hx = 11, hy = -31, hr = 15;
    c.save();
    c.beginPath(); c.arc(hx, hy, hr, 0, TAU); c.clip();
    c.drawImage(o.avatar, hx - hr, hy - hr, hr * 2, hr * 2);
    if(o.dead){   // 阵亡：照片蒙灰
      c.fillStyle = 'rgba(90,90,100,0.55)';
      c.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    }
    c.restore();
    c.strokeStyle = '#fff'; c.lineWidth = 2.5;   // 白色描边，像一张贴纸
    c.beginPath(); c.arc(hx, hy, hr, 0, TAU); c.stroke();
    if(o.dead){
      c.strokeStyle = '#e84545'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(hx - 8, hy - 8); c.lineTo(hx + 8, hy + 8);
      c.moveTo(hx + 8, hy - 8); c.lineTo(hx - 8, hy + 8);
      c.stroke();
    } else if(o.face === 'hurt'){
      // 痛苦表情直接"印"在照片脸上：泛红的圈 + 两行眼泪 + 漫画爆青筋
      c.strokeStyle = 'rgba(255,70,70,0.9)'; c.lineWidth = 3;
      c.beginPath(); c.arc(hx, hy, hr, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(110,170,255,0.95)';
      c.beginPath(); c.ellipse(hx - 6, hy + 4, 2.4, 5.5, 0, 0, TAU); c.fill();   // 左眼泪
      c.beginPath(); c.ellipse(hx + 6, hy + 5, 2.4, 5.5, 0, 0, TAU); c.fill();   // 右眼泪
      c.strokeStyle = '#ff5b5b'; c.lineWidth = 2.2; c.lineCap = 'round';
      const ax = hx + hr - 2, ay = hy - hr + 2;
      c.beginPath();
      c.moveTo(ax - 4, ay); c.lineTo(ax + 4, ay);
      c.moveTo(ax, ay - 4); c.lineTo(ax, ay + 4);
      c.moveTo(ax - 3, ay - 3); c.lineTo(ax + 3, ay + 3);
      c.moveTo(ax + 3, ay - 3); c.lineTo(ax - 3, ay + 3);
      c.stroke();
    } else if(o.face === 'joy'){
      // 开心表情也印在脸上：金色光环 + 腮红 + 脸上冒星星
      c.strokeStyle = 'rgba(255,211,77,0.9)'; c.lineWidth = 3;
      c.beginPath(); c.arc(hx, hy, hr, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(255,120,150,0.45)';
      c.beginPath(); c.arc(hx - 7, hy + 5, 3.5, 0, TAU); c.fill();
      c.beginPath(); c.arc(hx + 8, hy + 5, 3.5, 0, TAU); c.fill();
      sparkle(hx - 4, hy - 5, 2.6);
      sparkle(hx + 6, hy - 8, 3.2);
      sparkle(hx + hr + 3, hy - hr + 3, 3.2);
    }
  }
}

function drawParticles(){
  for(const p of particles){
    ctx.globalAlpha = 1 - p.life / p.max;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  // 飘字
  ctx.font = 'bold 15px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for(const f of floats){
    ctx.globalAlpha = 1 - f.life / 0.8;
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

/* ========== 13. 界面文字 ========== */
function drawHUD(){
  if(game.state === 'ready' && homeOpen()) return;   // 大厅开着时不画 HUD：一屏一焦点
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  // 亮色天空上白字看不清：HUD 文字一律先描边再填色
  const hudText = (s, x, y) => { ctx.strokeText(s, x, y); ctx.fillText(s, x, y); };
  // —— 左上角：表现面板（大号分数 + 离目标还差多少） ——
  const breaking = !dailyMode && game.startBest > 0 && game.score > game.startBest && game.state !== 'ready';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = breaking ? '#ffd34d' : '#fff';   // 破纪录时分数变金色
  ctx.font = 'bold 24px ' + FONT;
  hudText('得分 ' + game.score, 16, 10);
  ctx.font = 'bold 13px ' + FONT;
  let subLine, subColor;
  if(dailyMode){
    const drB = (save.dailyRun && save.dailyRun.date === todayStr()) ? save.dailyRun.best : 0;
    subLine = '☀️ 今日挑战 · 今日最佳 ' + drB + ' 分'; subColor = '#ffd34d';
  } else if(breaking){
    subLine = '🔥 新纪录进行中！'; subColor = '#ffd34d';
  } else if(challenge && save.lastBeat !== challenge.name && game.score <= challenge.score){
    subLine = '⚔️ 距击败 ' + challenge.name + ' 还差 ' + (challenge.score - game.score + 1) + ' 分'; subColor = '#ff8aa0';
  } else if(game.startBest > 0){
    subLine = '距最高纪录还差 ' + Math.max(1, game.startBest - game.score + 1) + ' 分'; subColor = '#c5cede';
  } else {
    subLine = '创造你的第一个纪录吧！'; subColor = '#c5cede';
  }
  ctx.fillStyle = subColor;
  hudText(subLine, 16, 38);
  // 金币 + 钻石
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.arc(24, 64, 7, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#d9a420'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px ' + FONT;
  hudText('× ' + save.coins, 38, 56);
  // 奖励关倒计时钩子：就快攒够了！
  if(game.state === 'playing' && !dailyMode && bgTime >= bonusUntil && nextBonusAt - game.coinCount <= 10){
    ctx.font = 'bold 12px ' + FONT;
    ctx.fillStyle = '#ffd34d';
    hudText('再吃 ' + Math.max(1, nextBonusAt - game.coinCount) + ' 枚 → ✨奖励关', 16, 78);
  }
  // 道具剩余时间条（移动系一条 + 磁铁/双倍金币各自一条，可同时挂多条）
  let barY = 96;
  const drawPBar = (name, color, frac) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(16, barY, 110, 9);
    ctx.fillStyle = color;
    ctx.fillRect(16, barY, 110 * clamp(frac, 0, 1), 9);
    ctx.font = 'bold 12px ' + FONT;
    ctx.fillStyle = '#fff';
    hudText(name, 132, barY - 2);
    barY += 15;
  };
  if(power.type) drawPBar(POWER_INFO[power.type].name, POWER_INFO[power.type].color, (power.until - bgTime) / power.total);
  if(bgTime < magnetUntil) drawPBar('磁铁', POWER_INFO.magnet.color, (magnetUntil - bgTime) / magnetTotal);
  if(bgTime < coinx2Until) drawPBar('双倍金币', POWER_INFO.coinx2.color, (coinx2Until - bgTime) / coinx2Total);
  if(bgTime < slowUntil) drawPBar('时停', POWER_INFO.slow.color, (slowUntil - bgTime) / slowTotal);
  // 最高分画在顶部正中：右上角的按钮是 HTML 元素，窗口变窄时会盖住右对齐的文字
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 17px ' + FONT;
  ctx.textAlign = 'center';
  hudText(dailyMode ? '☀️ ' + Math.min(3000, Math.floor(game.runDist / 12)) + ' / 3000 米'
                    : '最高 ' + game.best, W / 2, 14);
  if(boostDist > 0 && game.runDist < boostDist && game.state === 'playing'){
    ctx.font = 'bold 16px ' + FONT;
    ctx.fillStyle = '#ffd34d';
    hudText('🚀 开局冲刺 · 还剩 ' + Math.max(0, Math.ceil((boostDist - game.runDist) / 12)) + ' 米', W / 2, 36);
  }
  // 中央大横幅（破纪录 / 奖励关 / 复活 / 抓到兔子）
  if(bgTime < banner.until){
    ctx.globalAlpha = Math.min(1, (banner.until - bgTime) / 0.4);
    ctx.font = 'bold 28px ' + FONT;
    ctx.fillStyle = banner.color;
    hudText(banner.text, W / 2, 48);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawOverlay(){
  if(game.state === 'playing' && !paused) return;
  if(game.state === 'ready' && homeOpen()) return;   // 主页大厅开着时，开始界面交给大厅

  ctx.fillStyle = 'rgba(10,14,28,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if(paused && game.state === 'playing'){
    ctx.fillStyle = '#fff';
    if(resumeUntil){   // 3-2-1：让玩家看清自己和障碍的位置再开跑
      const cnt = Math.min(3, Math.max(1, Math.ceil((resumeUntil - performance.now()) / 500)));
      ctx.font = 'bold 64px ' + FONT;
      ctx.fillText(String(cnt), W / 2, H / 2);
    } else {
      ctx.font = 'bold 30px ' + FONT;
      ctx.fillText('已暂停', W / 2, H / 2 - 12);
      ctx.font = '15px ' + FONT;
      ctx.fillText('点击屏幕 / 按 P 继续', W / 2, H / 2 + 24);
    }
    return;
  }
  if(game.state === 'ready'){
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px ' + FONT;
    ctx.fillText('狐狸快跑', W / 2, H / 2 - 46);
    ctx.fillStyle = '#ffe9c4';
    ctx.font = '17px ' + FONT;
    ctx.fillText('按 空格 或 点击屏幕 开始', W / 2, H / 2 + 8);
    ctx.fillStyle = '#aab6d0';
    ctx.font = '14px ' + FONT;
    ctx.fillText('黑坑会摔死——看到坑就跳！其他障碍只扣分', W / 2, H / 2 + 36);
    const dly = (save.daily && save.daily.date === todayStr()) ? save.daily : null;
    if(dly){
      const doneN0 = dly.tasks.filter(t => t.done).length;
      ctx.fillText('📋 今日任务 ' + doneN0 + '/3：' + dly.tasks.map(t => (t.done ? '✅' : '◻') + taskName(t)).join('　'), W / 2, H / 2 + 58);
    } else {
      ctx.fillText('吃道具变强 · 金币攒起来逛商店（按 B） · 左下角还有今日挑战', W / 2, H / 2 + 58);
    }
    if(challenge){
      ctx.fillStyle = '#ff8aa0';
      ctx.font = 'bold 16px ' + FONT;
      ctx.fillText('⚔️ ' + challenge.name + ' 向你发起挑战：' + challenge.score + ' 分', W / 2, H / 2 + 84);
    }
  } else if(game.state === 'dead'){
    // 结算文字都在 DOM 卡片（#deadCard）里，这里只保留遮罩和角色倒地的画面
  }
}

/* ========== 14. 渲染一帧 ========== */
function render(){
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  // 屏幕震动：死亡瞬间整个画面抖几下
  if(game.shake > 0.3){
    ctx.translate(rand(-1, 1) * game.shake * 0.5, rand(-1, 1) * game.shake * 0.5);
  }
  const pal = skyPalette();
  curBiome = pal.biome || 0;
  drawBackground(pal);
  drawPits();
  drawObstacles();
  if(bunny) drawBunny();
  drawCoins();   // 金币画在障碍之后（也就是上层），万一和障碍重叠也看得见
  drawItems();
  drawParticles();
  drawPlayer();
  // 夜里给整个世界蒙一层淡淡的蓝
  if(pal.night > 0.02){
    ctx.fillStyle = 'rgba(10,16,42,' + (0.16 * pal.night) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  // 超级奖励时间：铺一层金色滤镜
  if(bgTime < bonusUntil){
    ctx.fillStyle = 'rgba(255,205,70,0.12)';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  drawHUD();
  drawOverlay();
}

/* ========== 15. 商店 ========== */
const shopEl = document.getElementById('shop');
const shopList = document.getElementById('shopList');
const shopCoinsEl = document.getElementById('shopCoins');
let shopTab = 'coin';   // 当前页签：coin=金币商店 | gem=钻石商店
document.getElementById('tabCoin').addEventListener('click', () => { shopTab = 'coin'; renderShop(); });
document.getElementById('tabGem').addEventListener('click', () => { shopTab = 'gem'; renderShop(); });
document.getElementById('tabSkin').addEventListener('click', () => { shopTab = 'skin'; renderShop(); });
// 货架：kind 为 char 的是角色（名字/能力/价格都在 CHARS 里），up 的是可升级项
const SHOP_GOODS = [
  { id: 'fox',     kind: 'char' },
  { id: 'pig',     kind: 'char' },
  { id: 'monkey',  kind: 'char' },
  { id: 'snowfox', kind: 'char' },
  { id: 'panda',   kind: 'char' },
  { id: 'dragon',  kind: 'char' },
  { id: 'dur', kind: 'up', name: '道具时长', desc: '每级让所有道具多持续 1.5 秒（最多 3 级）', prices: [100, 250, 500] },
];
function shopOpen(){ return !shopEl.classList.contains('hidden'); }
function renderShop(){
  shopCoinsEl.textContent = '💰 ' + save.coins + '　💎 ' + save.gems;
  document.getElementById('tabCoin').classList.toggle('active', shopTab === 'coin');
  document.getElementById('tabGem').classList.toggle('active', shopTab === 'gem');
  document.getElementById('tabSkin').classList.toggle('active', shopTab === 'skin');
  let html = '';
  if(shopTab === 'coin'){
  // 🎰 幸运抽奖：金币消耗的惊喜口（能抽到稀有角色！）
  html += '<div class="shop-row"><div class="shop-prev">🎰</div>' +
          '<div class="grow"><b>幸运抽奖</b><small>' +
          (lastGachaMsg || '150💰 抽一次：金币 / 💎 / 免费冲刺券 / 皮肤，还有小概率直接抽中稀有角色！') +
          '</small></div>' +
          '<div><button data-act="gacha" class="' + (save.coins < 150 ? 'cant' : '') + '">150 💰</button></div></div>';
  for(const g of SHOP_GOODS){
    let prev, info, btn;
    if(g.kind === 'char'){
      const ch = CHARS[g.id];
      // 能力小徽章：几连跳 + 会不会滑翔
      const chips = '<span class="chip">' + (ch.jumps === 1 ? '单跳' : ch.jumps + '连跳') + '</span>' +
                    (ch.glide ? '<span class="chip chip-g">滑翔</span>' : '');
      prev = '<canvas class="shop-prev" width="72" height="56" data-char="' + g.id + '"></canvas>';
      info = '<b>' + ch.name + '</b>' + chips + '<small>' + ch.desc + '</small>';
      if(save.char === g.id)             btn = '<button disabled>出战中</button>';
      else if(save.chars.includes(g.id)) btn = '<button data-act="wear" data-id="' + g.id + '">出战</button>';
      else                               btn = '<button data-act="buy" data-id="' + g.id + '" class="' + (save.coins < ch.price ? 'cant' : '') + '">' + ch.price + ' 金币</button>';
    } else {
      prev = '<div class="shop-prev">⏱️</div>';
      info = '<b>' + g.name + '</b><small>' + g.desc + '</small>';
      if(save.durLevel >= g.prices.length) btn = '<button disabled>已满级</button>';
      else btn = '<button data-act="up" data-id="' + g.id + '" class="' + (save.coins < g.prices[save.durLevel] ? 'cant' : '') + '">升级 ' + g.prices[save.durLevel] + ' 金币</button>';
      btn = '<span style="color:#97a1b8;font-size:12px;">Lv ' + save.durLevel + '/' + g.prices.length + '&nbsp;</span>' + btn;
    }
    html += '<div class="shop-row">' + prev +
            '<div class="grow">' + info + '</div>' +
            '<div>' + btn + '</div></div>';
  }
  // 真人头像专区
  const avPrev = save.avatar
    ? '<div class="shop-prev"><img src="' + save.avatar + '" alt="头像"></div>'
    : '<div class="shop-prev">🤳</div>';
  const avBtns =
    '<button data-act="avatar-up">' + (save.avatar ? '换照片' : '上传照片') + '</button>' +
    (save.avatar ? ' <button data-act="avatar-toggle">' + (save.useAvatar ? '摘下' : '戴上') + '</button>' : '');
  html += '<div class="shop-row">' + avPrev +
          '<div class="grow"><b>真人头像</b>' +
          (save.useAvatar ? '<span class="chip chip-g">使用中</span>' : '') +
          '<small>上传一张照片，角色的脑袋换成你！撞到、吃道具、阵亡都有专属表情</small></div>' +
          '<div>' + avBtns + '</div></div>';
  } else if(shopTab === 'gem'){
  // —— 钻石商店：💎 专属高级货，和金币商店完全分开 ——
  html += '<div class="shop-row"><div class="shop-prev">🐰</div>' +
          '<div class="grow"><b>怎么获得钻石？</b><small>路上偶尔出现背着钻石的小兔子——跳起来扑住它就 +1 💎（未来会有更多获取方式）</small></div></div>';
  const gemGoods = [
    { id: 'mount', name: '坐骑·筋斗云',   desc: '脚踩白云：所有角色额外 +1 段跳！', emoji: '☁️', cost: 25 },
    { id: 'board', name: '坐骑·火箭滑板', desc: '+1 段跳，并且每局免费开局冲刺 200 米！', emoji: '🛹', cost: 40 },
    { id: 'pet',   name: '精灵·星宝',     desc: '飘在身边的小精灵，每 8 秒自动帮你吸一波金币', emoji: '🧚', cost: 12 },
    { id: 'moth',  name: '精灵·月光蝶',   desc: '每局一次：掉坑的瞬间把你救回空中！', emoji: '🦋', cost: 18 },
  ];
  for(const g2 of gemGoods){
    const btn2 = save[g2.id]
      ? '<button disabled>已拥有</button>'
      : '<button data-act="gem-buy" data-id="' + g2.id + '" class="' + (save.gems < g2.cost ? 'cant' : '') + '">' + g2.cost + ' 💎</button>';
    html += '<div class="shop-row"><div class="shop-prev">' + g2.emoji + '</div>' +
            '<div class="grow"><b>' + g2.name + '</b><span class="chip" style="background:#23bcc9">钻石专属</span>' +
            '<small>' + g2.desc + '</small></div>' +
            '<div>' + btn2 + '</div></div>';
  }
  } else {
  // —— 装扮间：给已拥有的伙伴换配色皮肤（💎 购买，随时切换） ——
  html += '<div class="shop-row"><div class="shop-prev">👗</div>' +
          '<div class="grow"><b>换装间</b><small>已拥有的伙伴才能换装；买了皮肤随时切换，预览实时试穿</small></div></div>';
  for(const cid of save.chars){
    const list = SKINS2[cid] || [];
    if(!list.length) continue;
    let sw = '<button data-act="skin-wear" data-cid="' + cid + '" data-sid=""' + (!save.skinOn[cid] ? ' disabled' : '') + '>原色</button> ';
    for(const sk of list){
      const owned = (save.skins[cid] || []).includes(sk.id);
      const on = save.skinOn[cid] === sk.id;
      sw += owned
        ? '<button data-act="skin-wear" data-cid="' + cid + '" data-sid="' + sk.id + '"' + (on ? ' disabled' : '') + '>' + (on ? sk.name + ' ✓' : '穿' + sk.name) + '</button> '
        : '<button data-act="skin-buy" data-cid="' + cid + '" data-sid="' + sk.id + '" class="' + (save.gems < sk.price ? 'cant' : '') + '">' + sk.name + ' ' + sk.price + '💎</button> ';
    }
    html += '<div class="shop-row"><canvas class="shop-prev" width="72" height="56" data-char="' + cid + '"></canvas>' +
            '<div class="grow"><b>' + CHARS[cid].name + '</b><small>' + sw + '</small></div></div>';
  }
  }
  shopList.innerHTML = html;
  // 记下所有预览画布，主循环会逐帧重画它们 → 货架上的小动物是活的！
  shopPrevs = Array.from(shopList.querySelectorAll('canvas[data-char]'));
  updateShopPreviews();
}
let shopPrevs = [];
function updateShopPreviews(){
  const t = performance.now() / 1000;   // 商店打开时游戏是暂停的，所以用真实时间驱动动画
  for(const cv of shopPrevs) drawCharPreview(cv, cv.dataset.char, t);
}
// 在商店的小画布上画角色：原地小跑 + 偶尔眨眼（和游戏里同一套 drawCharacter）
function drawCharPreview(cv, id, t){
  const ch = CHARS[id] || CHARS.fox;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  c.save();
  c.translate(40, 50);
  c.scale(0.9, 0.9);
  drawCharacter(c, ch, {
    time: t,
    grounded: true,
    swing: Math.sin(t * 9) * 0.6,
    gliding: false,
    blinking: (t % 3) < 0.12 ? 1 : 0,
    dead: false,
    pal: charC(id in CHARS ? id : 'fox'),   // 预览也穿着当前皮肤
  });
  c.restore();
}
let lastBuyAt = 0;   // 连点保护：两次购买至少间隔 350 毫秒，防止手抖双击连买两级
let lastGachaMsg = '';   // 上一次抽奖结果（显示在抽奖行里）
shopList.addEventListener('click', e => {
  const b = e.target.closest('button');
  if(!b || b.disabled) return;
  // 真人头像的两个按钮（不走货架逻辑）
  if(b.dataset.act === 'avatar-up'){ document.getElementById('avatarFile').click(); return; }
  if(b.dataset.act === 'avatar-toggle'){
    save.useAvatar = !save.useAvatar;
    saveSave(); renderShop();
    return;
  }
  // 🎰 抽奖
  if(b.dataset.act === 'gacha'){
    if(performance.now() - lastBuyAt < 600) return;
    lastBuyAt = performance.now();
    if(save.coins < 150){ b.textContent = '金币不够！'; setTimeout(renderShop, 900); return; }
    save.coins -= 150;
    const roll = Math.random();
    let msg;
    const unownedChars = Object.keys(CHARS).filter(id => !save.chars.includes(id));
    const unownedSkins = [];
    for(const cid in SKINS2) for(const sk of SKINS2[cid]) if(!(save.skins[cid] || []).includes(sk.id)) unownedSkins.push({ cid, sk });
    if(roll < 0.06 && unownedChars.length){          // 6% 大奖：直接抽中新角色！
      const cid = unownedChars[Math.floor(Math.random() * unownedChars.length)];
      save.chars.push(cid); save.char = cid;
      msg = '🎊🎊 抽中稀有角色：' + CHARS[cid].name + '！已自动出战';
      sfx.power(); setTimeout(() => sfx.power(), 250);
    } else if(roll < 0.18 && unownedSkins.length){   // 12% 皮肤
      const pick = unownedSkins[Math.floor(Math.random() * unownedSkins.length)];
      (save.skins[pick.cid] = save.skins[pick.cid] || []).push(pick.sk.id);
      save.skinOn[pick.cid] = pick.sk.id;
      msg = '🎉 抽中皮肤：' + CHARS[pick.cid].name + '·' + pick.sk.name;
      sfx.power();
    } else if(roll < 0.30){                          // 12% 钻石
      save.gems += 1;
      msg = '💎 钻石 ×1';
      sfx.power();
    } else if(roll < 0.52){                          // 22% 免费冲刺券
      pendingSprint = Math.max(pendingSprint, 500);
      msg = '🚀 免费开局冲刺 500 米券（下一局自动生效）';
      sfx.power();
    } else {                                         // 48% 金币（有赔有赚）
      const c2 = 60 + Math.floor(Math.random() * 220);
      save.coins += c2;
      msg = '💰 金币 ×' + c2;
      sfx.coin();
    }
    lastGachaMsg = '🎉 上次抽中：' + msg;
    saveSave(); renderShop();
    return;
  }
  // 装扮：穿皮肤 / 买皮肤
  if(b.dataset.act === 'skin-wear'){
    if(b.dataset.sid) save.skinOn[b.dataset.cid] = b.dataset.sid;
    else delete save.skinOn[b.dataset.cid];
    saveSave(); renderShop();
    return;
  }
  if(b.dataset.act === 'skin-buy'){
    const cid = b.dataset.cid;
    const sk = (SKINS2[cid] || []).find(s => s.id === b.dataset.sid);
    if(!sk) return;
    if(performance.now() - lastBuyAt < 350) return;
    lastBuyAt = performance.now();
    if(save.gems < sk.price){ b.textContent = '钻石不够！'; setTimeout(renderShop, 900); return; }
    save.gems -= sk.price;
    (save.skins[cid] = save.skins[cid] || []).push(sk.id);
    save.skinOn[cid] = sk.id;
    sfx.power(); saveSave(); renderShop();
    return;
  }
  // 钻石商品（坐骑/精灵）
  if(b.dataset.act === 'gem-buy'){
    const gemCosts = { mount: 25, board: 40, pet: 12, moth: 18 };
    const gid = b.dataset.id, gcost = gemCosts[gid];
    if(performance.now() - lastBuyAt < 350) return;
    lastBuyAt = performance.now();
    if(save.gems < gcost){ b.textContent = '钻石不够！追兔子去'; setTimeout(renderShop, 1000); return; }
    save.gems -= gcost; save[gid] = true;
    sfx.power(); saveSave(); renderShop();
    return;
  }
  const g = SHOP_GOODS.find(x => x.id === b.dataset.id);
  if(!g) return;
  if(b.dataset.act === 'buy' || b.dataset.act === 'up'){
    if(performance.now() - lastBuyAt < 350) return;
    lastBuyAt = performance.now();
  }
  if(b.dataset.act === 'wear') save.char = g.id;
  if(b.dataset.act === 'buy'){
    const price = CHARS[g.id].price;
    if(save.coins < price){ b.textContent = '金币不够！'; setTimeout(renderShop, 900); return; }
    save.coins -= price; save.chars.push(g.id); save.char = g.id;
    sfx.power();
  }
  if(b.dataset.act === 'up'){
    const cost = g.prices[save.durLevel];
    if(save.coins < cost){ b.textContent = '金币不够！'; setTimeout(renderShop, 900); return; }
    save.coins -= cost; save.durLevel++;
    sfx.power();
  }
  saveSave();
  renderShop();
});
function toggleShop(show){
  if(show){
    if(game.state === 'playing') paused = true;   // 打开商店时自动暂停，逛完按 P 继续
    renderShop();
    shopEl.classList.remove('hidden');
  } else {
    shopEl.classList.add('hidden');
    if(game.state === 'playing' && paused && !resumeUntil){
      resumeUntil = performance.now() + 1500;   // 关店直接进 3-2-1，省掉一个"已暂停"页
    }
    if(game.state === 'ready' && homeOpen()) renderHome();   // 买完东西回大厅刷新余额
  }
}
// 头像上传：读取照片 → 居中裁成正方形、缩到 128px → 存进存档
document.getElementById('avatarFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // 把选定的正方形区域裁成 128×128 存进存档
      const finish = (sx, sy, s) => {
        const cv2 = document.createElement('canvas');
        cv2.width = cv2.height = 128;
        const c2 = cv2.getContext('2d');
        c2.drawImage(img, sx, sy, s, s, 0, 0, 128, 128);
        save.avatar = cv2.toDataURL('image/jpeg', 0.85);
        save.useAvatar = true;
        loadAvatarImg();
        saveSave();
        renderShop();
        // 如果是"创建主角"弹窗发起的上传：关弹窗、直接开局
        if(avatarAskOpen()){
          avatarAskEl.classList.add('hidden');
          if(startAfterAvatar){ startAfterAvatar = false; startGame(); }
        }
      };
      // 兜底裁法：水平居中、垂直偏上——人像照片的脸通常在偏上 1/3 的位置
      const fallback = () => {
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2;
        const sy = Math.max(0, Math.min(img.height - s, img.height * 0.38 - s / 2));
        finish(sx, sy, s);
      };
      // 部分浏览器自带人脸检测（FaceDetector）：检测到脸就把镜头精确对准脸
      if(window.FaceDetector){
        try{
          new FaceDetector({ maxDetectedFaces: 1, fastMode: true }).detect(img).then(faces => {
            if(faces && faces.length){
              const fb = faces[0].boundingBox;
              const fcx = fb.x + fb.width / 2, fcy = fb.y + fb.height / 2;
              const s = Math.min(Math.max(fb.width, fb.height) * 1.7, img.width, img.height);
              const sx = Math.max(0, Math.min(img.width - s, fcx - s / 2));
              const sy = Math.max(0, Math.min(img.height - s, fcy - s / 2));
              finish(sx, sy, s);
            } else fallback();
          }).catch(fallback);
        }catch(e){ fallback(); }
      } else fallback();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
  e.target.value = '';   // 清空选择，下次选同一张照片也能触发
});
/* —— 今日挑战 & 复制战绩 —— */
const dailyBtn = document.getElementById('dailyBtn');
const copyBtn = document.getElementById('copyBtn');
function startDaily(){
  dailyMode = true;
  startGame();
  showBanner('☀️ 今日挑战：全国同一张图，跑满 3000 米！', 2.8, '#ffd34d');
}
dailyBtn.addEventListener('click', function(){
  ensureAudio();
  if(dailyMode && game.state === 'dead'){ goHome(); }   // 赛后回主页
  else if(game.state === 'ready'){ startDaily(); }
  this.blur();
});
function fallbackCopy(txt, ok){
  const ta = document.createElement('textarea');
  ta.value = txt; document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand('copy'); ok(); }catch(e){}
  document.body.removeChild(ta);
}
copyBtn.addEventListener('click', function(){
  const dr = (save.dailyRun && save.dailyRun.date === todayStr()) ? save.dailyRun : { best: game.score, tries: 1 };
  const stars = dr.best >= 1500 ? '⭐⭐⭐' : dr.best >= 1000 ? '⭐⭐' : dr.best >= 600 ? '⭐' : '';
  const d = new Date();
  const txt = '【狐狸快跑·每日挑战 ' + (d.getMonth() + 1) + '.' + d.getDate() + '】我跑了 ' + dr.best + ' 分 ' + stars +
              ' 全国同一张图，敢来比吗？ ' + location.origin + location.pathname + '?d=1';
  const ok = () => { copyBtn.textContent = '✅ 已复制，去微信粘贴'; };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(ok).catch(() => fallbackCopy(txt, ok));
  } else fallbackCopy(txt, ok);
});

/* —— 主页大厅 & 签到日历 —— */
const homeEl = document.getElementById('home');
const signEl = document.getElementById('sign');
const homeBtn = document.getElementById('homeBtn');
function homeOpen(){ return !homeEl.classList.contains('hidden'); }
function signOpen(){ return !signEl.classList.contains('hidden'); }
const SIGN_REWARDS = ['💰50', '💰80', '💰120', '💰160', '💎1', '💰250', '💎2+💰300'];
function canClaimSign(){ return save.lastLogin !== todayStr(); }
function renderHome(){
  document.getElementById('homeStats').innerHTML =
    '最高 ' + game.best + ' 分 · 💰' + save.coins + ' · 💎' + save.gems +
    (save.streak ? ' · 已连签 ' + save.streak + ' 天' : '') +
    (weekendBoost() ? '<br>🎉 周末狂欢：金币双倍进行中！' : '') +
    (challenge ? '<br>⚔️ ' + challenge.name + ' 向你发起挑战：' + challenge.score + ' 分' : '');
  document.getElementById('nickInput').value = save.nick || '';
  document.getElementById('signDot').classList.toggle('hidden', !canClaimSign());
  // 开始按钮回显已选加成：钱花到位了，看得见
  document.getElementById('homeStart').textContent =
    '▶️ 开始游戏' + (pendingSprint ? ' · 🚀' + pendingSprint + '米' : '') + (pendingShield ? ' · 🛡' : '');
  // 今日任务：目标看得见，才有"再来一局"的劲
  const ht = document.getElementById('homeTasks');
  if(save.runs > 0 && save.daily && save.daily.date === todayStr()){
    let th = '<div class="bTitle">📋 今日任务（全清 +1💎）</div>';
    for(const t of save.daily.tasks){
      th += '<div class="tline' + (t.done ? ' done' : '') + '"><span>' + (t.done ? '✅ ' : '◻ ') + taskName(t) +
            '</span><span>' + Math.min(t.prog, t.goal) + '/' + t.goal + '</span></div>';
    }
    ht.innerHTML = th; ht.style.display = '';
  } else ht.style.display = 'none';
  // 出发加成：第一局先藏起来（渐进披露）；买不起的灰显并写明差额
  const hb = document.getElementById('homeBoosts');
  document.getElementById('homeDaily').style.display = save.runs > 0 ? '' : 'none';
  if(!save.runs){ hb.style.display = 'none'; }
  else {
    hb.style.display = '';
    const opts = [{ k: 300, cost: 80 }, { k: 500, cost: 150 }, { k: 1000, cost: 300 }];
    let bh = '<div class="bTitle">出发加成（仅下一局生效，再点一次取消退款）：</div>';
    for(const o2 of opts){
      const can = pendingSprint === o2.k || save.coins >= o2.cost;
      bh += '<button data-boost="' + o2.k + '" data-cost="' + o2.cost + '" class="' +
            (pendingSprint === o2.k ? 'on' : (can ? '' : 'cant')) + '">🚀 冲刺 ' + o2.k + ' 米 · ' +
            (can ? o2.cost + '💰' : '还差' + (o2.cost - save.coins) + '💰') + '</button>';
    }
    const canS = pendingShield || save.coins >= 60;
    bh += '<button data-boost="shield" data-cost="60" class="' + (pendingShield ? 'on' : (canS ? '' : 'cant')) + '">🛡 开局护盾 · ' + (canS ? '60💰' : '还差' + (60 - save.coins) + '💰') + '</button>';
    hb.innerHTML = bh;
  }
}
let lastBoostAt = 0;   // 手机上手抖双击会"选中又立刻取消"，350ms 内只认第一下
document.getElementById('homeBoosts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if(!b) return;
  if(performance.now() - lastBoostAt < 350) return;
  lastBoostAt = performance.now();
  const cost = parseInt(b.dataset.cost);
  if(b.dataset.boost === 'shield'){
    if(pendingShield){ pendingShield = false; save.coins += cost; }                 // 取消=退款
    else if(save.coins >= cost){ pendingShield = true; save.coins -= cost; sfx.coin(); }
    else { b.textContent = '金币不够！'; setTimeout(renderHome, 800); return; }
  } else {
    const k = parseInt(b.dataset.boost);
    const opts2 = [{ k: 300, cost: 80 }, { k: 500, cost: 150 }, { k: 1000, cost: 300 }];
    const prev = opts2.find(x => x.k === pendingSprint);
    if(pendingSprint === k){ pendingSprint = 0; save.coins += cost; }               // 再点一次=取消退款
    else {
      if(prev) save.coins += prev.cost;                                             // 换档先退上一档
      if(save.coins >= cost){ pendingSprint = k; save.coins -= cost; sfx.coin(); }
      else { pendingSprint = 0; b.textContent = '金币不够！'; setTimeout(renderHome, 800); }
    }
  }
  saveSave(); renderHome();
});
const deadEl = document.getElementById('dead');
/* —— 主页像素场景：低清画布 + 放大 = 像素风（夜空/星星/奔跑的角色/大标题） —— */
const homeCv = document.getElementById('homeCanvas');
const hctx = homeCv.getContext('2d');
const homeStars = [];
for(let i = 0; i < 42; i++){
  homeStars.push({ x: Math.random() * 320, y: Math.random() * 95, s: Math.random() < 0.25 ? 2 : 1, tw: Math.random() * TAU });
}
let homeScroll = 0;
function drawHomeScene(){
  const t = performance.now() / 1000;
  homeScroll += 0.7;
  hctx.fillStyle = '#0d1024'; hctx.fillRect(0, 0, 320, 180);     // 夜空
  hctx.fillStyle = '#141a36'; hctx.fillRect(0, 96, 320, 84);
  for(const s of homeStars){                                      // 像素星星
    hctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.5 + s.tw));
    hctx.fillStyle = '#fff';
    hctx.fillRect(s.x | 0, s.y | 0, s.s, s.s);
  }
  hctx.globalAlpha = 1;
  hctx.fillStyle = '#ffe9b0';                                     // 像素月亮
  hctx.fillRect(262, 22, 14, 14); hctx.fillRect(258, 26, 22, 6); hctx.fillRect(266, 18, 6, 22);
  hctx.fillStyle = '#10162e';                                     // 远山剪影
  hctx.beginPath(); hctx.moveTo(0, 150); hctx.lineTo(60, 104); hctx.lineTo(130, 150); hctx.closePath(); hctx.fill();
  hctx.beginPath(); hctx.moveTo(90, 150); hctx.lineTo(180, 92); hctx.lineTo(280, 150); hctx.closePath(); hctx.fill();
  hctx.beginPath(); hctx.moveTo(230, 150); hctx.lineTo(300, 112); hctx.lineTo(360, 150); hctx.closePath(); hctx.fill();
  hctx.fillStyle = '#1c2447'; hctx.fillRect(0, 150, 320, 30);     // 地面
  hctx.fillStyle = '#2c376a';
  for(let x = -(homeScroll % 26); x < 320; x += 26) hctx.fillRect(x | 0, 156, 10, 3);
  hctx.save();                                                    // 奔跑的当前角色（戴头像也会显示）
  hctx.translate(64, 150); hctx.scale(0.85, 0.85);
  drawCharacter(hctx, CHARS[save.char] || CHARS.fox, {
    time: t, grounded: true, swing: Math.sin(t * 10) * 0.65, gliding: false,
    blinking: (t % 3) < 0.12 ? 1 : 0, dead: false,
    pal: charC(save.char in CHARS ? save.char : 'fox'),
    avatar: (save.useAvatar && avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) ? avatarImg : null,
  });
  hctx.restore();
  hctx.textAlign = 'center'; hctx.textBaseline = 'top';           // 大标题（低清放大自带像素感）
  hctx.font = 'bold 38px sans-serif';
  hctx.fillStyle = '#3a2a00'; hctx.fillText('狐狸快跑', 163, 27);
  hctx.fillStyle = '#ffd34d'; hctx.fillText('狐狸快跑', 160, 24);
  hctx.font = 'bold 9px monospace';
  hctx.fillStyle = '#7e879c'; hctx.fillText('- F O X　R U N -', 160, 66);
}
/* —— 加载过场：星际穿越线 + 狂奔剪影 + 像素进度条 —— */
const loadEl = document.getElementById('loading');
const lctx = document.getElementById('loadCanvas').getContext('2d');
const LOAD_COVER = 750, LOAD_REVEAL = 750;   // 像素块合拢 / 揭开 的时长
const LOAD_TIPS = ['提示：长按跳得更高', '提示：紫色高空鸟——千万别跳！', '提示：黑坑会摔死，看到就跳',
                   '提示：金币攒够会进入超级奖励关', '提示：钻石兔要跳起来扑住', '提示：冲刺时可以撞碎一切',
                   '提示：连跳角色掉坑瞬间还能自救'];
let loadingStart = 0, loadingCb = null, loadingMidFired = false;
// 像素块网格：20×12 个 8px 方块，按"离边缘的圈数"排好入场顺序（PPT 棋盘式）
const loadTiles = [];
for(let cx2 = 0; cx2 < 20; cx2++){
  for(let cy2 = 0; cy2 < 12; cy2++){
    loadTiles.push({ cx: cx2, cy: cy2, ring: Math.min(cx2, cy2, 19 - cx2, 11 - cy2), j: Math.random() * 60 });
  }
}
function startLoading(cb){
  loadingStart = performance.now();
  loadingMidFired = false;
  loadingCb = cb;
  document.getElementById('loadTip').textContent = LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];
  loadEl.classList.remove('hidden');
}
function drawLoading(){
  const el = performance.now() - loadingStart;
  lctx.clearRect(0, 0, 160, 90);
  for(const tl of loadTiles){
    let k;   // 这块砖当前的大小（0=没出现 1=完全盖住）
    if(el < LOAD_COVER){           // 合拢：从四周一圈圈往中心盖
      k = clamp((el - tl.ring * 70 - tl.j) / 160, 0, 1);
    } else {                       // 揭开：同样从四周一圈圈消失，露出游戏
      k = 1 - clamp((el - LOAD_COVER - tl.ring * 70 - tl.j) / 160, 0, 1);
    }
    if(k <= 0) continue;
    const s = 8 * k;
    lctx.fillStyle = (tl.cx + tl.cy) % 2 ? '#0d1024' : '#05060f';
    lctx.fillRect(tl.cx * 8 + (8 - s) / 2, tl.cy * 8 + (8 - s) / 2, s, s);
  }
  if(el >= LOAD_COVER * 0.55 && el <= LOAD_COVER + 250){   // 盖满的瞬间打出标语
    lctx.font = 'bold 11px monospace'; lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
    lctx.fillStyle = '#ffd34d';
    lctx.fillText('R E A D Y', 80, 44);
  }
}
// 把这一局的结算信息填进 DOM 卡片
function updateDeadCard(){
  const finish = dailyMode && game.deathBy === 'finish';
  document.getElementById('deadTitle').textContent = finish ? '🏁 完赛！' : '游戏结束';
  const nearMiss = !dailyMode && !game.newBest && game.startBest > 0 && game.score >= game.startBest * 0.85;
  document.getElementById('deadSub').textContent =
    nearMiss ? '就差 ' + (game.startBest - game.score + 1) + ' 分破纪录！' :
    (game.newBest && !dailyMode ? '🎉 新纪录！' : (game.deathBy === 'pit' ? '掉进坑里啦，看到坑要跳～' : ''));
  document.getElementById('deadScore').textContent = game.score + ' 分';
  let stats;
  if(dailyMode){
    const dr = (save.dailyRun && save.dailyRun.date === todayStr()) ? save.dailyRun : { best: 0, tries: 0 };
    const stars = dr.best >= 1500 ? '⭐⭐⭐' : dr.best >= 1000 ? '⭐⭐' : dr.best >= 600 ? '⭐' : '';
    stats = '今日最佳 ' + dr.best + ' 分 ' + stars + ' · 第 ' + dr.tries + ' 次尝试<br>复制战绩发到群里，群友就是排行榜';
  } else {
    const doneN = (save.daily && save.daily.date === todayStr()) ? save.daily.tasks.filter(t => t.done).length : 0;
    stats = '本局金币 +' + game.coinCount + ' · 最高纪录 ' + game.best + ' · 今日任务 ' + doneN + '/3';
    if(challenge && game.score > challenge.score) stats += '<br>⚔️ 击败了 ' + challenge.name + '！转发链接回去让他好看';
  }
  document.getElementById('deadStats').innerHTML = stats;
  const goalEl = document.getElementById('deadGoal');
  const goal = dailyMode ? null : nextGoal();
  if(goal){
    const frac = clamp(save.coins / goal.price, 0, 1);
    goalEl.innerHTML = '<div class="gbar"><div class="gfill' + (frac >= 1 ? ' full' : '') + '" style="width:' + (frac * 100).toFixed(1) + '%"></div></div>' +
      '<div class="gtxt">' + (frac >= 1 ? '💰 金币够了！去商店把「' + goal.label + '」接回家'
                                        : '下一个目标：' + goal.label + '　' + save.coins + ' / ' + goal.price) + '</div>';
    goalEl.style.display = '';
  } else goalEl.style.display = 'none';
}
function goHome(){
  dailyMode = false;
  game.state = 'ready';
  resetPlayer();
  renderHome();
  homeEl.classList.remove('hidden');
  // 玩了两局还没设头像：回大厅这个"闲时"再邀请（绝不在结算页打断玩家）
  if(save.runs >= 2 && !save.avatar && !save.skippedAvatar){
    startAfterAvatar = false;
    avatarAskEl.classList.remove('hidden');
  }
}
homeBtn.addEventListener('click', function(){ goHome(); this.blur(); });
document.getElementById('nickInput').addEventListener('change', function(){
  save.nick = String(this.value || '').slice(0, 12);
  saveSave(); updateShareUrl();
});
document.getElementById('againBtn').addEventListener('click', function(){
  ensureAudio();
  startGame();   // 日赛模式下 = 重试今日挑战
  this.blur();
});
document.getElementById('homeStart').addEventListener('click', function(){
  ensureAudio();
  homeEl.classList.add('hidden');
  startLoading(() => startGame());
});
document.getElementById('homeDaily').addEventListener('click', function(){
  ensureAudio();
  homeEl.classList.add('hidden');
  startLoading(() => startDaily());
});
document.getElementById('homeShop').addEventListener('click', function(){ ensureAudio(); toggleShop(true); });
document.getElementById('homeSign').addEventListener('click', function(){
  ensureAudio(); renderSign(); signEl.classList.remove('hidden');
});
function renderSign(){
  const claimable = canClaimSign();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const nextStreak = claimable ? ((save.lastLogin === yest.toDateString()) ? save.streak + 1 : 1) : save.streak;
  const todayIdx = ((Math.max(1, nextStreak) - 1) % 7);
  let gh = '';
  for(let i = 0; i < 7; i++){
    const got = claimable ? i < todayIdx : i <= todayIdx && save.streak > 0;
    gh += '<div class="signCell' + (got ? ' got' : '') + (i === todayIdx ? ' today' : '') + '">第' + (i + 1) + '天<br>' + SIGN_REWARDS[i] + (got && (claimable || i !== todayIdx) ? '<br>✓' : (got ? '<br>✓' : '')) + '</div>';
  }
  document.getElementById('signGrid').innerHTML = gh;
  const btn = document.getElementById('signClaim');
  btn.disabled = !claimable;
  btn.textContent = claimable ? '领取第 ' + nextStreak + ' 天奖励' : '今天已领，明天再来！';
}
document.getElementById('signClaim').addEventListener('click', function(){
  if(!canClaimSign()) return;
  dailyCheckIn();
  sfx.power();
  renderSign(); renderHome();
});
document.getElementById('signClose').addEventListener('click', () => signEl.classList.add('hidden'));
signEl.addEventListener('pointerdown', e => { if(e.target === signEl) signEl.classList.add('hidden'); });
renderHome();

document.getElementById('shopBtn').addEventListener('click', function(){ ensureAudio(); toggleShop(true); this.blur(); });
document.getElementById('shopClose').addEventListener('click', () => toggleShop(false));
shopEl.addEventListener('pointerdown', e => { if(e.target === shopEl) toggleShop(false); });   // 点旁边暗处也能关

/* ========== 16. 主循环 ========== */
ensureDaily();   // 老玩家一打开就能在开始界面看到今天的任务
// 浏览器每秒大约调用 60 次 frame()，每次：算一小步物理 → 画一帧
let last = performance.now();
function frame(t){
  // 限制单步时长：太长（卡顿）会瞬移穿墙；浏览器第一帧的时间戳偶尔会比加载时刻还早，
  // 算出负数会让游戏时钟倒流直接崩溃，所以下限卡在 0
  const dt = Math.max(0, Math.min((t - last) / 1000, 0.05));
  last = t;
  if(paused && resumeUntil && performance.now() >= resumeUntil){
    paused = false; resumeUntil = 0;   // 倒计时结束，正式续跑
  }
  if(!paused) update(dt);
  render();
  if(shopOpen()) updateShopPreviews();   // 商店开着时，让货架上的小动物动起来
  if(homeOpen()) drawHomeScene();        // 主页像素场景常驻动画
  if(loadingStart){                       // 加载过场：合拢→开局→揭开→3·2·1
    drawLoading();
    const lel = performance.now() - loadingStart;
    if(!loadingMidFired && lel >= LOAD_COVER){
      loadingMidFired = true;
      const cb = loadingCb; loadingCb = null;
      if(cb) cb();                         // 屏幕全黑的这一刻切到游戏
      paused = true;                       // 揭开期间数 3·2·1，倒数完才开跑
      resumeUntil = performance.now() + LOAD_REVEAL + 1500;
    }
    if(lel >= LOAD_COVER + LOAD_REVEAL + 120){
      loadingStart = 0;
      loadEl.classList.add('hidden');
    }
  }
  const pIcon = paused ? 'play' : 'pause';   // 暂停按钮的图标跟着状态变
  if(pauseBtn.dataset.icon !== pIcon){
    pauseBtn.dataset.icon = pIcon;
    pauseBtn.innerHTML = pIcon === 'play' ? SVG_PLAY : SVG_PAUSE;
  }
  // 死亡结算：DOM 卡片统一承载（死后 0.6 秒淡入，先看清自己怎么死的）
  const showDead = game.state === 'dead' && bgTime - game.deadAt > 0.6 && !shopOpen();
  deadEl.classList.toggle('hidden', !showDead);
  if(showDead){
    const revFree = !save.freeReviveUsed;
    const revCost = 200 * (reviveCount + 1);
    const showRev = !dailyMode && (revFree || save.coins >= revCost);
    reviveBtn.classList.toggle('hidden', !showRev);
    if(showRev){
      const nearTxt = (!game.newBest && game.startBest > 0 && game.score >= game.startBest * 0.85) ? '，冲纪录！' : '';
      const revTxt = revFree ? '🎁 新手专享：免费复活！' : '💰 花 ' + revCost + ' 金币复活' + nearTxt;
      if(reviveBtn.textContent !== revTxt) reviveBtn.textContent = revTxt;
    }
    copyBtn.classList.toggle('hidden', !dailyMode);
  }
  dailyBtn.classList.toggle('hidden', true);   // 旧的悬浮入口退役（入口都在大厅和结算卡里）
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
