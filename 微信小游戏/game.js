/* ============================================================
   《狐狸快跑呀》—— 微信小游戏版
   由网页版（狐狸快跑.html）移植而来：
   · 玩法核心（物理/障碍/道具/绘制/音乐）与网页版同源
   · 网页专属的 DOM 界面换成纯画布绘制（见 UI 层）
   · 所有【小游戏改造】注释 = 与网页版不同的地方
   ============================================================ */

/* ========== 1. 常量配置 ========== */
const W = 900, H = 300;        // 游戏画面的逻辑尺寸（实际显示会等比缩放）
const GROUND_Y = 256;          // 地面顶端的 y 坐标。注意：画布的 y 轴朝下，0 在最上方，数字越大越靠下
const GRAVITY  = 2400;         // 重力加速度（像素/秒²）
const JUMP_VY  = -820;         // 起跳瞬间的向上速度（负数代表向上）
const JUMP_CUT = -420;         // 提前松开跳跃键时，上升速度立刻衰减到这个值 →"长按跳更高"（越接近 0，轻点跳得越矮）
const SPEED_START = 230;       // 【血条Boss】初始奔跑速度由 280 调缓到 230（开局更从容，新手有时间反应）
const SPEED_MAX   = 820;       // 速度上限（后期才真正狂飙）
// 加速度分段递增：跑得越远提速越狠——"从慢到快、越来越难"的难度曲线
// 旧版是恒定 +9/秒，45 秒就飙到顶速；现在前 600 米很温柔，3500 米后才是地狱
function speedRamp(){
  const m = game.runDist / 12;   // 当前里程（米）
  // 【可玩性】分段提速：前 300 米温和(+5)让新手上手，300-800 米提速(+8)制造"要加油了"的压力递进，之后渐入狂飙
  return m < 300 ? 5 : m < 800 ? 8 : m < 1800 ? 11 : m < 3500 ? 13 : 15;
}
const SLIDE_DUR = 0.65;        // 【酷跑1】一次下滑持续多久（秒）。期间角色压矮，高处横杆从头顶掠过
const SLIDE_H   = 18;          // 【酷跑1】滑行时角色的等效高度（正常 h=36，滑行压到 18：碰撞框矮一半）
const COYOTE = 0.08;           // 土狼时间：离开地面后这么多秒内仍允许起跳（经典手感技巧）
const BUFFER = 0.12;           // 跳跃缓冲：落地前这么多秒内按下的跳跃，落地瞬间会自动执行
const CYCLE  = 80;             // 昼夜循环一圈的秒数
const ENDLESS = true;          // 【血条Boss】true=撞障碍走"扣血"分支(stumble 扣血，血空才死)，不再走经典"撞到即结束"；false=撞到障碍立刻 die()。掉坑(pit)永远是秒死，不吃血条
// 【血条Boss】玩家血条：撞障碍每次扣 22 血，约 4-5 次撞死；脱战回血 + 吃币微回血当缓冲
const PLAYER_MAX_HP = 100;     // 满血值
const BOSS_SCORE = 12000;      // 【血条Boss】第一次 Boss 战的分数门槛（普通玩家三五局够得到）；之后每 +18000 再来一只，中后期持续有高潮


/* ========== 2. 画布与缩放（微信小游戏适配层） ========== */
// 【小游戏改造】小游戏里没有网页 DOM：第一次 wx.createCanvas() 返回的就是手机屏幕画布，
// 之后再调用返回的都是"离屏画布"（先画到小画布、再放大贴上屏，像素风就是这么来的）
function readWindowInfo(){   // 【小游戏改造】优先用新接口 getWindowInfo（老接口有弃用警告），没有就回退
  try{ if(wx.getWindowInfo) return wx.getWindowInfo(); }catch(e){}
  return wx.getSystemInfoSync();
}
let sysInfo = readWindowInfo();
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
const homeCv = wx.createCanvas(); homeCv.width = 320; homeCv.height = 180;   // 主页像素场景
const hctx = homeCv.getContext('2d');
const loadCv = wx.createCanvas(); loadCv.width = 160; loadCv.height = 90;    // 加载过场
const lctx = loadCv.getContext('2d');
const shareCv = wx.createCanvas(); shareCv.width = 500; shareCv.height = 400;   // 【社交】分享战报图离屏画布
const shctx = shareCv.getContext('2d');
let shareImg = '';          // 战报图临时文件路径（canvasToTempFilePath 成功后填上，做分享卡配图）

// 游戏世界(900×300) → 手机屏幕 的等比缩放，多出来的上下空间是深色舞台边
let DPR = sysInfo.pixelRatio || 1;   // 【小游戏改造】设备像素比：UI 层的坐标都用"设备像素"
const VIEW = { s: 1, ox: 0, oy: 0 };
const SAFE = { l: 0, r: 0 };   // 【小游戏改造】刘海/圆角占掉的不可用边（设备像素）
let CAPSULE = null;            // 微信右上角胶囊按钮（"···◎"）的位置，永远盖在游戏上面
let hudInsetL = 0;             // 记分牌要右移多少（游戏坐标）才能躲开刘海
function resize(){
  sysInfo = readWindowInfo();   // 【小游戏改造】旋转/折叠屏后宽高会变，每次重新取
  DPR = sysInfo.pixelRatio || 1;
  canvas.width  = Math.round(sysInfo.windowWidth * DPR);
  canvas.height = Math.round(sysInfo.windowHeight * DPR);
  VIEW.s  = Math.min(canvas.width / W, canvas.height / H);
  VIEW.ox = (canvas.width  - W * VIEW.s) / 2;
  VIEW.oy = (canvas.height - H * VIEW.s) / 2;
  ctx.setTransform(VIEW.s, 0, 0, VIEW.s, VIEW.ox, VIEW.oy);
  // 【小游戏改造】iPhone 刘海屏：系统会告诉我们哪块是"安全区域"，记分牌往里挪
  // 【真机修复】iPhone 刚转完横屏的一瞬间，safeArea 可能还是竖屏的旧值（右边界远小于窗口宽度），
  // 拿它算布局会把按钮挤到屏幕中间——所以先"验真"：对不上当前窗口的一律不信，宁可贴边不能歪
  const sa = sysInfo.safeArea;
  const saOK = sa && sa.right <= sysInfo.windowWidth + 2 && sa.right >= sysInfo.windowWidth * 0.8;
  SAFE.l = saOK ? Math.max(0, sa.left) * DPR : 0;
  SAFE.r = saOK ? Math.max(0, sysInfo.windowWidth - sa.right) * DPR : 0;
  try{ if(wx.getMenuButtonBoundingClientRect) CAPSULE = wx.getMenuButtonBoundingClientRect(); }catch(e){}
  // 胶囊位置同样验真：必须真的待在"当前窗口"的右上角，否则当它不存在（走兜底布局）
  if(CAPSULE && !(CAPSULE.right <= sysInfo.windowWidth + 2 && CAPSULE.right > sysInfo.windowWidth * 0.6 &&
                  CAPSULE.bottom < sysInfo.windowHeight * 0.5)){
    CAPSULE = null;
  }
  hudInsetL = Math.max(0, (SAFE.l - VIEW.ox) / VIEW.s);
}
resize();
// 屏幕旋转/窗口变化时跟着重新铺画布（真机横竖屏切换、开发者工具点旋转按钮都走这里）
if(wx.onWindowResize){ try{ wx.onWindowResize(function(){ resize(); }); }catch(e){} }
// 【真机修复】iPhone 进横屏有个过程：开局后再自动校准两次，等 safeArea/胶囊换算成横屏的真值
setTimeout(resize, 600);
setTimeout(resize, 2000);
// 每帧先把整块屏幕刷成深色，舞台边永远干净
function clearDevice(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// 【小游戏改造】localStorage 替身：小游戏的存档接口是 wx.setStorageSync / getStorageSync
var localStorage = {
  getItem(k){ try{ const v = wx.getStorageSync(k); return (v === '' || v === undefined || v === null) ? null : String(v); }catch(e){ return null; } },
  setItem(k, v){ try{ wx.setStorageSync(k, String(v)); }catch(e){} },
  removeItem(k){ try{ wx.removeStorageSync(k); }catch(e){} },
};
// 【小游戏改造】performance.now 替身（部分真机没有这个接口）
var performance = { now: function(){ return Date.now(); } };

// 切后台自动暂停 + 存档（对应网页版的 visibilitychange / pagehide）
let appHidden = false;
wx.onHide(function(){
  appHidden = true;
  if(game.state === 'playing') paused = true;
  saveBest();
  stopBGM();
});
wx.onShow(function(res){
  appHidden = false;
  resize();   // 【真机修复】切回前台重新校准布局（安全区/胶囊可能刚刷新）
  // 【小游戏改造】热启动带的新参数只出现在这里（后台时点了好友的挑战卡片）
  if(res && res.query) parseChallengeQuery(res.query);
});

// 触摸事件统一交给 UI 层分发（按下=点按钮/跳，移动=商店列表滚动，松开=收跳）
// 【小游戏改造】传给 UI 的是"设备像素坐标"（clientX × dpr），和 UI.zones 登记的按钮坐标同一套；
// 游戏内的跳跃不看坐标，所以不用再换算成游戏世界坐标了
// 多指防错乱：永远跟踪"最新按下的那根手指"。changedTouches 才是本次新按下的，
// touches[0] 是最早按下还没抬起的旧手指——用它会把旧手指的坐标错挂到新点击上
let activeTouchId = null;
function touchOf(list, id){
  if(!list) return null;
  for(let i = 0; i < list.length; i++){
    const t = list[i];
    if((t.identifier === undefined ? -1 : t.identifier) === id) return t;
  }
  return null;
}
wx.onTouchStart(function(e){
  const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
  if(!t) return;
  activeTouchId = (t.identifier === undefined ? -1 : t.identifier);
  UI.touchStart(t.clientX * DPR, t.clientY * DPR);
});
wx.onTouchMove(function(e){   // 【小游戏改造】商店货架要用手指拖着滚
  const t = touchOf(e.changedTouches, activeTouchId) || touchOf(e.touches, activeTouchId);
  if(!t) return;
  UI.touchMove(t.clientX * DPR, t.clientY * DPR);
});
function touchUp(e){
  // 只有"正在操作的那根手指"抬起才算松手：旁边手指抬起不打断跳跃/拖动
  if(e && e.changedTouches && e.changedTouches.length && !touchOf(e.changedTouches, activeTouchId)) return;
  activeTouchId = null;
  UI.touchEnd();
}
wx.onTouchEnd(touchUp);
wx.onTouchCancel(touchUp);

try{ wx.setKeepScreenOn({ keepOn: true }); }catch(e){}   // 玩的时候屏幕别自动熄灭

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
    // 【小游戏改造】小游戏的 WebAudio 入口是 wx.createWebAudioContext()
    let AC = null;
    try{ AC = wx.createWebAudioContext ? wx.createWebAudioContext() : null; }catch(e){ AC = null; }
    if(AC){
      actx = AC;
      masterGain = actx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(actx.destination);
    }
  }
  // 只要不在播放状态就尝试恢复（iOS 上来电/切后台会把状态变成 'interrupted'）
  if(actx && actx.state !== 'running' && actx.resume){ try{ actx.resume().catch(() => {}); }catch(e){} }
}
// 【小游戏改造】不用 OscillatorNode（部分安卓机没有），改成自己算 PCM 波形塞进 AudioBuffer
function waveSample(type, phase){
  const p = phase % 1;
  if(type === 'sine') return Math.sin(p * TAU);
  if(type === 'square') return p < 0.5 ? 1 : -1;
  if(type === 'sawtooth') return 2 * p - 1;
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;   // triangle
}
const toneCache = new Map();   // 【小游戏改造】音色缓存：同一种音符只合成一次，之后直接播（手机省电不掉帧）
function playTone(f0, f1, dur, type, vol, when){
  if(!actx || !masterGain) return;
  try{
    const key = type + '|' + f0 + '|' + f1 + '|' + dur + '|' + vol;
    let buf = toneCache.get(key);
    if(!buf){
      const sr = 44100, total = Math.max(1, Math.floor(sr * (dur + 0.03))), nd = Math.max(1, Math.floor(sr * dur));
      buf = actx.createBuffer(1, total, sr);
      const data = buf.getChannelData(0);
      // 衰减和滑音都写成"每个采样乘一个固定系数"的递推：
      // 衰减终点是绝对值 0.0001（网页版 exponentialRamp 的语义），不是 vol×0.0001——之前算错了会让尾音断得太快
      let phase = 0, env = vol, f = Math.max(1, f0);
      const envMul = Math.pow(0.0001 / vol, 1 / nd);
      const fMul = Math.pow(Math.max(1, f1) / Math.max(1, f0), 1 / nd);
      for(let i = 0; i < total; i++){
        phase += f / sr;
        data[i] = i < nd ? waveSample(type, phase) * env : 0;
        if(i < nd){ env *= envMul; f *= fMul; }
      }
      if(toneCache.size < 200) toneCache.set(key, buf);   // 防御上限：实际只有几十种音符
    }
    const s = actx.createBufferSource();
    s.buffer = buf;
    s.connect(masterGain);
    s.start(when);
  }catch(e){}
}
// 万能小喇叭：给定起始频率、结束频率、时长、波形，就能合成一个音效
function beep(o){
  if(muted || !actx) return;
  const f0 = o.f0, f1 = (o.f1 === undefined ? o.f0 : o.f1);
  const dur = o.dur || 0.1, type = o.type || 'square';
  const vol = o.vol || 0.045, delay = o.delay || 0;
  playTone(f0, f1, dur, type, vol, actx.currentTime + delay);   // 【小游戏改造】走 PCM 合成
}
const sfx = {
  jump(mult){ const m = mult || 1;   // mult 越大音调越高（连跳的第二、三段用）
              beep({f0:340*m, f1:680*m, dur:0.13, type:'square', vol:0.04}); },
  land(){ beep({f0:160,  f1:90,   dur:0.07, type:'triangle', vol:0.035}); },
  slide(){ beep({f0:180, f1:70, dur:0.22, type:'sawtooth', vol:0.045}); },   // 【酷跑1】下滑：一道低沉下滑的"唰"
  coin(){ const k = 1 + Math.min(combo, 24) * 0.03;   // 【手感】连吃币升调：连击越高音越往上爬（封顶 24 连，约 1.7 倍），听得出"越串越爽"
          beep({f0:1175*k, dur:0.06, type:'sine', vol:0.05});
          beep({f0:1568*k, dur:0.09, type:'sine', vol:0.05, delay:0.06}); },
  graze(){ beep({f0:1700, f1:2500, dur:0.06, type:'sine', vol:0.045}); },   // 【手感】险过：一声清脆上扬的"嗖"
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
// 【小游戏改造】网页版的功能图标是内联 SVG；小游戏画布画不了 SVG，
// 暂停/静音的小图标改成在 UI 层用矩形、三角形直接画（见 drawGameBtns）
function toggleMute(){
  muted = !muted;
  try{ localStorage.setItem('fox_muted', muted ? '1' : '0'); }catch(e){}
  if(masterGain) masterGain.gain.value = muted ? 0 : 1;   // 总闸立刻生效，连已排队的音符都会消失
  if(muted) stopBGM();
  else { ensureAudio(); startBGM(); }   // 取消静音时把音乐续上
}
/* —— 首次进入引导（照片当主角）：交互在画布 UI 层（drawAvatarAsk），这里只留状态 —— */
let startAfterAvatar = false;   // 弹窗关闭后是否直接开局
function avatarAskOpen(){ return uiAvatarAsk; }   // 【小游戏改造】开关由画布 UI 层维护

/* —— 背景音乐：三个乐章 × 每章两首，跑得越远节奏越快（0~2500米 / 2500~5000 / 5000+） —— */
// 数字是 MIDI 音高（69 = 标准音 A4，每 +12 升一个八度），0 = 休止符
// 【音乐多样化】BGM_TRACKS[乐章][第几首]：每个乐章准备了 A/B 两首，开局抽一首听到底，免得听腻
const BGM_TRACKS = [
  [ // —— 第一乐章（0~2500米）——
    { step: 0.25,   // 曲A·悠闲：C→G→Am→F 万能四和弦（原版）
      melody: [ 76,79,84,79, 76,79,72,76,  74,79,83,79, 74,79,71,74,
                76,81,84,81, 76,81,72,76,  77,81,84,81, 77,84,81,77 ],
      bass:   [ 48,55,48,55, 43,50,43,50, 45,52,45,52, 41,48,41,48 ] },
    { step: 0.25,   // 曲B·轻快民谣：F→C→G→Am，旋律一级一级走（像哼小曲），不是琶音
      melody: [ 77,79,81,77, 81,79,77,74,  76,77,79,76, 72,74,76,72,
                74,76,79,81, 79,76,74,71,  72,74,76,77, 76,74,72,69 ],
      bass:   [ 41,48,45,48, 36,43,40,43, 43,50,47,50, 45,52,48,52 ] },
  ],
  [ // —— 第二乐章（2500~5000米）——
    { step: 0.22,   // 曲A·加速：Am→F→C→G，更有冲劲（原版）
      melody: [ 81,84,88,84, 81,84,76,81,  77,81,84,81, 77,81,72,77,
                76,79,84,79, 76,79,72,76,  79,83,86,83, 79,83,74,79 ],
      bass:   [ 45,52,45,52, 41,48,41,48, 48,55,48,55, 43,50,43,50 ] },
    { step: 0.22,   // 曲B·电子小调：Am→G→F→E 一路下沉，休止符断奏 + 低音蹦八度，像合成器
      melody: [ 81,0,81,84, 81,0,76,81,  79,0,79,83, 79,0,74,79,
                77,0,77,81, 77,0,72,77,  76,0,76,80, 76,80,83,88 ],
      bass:   [ 45,57,45,57, 43,55,43,55, 41,53,41,53, 40,52,40,52 ] },
  ],
  [ // —— 第三乐章（5000米+）——
    { step: 0.19,   // 曲A·狂飙：Em→C→G→D，高潮段（原版）
      melody: [ 76,79,83,88, 83,79,76,79,  72,76,79,84, 79,76,72,76,
                79,83,86,91, 86,83,79,83,  74,78,81,86, 81,78,74,78 ],
      bass:   [ 40,47,40,47, 36,43,36,43, 43,50,43,50, 38,45,38,45 ] },
    { step: 0.18,   // 曲B·急板：Dm→B♭→F→A 小调冲刺，结尾一口气冲上最高音再绕回开头
      melody: [ 74,77,81,86, 81,77,74,77,  70,74,77,82, 77,74,70,74,
                72,77,81,84, 81,77,72,77,  73,76,81,85, 81,85,88,91 ],
      bass:   [ 38,45,38,45, 46,53,46,53, 41,48,41,48, 45,52,45,52 ] },
  ],
];
// 【音乐多样化】奖励关专属欢快小调：C 大调琶音节节向上，48 个音 × 0.16 秒 ≈ 8 秒一圈
const BGM_BONUS = {
  step: 0.16,
  melody: [ 72,76,79,84, 76,79,84,88,  77,81,84,89, 81,84,89,84,
            79,83,86,91, 86,83,79,83,  72,76,79,84, 88,84,79,76,
            69,72,76,81, 72,76,81,84,  79,83,86,88, 91,0,84,0 ],
  bass:   [ 48,55,48,55, 41,48,41,48, 43,50,43,50, 48,55,48,55, 45,52,45,52, 43,50,36,48 ],
};
// 【主页音乐】大厅摇篮曲：柔和的 C 大调摇摆，等玩家点"开始"（首次点击屏幕后才有声音，这是平台规定）
const BGM_MENU = { step: 0.3,
  melody: [ 72,0,76,79, 84,0,79,76, 74,0,77,81, 86,0,81,77,
            76,0,79,84, 88,0,84,79, 77,0,81,84, 79,0,74,0 ],
  bass:   [ 48,55,52,55, 50,57,53,57, 52,59,55,59, 53,57,50,43 ] };
// 当前该放第几乐章：按本局跑的里程分段
function bgmTier(){
  if(game.state !== 'playing') return 0;
  const m = game.runDist / 12;
  return m >= 5000 ? 2 : m >= 2500 ? 1 : 0;
}
let bgmVariant = 0;   // 【音乐多样化】这一局每个乐章听第几首（0=曲A 1=曲B，开局抽签、整局固定）
const bgm = { on: false, step: 0, nextTime: 0, timer: null, track: null };   // track = 此刻正在放的那首

function midiToFreq(m){ return 440 * Math.pow(2, (m - 69) / 12); }
function playNote(midi, t, dur, type, vol){
  playTone(midiToFreq(midi), midiToFreq(midi), dur, type, vol, t);   // 【小游戏改造】走 PCM 合成
}
// 【音乐多样化】此刻该放哪首：奖励关期间优先放专属欢快小调；平时按里程乐章 + 本局抽中的 A/B
function bgmPick(){
  if(game.state !== 'playing') return BGM_MENU;   // 【主页音乐】不在跑就放大厅摇篮曲
  if(bgTime < bonusUntil) return BGM_BONUS;   // 奖励关结束自然切回
  return BGM_TRACKS[bgmTier()][bgmVariant];
}
// WebAudio 的常用玩法：用一个普通定时器，把"接下来一秒多"的音符提前排进播放队列
function scheduleBGM(){
  if(!actx || muted) return;
  if(paused || appHidden) return;   // 【小游戏改造】   // 暂停或切到后台时，音乐也跟着停
  // 停了一阵子（暂停/后台回来）的话，把排队起点拉回"现在"，避免一瞬间补播一堆旧音符
  if(bgm.nextTime < actx.currentTime) bgm.nextTime = actx.currentTime + 0.05;
  const trk = bgmPick();
  if(trk !== bgm.track){ bgm.track = trk; bgm.step = 0; }   // 【音乐多样化】换乐章/换曲子：拍子从头数，防止下标错位
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
                petOwned: ['star'], petActive: 'star',   // 【酷跑2】萌宠：已拥有列表 / 当前出战（默认就送星宝）
                talents: {},   // 【酷跑2】天赋养成树：每个天赋 id → 已升等级（金币永久升级，越肝越强）
                stageMax: 1, stageProg: {},   // 【酷跑2】闯关：已解锁到第几关(默认只开第1关) / 每关历史最高星数 {关卡id: 星}
                runs: 0, pitsSeen: 0, barSeen: false, freeReviveUsed: false, nick: '',
                lastLogin: '', streak: 0, daily: null, dailyRun: null,
                bestDist: 0, lastBeat: '', skins: {}, skinOn: {},
                // 【留存包】③累计统计 ④成就称号 ⑤明日/回归礼包 ⑥周段位（老存档没有这些字段，全靠这里兜底）
                stat: {}, ach: { un: {}, title: '' },
                gift: { lastPlay: '', claimed: '', lastPlayTs: 0 },
                week: { key: '', best: 0 } };
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
      // 【留存包】新字段都是"对象套对象"：老存档合并后可能缺内层字段，逐项兜底（老玩家的档不能崩）
      if(!out.stat || typeof out.stat !== 'object') out.stat = {};
      if(!out.ach || typeof out.ach !== 'object') out.ach = { un: {}, title: '' };
      if(!out.ach.un || typeof out.ach.un !== 'object') out.ach.un = {};
      if(typeof out.ach.title !== 'string') out.ach.title = '';
      if(!out.gift || typeof out.gift !== 'object') out.gift = { lastPlay: '', claimed: '', lastPlayTs: 0 };
      if(!out.week || typeof out.week !== 'object') out.week = { key: '', best: 0 };
      // 【酷跑2】萌宠存档兜底 + 平滑迁移：老存档没有 petOwned/petActive 字段，且老的"星宝"是 save.pet===true。
      if(!Array.isArray(out.petOwned)) out.petOwned = [];
      if(out.pet === true && !out.petOwned.includes('star')) out.petOwned.push('star');   // 老星宝→新图鉴里的 star
      if(out.petOwned.length === 0) out.petOwned = ['star'];   // 谁都默认送一只星宝（和新档一致）
      if(out.petActive !== null && !out.petOwned.includes(out.petActive)) out.petActive = out.petOwned[0];   // 出战的得是拥有的
      // 【酷跑2】天赋存档兜底：老存档没有 talents 字段（或被写坏成非对象），统一补成空对象，老档不崩
      if(!out.talents || typeof out.talents !== 'object') out.talents = {};
      // 【酷跑2】闯关存档兜底：老存档没有 stageMax/stageProg，补默认（至少解锁第 1 关），老档不崩
      if(typeof out.stageMax !== 'number' || out.stageMax < 1) out.stageMax = 1;
      if(!out.stageProg || typeof out.stageProg !== 'object') out.stageProg = {};
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
const face = { mood: '', until: 0 };   // mood: 'hurt'=痛 | 'joy'=开心 | 'focus'=专注(【酷跑1】下滑) | ''=平常
function setFace(mood, dur){ face.mood = mood; face.until = bgTime + dur; }

/* —— 真人头像：用户上传的照片（存在存档里，角色的头会换成它） —— */
let avatarImg = null;
function loadAvatarImg(){
  if(!save.avatar) return;
  avatarImg = wx.createImage();   // 【小游戏改造】小游戏里造图片用 wx.createImage()
  avatarImg.onload = function(){ avatarImg.complete = true; avatarImg.naturalWidth = avatarImg.width || 1; };
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
  earlyMile: 0,        // 【可玩性】本局已报过的早期里程碑(300/500/750米)档位
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
let playerHP = 100;         // 【血条Boss】玩家当前血量（局内运行时状态，不存档；startGame 重置）
let lastHurtAt = -99;       // 【血条Boss】上次受伤时刻——脱战 2 秒后才开始回血
let boss = null;            // 【血条Boss】当前 Boss 战对象（null=没在打 Boss）；局内运行时状态，不存档
let bossDefeated = false;   // 【血条Boss】本局是否击败过至少一只 Boss（成就/统计用）
let bossAt = BOSS_SCORE;    // 【血条Boss】下一只 Boss 的触发分数（击败后 +18000，中后期循环出现）
let bossMode = false;       // 【血条Boss】Boss 战期间：暂停生成普通障碍/收集物，画面只剩 Boss 与其弹幕
const bossAtks = [];        // 【血条Boss】Boss 的攻击物（火球/落石/冲击波），与普通 obstacles 分开管理

/* —— 道具系统 —— */
// 【内容扩展】shrink/scorex3 三秒数也进来：基础持续秒数；shrink 略短(怕一直钻太无脑)，scorex3 适中
const POWER_DUR  = { dash: 4, giant: 7, magnet: 9, coinx2: 8, fly: 6, slow: 5, shrink: 6, ghost: 5, scorex3: 7 };   // 各道具的基础持续秒数
const POWER_INFO = {
  dash:   { name: '冲刺', color: '#ffd34d' },   // 高速狂奔，撞碎一切，顺带吸金币
  giant:  { name: '变大', color: '#c77dff' },   // 巨大化，横着撞碎障碍
  magnet: { name: '磁铁', color: '#ff6b6b' },   // 附近的金币自动飞过来
  coinx2: { name: '双倍金币', color: '#5ce1e6' },   // 期间每枚金币算两枚
  shield: { name: '护盾', color: '#8ecaff' },   // 挡下一次撞击（不占道具栏）
  fly:    { name: '飞行', color: '#ffa7e2' },   // 飞上天巡航：无敌 + 自带磁吸
  slow:   { name: '时停', color: '#b0fc38' },   // 世界减速 45%，喘口气仔细操作
  // 【内容扩展】三种新道具：缩小=钻低障碍，幽灵=穿障保命，分数狂潮=得分×3
  shrink: { name: '缩小', color: '#6ee7b7' },   // 玩家变小：碰撞框缩小，能从低矮障碍下钻过
  ghost:  { name: '幽灵', color: '#cdd6ff' },   // 半透明：穿过障碍不受伤（不撞碎不加分，纯保命）
  scorex3:{ name: '分数狂潮', color: '#ffb02e' },   // 期间所有得分来源 ×3
};
const power = { type: null, until: 0, total: 1 };   // 移动系道具槽（冲刺/变大/飞行 互斥）
let magnetUntil = 0, magnetTotal = 1;   // 收益系：磁铁——独立计时，可与任何道具叠加
let coinx2Until = 0, coinx2Total = 1;   // 收益系：双倍金币
let slowUntil = 0, slowTotal = 1;       // 收益系：时停（世界慢下来）
// 【内容扩展】三种新道具都走"独立计时器"，不挤占移动系主槽 power.type（与磁铁/双倍金币同款机制）
let shrinkUntil = 0, shrinkTotal = 1;       // 状态系：缩小（碰撞框+身形缩小）
let ghostUntil = 0, ghostTotal = 1;         // 防护系：幽灵（穿障无伤）
let scorex3Until = 0, scorex3Total = 1;     // 收益系：分数狂潮（得分 ×3）
let goldStorm = false;                  // 组合技：冲刺 × 双倍金币 = ⚡黄金风暴
const items = [];                                   // 场上漂浮的道具
let distToItem = 1200;      // 【可玩性】首个道具大幅提前：约第6秒拿到第一个 buff，补齐开局正反馈（原2200≈40秒太晚）

/* —— 【内容扩展】跑酷收集玩法：神秘宝箱 + 字母收集 —— */
//  ① 神秘宝箱(mysteryBox)：跑道上偶尔出现一个发光宝箱，碰到开箱随机大奖（金币爆发/道具/钻石/表现分）
const boxes = [];           // 场上漂浮的神秘宝箱（同时最多一个，别太频繁）
let distToBox = 1500;       // 还要跑多远出现下一个宝箱（首个早点见到；之后间隔变大→每局约 1~3 个）
let boxCount = 0;           // 本局已开过几个宝箱（控制频率 + 局末累加成就）
//  ② 字母收集：沿途掉「狐/狸/快/跑」四张发光字卡，集齐四张 → 大奖励；HUD 角落显示进度，每局重置
const LETTER_CHARS = ['狐', '狸', '快', '跑'];   // 集齐顺序固定（四格点亮）
const letters = [];         // 场上漂浮的字母卡
let distToLetter = 900;     // 还要跑多远掉下一张字母卡
let letterGot = [false, false, false, false];   // 本局四张字母是否已收集（局内变量，不存档）
let letterDoneShown = false;   // 本局"集齐庆祝"是否已播（防止集齐后重复触发）
function letterCount(){ let n = 0; for(const g of letterGot) if(g) n++; return n; }   // 已集齐张数

/* —— v2.0 新系统 —— */
let bonusUntil = 0;         // 超级奖励时间的截止时刻（吃金币攒出来的福利关）
let bonusCount = 0;         // 本局进过几次奖励关（决定轮到哪种玩法）
let bonusKind = 0;          // 本次奖励关玩法：0=大头雨 1=飞天黄金 2=狂暴冲撞
let nextBonusAt = 30;       // 【可玩性】首次奖励关门槛 50→30：新手约35秒就体验第一次高潮，之后 +150（原+180）保留稀缺感
let reviveCount = 0;        // 本局已复活次数（复活费一次比一次贵：200、400、600……）
let shieldOn = false;       // 护盾道具：挡一次撞击
// 【追逐】巨石追击事件：周期触发的高紧张段——撞障碍会让巨石猛逼近，干净跑完这段甩掉它给奖励
let chaseUntil = 0;         // 本次追击的结束时刻
let chaseX = -260;          // 巨石"右边缘"的屏幕 x（< player.x 即在身后；追上玩家=撞击）
let nextChaseAt = 900;      // 【可玩性】首次巨石追击 1500→900 米：常死在600-1200米的新手也能撞上这个逃命爽点
let chaseRewarded = true;   // 本次追击的"甩掉奖励"是否已发（初始 true=没在追击）
const CHASE_CREEP = 11;     // 巨石每秒匀速逼近的像素（基础压力）
const CHASE_LURCH = 40;     // 追击中每撞一次障碍，巨石额外猛逼近的像素
let petPulseAt = 0, petPulseUntil = 0;   // 精灵·星宝的吸金币脉冲计时
let petSmashAt = 0;                       // 【酷跑2】铁拳熊：下一次自动撞碎障碍的时刻
let petSmashFx = 0;                       // 【酷跑2】铁拳熊：撞击特效（拳印）残留到的时刻
let petReviveUsed = false;               // 【酷跑2】不死鸟：本局是否已自动复活过
let bunny = null;           // 钻石兔（场上最多一只）
let distToBunny = 8000;     // 还要跑多远钻石兔才出现
let nextMeteorAt = 5000;    // 💫 流星雨事件的下一个触发里程（米，5000 米后的后期内容）
const banner = { text: '', until: 0, color: '#ffd34d' };   // 屏幕中央的大横幅
function showBanner(text, dur, color){
  banner.text = text; banner.until = bgTime + dur; banner.color = color || '#ffd34d';
}

/* —— v3.0：每日系统 / 今日挑战 / 挑战链接 —— */
let challenge = null;        // 从挑战链接进来的对战目标 {score, name}
let dailyMode = false;       // 是否在"今日挑战"模式（全国同一天同一张图）
let recordFlagShown = false; // 本局"接近纪录旗"横幅是否已播

/* —— 【酷跑2】闯关冒险模式：对标天天酷跑"冒险模式"——一关一关打，有终点、有三星目标 ——
 *   adventureMode：是否在闯关；curStage：当前关卡数据；本关进度三件套——
 *   stageStars=本关已评几星 / stageHurt=本关是否受过伤（撞障碍/掉血即 true，3星之"不受伤"判据）
 *   stageCoins=本关已收集金币数（3星之"集够金币"判据）。
 *   STAGES：12 关，难度递增——dist(终点米数) 从 300 渐增到 3000+，goalCoins(三星之一所需金币) 同步递增。
 *   闯关用"关卡 id 当随机种子"→ 同一关每次同图，可背板（和日赛走同一套 seededRng）。*/
let adventureMode = false;   // 是否在闯关冒险模式（无尽/日赛之外的第三模式）
let curStage = null;         // 当前关卡对象（来自 STAGES），非闯关时为 null
let stageStars = 0;          // 本关结算评定的星数（finishStage 里算）
let stageHurt = false;       // 本关是否受过伤（撞障碍/掉坑/扣血会置 true → 失去"不受伤"星）
let stageCoins = 0;          // 本关已收集金币数（达到 goalCoins → 得"收集"星）
const STAGES = [
  { id: 1,  name: '草原起跑',   dist: 300,  goalCoins: 8,   reward: { coins: 120,  gems: 0 },  biome: 0 },
  { id: 2,  name: '丛林初探',   dist: 450,  goalCoins: 12,  reward: { coins: 160,  gems: 0 },  biome: 1 },
  { id: 3,  name: '沙海跋涉',   dist: 600,  goalCoins: 16,  reward: { coins: 200,  gems: 1 },  biome: 2 },
  { id: 4,  name: '雪原疾行',   dist: 800,  goalCoins: 22,  reward: { coins: 260,  gems: 0 },  biome: 3 },
  { id: 5,  name: '黄昏古道',   dist: 1000, goalCoins: 28,  reward: { coins: 320,  gems: 1 },  biome: 4 },
  { id: 6,  name: '溶洞探秘',   dist: 1300, goalCoins: 36,  reward: { coins: 400,  gems: 0 },  biome: 5 },
  { id: 7,  name: '花海狂奔',   dist: 1600, goalCoins: 44,  reward: { coins: 480,  gems: 1 },  biome: 6 },
  { id: 8,  name: '云端天路',   dist: 1900, goalCoins: 54,  reward: { coins: 600,  gems: 2 },  biome: 7 },
  { id: 9,  name: '熔岩险境',   dist: 2200, goalCoins: 64,  reward: { coins: 720,  gems: 1 },  biome: 8 },
  { id: 10, name: '星夜飞驰',   dist: 2500, goalCoins: 76,  reward: { coins: 880,  gems: 2 },  biome: 9 },
  // 通关大奖：第 11 关送一只钻石角色（雪狐飘飘），第 12 关送传说龙
  { id: 11, name: '极速峡谷',   dist: 2800, goalCoins: 88,  reward: { coins: 1000, gems: 2, char: 'snowfox' } },
  { id: 12, name: '终极冲刺',   dist: 3200, goalCoins: 100, reward: { coins: 1500, gems: 3, char: 'dragon' } },
];
function curStageBiome(){ return (curStage && typeof curStage.biome === 'number') ? curStage.biome : 0; }   // 没指定就用草原
// 【酷跑2】"纯无尽局专属"判据：既不是日赛也不是闯关。Boss/流星雨/钻石兔/奖励关/破纪录横幅等只在纯无尽出现，
//   闯关有自己的终点与三星节奏，和日赛一样把这些大事件关掉（保证同图、关卡时长可控）。
function endlessOnly(){ return !dailyMode && !adventureMode; }
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
// 【内容扩展】分数狂潮：生效期间所有"加分来源"统一乘 3（撞碎/吃金币额外分/里程都过这个口子）
function scoreMult(){ return bgTime < scorex3Until ? 3 : 1; }
let seededRng = Math.random;
// 【酷跑2】闯关也走种子：每关固定种子=关卡 id，保证同一关每次都是同一张图，可背板（与日赛同套机制）
function srand(){ return (dailyMode || adventureMode) ? seededRng() : Math.random(); }   // 生成赛道内容专用的随机数
function srange(a, b){ return a + srand() * (b - a); }

// 【内容扩展】开局生成本局"视觉世界出场顺序"：把全部世界下标打乱排成一队。
//   用 srand → 日赛(dailyMode)走日期种子，当天全国同一串世界顺序，普通局每局随机。
//   首段固定从 0 号草原开场（新手第一眼是熟悉的草原，跑出 1200 米才进第一个新世界）。
function buildWorldSeq(){
  // 【酷跑2】闯关：每关用自己指定的 biome 打头（给每关一个专属世界外观），其余世界随种子洗牌跟在后面。
  //   非闯关：和原来一样固定从 0 号草原开场。
  const lead = (adventureMode && curStage) ? (curStageBiome() % WORLD_THEMES.length) : 0;
  const rest = [];
  for(let i = 0; i < WORLD_THEMES.length; i++){ if(i !== lead) rest.push(i); }
  // Fisher–Yates 洗牌，随机源用 srand（日赛/闯关=固定种子）
  for(let i = rest.length - 1; i > 0; i--){
    const j = Math.floor(srand() * (i + 1));
    const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
  }
  worldSeq = [lead].concat(rest);
  curWorldName = '';   // 重置"上一个世界名"，开局第一段不抢着弹横幅
}

/* —— 出发加成（主页里花金币买，下一局生效） —— */
let pendingSprint = 0;    // 开局冲刺的米数（0=没买）
let pendingShield = false;
let resumeUntil = 0;      // 暂停恢复的 3-2-1 倒计时（真实时间毫秒，0=没在倒计时）
let mothUsed = false;     // 月光蝶救援本局是否已用过
let boostDist = 0;        // 本局开局冲刺还要冲到的距离（像素）
let curBgmTier = 0;       // 当前音乐段位（0/1/2，里程越远节奏越快）
let curBiome = 0;         // 当前"视觉世界"序号（索引 WORLD_THEMES），岩石/装饰按它取色
// 【内容扩展】世界轮换：每局把所有世界打乱排成一队，跑动中循环切换，短局也能见到新世界
let worldSeq = [0];       // 本局的世界出场顺序（一串 WORLD_THEMES 下标）
let curWorldName = '';    // 当前世界名，进新世界时用来判断是否需要弹横幅

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
  // 【小游戏改造】网页版往地址栏写"战书链接"；小游戏改成微信分享卡片，
  // 分享参数在 UI 层的 wx.onShareAppMessage 里现取现拼，这里不用做事了
  // 【留存包】好友排行榜的数据源：把最高分悄悄存到微信云端。
  // 主域按微信的隐私规则拿不到好友数据，但"开放数据域"（open-data/index.js）
  // 可以读到每个好友存的这条 score，拼成排行榜画给我们看
  try{ wx.setUserCloudStorage({ KVDataList: [{ key: 'score', value: String(game.best) }] }); }catch(e){}
}
// 【社交接通】统一生成分享/战书的 {title, query}：日赛带 d=日期(接通"喊好友比今日挑战"那条死链)，平时带最高分挑战书
function buildShare(){
  const nick = save.nick || '神秘小狐狸';
  if(dailyMode){
    const drB = (save.dailyRun && save.dailyRun.date === todayStr()) ? save.dailyRun.best : (game.score || 0);
    return {
      title: playerTitle() + nick + ' 今日挑战跑了 ' + drB + ' 分，全国同一张图，敢来比吗？',
      query: 'd=' + todayStr() + '&c=' + drB + '&n=' + encodeURIComponent(nick) + '&s=' + challengeSum(drB, nick),
      imageUrl: shareImg || undefined,   // 【战报图】有就用，没有就退回微信默认截图
    };
  }
  if(game.best > 0){
    return {
      title: playerTitle() + nick + ' 在狐狸快跑呀跑了 ' + game.best + ' 分，不服来战！',
      query: 'c=' + game.best + '&n=' + encodeURIComponent(nick) + '&s=' + challengeSum(game.best, nick),
      imageUrl: shareImg || undefined,
    };
  }
  return { title: '狐狸快跑呀——像素跑酷，来比比谁跑得远！', query: '' };
}
// 【社交·战报图】把"角色+称号+分数+挑衅"渲染成一张可炫耀的图，当分享卡配图（比一行字传播力强一个量级）
function renderShareCard(){
  const c = shctx;
  const g = c.createLinearGradient(0, 0, 0, 400);   // 黄昏渐变底
  g.addColorStop(0, '#241a4d'); g.addColorStop(0.55, '#3b2a6b'); g.addColorStop(1, '#7e4a84');
  c.fillStyle = g; c.fillRect(0, 0, 500, 400);
  c.fillStyle = 'rgba(255,255,255,0.45)';           // 星点点缀
  for(let i = 0; i < 26; i++) c.fillRect((i * 83 % 470) + 12, (i * 47 % 150) + 12, 2, 2);
  c.fillStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 0;   // 内描边框
  c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 3; c.strokeRect(10, 10, 480, 380);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = 'bold 28px ' + FONT; c.fillStyle = '#ffd34d';
  c.fillText('🦊 狐狸快跑呀', 250, 44);
  c.save();   // 出战角色（小跑姿态）
  c.translate(250, 205); c.scale(2.7, 2.7);
  drawCharacter(c, CHARS[save.char] || CHARS.fox, {
    time: 0.2, grounded: true, swing: 0.5, gliding: false, blinking: 0, dead: false,
    pal: charC(save.char in CHARS ? save.char : 'fox'),
    avatar: (save.useAvatar && avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) ? avatarImg : null,
  });
  c.restore();
  const nick = save.nick || '神秘小狐狸';
  c.font = 'bold 19px ' + FONT; c.fillStyle = '#dfe6f5';
  c.fillText(playerTitle() + nick, 250, 250);
  c.font = 'bold 46px ' + FONT; c.fillStyle = '#ffd34d';
  c.fillText('最高 ' + game.best + ' 分', 250, 302);
  c.font = 'bold 20px ' + FONT; c.fillStyle = '#ff8aa0';
  c.fillText('🆚 敢来超过我吗？', 250, 350);
  c.font = '14px ' + FONT; c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fillText('微信搜「狐狸快跑呀」一起跑', 250, 382);
}
function genShareImg(){   // 渲染战报图并转成临时文件（异步；失败就退回无图分享，绝不影响分享本身）
  try{
    renderShareCard();
    wx.canvasToTempFilePath({ canvas: shareCv, success(res){ shareImg = res.tempFilePath; }, fail(){} });
  }catch(e){}
}
// 【社交接通】主动分享：玩家在结算/破纪录/击败好友时点按钮，直接弹起微信转发(把上面备好的战书发出去)
function shareChallenge(){
  try{ ensureAudio(); wx.shareAppMessage(buildShare()); }catch(e){}
}
// 【小游戏改造】挑战书从"链接参数"改成"微信分享卡片带的参数"。
// 注意：小游戏切到后台不会"重新打开页面"——冷启动看 getLaunchOptionsSync，
// 热启动（游戏还活在后台、玩家点了好友的挑战卡片进来）要在 wx.onShow 里再解析一次
function parseChallengeQuery(q){
  try{
    q = q || {};
    const cc = parseInt(q.c), nn = decodeURIComponent(q.n || '').slice(0, 12);
    if(cc > 0 && nn && parseInt(q.s) === challengeSum(cc, nn)){
      challenge = { score: cc, name: nn };
      showBanner('🆚 ' + nn + ' 向你发起挑战：' + cc + ' 分！', 4, '#ff8aa0');
    }
    if(q.d) showBanner('🌞 朋友喊你来比今日挑战！', 4, '#ffd34d');
  }catch(e){}
}
try{ parseChallengeQuery(wx.getLaunchOptionsSync().query); }catch(e){}

/* —— 【留存包】①连击Fever ②震动反馈 ③累计统计 ④成就称号 ⑤礼包 ⑥周段位 —— */
// ① 连击：吃金币 / 撞碎障碍 / 吃道具 / 跳过坑 都 +1；攒满 30 进入"狂热时刻"（5 秒得分加成）
let combo = 0, comboBest = 0, feverUntil = 0;
let hurtFlash = 0;          // 【打击感】受伤红闪到期时刻（bgTime）：撞击瞬间全屏红一下，配合顿帧放大"痛"
let jumpedRun = false;      // 【新手】本局是否跳过至少一次（没跳过时给"点屏幕跳"引导，第一局才弹）
function addCombo(){
  combo++;
  if(combo > comboBest) comboBest = combo;   // 记住本局连击峰值（局末写进存档）
  // 【酷跑2】天赋·狂热：触发狂热所需连击从 30 降到 max(10, 30-2*等级)。日赛 talentLv 为 0 → 仍是裸值 30
  const feverNeed = Math.max(10, 30 - 2 * talentLv('fever'));
  if(combo > 0 && combo % feverNeed === 0){   // 每攒满 feverNeed 连击触发一次狂热
    feverUntil = bgTime + 5;
    showBanner('🔥 狂热时刻！得分翻倍 5 秒', 2, '#ff8a5c');
    addStat('fevers', 1);
    juiceVibrate('fever');
  }
}
function breakCombo(){ combo = 0; }   // 真正受伤时调：连击断了（护盾挡住的不算）

// ② 震动反馈：手机轻轻"哒"一下，增加打击感（不支持的设备静默跳过）
function juiceVibrate(kind){
  try{ wx.vibrateShort({ type: 'light' }); }catch(e){}   // 恢复原版：统一轻震（之前的震动分级也一并撤掉，避免撞击过重）
}
// 【打击感】命中顿帧(hit-stop)：撞击瞬间把世界冻结几十毫秒，"撞到了"从看到变成感觉到
let freezeUntil = 0;
function hitStop(ms){ const now = performance.now(); if(now + ms > freezeUntil) freezeUntil = now + ms; }
// 【手感·险过】精准擦边躲过障碍 = 看得见的奖励：续连击 + 险! 飘字 + 清脆音 + 轻震 + 小火花
const GRAZE_MARGIN = 16;   // 贴脸判定：竖直间隙小于这么多像素就算"险过"
function doGraze(o){
  addCombo();
  game.bonus += scoreMult();
  juiceVibrate('graze');
  try{ sfx.graze(); }catch(e){}
  floatText(player.x + player.w / 2, player.y - player.h - 8, '险!', '#9fe8ff');
  burst(player.x + player.w / 2, player.y - player.h / 2, 5, ['#9fe8ff', '#ffffff']);
}

// ③ 累计统计：跨局累加进存档 save.stat（成就系统从这里读数）
function addStat(k, n){
  if(!save.stat) save.stat = {};
  save.stat[k] = (save.stat[k] || 0) + (n || 1);
}

// ④ 成就 + 称号：纯数据驱动（UI 层只管展示）。每类三档，最高档附带"称号"
const ACHIEVEMENTS = [
  { id: 'coins1',   name: '小有积蓄',   emoji: '💰', desc: '累计吃到 100 枚金币',    stat: 'coins',    goal: 100 },
  { id: 'coins2',   name: '财源滚滚',   emoji: '💰', desc: '累计吃到 1000 枚金币',   stat: 'coins',    goal: 1000 },
  { id: 'coins3',   name: '点金狐',     emoji: '💰', desc: '累计吃到 10000 枚金币',  stat: 'coins',    goal: 10000, title: '点金狐' },
  { id: 'jumps1',   name: '初学起跳',   emoji: '🦘', desc: '累计跳跃 100 次',        stat: 'jumps',    goal: 100 },
  { id: 'jumps2',   name: '跳个不停',   emoji: '🦘', desc: '累计跳跃 1000 次',       stat: 'jumps',    goal: 1000 },
  { id: 'jumps3',   name: '弹簧腿',     emoji: '🦘', desc: '累计跳跃 10000 次',      stat: 'jumps',    goal: 10000, title: '弹簧腿' },
  { id: 'smash1',   name: '小试拳脚',   emoji: '💥', desc: '累计撞碎 10 个障碍',     stat: 'smash',    goal: 10 },
  { id: 'smash2',   name: '拆迁队长',   emoji: '💥', desc: '累计撞碎 100 个障碍',    stat: 'smash',    goal: 100 },
  { id: 'smash3',   name: '破坏王',     emoji: '💥', desc: '累计撞碎 500 个障碍',    stat: 'smash',    goal: 500,   title: '破坏王' },
  { id: 'pits1',    name: '坑口求生',   emoji: '🕳', desc: '累计跳过 10 个坑',       stat: 'pits',     goal: 10 },
  { id: 'pits2',    name: '如履平地',   emoji: '🕳', desc: '累计跳过 100 个坑',      stat: 'pits',     goal: 100 },
  { id: 'pits3',    name: '跳坑大师',   emoji: '🕳', desc: '累计跳过 1000 个坑',     stat: 'pits',     goal: 1000,  title: '跳坑大师' },
  { id: 'bunnies1', name: '初遇钻石兔', emoji: '🐰', desc: '抓住 1 只钻石兔',        stat: 'bunnies',  goal: 1 },
  { id: 'bunnies2', name: '兔子克星',   emoji: '🐰', desc: '累计抓住 10 只钻石兔',   stat: 'bunnies',  goal: 10 },
  { id: 'bunnies3', name: '追兔猎人',   emoji: '🐰', desc: '累计抓住 50 只钻石兔',   stat: 'bunnies',  goal: 50,    title: '追兔猎人' },
  { id: 'fevers1',  name: '第一把火',   emoji: '🔥', desc: '触发 1 次狂热时刻',      stat: 'fevers',   goal: 1 },
  { id: 'fevers2',  name: '越烧越旺',   emoji: '🔥', desc: '累计触发 10 次狂热时刻', stat: 'fevers',   goal: 10 },
  { id: 'fevers3',  name: '狂热信徒',   emoji: '🔥', desc: '累计触发 50 次狂热时刻', stat: 'fevers',   goal: 50,    title: '狂热信徒' },
  { id: 'meters1',  name: '热身完毕',   emoji: '🏃', desc: '累计跑 5000 米',         stat: 'meters',   goal: 5000 },
  { id: 'meters2',  name: '长跑健将',   emoji: '🏃', desc: '累计跑 50000 米',        stat: 'meters',   goal: 50000 },
  { id: 'meters3',  name: '万里行者',   emoji: '🏃', desc: '累计跑 500000 米',       stat: 'meters',   goal: 500000, title: '万里行者' },
  { id: 'runs1',    name: '常来常往',   emoji: '🎮', desc: '累计开跑 10 局',         stat: 'runs',     goal: 10 },
  { id: 'runs2',    name: '百战老狐',   emoji: '🎮', desc: '累计开跑 100 局',        stat: 'runs',     goal: 100 },
  { id: 'runs3',    name: '肝帝',       emoji: '🎮', desc: '累计开跑 500 局',        stat: 'runs',     goal: 500,   title: '肝帝' },
  { id: 'combo1',   name: '渐入佳境',   emoji: '⚡', desc: '单局连击达到 30',        stat: 'maxCombo', goal: 30 },
  { id: 'combo2',   name: '行云流水',   emoji: '⚡', desc: '单局连击达到 60',        stat: 'maxCombo', goal: 60 },
  { id: 'combo3',   name: '连击之神',   emoji: '⚡', desc: '单局连击达到 100',       stat: 'maxCombo', goal: 100,   title: '连击之神' },
  { id: 'boss',     name: '屠龙者',     emoji: '🐉', desc: '击败一次 BOSS',          stat: 'boss',     goal: 1,     title: '屠龙者' },   // 【血条Boss】击败 50000 分 Boss 解锁（loadSave 已对 stat 兜底）
];
function checkAchievements(){
  if(!save.ach || typeof save.ach !== 'object') save.ach = { un: {}, title: '' };
  if(!save.ach.un) save.ach.un = {};
  const st = save.stat || {};
  for(const a of ACHIEVEMENTS){
    if(save.ach.un[a.id]) continue;            // 已解锁的不再查
    if((st[a.stat] || 0) >= a.goal){
      save.ach.un[a.id] = 1;
      showBanner('🏅 成就达成：' + a.emoji + a.name, 2.4, '#ffd34d');
      if(a.title && !save.ach.title) save.ach.title = a.title;   // 带称号的成就：没选过称号就自动戴上
    }
  }
}
// 玩家称号：接在昵称 / 战报前面用，如【连击之神】；没称号返回空串
function playerTitle(){ return save.ach && save.ach.title ? '【' + save.ach.title + '】' : ''; }

// ⑤ 明日礼包 / 回归礼包：'tomorrow'=昨天玩过、今天可领 200💰；'back'=3 天没来、可领 500💰+2💎
function giftState(){
  const today = todayStr();
  const g = save.gift || {};
  if(g.claimed === today) return 'done';               // 今天已经领过
  if(!(save.runs > 0) || !g.lastPlay) return 'none';   // 还没玩过：没有礼包
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if(g.lastPlay === yest.toDateString()) return 'tomorrow';
  const days = g.lastPlayTs ? (Date.now() - g.lastPlayTs) / 86400000 : 0;   // 用时间戳算"几天没玩了"
  if(days >= 3 && g.lastPlay !== today) return 'back';
  return 'none';
}
function claimGift(){
  const st = giftState();
  if(st !== 'tomorrow' && st !== 'back') return null;   // 没有可领的：返回 null，UI 层据此隐藏按钮
  const out = st === 'back' ? { coins: 500, gems: 2 } : { coins: 200, gems: 0 };
  save.coins += out.coins; save.gems += out.gems;
  save.gift.claimed = todayStr();
  saveSave();
  showBanner(st === 'back' ? '🎁 回归礼包：+' + out.coins + '💰 +' + out.gems + '💎 欢迎回来！'
                           : '🎁 明日礼包：+' + out.coins + '💰 明天再来还有！', 2.6, '#ffd34d');
  return out;   // 告诉 UI 层发了什么 {coins, gems}
}

// ⑥ 周段位：本周（周一起算）最高分决定段位，跨周自动清零重新打
function weekKey(){
  const d = new Date();
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7);   // 本周的周一
  const wn = Math.floor((mon - new Date(mon.getFullYear(), 0, 1)) / 86400000 / 7) + 1;       // 周一是当年第几周
  return mon.getFullYear() + '-w' + wn;   // 形如 '2026-w24'
}
const RANKS = [
  { name: '青铜狐', at: 0,     e: '🥉' },
  { name: '白银狐', at: 1000,  e: '🥈' },
  { name: '黄金狐', at: 3000,  e: '🥇' },
  { name: '铂金狐', at: 6000,  e: '💠' },
  { name: '钻石狐', at: 10000, e: '💎' },
  { name: '王者狐', at: 15000, e: '👑' },
  { name: '传说狐', at: 22000, e: '🌟' },
];
function rankOf(b){
  let cur = RANKS[0], next = null;
  for(const r of RANKS){
    if(b >= r.at) cur = r;
    else { next = r; break; }
  }
  return { rank: cur, next: next, toNext: next ? next.at - b : 0 };   // toNext=离下一段还差多少分
}

// 一局结束（摔死 / 日赛完赛）统一走这里：把本局数据归档进留存系统
function endRunStats(died){
  if(died) addStat('deaths', 1);
  addStat('meters', Math.floor(game.runDist / 12));   // 累计里程在局末一次记入
  if(boxCount > 0) addStat('boxes', boxCount);   // 【内容扩展】累计开箱数（成就钩子；老存档 stat 默认 {} 已兜底）
  if(comboBest > (save.stat.maxCombo || 0)) save.stat.maxCombo = comboBest;   // 本局连击峰值（取最大）
  combo = 0;                                          // 局末连击清零（掉坑死亡也算断连击）
  if(!save.gift || typeof save.gift !== 'object') save.gift = { lastPlay: '', claimed: '', lastPlayTs: 0 };
  save.gift.lastPlay = todayStr(); save.gift.lastPlayTs = Date.now();   // 礼包系统记"最后一次玩"
  const wk = weekKey();
  if(!save.week || save.week.key !== wk) save.week = { key: wk, best: 0 };   // 跨周：段位分重置
  if(game.score > save.week.best) save.week.best = game.score;
  checkAchievements();   // 成就一局查一次就够了
}

/* ========== 6. 玩家与角色 ========== */
// 角色表：每个角色有自己的长相、能力和身价，能力越强越贵！
//   jumps = 总共能跳几段（1=只能地面跳，2=二连跳，3=三连跳）
//   glide = 会不会滑翔（空中按住跳跃键就缓缓飘落）
//   kind  = 用哪套画法（fox/pig/monkey/dragon，见 drawCharacter）
const CHARS = {
  fox: { name:'橙狐', price:0, jumps:1, glide:false, kind:'fox',
    desc:'最初的伙伴，朴实可靠',
    c:{ body:'#f8a155', body2:'#e0731f', dark:'#c96a25', belly:'#ffd9b0', ear:'#7c3f12', tail:'#e8833a', scarf:'#e84545' },
    trail:['#ff9b4b','#ffd9a0'] },
  pig: { name:'小猪噜噜', price:200, jumps:2, glide:false, kind:'pig',
    desc:'圆滚滚的二连跳选手：空中再按一次跳跃！',
    c:{ body:'#fbb8cd', body2:'#ef8fb0', dark:'#d97fa0', belly:'#ffe3ec', snout:'#ffc7d8', scarf:'#4f87d6' },
    trail:['#ff8ac0','#ffd0e6'] },
  monkey: { name:'小猴跳跳', price:1200, jumps:3, glide:false, kind:'monkey',
    desc:'灵活的三连跳大师，空中还能再跳两次',
    c:{ body:'#b5805a', body2:'#92603d', dark:'#7c5232', belly:'#e8c79e', face:'#e8c79e', scarf:'#ffd34d' },
    trail:['#ffcf6b','#ffe9b0'] },
  cat: { name:'闪电喵', price:1600, jumps:2, glide:false, kind:'cat',
    desc:'敏捷机灵的猫：二连跳，身后拖一道闪电金尾迹',
    c:{ body:'#ffd24d', body2:'#f2a93a', dark:'#cf8a1e', belly:'#fff3cf', ear:'#7a4a12', tail:'#f2b53a', scarf:'#3a3f57' },
    trail:['#ffe24d','#fff3a0','#ffffff'] },
  snowfox: { name:'雪狐飘飘', price:2600, jumps:2, glide:true, kind:'fox',
    desc:'二连跳 + 滑翔：空中按住跳跃键，像羽毛一样飘',
    c:{ body:'#f4f8fd', body2:'#d8e2ee', dark:'#b9c6d6', belly:'#ffffff', ear:'#8aa0b8', tail:'#dce6f2', scarf:'#7fb3ff' },
    trail:['#bfe6ff','#ffffff'] },
  panda: { name:'熊猫滚滚', price:3000, jumps:2, glide:false, kind:'panda', perk:'shield',
    desc:'二连跳 + 每局开局自带一面护盾！',
    c:{ body:'#f4f4f0', body2:'#dcdcd4', dark:'#2a2a2a', belly:'#ffffff', patch:'#2a2a2a', scarf:'#7fd89a' },
    trail:['#bdf0cf','#ffffff'] },
  cosmic: { name:'星河狐', price:4200, jumps:2, glide:true, kind:'fox', perk:'shield',
    desc:'遨游星河的狐狸：二连跳 + 滑翔 + 开局护盾，拖出紫色星尘',
    c:{ body:'#6b5cff', body2:'#3b2a8c', dark:'#2c2070', belly:'#d8d4ff', ear:'#241a55', tail:'#7d6cff', scarf:'#7df9ff' },
    trail:['#b07dff','#7df9ff','#ffffff'] },
  dragon: { name:'小龙腾腾', price:5000, jumps:3, glide:true, kind:'dragon',
    desc:'传说级！三连跳 + 滑翔，几乎就是在飞',
    c:{ body:'#5fd9ad', body2:'#2f9d7a', dark:'#2a8a6b', belly:'#d8ffe9', spike:'#ffd34d', wing:'#a9f0d6', scarf:'#ff8a5c' },
    trail:['#5fd9ad','#a9f0d6'] },
  flame: { name:'赤焰龙', price:6800, jumps:3, glide:true, kind:'dragon', perk:'shield',
    desc:'烈焰龙王：三连跳 + 滑翔 + 开局护盾，身后拖着熊熊火焰',
    c:{ body:'#ff7a3d', body2:'#d63a2a', dark:'#b32a1e', belly:'#ffe0b0', spike:'#ffd34d', wing:'#ffb070', scarf:'#3a3f57' },
    trail:['#ff5a2d','#ffd24d','#ff9b3d'] },
};
const player = {
  x: 120, w: 44, h: 36,
  y: GROUND_Y,         // y 记录的是脚底的位置
  vy: 0,
  grounded: true,
  jumpsUsed: 0,        // 这次离地后已经跳了几段（连跳角色用）
  gliding: false,      // 正在滑翔吗
  sliding: false,      // 【酷跑1】正在下滑吗（贴地滑铲，身体压矮，能从高处横杆下钻过）
  slideUntil: 0,       // 【酷跑1】这次下滑持续到的时刻（bgTime 超过它就站起来）
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
  player.sliding = false; player.slideUntil = 0; player.h = 36;   // 【酷跑1】重开时收掉下滑状态、恢复正常身高
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
    const canRevive = endlessOnly() && (!save.freeReviveUsed || save.coins >= reviveCost());   // 【酷跑2】闯关同日赛不复活（失败即重试），用带重生天赋折扣的价
    if(!canRevive && bgTime - game.deadAt > 1.2) startGame();
    return;
  }
  jumpHeld = source;
  if(player.sliding) return;   // 【酷跑1】正在贴地滑行时不接受起跳（跳+滑是两个独立动作，避免一下就弹起来失去躲避意义）
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
  addStat('jumps', 1);   // 【留存包】③ 空中连跳也算跳跃
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
// 【酷跑1】下滑（滑铲）：对标天天酷跑的"跳+滑"双动作。在地面贴地一滑，身体压矮，
// 高处的横杆/栏杆就从头顶掠过；滑行中不能起跳，滑完自动站起来。
function startSlide(){
  if(game.state !== 'playing' || paused || loadingStart) return;
  const p = player;
  if(!p.grounded || p.sliding || p.inPit) return;   // 只有踏实站在地面、还没在滑、没掉坑时才能滑
  p.sliding = true;
  // 【酷跑2】天赋·灵动：滑行时长 SLIDE_DUR + 0.08*等级（日赛 talentVal('slide')=0 → 裸值）
  const slideDur = SLIDE_DUR + talentVal('slide');
  p.slideUntil = bgTime + slideDur;
  p.h = SLIDE_H;                  // 身高压到一半：碰撞框和画面都变矮
  setFace('focus', slideDur);    // 专注表情：低头猫腰冲过去（时长跟着天赋一起延长）
  // 扬尘：脚后跟两团灰，像在地上蹭出一道
  burst(p.x + p.w / 2, GROUND_Y - 2, 9, ['#e6dcc2', '#c9bfa0', '#ffffff']);
  puff(p.x + 4, GROUND_Y - 2); puff(p.x + p.w - 4, GROUND_Y - 2);
  sfx.slide();   // 一个低沉的"唰"
}
/* ========== 8. 开始 / 死亡 / 重开 ========== */
function startGame(){
  if(dailyMode) seededRng = mulberry32(dateNum());   // 日赛每次重试都从头放同一串随机数
  // 【酷跑2】闯关每关固定种子=关卡 id，每次重试同图可背板（startStage 已设 adventureMode/curStage，这里只播种子）
  else if(adventureMode && curStage) seededRng = mulberry32((curStage.id * 2654435761) >>> 0);
  save.runs = (save.runs || 0) + 1;
  addStat('runs', 1);                          // 【留存包】③ 累计局数
  combo = 0; comboBest = 0; feverUntil = 0;    // 【留存包】① 新一局连击从零攒
  game.state = 'playing';
  game.speed = SPEED_START;
  game.runDist = 0; game.score = 0; game.coinCount = 0; jumpedRun = false; hurtFlash = 0;
  game.penalty = 0; game.bonus = 0; invulnUntil = 0;
  playerHP = effMaxHP(); lastHurtAt = -99;   // 【血条Boss】新一局满血、清空受伤时刻（【酷跑2】铁骨天赋抬高上限）
  boss = null; bossDefeated = false; bossMode = false; bossAtks.length = 0; bossAt = BOSS_SCORE;   // 【血条Boss】新一局 Boss 状态全清
  game.newBest = false; game.shake = 0; game.deathBy = '';
  power.type = null;
  obstacles.length = 0; coins.length = 0; particles.length = 0; pits.length = 0;
  items.length = 0; floats.length = 0; distToItem = 1200;
  // 【内容扩展】收集玩法开局清场：宝箱/字母数组清空、计时器复位、字母进度重置（每局重新集齐）
  boxes.length = 0; distToBox = 1500; boxCount = 0;
  letters.length = 0; distToLetter = 900;
  letterGot = [false, false, false, false]; letterDoneShown = false;
  distToObstacle = 750; distToCoin = 500;
  paused = false;
  jumpHeld = null;
  face.until = 0;
  game.startBest = game.best; game.recordShown = false;
  bonusUntil = 0; nextBonusAt = 30; reviveCount = 0; shieldOn = false;
  chaseUntil = 0; chaseX = -260; nextChaseAt = 900; chaseRewarded = true;   // 【追逐】新一局重置巨石追击
  bonusCount = 0; bonusKind = 0; magnetUntil = 0; coinx2Until = 0; goldStorm = false;
  patQueue = []; nextMeteorAt = 5000; game.milestone = 0; game.earlyMile = 0; mothUsed = false; slowUntil = 0;
  lastBarX = 0;   // 【酷跑1】新一局清掉上一局的横杆锚点，免得开局贴地币位置错乱
  shrinkUntil = 0; ghostUntil = 0; scorex3Until = 0;   // 【内容扩展】三种新道具计时器开局清零（老局残留不能带进新局）
  bunny = null; distToBunny = 6000 + Math.random() * 4000;
  banner.until = 0; petPulseAt = 0; petPulseUntil = 0;
  petSmashAt = bgTime + 6; petSmashFx = 0; petReviveUsed = false;   // 【酷跑2】萌宠局内计时器清零（铁拳熊首撞给 6 秒、不死鸟本局未用）
  recordFlagShown = false; curBgmTier = 0;
  // 【酷跑2】闯关本关进度清零：每次开关/重试都从零评星（stars 在 finishStage 现算，这里先归零）
  if(adventureMode){ stageStars = 0; stageHurt = false; stageCoins = 0; }
  buildWorldSeq();   // 【内容扩展】抽好本局世界出场顺序（日赛已在上方播好种子→当天同图）
  bgmVariant = Math.random() < 0.5 ? 0 : 1;   // 【音乐多样化】开局抽签：这一局听曲A还是曲B（整局固定，不每帧乱换）
  bgm.step = 0; bgm.track = null;             // 新一局旋律从头唱
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
  // 【酷跑2】萌宠·不死鸟：濒死的瞬间自动满血复活，每局一次、免费（日赛 activePet 为 null 自动禁用）。
  //   放在 die 最前面拦截：撞死(hit)、掉坑(pit)都能救；救完直接 return，本帧不进入死亡流程。
  const ap2 = activePet();
  if(ap2 && ap2.id === 'revivepet' && !petReviveUsed && game.state === 'playing'){
    petReviveUsed = true;
    petRevive();
    return;
  }
  game.state = 'dead';
  game.deathBy = cause || 'hit';
  game.deadAt = bgTime;
  game.shake = 6;   // 阵亡：只保留一记很轻的"咚"（一次性终结，不是反复晃屏）
  stopBGM();   // 背景音乐停下，让"游戏结束"旋律独奏
  sfx.die();
  burst(player.x + player.w/2, Math.min(player.y - player.h/2, H - 20), 26, ['#ff9b4b','#ffd34d','#ffffff']);
  taskProg('meters', 0, Math.floor(game.runDist / 12));   // "单局跑X米"任务在结算时结算
  if(adventureMode){
    // 【酷跑2】闯关失败：撞死/掉坑都算受伤、不刷新无尽纪录、不结挑战赏（参考日赛禁用面）。本关不解锁，可重试。
    stageHurt = true;
  } else if(dailyMode){
    recordDailyRun();
  } else {
    // 和"本局开始时的纪录"比，而不是和实时刷新的 best 比（best 永远 >= score，那样永远判不出新纪录）
    if(game.score > game.startBest){
      game.newBest = true;
      save.bestDist = Math.floor(game.runDist);   // 记下纪录局跑到的距离 → 赛道上的"纪录旗"
    }
  }
  endRunStats(true);   // 【留存包】统计 / 成就 / 礼包 / 周段位 都在局末统一结算
  saveBest();
  updateDeadCard();   // 把结算信息填进 DOM 卡片
  genShareImg();       // 【社交·战报图】死亡瞬间就把战报图渲染好，等玩家点"发战书"时已就绪
}
// 日赛成绩记录（与无尽模式的最高分完全分开）
function recordDailyRun(){
  const today = todayStr();
  const dr = (save.dailyRun && save.dailyRun.date === today) ? save.dailyRun : { date: today, best: 0, tries: 0 };
  dr.tries++;
  if(game.score > dr.best) dr.best = game.score;
  save.dailyRun = dr;
  saveSave();
  uiCopyLabel = '📋 复制战绩发群里';   // 【小游戏改造】复位画布结算卡上"复制战绩"按钮的文案
}
// 日赛跑满 3000 米：完赛！
function finishDaily(){
  game.state = 'dead';
  game.deathBy = 'finish';
  game.deadAt = bgTime;
  stopBGM();
  sfx.power();
  taskProg('meters', 0, Math.floor(game.runDist / 12));
  endRunStats(false);   // 【留存包】完赛不算"死亡"，但里程/连击/礼包照常结算
  recordDailyRun();
  updateDeadCard();
  showBanner('🏁 完赛！', 2, '#ffd34d');
}
// 【酷跑2】闯关跑到终点：过关结算——算三星、发奖励、记进度、解锁下一关
function finishStage(){
  const st = curStage;
  game.state = 'dead';
  game.deathBy = 'finish';   // 复用完赛分支（不算死亡：不刷新无尽纪录、不结挑战）
  game.deadAt = bgTime;
  stopBGM();
  sfx.power();
  taskProg('meters', 0, Math.floor(game.runDist / 12));
  endRunStats(false);        // 完赛不算"死亡"，但里程/连击/礼包/成就照常结算
  // —— 三星评定：1★=完赛(到这就有) / 2★=本关全程不受伤 / 3★=收集够 goalCoins ——
  const noHurt = !stageHurt;
  const coinsEnough = stageCoins >= st.goalCoins;
  stageStars = 1 + (noHurt ? 1 : 0) + (coinsEnough ? 1 : 0);
  // —— 发奖励：仅当首次通关 或 刷新了更高星数才发（避免刷关无限领钱）——
  const prev = (save.stageProg && save.stageProg[st.id]) || 0;
  if(stageStars > prev){
    const rw = st.reward || {};
    if(rw.coins){ save.coins += rw.coins; addStat('coins', rw.coins); }
    if(rw.gems){ save.gems = (save.gems || 0) + rw.gems; }
    if(rw.char && !save.chars.includes(rw.char)){ save.chars.push(rw.char); }   // 通关大奖：解锁角色（已有则跳过）
  }
  // 进度只升不降；解锁下一关
  save.stageProg = save.stageProg || {};
  save.stageProg[st.id] = Math.max(prev, stageStars);
  save.stageMax = Math.max(save.stageMax || 1, st.id + 1);
  saveSave();
  updateDeadCard();
  showBanner('🏁 过关！' + '★'.repeat(stageStars), 2.2, '#ffd34d');
}
// 【血条Boss】撞到障碍：扣血（不再只扣分）——扣 22 血、震屏、短暂无敌闪烁；血空才真正死
function stumble(){
  if(shieldOn){   // 护盾替你挡下这一击！（挡下不掉血）
    shieldOn = false;
    invulnUntil = bgTime + 1.2;
    sfx.hit();
    burst(player.x + player.w / 2, player.y - player.h / 2, 16, ['#8ecaff', '#ffffff']);
    floatText(player.x + player.w / 2, player.y - player.h - 16, '护盾抵挡！', '#8ecaff');
    return;
  }
  if(adventureMode) stageHurt = true;   // 【酷跑2】闯关：真正掉血即"受伤"（护盾挡下的上面已 return，不算）→ 失去"不受伤"三星
  playerHP -= 22;         // 【血条Boss】每次撞击扣 22 血，约 4-5 次撞死（脱战/吃币能回一点缓冲）
  if(bgTime < chaseUntil) chaseX += CHASE_LURCH;   // 【追逐】追击中撞障碍：巨石猛逼近一截（撞得越多越危险）
  lastHurtAt = bgTime;    // 【血条Boss】记下受伤时刻——脱战 2 秒后才回血
  invulnUntil = bgTime + 1.0;
  game.penalty += 5;      // 【血条Boss】保留少量扣分（5）作为受伤手感，不再扣 20
  breakCombo();           // 【留存包】① 真正受伤：连击断了（护盾挡住的在上面已 return，不断）
  juiceVibrate('hurt');   // 【留存包】② 痛感震动
  setFace('hurt', 1.0);   // 痛苦表情
  sfx.hit();
  burst(player.x + player.w / 2, player.y - player.h / 2, 14, ['#ff9b4b', '#ffffff']);
  floatText(player.x + player.w / 2, player.y - player.h - 16, '-22 ❤', '#ff5a5a');   // 【血条Boss】红色掉血飘字
  if(playerHP <= 0){ playerHP = 0; die('hit'); }   // 【血条Boss】血空才死（掉坑仍走 die('pit') 秒死，不经这里）
}
function saveBest(){
  try{ localStorage.setItem('fox_best', String(game.best)); }catch(e){}
  saveSave();   // 顺手把钱包/皮肤也存了
  updateShareUrl();   // 把最新纪录写进网址——随手转发就是挑战书
}
// 【追逐】开启一次巨石追击：巨石从屏幕左外滚入，约 9 秒内别让它追上（撞障碍会让它猛逼近一截）
function startChase(){
  chaseUntil = bgTime + 9;
  chaseX = -260;
  chaseRewarded = false;
  nextChaseAt = Math.floor(game.runDist / 12) + 1800 + Math.floor(srand() * 600);   // 下一次更远（循环更紧：原+2200）
  showBanner('🪨 巨石追击！别撞障碍 · 冲过这一段！', 2.4, '#ffb84d');
}
// 被巨石追上：休闲模式不秒死，重伤一下并把巨石顶回去一截，给玩家喘息
function chaseHit(){
  if(bgTime < invulnUntil) return;
  playerHP -= 30; lastHurtAt = bgTime; invulnUntil = bgTime + 1.0;
  breakCombo(); setFace('hurt', 1.0); juiceVibrate('hurt'); sfx.hit();   // 巨石撞击：去掉震屏（用户反馈"屏幕一晃一晃"），保留扣血飘字+原地星花
  burst(player.x + player.w / 2, player.y - player.h / 2, 18, ['#9a7b5a', '#c0a080', '#ffffff']);
  floatText(player.x + player.w / 2, player.y - player.h - 16, '巨石撞击 -30 ❤', '#ff5a5a');
  if(playerHP <= 0){ playerHP = 0; die('hit'); }
}
// 巨石本体：屏幕左侧滚来的大石球（追击中才画），带裂纹/碾尘 + 左边缘危险红光（追得越近越红）
function drawChaser(){
  if(bgTime >= chaseUntil && chaseX <= -240) return;   // 没在追击、也退场完了：不画
  const R = 66, cx = chaseX - R, cy = GROUND_Y - R + 6;
  const near = clamp((chaseX + 60) / (player.x + 60), 0, 1);
  const grd = ctx.createLinearGradient(0, 0, 180, 0);   // 左边缘危险红光
  grd.addColorStop(0, 'rgba(180,20,20,' + (0.32 * near).toFixed(3) + ')');
  grd.addColorStop(1, 'rgba(180,20,20,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 180, H);
  for(let i = 0; i < 3; i++){   // 碾尘
    ctx.fillStyle = 'rgba(150,130,100,' + (0.3 - i * 0.08) + ')';
    ctx.beginPath(); ctx.arc(cx + R - 6 + i * 10, GROUND_Y - 6 + Math.sin(bgTime * 9 + i) * 3, 9 - i * 2, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';   // 地面投影
  ctx.beginPath(); ctx.ellipse(cx, GROUND_Y + 3, R * 0.95, 7, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-game.runDist * 0.012);   // 旋转的石球
  const g2 = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.2, 0, 0, R);
  g2.addColorStop(0, '#8a7a66'); g2.addColorStop(1, '#4a4036');
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(30,24,18,0.6)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(30,24,18,0.45)'; ctx.lineWidth = 2.5;   // 裂纹
  ctx.beginPath();
  ctx.moveTo(-R * 0.5, -R * 0.2); ctx.lineTo(0, R * 0.1); ctx.lineTo(R * 0.4, -R * 0.3);
  ctx.moveTo(-R * 0.1, R * 0.5); ctx.lineTo(R * 0.2, -R * 0.1);
  ctx.stroke();
  ctx.restore();
}
// 超级奖励关：三种玩法轮换，每次进都有"这回轮到哪个"的开箱感
function startBonus(){
  bonusKind = bonusCount % 3;
  bonusCount++;
  bonusUntil = bgTime + 6;
  nextBonusAt = game.coinCount + 150;  // 下次门槛从"当前数量"重新起算 +150，奖励关循环更紧一点但仍不会连环触发
  taskProg('bonus', 1);
  obstacles.length = 0;
  pits.length = 0;
  const names = ['☔ 大头雨', '🦅 飞天黄金', '💥 狂暴冲撞'];
  showBanner('✨ 超级奖励：' + names[bonusKind] + ' ✨', 2.5, '#ffd34d');
  if(bonusKind === 1){        // 飞天黄金：直接起飞，上天吃金币长龙
    power.type = 'fly'; power.total = 6; power.until = bonusUntil;
  } else if(bonusKind === 2){ // 狂暴冲撞：全程冲刺，障碍墙撞个稀碎
    power.type = 'dash'; power.total = 6; power.until = bonusUntil;
  }
  setFace('joy', 2);
  sfx.power();
}
// 【酷跑2】复活基础价：200*(n+1) 乘重生天赋折扣 (1-0.1*等级)，向上取整。
//   收费/按钮显示/可否复活判断全走它，三处口径一致（日赛 talentVal('revive')=1 → 裸价）
function reviveCost(){ return Math.ceil(200 * (reviveCount + 1) * talentVal('revive')); }
// 金币复活：扣钱、原地满血复活，并把眼前的危险清掉（首次死亡免费送一次）
function revive(){
  const free = !save.freeReviveUsed;
  const cost = free ? 0 : reviveCost();
  if(game.state !== 'dead' || dailyMode || (!free && save.coins < cost)) return;
  if(free) save.freeReviveUsed = true;
  else { save.coins -= cost; reviveCount++; }
  saveSave();
  game.state = 'playing';
  player.x = 120; player.y = GROUND_Y; player.vy = 0; player.grounded = true;
  player.inPit = false; player.jumpsUsed = 0; player.gliding = false;
  playerHP = effMaxHP(); lastHurtAt = -99;   // 【血条Boss】复活回满血（【酷跑2】铁骨天赋上限），否则复活瞬间又是 0 血秒死
  invulnUntil = bgTime + 2.5;   // 复活保护期
  pits.length = 0;
  for(let i = obstacles.length - 1; i >= 0; i--){
    if(obstacles[i].x < 700) obstacles.splice(i, 1);   // 清掉眼前的障碍，别复活即死
  }
  showBanner('💖 复活！继续冲！', 1.6, '#ff8aa0');
  sfx.power();
  startBGM();   // 音乐重新响起
}
// 【酷跑2】萌宠·不死鸟的复活：免费、不扣钱、不动存档，原地满血并清掉眼前危险（在 die 里被 return 拦截后调用）
function petRevive(){
  player.x = 120; player.y = GROUND_Y; player.vy = 0; player.grounded = true;
  player.inPit = false; player.jumpsUsed = 0; player.gliding = false;
  player.sliding = false; player.slideUntil = 0; player.h = 36;   // 顺手收掉下滑状态，避免复活时压矮
  playerHP = effMaxHP(); lastHurtAt = -99;   // 【酷跑2】不死鸟也回到铁骨天赋的有效满血
  invulnUntil = bgTime + 2.5;   // 复活保护期
  pits.length = 0;
  for(let i = obstacles.length - 1; i >= 0; i--){
    if(obstacles[i].x < 700) obstacles.splice(i, 1);   // 清掉眼前障碍，别复活即死
  }
  burst(player.x + player.w / 2, player.y - player.h / 2, 22, ['#ffd34d', '#ff8a5c', '#ffffff']);   // 复活光
  showBanner('🐦 不死鸟救援！满血复活！', 1.8, '#ffb84d');
  setFace('joy', 1.5);
  sfx.power();
}

/* ========== 8.5 Boss 战（50000 分触发，一局一次，日赛不触发）========== */
// 【血条Boss】进入 Boss 战：在右上方盘旋的巨龙，每隔约 1.4 秒发动一次攻击，撑过约 8 波即可击败
function startBoss(){
  boss = {
    hp: 100, maxHp: 100,   // Boss 血量：每撑过一波攻击扣 100/8，约 8 波见底
    t: 0,                  // Boss 自己的计时（攻击节奏由它驱动）
    phase: 'enter',        // enter=入场飞进来 / fight=盘旋作战
    x: W + 120, y: 80,     // 出生在屏幕右外侧上方，入场时飞到位
    nextAtk: 1.0,          // 距离下次攻击的秒数（入场给 1 秒缓冲）
    atkCount: 0,           // 已发动的攻击次数（轮换攻击模式 + 计算扣血进度）
  };
  bossMode = true;         // 暂停普通障碍/收集物生成
  bossAtks.length = 0;     // 清空残留弹幕
  showBanner('👹 BOSS 来袭！躲开攻击撑住它！', 2.5, '#ff5a5a');
  setFace('hurt', 1.0);    // 紧张表情
  sfx.hit();
}
// 【血条Boss】Boss 被玩家攻击物打到时给玩家扣血（和 stumble 类似但独立：无敌期短一些，否则一直免疫打不到）
function bossHurt(dmg){
  if(bgTime < invulnUntil) return;   // 刚被打过的极短无敌（0.8 秒）内不重复扣
  playerHP -= dmg;
  lastHurtAt = bgTime;
  invulnUntil = bgTime + 0.8;   // 比普通障碍(1.0)略短：Boss 弹幕密，但别让玩家完全免疫
  game.penalty += 4;
  breakCombo();
  juiceVibrate('hurt');
  setFace('hurt', 0.9);
  sfx.hit();
  burst(player.x + player.w / 2, player.y - player.h / 2, 14, ['#ff5a5a', '#ffffff']);
  floatText(player.x + player.w / 2, player.y - player.h - 16, '-' + dmg + ' ❤', '#ff5a5a');
  if(playerHP <= 0){ playerHP = 0; die('hit'); }   // 被 Boss 打空血照样死
}
// 【血条Boss】每帧驱动 Boss：入场 → 盘旋浮动 → 定时发动攻击 → 推进弹幕 → 弹幕碰玩家扣血 → 见底则胜利
function updateBoss(dt){
  boss.t += dt;
  // —— 入场：从右外侧飞到盘旋位（屏幕右上方约 x=680）——
  if(boss.phase === 'enter'){
    boss.x += (680 - boss.x) * Math.min(1, dt * 2.2);
    if(boss.x < 690){ boss.phase = 'fight'; boss.x = 680; }
  } else {
    // 盘旋：轻微左右 + 上下浮动，像在空中俯视猎物
    boss.x = 680 + Math.sin(boss.t * 0.8) * 22;
    boss.y = 80 + Math.sin(boss.t * 1.6) * 14;
  }

  // —— 定时攻击：盘旋阶段每隔约 1.4 秒发动一次，三种模式轮换 ——
  if(boss.phase === 'fight'){
    boss.nextAtk -= dt;
    if(boss.nextAtk <= 0){
      boss.nextAtk = 1.4;
      const mode = boss.atkCount % 3;
      boss.atkCount++;
      bossAttack(mode);
      // 每发动一波攻击就扣一截血（撑过 ≈8 波见底）。入场后第一波也算，约 11 秒打完
      boss.hp -= boss.maxHp / 8;
      if(boss.hp <= 0){ boss.hp = 0; defeatBoss(); return; }   // 见底：胜利（return 后本帧不再推进弹幕）
    }
  }

  // —— 推进所有 Boss 攻击物 + 碰撞玩家 ——
  const pbx = player.x + 7, pby = player.y - player.h + 6, pbw = player.w - 14, pbh = player.h - 8;
  for(let i = bossAtks.length - 1; i >= 0; i--){
    const a = bossAtks[i];
    a.t += dt;
    if(a.type === 'dive'){
      // 俯冲扑击：Boss 的影子斜冲向玩家落点再回位（用 0→1→0 的抛物线参数）
      const k = Math.min(1, a.t / a.dur);
      const arc = Math.sin(k * Math.PI);   // 0→1→0
      a.x = a.x0 + (a.tx - a.x0) * arc;
      a.y = a.y0 + (a.ty - a.y0) * arc;
      if(a.t >= a.dur){ bossAtks.splice(i, 1); continue; }
    } else {
      // 火球/落石(rock 从天而降) + 冲击波(wave 贴地飞来)：匀速移动
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      if(a.vy !== 0 && a.y > GROUND_Y - 4){ a.y = GROUND_Y - 4; a.vy = 0; a.vx = -260; }   // 落石砸地后贴地弹一段
      if(a.x < -60 || a.y > H + 60){ bossAtks.splice(i, 1); continue; }
    }
    // 碰撞玩家（圆 vs 矩形）：打到就扣血
    const nx = clamp(a.x, pbx, pbx + pbw);
    const ny = clamp(a.y, pby, pby + pbh);
    if((a.x - nx) * (a.x - nx) + (a.y - ny) * (a.y - ny) < a.r * a.r){
      bossHurt(18);   // 【血条Boss】Boss 弹幕每次扣 18 血
      if(game.state !== 'playing') return;   // 可能被打死了
      if(a.type !== 'dive') bossAtks.splice(i, 1);   // 实体弹幕打到就消失；俯冲是 Boss 本体不消失
    }
  }
}
// 【血条Boss】发动一次攻击：mode 0=俯冲 / 1=空中落石(火球) / 2=地面冲击波
function bossAttack(mode){
  const bx = boss.x, by = boss.y;
  if(mode === 0){
    // ① 俯冲扑击：Boss 斜冲向玩家当前位置再回位，r 大、伤害判定整段有效
    bossAtks.push({
      type: 'dive', t: 0, dur: 1.1, r: 26,
      x: bx, y: by, x0: bx, y0: by,
      tx: player.x + player.w / 2, ty: player.y - player.h / 2,
    });
    sfx.smash();
    setFace('hurt', 0.5);
  } else if(mode === 1){
    // ② 空中落石/火球：从天而降的弹幕（2-3 颗，瞄准玩家附近，玩家要跳/移开躲）
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for(let i = 0; i < n; i++){
      const tx = player.x + (i - (n - 1) / 2) * 90 + rand(-30, 30);
      bossAtks.push({
        type: 'rock', t: 0, r: 15,
        x: tx, y: -20,
        vx: rand(-40, 40), vy: rand(360, 460),   // 主要往下砸，略带横向
      });
    }
    sfx.hit();
  } else {
    // ③ 地面冲击波：贴地从右往左飞来，要跳过去
    bossAtks.push({
      type: 'wave', t: 0, r: 18,
      x: W + 40, y: GROUND_Y - 14,
      vx: -340, vy: 0,
    });
    sfx.hit();
  }
}
// 【血条Boss】击败 Boss：清场 + 大奖励（金币/钻石/表现分）+ 全屏庆祝 + 成就，恢复普通障碍生成
function defeatBoss(){
  bossDefeated = true;
  bossAt = game.score + 18000;   // 【血条Boss】下一只 Boss 再过 18000 分出现（中后期持续高潮）
  boss = null;
  bossMode = false;      // 恢复普通障碍/收集物生成
  bossAtks.length = 0;   // 清掉屏上残留弹幕
  // 大奖励：金币 +2000、钻石 +5（持久化存档），外加局内表现分 +1000
  save.coins += 2000; game.coinCount += 2000; addStat('coins', 2000);
  save.gems += 5;
  game.bonus += 1000;
  addStat('boss', 1);    // 成就「屠龙者」
  saveSave();
  // 全屏庆祝
  burst(player.x + player.w / 2, player.y - player.h - 10, 40, ['#ffd34d', '#ff8aa0', '#7df9ff', '#ffffff', '#b0fc38']);
  burst(W / 2, H / 2, 30, ['#ffd34d', '#ffffff', '#ff5a5a']);
  showBanner('🏆 击败BOSS！金币+2000 钻石+5！', 3.5, '#ffd34d');
  setFace('joy', 2.0);
  sfx.power();
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
// 【角色拖尾】每个角色自带一组专属颜色，跑动时身后持续吐出柔光小点，向后飘并淡出（对标天天酷跑的奔跑尾迹）
let charTrail = [];
let trailEmitT = 0;
function updateTrail(dt){
  if(game.state === 'playing'){
    const cur = dailyMode ? CHARS.fox : (CHARS[save.char] || CHARS.fox);
    const tc = cur.trail || ['#ffd34d'];
    if(bgTime - trailEmitT > 0.028){
      trailEmitT = bgTime;
      const n = (boostDist > 0 && game.runDist < boostDist) ? 2 : 1;   // 冲刺时尾迹更浓
      for(let i = 0; i < n; i++){
        charTrail.push({
          x: player.x + rand(-2, 8), y: player.y - player.h * 0.5 + rand(-7, 5),
          vx: -90 - rand(0, 60), vy: rand(-14, 14),
          life: 0, max: rand(0.35, 0.55), size: rand(5, 9),
          color: tc[(Math.random() * tc.length) | 0],
        });
      }
    }
  }
  for(let i = charTrail.length - 1; i >= 0; i--){
    const p = charTrail[i];
    p.life += dt;
    if(p.life >= p.max){ charTrail.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.size *= (1 - dt * 1.2);
  }
}
function drawTrail(){
  for(const p of charTrail){
    const r = Math.max(0.5, p.size);
    ctx.globalAlpha = (1 - p.life / p.max) * 0.7;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, p.color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
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
  // 【内容扩展】蹦床（爽点 good 类）：踩它弹高吃上方金币串；早早登场，日赛照常出
  { tier: 1, seq: [['trampoline', 0]] },
  { tier: 2, seq: [['rock', 0], ['trampoline', 300]] },                  // 先跳石头，再踩蹦床起飞
  { tier: 2, seq: [['pit', 0], ['coinsOver', -1], ['trampoline', 420]] },
  // 【内容扩展】火焰喷射口：周期喷火，看准间隙冲过去（中期登场）
  { tier: 2, seq: [['flame', 0]] },
  { tier: 2, seq: [['flame', 0], ['rock', 360]] },
  // 【内容扩展】激光门：周期开关的横向激光，看节奏过（偏后期）
  { tier: 3, seq: [['laser', 0]] },
  { tier: 3, seq: [['laser', 0], ['coinsLine', 300]] },
  { tier: 3, seq: [['flame', 0], ['flame', 360]] },                       // 双火口：连续两道喷火
  { tier: 3, seq: [['birdHigh', 0], ['spikes', 340]] },
  { tier: 3, seq: [['pendulum', 0], ['pendulum', 460]] },                 // 双摆锤：后期精英段
  { tier: 3, seq: [['roller', 0]] },                                      // 滚石：贴地滚来，跳它！
  { tier: 3, seq: [['pit', 0], ['pit', 330], ['coinsOver', -1]] },
  // 【丰富度】滚锯 / 地刺机关 / 落锤：三种新障碍，反应各不同（快跳 / 看缩回间隙 / 抬起时钻过）
  { tier: 2, seq: [['saw', 0]] },                                         // 滚锯：高速滚来，快跳！
  { tier: 2, seq: [['saw', 0], ['cactus', 380]] },                        // 跳锯紧接着跳仙人掌
  { tier: 2, seq: [['spiketrap', 0]] },                                   // 地刺：看缩回间隙冲过 / 升起时跳
  { tier: 3, seq: [['spiketrap', 0], ['rock', 360]] },                    // 地刺机关 + 石头
  { tier: 3, seq: [['hammer', 0]] },                                      // 落锤：抬起时从下方跑过
  { tier: 3, seq: [['hammer', 0], ['saw', 400]] },                        // 落锤钻过去马上跳滚锯
  { tier: 3, seq: [['saw', 0], ['bar', 380], ['coinsLow', -1]] },         // 跳锯接滑杆：跳↔滑
  // 【丰富度】高低路线 risk-reward：高处一串金币，要踩蹦床/大跳才够得着；不冒险就只走安全低路
  { tier: 2, seq: [['trampoline', 0], ['coinsHigh', 70]] },               // 踩蹦床冲上去吃高空币串
  { tier: 2, seq: [['rock', 0], ['coinsHigh', 10]] },                     // 大跳过石头顺势够高空币
  { tier: 3, seq: [['trampoline', 0], ['coinsHigh', 70], ['rock', 300]] },// 蹦床吃高币，落地马上跳石头
  // 【酷跑1】下滑躲避：横杆 'bar' 站着撞、下滑可过。下滑是核心操作，tier1 起就常见、场景要够多。
  { tier: 1, seq: [['bar', 0]] },                                          // 单根横杆：第一次出现，教会下滑
  { tier: 1, seq: [['lowbar', 0], ['coinsLow', -1]] },                     // 低横杆 + 杆下贴地币：奖励滑过去
  { tier: 1, seq: [['bar', 0], ['coinsLow', -1]] },                        // 横杆 + 杆下币：基础常见款
  { tier: 2, seq: [['bar', 0], ['coinsLow', -1], ['rock', 360]] },         // 先滑过横杆（顺手吃贴地币），再跳石头
  { tier: 2, seq: [['rock', 0], ['bar', 340]] },                           // 跳石头紧接着下滑横杆：跳+滑连招
  { tier: 2, seq: [['lowbar', 0], ['lowbar', 330], ['coinsLow', -1]] },    // 连续两道低杆：保持低姿连滑
  { tier: 2, seq: [['bar', 0], ['cactus', 370]] },                         // 滑横杆紧接着跳仙人掌：滑↔跳切换
  { tier: 3, seq: [['bar', 0], ['lowbar', 360], ['coinsLow', -1]] },       // 连续两道横杆：保持低姿连滑
  { tier: 3, seq: [['cactus', 0], ['bar', 320], ['coinsLow', -1]] },       // 跳仙人掌再滑横杆：跳↔滑切换
  { tier: 3, seq: [['bar', 0], ['rock', 330], ['bar', 660]] },             // 滑-跳-滑三连击
  { tier: 3, seq: [['lowbar', 0], ['pit', 350]] },                         // 滑过低杆紧接着跳坑：滑完立刻跳
  // 【丰富度】tier4 硬核段（4500米后才放）：逼你在零点几秒里连续切换跳/滑，拉开高手差距、给老手"手指打结也超爽"的段
  { tier: 4, seq: [['bar', 0], ['spiketrap', 330], ['lowbar', 660]] },     // 滑-跳-滑 三连切换
  { tier: 4, seq: [['hammer', 0], ['saw', 340], ['bar', 680]] },           // 钻落锤-跳滚锯-滑横杆
  { tier: 4, seq: [['saw', 0], ['saw', 300], ['cactus', 560]] },           // 双滚锯接仙人掌：连续快跳
  { tier: 4, seq: [['spiketrap', 0], ['hammer', 330], ['rock', 640]] },    // 地刺-落锤-石头
  { tier: 4, seq: [['lowbar', 0], ['rock', 320], ['lowbar', 600], ['coinsLow', -1]] },  // 滑-跳-滑保持低姿
];
let patQueue = [];          // 当前组合段里还没入场的元素
let lastPitX = 0;           // 最近一个坑的中心（给"坑上金币弧"定位）
let lastBarX = 0;           // 【酷跑1】最近一根横杆的中心（给"杆下贴地奖励币"定位）
function makeObstacle(type){
  let w, h;
  if(type === 'spikes'){        w = srange(56, 88); h = 20; }
  else if(type === 'birdLow'){  w = 36; h = 26; }
  else if(type === 'birdHigh'){ w = 36; h = 26; }
  else if(type === 'pendulum'){ w = 40; h = 30; }
  else if(type === 'roller'){   w = 36; h = 36; }
  else if(type === 'trampoline'){ w = 46; h = 16; }   // 【内容扩展】蹦床：扁扁一块，踩上去弹很高（good 类，不致死）
  else if(type === 'laser'){    w = 24; h = 150; }     // 【内容扩展】激光门：竖直一道，周期开关（开=致命，关=可过）
  else if(type === 'flame'){    w = 40; h = 96; }       // 【内容扩展】火焰喷射口：地面喷火柱，周期喷发（喷=致命，停=可过）
  else if(type === 'bar'){      w = srange(70, 110); h = 16; }   // 【酷跑1】高处横杆：悬在头顶的一根杆，站着会撞、下滑可过
  else if(type === 'lowbar'){   w = srange(70, 110); h = 16; }   // 【酷跑1】低横杆组合：横杆 + 地面留缝，唯有下滑能钻过
  else if(type === 'rock'){     w = srange(26, 46); h = srange(34, 52); }
  else if(type === 'cactus'){   w = srange(22, 32); h = srange(56, 78); }
  else if(type === 'saw'){      w = 42; h = 42; }                 // 【丰富度】滚锯：高速滚来的锯轮，跳过 / 可撞碎
  else if(type === 'spiketrap'){ w = 56; h = 26; }                // 【丰富度】地刺机关：周期升起的地刺，看缩回间隙冲过 / 升起时跳过
  else if(type === 'hammer'){   w = 44; h = 44; }                 // 【丰富度】落锤：从天而降的冲压锤，抬起时从下方跑过
  else {                        w = srange(58, 72); h = srange(30, 48); }   // double
  const o = { x: W + 80, w: w, h: h, type: type };
  // 【酷跑1】横杆悬在头顶：alt=26 → 杆身约在 y[214,230]，正好挡住站立玩家的头(站立头≈y220)，
  //   下滑把人压到 y238 以下，杆就从头顶掠过。lowbar 同高，但靠 PATTERNS 安排更密集、更明确要滑。
  if(type === 'bar' || type === 'lowbar'){ o.alt = 26; o.warned = false; lastBarX = o.x + o.w / 2; }
  if(type === 'birdLow'){  o.alt = 22; o.extraV = 60; }
  if(type === 'birdHigh'){ o.alt = 62; o.extraV = 60; }
  if(type === 'roller'){   o.extraV = 140; o.roll = 0; }   // 滚石：朝你滚来，可跳可撞碎
  if(type === 'pendulum'){ o.pivotY = 58; o.len = 160; o.phase = srand() * TAU; }
  // 【内容扩展】激光门：period 一个开关周期(秒)，onFrac 开着占的比例（开 45%/关 55%，关窗够长能过）
  if(type === 'laser'){    o.period = 2.0; o.onFrac = 0.45; o.phase = srand() * o.period; }
  // 【内容扩展】火焰喷射：period 一个喷发周期，upFrac 喷火占比（喷 40%/停 60%），warn 预警提前量
  if(type === 'flame'){    o.period = 1.8; o.upFrac = 0.40; o.warn = 0.45; o.phase = srand() * o.period; }
  // 【丰富度】滚锯/地刺机关/落锤
  if(type === 'saw'){       o.extraV = 175; o.roll = 0; }                                     // 比滚石更快、更唬人
  if(type === 'spiketrap'){ o.period = 1.7; o.upFrac = 0.5; o.warn = 0.4; o.phase = srand() * o.period; }
  if(type === 'hammer'){    o.period = 1.9; o.downFrac = 0.34; o.phase = srand() * o.period; }
  obstacles.push(o);
  // 【酷跑1】第一次遇到横杆：给一条醒目提示横幅，教会新手"这是要下滑的，不是跳的"（日赛不弹，免得占屏）
  if((type === 'bar' || type === 'lowbar') && !dailyMode && !save.barSeen){
    save.barSeen = true; saveSave();
    showBanner('⬇ 下滑钻过去！', 2, '#8ee6ff');
  }
  // 【酷跑1】横杆附近清掉诱人的散币（同空中障碍逻辑），别把人引到杆下站着撞；贴地缝隙的奖励币由 PATTERNS 里 coinsLow 单独放
  if(type === 'bar' || type === 'lowbar'){
    for(let i = coins.length - 1; i >= 0; i--){
      if(!coins[i].brave && Math.abs(coins[i].x - (o.x + o.w / 2)) < 200) coins.splice(i, 1);
    }
  }
  // 【内容扩展】蹦床：正上方放一串弧线金币当"爽点"奖励（踩弹起来正好够到）
  if(type === 'trampoline'){
    const tx = o.x + o.w / 2;
    for(let i = 0; i < 5; i++){
      coins.push({ x: tx - 64 + i * 32, y: 120 - Math.sin(i / 4 * Math.PI) * 34, phase: Math.random() * TAU, brave: true });
    }
  }
  // 【内容扩展】激光门/火焰柱是细长的致命竖障：跟空中障碍一样把附近诱人的散币和道具清掉，别引人送死
  if(type === 'laser' || type === 'flame'){
    const cx = o.x + o.w / 2;
    for(let i = coins.length - 1; i >= 0; i--){
      if(!coins[i].brave && Math.abs(coins[i].x - cx) < 200) coins.splice(i, 1);
    }
    for(let i = items.length - 1; i >= 0; i--){
      if(Math.abs(items[i].x - cx) < 200) items.splice(i, 1);
    }
  }
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
  } else if(kind === 'coinsHigh'){ // 【丰富度】高空弧线币：要踩蹦床/大跳才够得着——冒险高路，币更多更值
    for(let i = 0; i < 6; i++){
      coins.push({ x: refX - 64 + i * 28, y: 92 - Math.sin(i / 5 * Math.PI) * 30, phase: Math.random() * TAU, brave: true });
    }
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
    showBanner('❗ 前方有坑，跳过去！', 1.8, '#ff8aa0');
    return;
  }
  if(!patQueue.length){
    // 抽一个适合当前里程的组合段（前期只抽简单段）
    const tier = d > 4500 ? 4 : d > 2200 ? 3 : d > 1100 ? 2 : d > 280 ? 1 : 0;   // 【可玩性】解锁前置：约280米(第14秒)进 tier1（滑铲/坑/蹦床），新手第一分钟就能见到跳+滑，不再前500米纯跳石头
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
    // 【酷跑1】贴在横杆后面的 coinsLow（杆下奖励币）锚到横杆中心；坑上金币弧锚到坑中心；其余锚到入场处
    if(el2[0] === 'coinsLow') spawnPatternCoins(el2[0], lastBarX || (W + 80));
    else if(el2[0].indexOf('coins') === 0) spawnPatternCoins(el2[0], lastPitX);
    else makeObstacle(el2[0]);
  }
  if(patQueue.length){
    distToObstacle = patQueue[0][1] * Math.max(1, game.speed / 480);
    return;
  }
  // 段落结束：到下一段的间距用原公式（含密度递增）
  // 障碍密度曲线：开局更稀疏（热身段），后期挤到只剩 55% 间距（地狱段）
  const densK = (d < 300 ? 1.25 : 1) * Math.max(0.55, 1 - d / 7000);
  distToObstacle = (game.speed * dashMult() * 0.6 + 280 + srand() * 320) * densK;
}
function spawnCoins(){
  // 屏幕右侧附近有鸟/摆锤/激光门/火焰口时先不发金币，过 250px 再试（理由见 spawnObstacle 里的注释）
  for(const o of obstacles){
    // 【内容扩展】激光/火焰是细长致命柱，和空中障碍一样先避让，别把金币撒在它们的判定线上
    if((o.alt || o.type === 'pendulum' || o.type === 'laser' || o.type === 'flame') && o.x > W - 420){ distToCoin = 250; return; }
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
  if(o.type === 'trampoline') return [];     // 【内容扩展】蹦床不致死，碰撞在 update 里单独算（弹起来）
  if(o.type === 'bar' || o.type === 'lowbar') return [];   // 【酷跑1】横杆碰撞在 update 里单独算（滑行可过、只 stumble 不秒死）
  if(o.type === 'laser'){
    // 【内容扩展】激光关着时无判定（可过），开着才是一道从天到地的致命光柱
    if(!laserOn(o)) return [];
    return [{ x: o.x + 7, y: 0, w: o.w - 14, h: GROUND_Y }];
  }
  if(o.type === 'flame'){
    // 【内容扩展】火柱按当前喷发高度给判定：没喷=无（可过），喷起来才烫人
    const lv = flameLevel(o);
    if(lv <= 0) return [];
    const fh = o.h * lv;
    return [{ x: o.x + 8, y: GROUND_Y - fh, w: o.w - 16, h: fh }];
  }
  if(o.type === 'spiketrap'){
    // 【丰富度】地刺：缩回(或刚冒头)可过；升起到一定高度才致命
    const lv = spikeLevel(o);
    if(lv < 0.45) return [];
    const sh = 22 * lv;
    return [{ x: o.x + 3, y: GROUND_Y - sh, w: o.w - 6, h: sh }];
  }
  if(o.type === 'hammer'){
    // 【丰富度】落锤：抬起可从下面跑过；砸下时整柱致命
    if(!hammerDown(o)) return [];
    return [{ x: o.x + 6, y: 0, w: o.w - 12, h: GROUND_Y }];
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
// 【内容扩展】激光门：在一个 period 周期里，前 onFrac 段是"开"（致命），其余是"关"（可过）
//   返回 0~1 的相位 ph 给绘制用，> onFrac 即关闭
function laserPhase(o){ return ((bgTime + o.phase) % o.period) / o.period; }
function laserOn(o){ return laserPhase(o) < o.onFrac; }
// 【内容扩展】火焰喷射：周期里 0~upFrac 段在喷火（致命），喷发前 warn 秒地面冒火星预警
//   返回当前火柱高度比例 0~1（0=没喷，1=喷满），> 0 即有致命判定
function flameLevel(o){
  const ph = ((bgTime + o.phase) % o.period) / o.period;
  if(ph >= o.upFrac) return 0;                 // 间隙：不喷，可安全通过
  const t = ph / o.upFrac;                      // 喷发期内的进度 0~1
  // 0~0.25 冲起来、0.25~0.7 维持满、0.7~1 缩回去：像真的火柱一蹿一蹿
  if(t < 0.25) return t / 0.25;
  if(t < 0.7)  return 1;
  return 1 - (t - 0.7) / 0.3;
}
function flameWarn(o){   // 即将喷发：进入下一周期喷火前的 warn 秒里返回 true（地面冒火星预警）
  const tNext = o.period - ((bgTime + o.phase) % o.period);
  return tNext <= o.warn && flameLevel(o) === 0;
}
// 【丰富度】地刺机关：周期里 0~upFrac 段刺"升起"(致命)，其余缩回(可过)。返回 0(全缩回)~1(全升起)
function spikeLevel(o){
  const ph = ((bgTime + o.phase) % o.period) / o.period;
  if(ph >= o.upFrac) return 0;
  const t = ph / o.upFrac;
  if(t < 0.18) return t / 0.18;            // 猛地弹起
  if(t < 0.82) return 1;                   // 维持
  return 1 - (t - 0.82) / 0.18;            // 缩回
}
function spikeWarn(o){   // 即将升起：下个周期升起前 warn 秒（底座闪红预警）
  const tNext = o.period - ((bgTime + o.phase) % o.period);
  return tNext <= o.warn && spikeLevel(o) === 0;
}
// 【丰富度】落锤：周期里 0~downFrac 段锤头砸下(致命)，其余抬起(可过)。返回锤头"底边" y。
function hammerHeadY(o){
  const ph = ((bgTime + o.phase) % o.period) / o.period;
  const upY = 30, downY = GROUND_Y - 8;    // 抬起时锤底在 y30(高，可从下面过)；砸下时贴到地面
  if(ph >= o.downFrac) return upY;
  const t = ph / o.downFrac;
  if(t < 0.28) return upY + (downY - upY) * (t / 0.28);     // 快速砸下
  if(t < 0.62) return downY;                                // 砸到底短暂停顿
  return downY + (upY - downY) * ((t - 0.62) / 0.38);       // 抬起复位
}
function hammerDown(o){ return hammerHeadY(o) > 110; }   // 锤头底边低于 y110 即整柱致命
// 玩家脚底中心是否悬在坑上（坑的左右各留 8px 的边，站在坑沿上不算掉）
function overPit(){
  const cx = player.x + player.w / 2;
  for(const pt of pits){
    if(cx > pt.x + 8 && cx < pt.x + pt.w - 8) return true;
  }
  return false;
}
function spawnItem(){
  // 和金币一样：右侧有鸟/摆锤/激光门/火焰口时先不出道具，免得诱人撞上去
  for(const o of obstacles){
    // 【内容扩展】激光/火焰致命柱附近也不出道具（理由同 spawnCoins）
    if((o.alt || o.type === 'pendulum' || o.type === 'laser' || o.type === 'flame') && o.x > W - 420){ distToItem = 250; return; }
  }
  // 【真机反馈】坑口上方不出道具：悬在坑上的道具要么够不着、要么引人坠坑，太鸡肋
  for(const pt of pits){
    if(pt.x > W - 280 && pt.x < W + 280){ distToItem = 200; return; }
  }
  // 【内容扩展】新增 shrink/ghost/scorex3 进随机池。三者都走种子随机 srand → 日赛同图同序，照常出现不破坏公平
  const types = ['dash', 'giant', 'magnet', 'coinx2', 'shield', 'fly', 'slow', 'shrink', 'ghost', 'scorex3'];
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
    magnetTotal = POWER_DUR.magnet + effDur();
    magnetUntil = bgTime + magnetTotal;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '磁铁！', POWER_INFO.magnet.color);
    return;
  }
  if(type === 'coinx2'){
    coinx2Total = POWER_DUR.coinx2 + effDur();
    coinx2Until = bgTime + coinx2Total;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '双倍金币！', POWER_INFO.coinx2.color);
    return;
  }
  if(type === 'slow'){
    slowTotal = POWER_DUR.slow + effDur();
    slowUntil = bgTime + slowTotal;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '时停！', POWER_INFO.slow.color);
    return;
  }
  // 【内容扩展】缩小药水：独立计时器（不占主槽），生效期碰撞框+身形缩小，能从低矮障碍下钻过
  if(type === 'shrink'){
    shrinkTotal = POWER_DUR.shrink + effDur();
    shrinkUntil = bgTime + shrinkTotal;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '缩小！', POWER_INFO.shrink.color);
    return;
  }
  // 【内容扩展】幽灵：独立计时器，期间半透明、穿障无伤（纯保命，不撞碎不加分）
  if(type === 'ghost'){
    ghostTotal = POWER_DUR.ghost + effDur();
    ghostUntil = bgTime + ghostTotal;
    setFace('joy', 1.2); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '幽灵！', POWER_INFO.ghost.color);
    return;
  }
  // 【内容扩展】分数狂潮：独立计时器，期间所有得分来源 ×3（加分类，日赛保留）
  if(type === 'scorex3'){
    scorex3Total = POWER_DUR.scorex3 + effDur();
    scorex3Until = bgTime + scorex3Total;
    setFace('joy', 1.4); sfx.power();
    floatText(player.x + player.w / 2, player.y - player.h - 24, '分数狂潮 ×3！', POWER_INFO.scorex3.color);
    return;
  }
  power.type = type;
  power.total = POWER_DUR[type] + effDur();   // 商店升级会加时长
  power.until = bgTime + power.total;
  setFace('joy', 1.2);   // 开心表情
  sfx.power();
  floatText(player.x + player.w / 2, player.y - player.h - 24,
            POWER_INFO[type].name + '！', POWER_INFO[type].color);
}

/* —— 【内容扩展】神秘宝箱 —— */
// 出宝箱：和金币/道具一样躲开致命机关和坑口，悬在金币安全线上（永远够得到）。
//   位置用 srand → 日赛走日期种子，当天同图同点；普通局每局随机。
function spawnBox(){
  for(const o of obstacles){
    if((o.alt || o.type === 'pendulum' || o.type === 'laser' || o.type === 'flame') && o.x > W - 420){ distToBox = 250; return; }
  }
  for(const pt of pits){
    if(pt.x > W - 280 && pt.x < W + 280){ distToBox = 200; return; }
  }
  boxes.push({ x: W + 60, y: srange(140, 168), phase: Math.random() * TAU });
}
// 开箱：随机抽一种大奖（金币爆发 / 立即激活一个道具 / 1~2 钻石 / 一个大头表现分）。
//   奖励内容用 srand → 日赛同图同奖（公平）；有动画(burst)+音效(sfx.power)+横幅显示开出了啥。
function openBox(bx, by){
  boxCount++;
  setFace('joy', 1.6);
  sfx.power(); setTimeout(() => { try{ sfx.coin(); }catch(e){} }, 120);   // 开箱"叮当当"
  burst(bx, by, 22, ['#ffd34d', '#fff3b0', '#ffffff', '#7df9ff']);
  const roll = srand();
  if(roll < 0.40){
    // 金币爆发：60~300 枚一次性入账（既计金币数也计累计统计，能推进奖励关/成就）
    const amt = 60 + Math.floor(srand() * 241);   // 60~300
    game.coinCount += amt; save.coins += amt; addStat('coins', amt); saveSave();
    showBanner('🎁 宝箱：金币 +' + amt + '！', 2.2, '#ffd34d');
    floatText(bx, by - 20, '+' + amt + ' 金币', '#ffd34d');
  } else if(roll < 0.68){
    // 随机一个道具立即激活（复用 activatePower，护盾/缩小/幽灵等都可能开出）
    const pool = ['dash', 'magnet', 'coinx2', 'shield', 'fly', 'slow', 'shrink', 'ghost', 'scorex3'];
    const t = pool[Math.floor(srand() * pool.length)];
    activatePower(t);
    showBanner('🎁 宝箱：' + POWER_INFO[t].name + '！', 2.2, POWER_INFO[t].color);
  } else if(roll < 0.85){
    // 1~2 钻石（钻石是硬通货，开出来很惊喜）
    const g = 1 + Math.floor(srand() * 2);   // 1~2
    save.gems += g; saveSave();
    showBanner('🎁 宝箱：钻石 +' + g + ' 💎！', 2.2, '#7df9ff');
    floatText(bx, by - 20, '+' + g + ' 💎', '#7df9ff');
  } else {
    // 一个大头表现分（吃 ×3 分数狂潮加成，和奖励关大头同款 +20 底分）
    const sc = 60 * scoreMult();
    game.bonus += sc;
    showBanner('🎁 宝箱：表现分 +' + sc + '！', 2.2, '#ffb3f6');
    floatText(bx, by - 20, '+' + sc + ' 分', '#ffb3f6');
  }
}

/* —— 【内容扩展】字母收集：「狐狸快跑」四张 —— */
// 出字母卡：永远掉"本局还没集齐的"那张里随机一张（集齐了就不再掉，避免出无用卡）。
//   同样躲机关/坑口、悬安全线；位置用 srand → 日赛同图。
function spawnLetter(){
  if(letterCount() >= 4) { distToLetter = 99999; return; }   // 已集齐：本局不再掉
  for(const o of obstacles){
    if((o.alt || o.type === 'pendulum' || o.type === 'laser' || o.type === 'flame') && o.x > W - 420){ distToLetter = 250; return; }
  }
  for(const pt of pits){
    if(pt.x > W - 280 && pt.x < W + 280){ distToLetter = 200; return; }
  }
  // 在"还缺的字母"里随机挑一张
  const need = [];
  for(let i = 0; i < 4; i++) if(!letterGot[i]) need.push(i);
  const idx = need[Math.floor(srand() * need.length)];
  letters.push({ x: W + 60, y: srange(138, 166), idx: idx, phase: Math.random() * TAU });
}
// 集齐四张「狐狸快跑」：大奖励（+500 金币 + 3 钻 + 下一局免费开局冲刺券）+ 全屏庆祝
function letterComplete(){
  if(letterDoneShown) return;
  letterDoneShown = true;
  save.coins += 500; game.coinCount += 500; addStat('coins', 500);
  save.gems += 3;
  pendingSprint = Math.max(pendingSprint, 300);   // 免费冲刺券：下一局开局冲刺 300 米（不覆盖更大的已购值）
  saveSave();
  showBanner('🦊 集齐「狐狸快跑」！+500金币 +3💎 +冲刺券', 3.0, '#ffd34d');
  setFace('joy', 2.0);
  sfx.power(); setTimeout(() => { try{ sfx.power(); }catch(e){} }, 260);
  // 全屏庆祝：在玩家头顶放一大束彩花
  burst(player.x + player.w / 2, player.y - player.h - 10, 40, ['#ffd34d', '#ff8aa0', '#7df9ff', '#ffffff', '#b0fc38']);
  floatText(player.x + player.w / 2, player.y - player.h - 30, '集齐啦！', '#ffd34d');
}

/* ========== 11. 每帧更新（游戏规则都在这里） ========== */
function update(dt){
  bgTime += dt;
  updateTrail(dt);   // 【角色拖尾】任何状态都推进/淡出尾迹粒子；只有 playing 时才吐新粒子（函数内部判断）

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
    if(tier === 1) showBanner('🌵 进入沙漠！节奏加快', 2.2, '#ffd9a0');
    else if(tier === 2) showBanner('⛄ 进入雪夜！最终乐章', 2.2, '#bfe3ff');
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

  game.speed = Math.min(SPEED_MAX, game.speed + speedRamp() * dt);   // 加速度随里程递增
  // 冲刺道具生效时世界加速 1.8 倍（相对地，就是狐狸在狂奔）
  const move = game.speed * dashMult() * (bgTime < slowUntil ? 0.55 : 1) * dt;   // 时停：世界慢 45%
  game.dist += move; game.runDist += move;

  // 【血条Boss】脱战回血：超过 2 秒没受伤，每秒回 7 点（撞击间歇能续命，4-5 击死但有缓冲）
  if(bgTime - lastHurtAt > 2) playerHP = Math.min(effMaxHP(), playerHP + 7 * dt);   // 【酷跑2】回血封顶到铁骨天赋上限

  const inBonus = bgTime < bonusUntil;   // 超级奖励时间：没有任何危险，只有漫天金币

  // 今日挑战：固定 3000 米，跑完即完赛
  if(dailyMode && game.runDist / 12 >= 3000){ finishDaily(); return; }
  // 【酷跑2】闯关：跑到本关终点米数即过关结算（到达即成功，至少 1 星）
  if(adventureMode && curStage && game.runDist / 12 >= curStage.dist){ finishStage(); return; }

  // 【血条Boss】Boss 触发：非日赛 / 非奖励关 / 本局没在打也没打过 / 分数过线 → 进入 Boss 战
  //   日赛禁用（保证同图公平，和流星雨/钻石兔同款门控）。奖励关结束后才触发，避免画面太乱
  if(endlessOnly() && !inBonus && !boss && game.score >= bossAt){   // 【酷跑2】闯关也不触发 Boss；bossAt 击败后递增=循环出现
    startBoss();
  }
  // 【血条Boss】Boss 战进行中：驱动盘旋/攻击/扣血/见底判定（独立函数，便于阅读）
  if(boss) updateBoss(dt);

  // 生成障碍：间距随速度变大（速度越快，留给反应的距离越长）
  // 【血条Boss】Boss 战期间(bossMode)暂停生成普通障碍：已在屏的正常划走，专心躲 Boss 弹幕
  if(!inBonus && !bossMode) distToObstacle -= move;
  if(!inBonus && !bossMode && distToObstacle <= 0){
    spawnObstacle();   // 组合段编排：函数内部自己安排好下一个间距
  }
  if(!bossMode) distToCoin -= move;   // 【血条Boss】Boss 战期间也暂停撒金币，画面只剩 Boss 与弹幕
  if(!bossMode && distToCoin <= 0){
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
    // 【留存包】① 成功跳过一个坑：坑的右沿滑到玩家身后、且人没掉在坑里 → 连击 +1（passed 标记保证每坑只记一次）
    if(!pits[i].passed && !player.inPit && pits[i].x + pits[i].w < player.x){
      pits[i].passed = true;
      addCombo();
      addStat('pits', 1);
    }
    if(pits[i].x + pits[i].w < -60) pits.splice(i, 1);
  }
  for(let i = coins.length - 1; i >= 0; i--){
    coins[i].x -= move;
    if(coins[i].x < -40) coins.splice(i, 1);
  }

  // 道具：每隔一段路出现一个（奖励关里不出；【血条Boss】Boss 战里也不出）
  if(!inBonus && !bossMode) distToItem -= move;
  if(!bossMode && distToItem <= 0){ spawnItem(); distToItem = 1600 + srand() * 1400; }
  for(let i = items.length - 1; i >= 0; i--){
    items[i].x -= move;
    if(items[i].x < -40) items.splice(i, 1);
  }

  // 【内容扩展】神秘宝箱：奖励关里不出；【血条Boss】Boss 战里也不出；同屏最多一个；按距离间隔生成（每局约 1~3 个）
  if(!inBonus && !bossMode) distToBox -= move;
  if(!inBonus && !bossMode && distToBox <= 0 && boxes.length === 0){
    spawnBox();
    distToBox = 3200 + srand() * 2600;   // 下一个隔得远些，别太频繁
  }
  for(let i = boxes.length - 1; i >= 0; i--){
    boxes[i].x -= move;
    if(boxes[i].x < -40) boxes.splice(i, 1);
  }

  // 【内容扩展】字母卡：奖励关里不出；【血条Boss】Boss 战里也不出；没集齐时按距离间隔掉落
  if(!inBonus && !bossMode && letterCount() < 4) distToLetter -= move;
  if(!inBonus && !bossMode && distToLetter <= 0 && letterCount() < 4){
    spawnLetter();
    distToLetter = 1400 + srand() * 1200;
  }
  for(let i = letters.length - 1; i >= 0; i--){
    letters[i].x -= move;
    if(letters[i].x < -40) letters.splice(i, 1);
  }

  updatePlayer(dt);
  if(game.state !== 'playing') return;   // 可能刚在 updatePlayer 里掉坑死掉了
  updateParticles(dt);
  game.shake = Math.max(0, game.shake - 40 * dt);

  // 撞障碍判定（碰撞框比画面上看到的略小，对玩家宽容一点，手感更公平）
  const pb = { x: player.x + 7, y: player.y - player.h + 6, w: player.w - 14, h: player.h - 8 };
  // 【内容扩展】缩小药水：碰撞框整体缩到约 0.55（脚底不动，顶部下压、左右内收），矮个子能从低矮障碍下钻过
  if(bgTime < shrinkUntil){
    const foot = pb.y + pb.h;              // 脚底保持原位（缩小不会让人飘起来漏踩坑）
    const ns = 0.55;                       // 缩小比例
    const nw = pb.w * ns, nh = pb.h * ns;
    pb.x += (pb.w - nw) / 2; pb.w = nw;    // 左右各内收一半
    pb.h = nh; pb.y = foot - nh;           // 高度变矮、顶部下压（贴地小不点，钻得过头顶的障碍）
  }
  const ghostOn = bgTime < ghostUntil;     // 【内容扩展】幽灵：穿障无伤（在致死循环里整段跳过判定）
  if(power.type === 'fly'){
    // 飞行中：在天上巡航，啥也撞不着
  } else if(power.type === 'dash' || power.type === 'giant'){
    // 冲刺/变大期间：碰到障碍直接撞碎，每个 +2 分（判定框放大 8px，撞起来更爽）
    for(let i = obstacles.length - 1; i >= 0; i--){
      const o = obstacles[i];
      // 【内容扩展】激光门/火焰口是固定机关，撞不碎：冲刺无敌期间直接穿过去（不删除、不加分）
      if(o.type === 'laser' || o.type === 'flame' || o.type === 'spiketrap' || o.type === 'hammer') continue;   // 固定机关：冲刺也撞不碎，直接穿过
      const boxes = obstacleBoxes(o);
      let smashed = false;
      for(const ob of boxes){
        if(pb.x < ob.x + ob.w + 8 && pb.x + pb.w > ob.x - 8 &&
           pb.y < ob.y + ob.h + 8 && pb.y + pb.h > ob.y - 8){ smashed = true; break; }
      }
      if(smashed){
        obstacles.splice(i, 1);
        const sm = scoreMult();                    // 【内容扩展】分数狂潮：撞碎得分 ×3
        game.bonus += (goldStorm ? 5 : 2) * sm;
        if(bgTime < feverUntil) game.bonus += 2 * sm;   // 【留存包】① 狂热时刻：撞碎额外 +2（同样吃 ×3）
        addCombo(); addStat('smash', 1);           // 【留存包】①③ 撞碎续连击 + 累计撞碎数
        juiceVibrate('smash');                     // 【留存包】② 撞碎的"哒"一下
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
  } else if(bgTime >= invulnUntil && !ghostOn){   // 刚撞过的短暂无敌期内/幽灵期间，不做致死判定
    for(const o of obstacles){
      const boxes = obstacleBoxes(o);
      for(const ob of boxes){
        if(pb.x < ob.x + ob.w && pb.x + pb.w > ob.x &&
           pb.y < ob.y + ob.h && pb.y + pb.h > ob.y){
          if(!ENDLESS){ die(); return; }   // 经典模式：撞到就结束
          o.hitMe = true;                  // 【手感·险过】标记"撞到过"，免得撞了还判险过
          stumble();                       // 休闲模式：绊一下，继续跑
          break;
        }
      }
      if(bgTime < invulnUntil) break;      // 这一帧已经绊到了，别的障碍不用再查
    }
  }

  // 【手感·险过】把"刚好躲过障碍"接进连击系统：擦着障碍框过(没撞但很近)就奖励，让"躲得准"看得见、攒得起来
  if(power.type !== 'fly' && power.type !== 'dash' && power.type !== 'giant' && !ghostOn){
    for(const o of obstacles){
      if(o.grazeDone) continue;
      for(const b of obstacleBoxes(o)){
        if(pb.x < b.x + b.w && pb.x + pb.w > b.x){          // 横向同列
          const gap = Math.max(b.y - (pb.y + pb.h), pb.y - (b.y + b.h));   // 竖直间隙(>0=没碰到)
          if(gap >= 0) o.minGraze = Math.min(o.minGraze === undefined ? Infinity : o.minGraze, gap);
        }
      }
      if(o.x + o.w < pb.x){   // 障碍整体滑到玩家身后：结算这一次"险过"
        o.grazeDone = true;
        if(!o.hitMe && o.minGraze !== undefined && o.minGraze < GRAZE_MARGIN) doGraze(o);
      }
    }
  }

  // 【内容扩展】蹦床：踩到/碰到就被弹很高（不致死，是爽点）。判定整块（含上表面），独立于致死循环。
  //   只有"正在下落或贴近床面"时才弹，避免在床顶反复抖动；弹完重置连跳，可在最高点再续跳够到金币。
  if(power.type !== 'fly'){
    for(const o of obstacles){
      if(o.type !== 'trampoline') continue;
      const tx = o.x, tw = o.w;
      const surfY = GROUND_Y - o.h;                       // 床面 y
      const overlapX = pb.x < tx + tw && pb.x + pb.w > tx;
      const footY = pb.y + pb.h;                          // 玩家脚底
      if(overlapX && footY > surfY - 6 && footY < GROUND_Y + 8 && player.vy >= -120){
        player.vy = JUMP_VY * 1.7;     // 弹起：比正常跳高得多
        player.grounded = false; player.inPit = false;
        player.jumpsUsed = 0;          // 弹起后还能再连跳（够顶上金币）
        player.y = surfY;              // 贴到床面起跳，避免穿模
        o.squish = 0.5;                // 床面压扁回弹的动画量
        setFace('joy', 0.6);
        sfx.jump();
        burst(tx + tw / 2, surfY, 8, ['#ffd34d', '#ffffff', '#9fe8ff']);
        floatText(tx + tw / 2, surfY - 14, '弹！', '#9fe8ff');
        juiceVibrate('smash');
        break;
      }
    }
  }

  // 【酷跑1】横杆（bar / lowbar）：站着撞、下滑可过。独立于致死循环，碰到只 stumble（扣血）不秒死。
  //   只有"没在滑行 且 头部高于杆底边"才算撞——滑行把人压矮，头从杆下掠过就安全。
  //   冲刺/变大/飞行/幽灵/无敌期间一律穿过去（和激光火焰同款豁免）。
  const barImmune = power.type === 'dash' || power.type === 'giant' || power.type === 'fly' ||
                    bgTime < invulnUntil || bgTime < ghostUntil;
  if(!barImmune){
    for(const o of obstacles){
      if(o.type !== 'bar' && o.type !== 'lowbar') continue;
      const bx = hitbox(o.x, o.w, o.h, o.alt);         // 杆身碰撞框（含 alt 悬空高度）
      const overlapX = pb.x < bx.x + bx.w && pb.x + pb.w > bx.x;
      const headY = pb.y;                              // 玩家头顶（碰撞框上沿）；滑行时 pb 整体下移，头自然低于杆底
      if(overlapX && !player.sliding && headY < bx.y + bx.h){
        stumble();
        break;
      }
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
      addCombo(); addStat('items', 1);   // 【留存包】①③ 吃道具也续连击 + 累计道具数
      taskProg('items', 1);
      burst(it.x, it.y, 10, [POWER_INFO[it.type].color, '#ffffff']);
    }
  }

  // 【内容扩展】碰到/吃到神秘宝箱 → 开箱（拾取范围跟着变大同款逻辑）
  const boxR = (power.type === 'giant') ? 36 : 24;
  for(let i = boxes.length - 1; i >= 0; i--){
    const bx = boxes[i];
    const inx = clamp(bx.x, pb.x, pb.x + pb.w);
    const iny = clamp(bx.y, pb.y, pb.y + pb.h);
    if((bx.x - inx) * (bx.x - inx) + (bx.y - iny) * (bx.y - iny) < boxR * boxR){
      const ox = bx.x, oy = bx.y;
      boxes.splice(i, 1);
      addCombo();                 // 开箱也续连击（手感）
      openBox(ox, oy);
    }
  }

  // 【内容扩展】收集字母卡 → 点亮对应格；集齐四张触发大奖励
  const letR = (power.type === 'giant') ? 32 : 22;
  for(let i = letters.length - 1; i >= 0; i--){
    const lt = letters[i];
    const inx = clamp(lt.x, pb.x, pb.x + pb.w);
    const iny = clamp(lt.y, pb.y, pb.y + pb.h);
    if((lt.x - inx) * (lt.x - inx) + (lt.y - iny) * (lt.y - iny) < letR * letR){
      letters.splice(i, 1);
      if(!letterGot[lt.idx]){
        letterGot[lt.idx] = true;
        addCombo();
        setFace('joy', 0.8); sfx.coin();
        burst(lt.x, lt.y, 12, ['#ffd34d', '#ffffff', '#ffb3f6']);
        floatText(lt.x, lt.y - 16, '「' + LETTER_CHARS[lt.idx] + '」', '#ffd34d');
        if(letterCount() < 4) showBanner('集字 ' + letterCount() + '/4：' + LETTER_CHARS[lt.idx], 1.4, '#ffd34d');
        if(letterCount() >= 4) letterComplete();
      }
    }
  }

  // 💫 流星雨：5000 米后的专属事件（日赛不触发，保证同图；【血条Boss】Boss 战里也不触发）
  if(endlessOnly() && !inBonus && !bossMode && game.runDist / 12 >= nextMeteorAt){   // 【酷跑2】闯关不下流星雨（同图可背板）
    nextMeteorAt = game.runDist / 12 + 800 + Math.random() * 400;
    showBanner('💫 流星雨来袭！盯住地上的阴影', 2.2, '#ff8a5c');
    for(let i = 0; i < 5; i++){   // 【真机反馈】3 颗太冷清，5 颗才像"雨"
      obstacles.push({ type: 'meteor', x: W + 160 + i * 210, w: 30, h: 30, dropAt: bgTime + 1.0 + i * 0.3 });
    }
    sfx.hit();
  }

  // 钻石兔：神出鬼没，追上摸到它就 +1 💎（日赛里不出，保证公平；【血条Boss】Boss 战里也不出）
  if(!inBonus && !bunny && endlessOnly() && !bossMode){   // 【酷跑2】闯关不出钻石兔（保证同图公平）
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
        addStat('bunnies', 1);      // 【留存包】③ 累计抓兔数
        juiceVibrate('bunny');      // 【留存包】② 抓到了！震一下
        taskProg('bunny', 1);
        burst(bunny.x, GROUND_Y - 20, 16, ['#7df9ff', '#ffffff']);
        showBanner('💎 抓到钻石兔！钻石 +1', 1.8, '#7df9ff');
        setFace('joy', 1.5);
        sfx.power();
        bunny = null;
      }
    }
  }

  // 【酷跑2】萌宠·星宝：每 8 秒自动帮你吸 1.5 秒金币（走 activePet，日赛里 activePet 返回 null 自动停用）
  const ap = activePet();
  if(ap && ap.id === 'star' && bgTime > petPulseAt){
    petPulseAt = bgTime + 8;
    petPulseUntil = bgTime + 1.5;
  }
  // 【酷跑2】萌宠·吸金喵：常驻小范围磁吸（比星宝弱：半径更小、吸力更慢，在下面磁铁循环里单独算）
  const magnetCat = ap && ap.id === 'magnetpet';

  // 磁铁（冲刺也自带吸金币，精灵的脉冲也走这里）：附近的金币自动飞过来
  if(bgTime < magnetUntil || power.type === 'dash' || power.type === 'fly' || bgTime < petPulseUntil || magnetCat){
    // 【酷跑2】吸金喵单独是常驻弱磁：半径 110（强磁是 170）、吸力 320（强磁 520）；其它情况仍是强磁
    const strong = !(magnetCat && bgTime >= magnetUntil && power.type !== 'dash' && power.type !== 'fly' && bgTime >= petPulseUntil);
    // 【酷跑2】天赋·磁场：吸金半径 ×(1+0.12*等级)（吸力不变，只扩范围）。日赛 talentVal 返回 1 → 裸值
    const mRad = (strong ? 170 : 110) * talentVal('magnet'), mPull = strong ? 520 : 320;
    const mcx = player.x + player.w / 2, mcy = player.y - player.h / 2;
    for(const c of coins){
      const dx = mcx - c.x, dy = mcy - c.y;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if(dd < mRad && dd > 1){
        c.x += dx / dd * mPull * dt;
        c.y += dy / dd * mPull * dt;
      }
    }
    // 【内容扩展】字母卡也被磁铁/飞行/冲刺吸过来（手感好，集字更顺）。宝箱体积大、是"惊喜"，不吸。
    for(const lt of letters){
      const dx = mcx - lt.x, dy = mcy - lt.y;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if(dd < mRad && dd > 1){
        lt.x += dx / dd * mPull * dt;
        lt.y += dy / dd * mPull * dt;
      }
    }
  }

  // 【酷跑2】萌宠·铁拳熊：每约 6 秒自动撞飞前方最近的一个"普通障碍"（可被冲刺撞碎的那类），+2 分。
  //   机关类（横杆/蹦床/激光/火焰/流星）不算普通障碍，不去碰它们。日赛禁用（activePet 已为 null）。
  if(ap && ap.id === 'smashpet' && bgTime > petSmashAt){
    let best = null, bestX = Infinity;
    for(const o of obstacles){
      if(o.type === 'bar' || o.type === 'lowbar' || o.type === 'trampoline' ||
         o.type === 'laser' || o.type === 'flame' || o.type === 'meteor' ||
         o.type === 'spiketrap' || o.type === 'hammer') continue;   // 只撞普通地面障碍（机关类不碰）
      if(o.x >= player.x && o.x < player.x + 360 && o.x < bestX){ best = o; bestX = o.x; }   // 前方一段距离内最近的一个
    }
    if(best){
      petSmashAt = bgTime + 6;
      const idx = obstacles.indexOf(best);
      if(idx >= 0) obstacles.splice(idx, 1);
      const sm = scoreMult();
      game.bonus += 2 * sm;
      addCombo(); addStat('smash', 1); taskProg('smash', 1);
      const fxX = best.x + best.w / 2, fxY = GROUND_Y - (best.alt || 0) - best.h / 2;
      burst(fxX, fxY, 14, ['#ffcaa0', '#ff8a5c', '#ffffff']);   // 撞击星花
      floatText(fxX, fxY - 18, '🐻 +' + (2 * sm), '#ffcaa0');
      petSmashFx = bgTime + 0.35;   // 拳印特效短暂残留
      sfx.smash();
    } else {
      petSmashAt = bgTime + 1;   // 眼前没普通障碍：1 秒后再找（不浪费整个 6 秒冷却）
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
        game.bonus += 20 * scoreMult();   // 【内容扩展】分数狂潮：大头分也 ×3
        sfx.coin();
        burst(c.x, c.y, 8, ['#ffd34d', '#ffffff']);
        floatText(c.x, c.y - 16, '+' + (20 * scoreMult()) + '分', '#ffb3f6');
        continue;
      }
      let v = (bgTime < coinx2Until) ? 2 : 1;   // 双倍金币道具：一枚顶两枚
      if(weekendBoost()) v *= 2;                   // 周末活动：金币再双倍！
      if(ap && ap.id === 'goldpet') v += 1;        // 【酷跑2】萌宠·招财猫：每枚金币额外 +1（温和的双倍替代，吃币多得）
      v = Math.round(v * talentVal('coin'));       // 【酷跑2】天赋·财源：金币价值 ×(1+0.06*等级)，取整（日赛 talentVal=1 → 不变）
      game.coinCount += v;
      save.coins += v;
      if(adventureMode) stageCoins += v;   // 【酷跑2】闯关：累计本关收集的金币数（达到 goalCoins → 三星之"收集"星）
      playerHP = Math.min(effMaxHP(), playerHP + 1);   // 【血条Boss】吃币微回 1 血，奖励收集（【酷跑2】上限随铁骨天赋）
      // 【内容扩展】分数狂潮：金币"得分"×3，但金币"数量(coinCount/save.coins)"绝不翻倍——
      //   金币本身在分数公式里按 coinCount*5 计，这里只把多出来的 (×3-1) 份分数补进 bonus
      const cScore = v * 5;
      if(scoreMult() > 1) game.bonus += cScore * (scoreMult() - 1);
      if(bgTime < feverUntil) game.bonus += 2 * scoreMult();   // 【留存包】① 狂热时刻：吃金币额外 +2 分（吃 ×3）
      addCombo(); addStat('coins', v);           // 【留存包】①③ 吃金币续连击 + 累计金币数
      taskProg('coins', v);
      if(game.coinCount % 10 < v) saveSave();   // 大约每 10 枚存一次档（双倍时一次跳 2，用 < v 兜住）
      sfx.coin();
      burst(c.x, c.y, 6, ['#ffd34d', '#fff3b0']);
      floatText(c.x, c.y - 14, '+' + (cScore * scoreMult()) + '分', '#ffd34d');
      // 本局攒够金币就进超级奖励关！（进行中不重复触发；日赛/闯关里没有奖励关，保证赛道一致）
      if(endlessOnly() && bgTime >= bonusUntil && game.coinCount >= nextBonusAt) startBonus();
    }
  }

  // 【追逐】巨石追击：周期触发；追击中巨石匀速逼近(撞障碍会猛逼近)，追上=重伤并顶回；甩掉后给奖励
  if(endlessOnly() && bgTime > chaseUntil && !boss && bgTime >= bonusUntil && game.runDist / 12 >= nextChaseAt){
    startChase();
  }
  if(bgTime < chaseUntil){
    chaseX += CHASE_CREEP * dt;
    if(chaseX >= player.x){ chaseX = player.x - 175; chaseHit(); }   // 追上：重伤 + 把巨石顶回去
  } else {
    if(!chaseRewarded){   // 这一次追击刚结束、且确实追过：发"甩掉巨石"奖励
      chaseRewarded = true;
      save.coins += 30; game.bonus += 200;
      showBanner('🎉 甩掉巨石！+30 金币', 2.2, '#7fd89a');
      floatText(player.x + player.w / 2, player.y - player.h - 20, '+30 💰', '#ffd34d');
      sfx.power();
    }
    if(chaseX > -260) chaseX -= 340 * dt;   // 巨石快速退场
  }

  // 得分 = 距离×里程倍率 + 金币奖励 + 撞碎奖励 - 撞障碍扣分（最低 0 分）
  const meters = game.runDist / 12;
  const distMult = 1 + Math.min(5, Math.floor(meters / 1000)) * 0.1;   // 每 1000 米距离分 +10%，深跑更值钱
  // 【内容扩展】分数狂潮：连"里程分"也 ×3。里程是累加量，不能整段乘(否则结束就回落像 bug)——
  //   只把"本帧新跑的距离分"多出来的 (×3-1) 份补进 bonus，于是已得分稳稳留住，狂潮一过自然停止加成
  if(scoreMult() > 1 && game.state === 'playing'){
    game.bonus += (move / 12) * distMult * (scoreMult() - 1);
  }
  game.score = Math.max(0, Math.floor(meters * distMult + game.coinCount * 5 + game.bonus - game.penalty));   // 【内容扩展修复】整体取整：分数狂潮的里程银行是小数
  // 跨过整千米：撒花报喜
  const mk = Math.floor(meters / 1000);
  if(mk > game.milestone){
    game.milestone = mk;
    showBanner('🏁 ' + mk * 1000 + ' 米！距离分 ×' + (1 + Math.min(5, mk) * 0.1).toFixed(1), 2.2, '#ffd34d');
    burst(player.x + player.w / 2, player.y - player.h - 10, 16, ['#ffd34d', '#ffffff']);
    sfx.power();
  }
  // 【可玩性】新手前1000米的小目标：300/500/750米节点报喜，填满"跑半天没盼头"的空窗（只给前5局新玩家，老玩家不刷屏）
  if((save.runs || 0) <= 5 && game.earlyMile < 3){
    const EM = [[300, '🏁 300 米 · 热身完成！'], [500, '🏁 500 米 · 难度上来咯'], [750, '🏁 750 米 · 马上破千米！']];
    while(game.earlyMile < 3 && meters >= EM[game.earlyMile][0]){
      showBanner(EM[game.earlyMile][1], 1.6, '#9bf6a0');
      game.earlyMile++;
    }
  }
  // 破纪录的那一瞬间：金色横幅 + 撒花！（日赛分数独立计算，不影响无尽纪录）
  if(endlessOnly() && !game.recordShown && game.startBest > 0 && game.score > game.startBest){   // 【酷跑2】闯关不弹破纪录
    game.recordShown = true;
    showBanner('🎉 新纪录诞生！', 2.2, '#ffd34d');
    burst(player.x + player.w / 2, player.y - player.h - 10, 20, ['#ffd34d', '#ffffff', '#ff9b4b']);
    setFace('joy', 1.5);
    sfx.power();
  }
  // 挑战链接：超过朋友分数的那一刻
  if(endlessOnly() && challenge && save.lastBeat !== challenge.name && game.score > challenge.score){   // 【酷跑2】闯关不结挑战赏
    save.lastBeat = challenge.name;
    save.coins += 100;
    saveSave();
    showBanner('🆚 击败了 ' + challenge.name + '！奖励 +100💰，转发回去让他好看', 3, '#ffd34d');
    sfx.power();
  }
  // 纪录旗快到了：提示一次
  if(endlessOnly() && !recordFlagShown && save.bestDist > 1000 &&
     save.bestDist - game.runDist < 1200 && save.bestDist - game.runDist > 0){   // 【酷跑2】闯关不提示纪录旗
    recordFlagShown = true;
    showBanner('🚩 前方就是你的最远纪录！', 1.8, '#ffd34d');
  }
  if(endlessOnly() && game.score > game.best) game.best = game.score;   // 积分制：最高纪录实时刷新（闯关不刷无尽纪录）
}

// 【酷跑1】结束下滑：恢复正常身高、清掉滑行标记（站起来）
function endSlide(){
  player.sliding = false;
  player.h = 36;
}
function updatePlayer(dt){
  const p = player;

  // 【酷跑1】下滑状态维护：滑够时间就站起来；任何原因离地（踩空/被蹦床弹/起跳）也立即结束
  if(p.sliding && (bgTime > p.slideUntil || !p.grounded)) endSlide();

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
    jumpedRun = true;     // 【新手】跳过了 → 收起"点屏幕跳"引导
    p.lastPress = -1e9;   // 设回"很久以前"，表示这次按键已经用掉了
    addStat('jumps', 1);   // 【留存包】③ 累计跳跃数
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

// 【内容扩展】全部"视觉世界"主题表（0 号 = null 表示原版草原昼夜底色，不覆盖任何颜色）
//   name   进入时横幅显示的世界名
//   tint   覆盖在昼夜底色上的配色（far远山/near近山/ground地面/top天顶/bot地平线，缺哪个就不改哪个）
//   rock   该世界岩石/地面装饰的颜色
//   dark   暗场景标记：true 时给岩石加自发光描边 + 叠一层夜色，保证障碍可见（霓虹都市/海底/火山）
//   deco   drawBackground 里画的专属背景装饰类型（vine藤蔓 / neon霓虹灯牌 / bubble气泡 / lava熔岩泡 / candy糖果，'' 表示无）
const WORLD_THEMES = [
  { name: '🌾 草原',     tint: null,                                                                 rock: '#6e7d63', dark: false, deco: ''      }, // 0 原版草原
  { name: '🏜️ 沙漠',     tint: { far:'#d8a878', near:'#c08850', ground:'#e8c890', bot:'#ffe2b8' },                                    rock: '#a8835a', dark: false, deco: ''      }, // 1 沙漠（原 BGM 沙漠段配色）
  { name: '❄️ 雪夜',     tint: { far:'#8fa8c8', near:'#6e8cb8', ground:'#eef4fa', top:'#2c3a5e', bot:'#9fb8d0' },                      rock: '#9fb8cc', dark: false, deco: ''      }, // 2 雪夜（原 BGM 雪夜段配色）
  { name: '🌴 丛林',     tint: { far:'#2f7d4f', near:'#1f5d39', ground:'#4a7a3a', top:'#3aa86a', bot:'#bfe9c0' },                      rock: '#4f5e3a', dark: false, deco: 'vine'  }, // 3 丛林（浓绿）
  { name: '🌃 霓虹都市', tint: { far:'#241a3a', near:'#160f28', ground:'#1a1430', top:'#0c0820', bot:'#3a1f55' },                      rock: '#2a2150', dark: true,  deco: 'neon'  }, // 4 霓虹都市（暗底+霓虹剪影）
  { name: '🐠 海底世界', tint: { far:'#1f6f9c', near:'#155a86', ground:'#1e7f8c', top:'#0e3a66', bot:'#3fb3c8' },                      rock: '#1d6f78', dark: true,  deco: 'bubble'}, // 5 海底（蓝青+气泡）
  { name: '🌋 火山',     tint: { far:'#6a2418', near:'#4a1810', ground:'#3a1410', top:'#2a0c0a', bot:'#c84a22' },                      rock: '#5a2218', dark: true,  deco: 'lava'  }, // 6 火山（暗红熔岩）
  { name: '🍬 糖果世界', tint: { far:'#ffb7d8', near:'#ff9ec8', ground:'#ffd6ea', top:'#ffc0e0', bot:'#fff0f7' },                      rock: '#e88ab8', dark: false, deco: 'candy' }, // 7 糖果（粉彩）
];

function skyPalette(){
  const u = (bgTime % CYCLE) / CYCLE * 4;
  // ((x % 4) + 4) % 4 这种写法保证结果一定落在 0~3（JS 的 % 对负数会返回负数）
  const i = ((Math.floor(u) % 4) + 4) % 4;
  const f = smooth(u - Math.floor(u));
  const a = PALETTES[i], b = PALETTES[(i + 1) % 4];
  const mix = {};
  for(const k of ['top', 'bot', 'far', 'near', 'ground']) mix[k] = lerpColor(a[k], b[k], f);
  mix.night = clamp(1 - Math.abs(u - 2.5), 0, 1);   // 0=白天 1=深夜（控制星星和夜色）
  // 【内容扩展】视觉世界轮换：每约 1200 米切下一个世界，200 米渐变过渡，循环。
  //   注意只换"看的"，BGM 仍按里程分段（bgmTier 没动），两者彻底解耦。
  const bm = game.state === 'playing' ? game.runDist / 12 : 0;
  const SEG = 1200, FADE = 200;
  const slot = Math.floor(bm / SEG);                 // 当前处在序列的第几段
  const wIdx = worldSeq[((slot % worldSeq.length) + worldSeq.length) % worldSeq.length];   // 循环取下标，保证非负
  const w = WORLD_THEMES[wIdx] || WORLD_THEMES[0];
  // 渐变：每段最后 FADE 米里，把"当前世界"往"下一段世界"过渡，肉眼无缝切换
  const intoNext = clamp((bm - slot * SEG - (SEG - FADE)) / FADE, 0, 1);
  const nIdx = worldSeq[(((slot + 1) % worldSeq.length) + worldSeq.length) % worldSeq.length];
  const nw = WORLD_THEMES[nIdx] || WORLD_THEMES[0];
  // 先把当前世界的 tint 叠到昼夜底色上
  if(w.tint){ for(const k2 in w.tint) mix[k2] = lerpColor(rgbToHex(mix[k2]), w.tint[k2], 1); }
  // 再在过渡带里向下一世界推进（下一世界没 tint 就退回纯昼夜底色）
  if(intoNext > 0){
    const baseSnap = {};   // 当前帧昼夜底色（用于"退回"无 tint 的世界）
    for(const k of ['top', 'bot', 'far', 'near', 'ground']) baseSnap[k] = lerpColor(a[k], b[k], f);
    for(const k2 of ['top', 'bot', 'far', 'near', 'ground']){
      const tgt = (nw.tint && nw.tint[k2]) ? nw.tint[k2] : baseSnap[k2];
      mix[k2] = lerpColor(rgbToHex(mix[k2]), rgbToHex(tgt), intoNext);
    }
  }
  mix.biome = wIdx;                          // 当前视觉世界下标（render 写回 curBiome）
  mix.worldName = w.name;                    // 当前世界名（进新世界时弹横幅用）
  mix.dark = w.dark;                         // 暗场景标记（叠夜色 + 障碍发光）
  if(w.dark) mix.night = Math.max(mix.night, 0.55);   // 暗世界至少半夜，星星/夜色滤镜跟着上
  mix.deco = w.deco;                         // 专属背景装饰类型
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

  // 【内容扩展】当前世界专属背景装饰（藤蔓/霓虹灯牌/气泡/熔岩泡/糖果），画在山之后、地面之前
  drawWorldDeco(pal);

  // 地面：竖向渐变（顶部受光略亮、越往下越暗）+ 顶部一道受光亮边 + 暗接缝
  const gg = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  gg.addColorStop(0, shade(pal.ground, 0.06));
  gg.addColorStop(1, shade(pal.ground, -0.28));
  ctx.fillStyle = gg;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';   // 草皮/跑道边缘的高光
  ctx.fillRect(0, GROUND_Y, W, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, GROUND_Y + 2, W, 3);
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

// 【内容扩展】各世界专属背景装饰：根据 pal.deco 选一种画法，靠 game.dist 视差滚动、bgTime 做轻动画
function drawWorldDeco(pal){
  const d = pal.deco;
  if(!d) return;
  if(d === 'vine'){
    // 丛林：从天顶垂下的藤蔓 + 末端叶片，营造浓绿氛围
    ctx.strokeStyle = 'rgba(30,90,40,0.55)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    const span = W + 160;
    for(let i = 0; i < 6; i++){
      const bx = ((i * 170 - game.dist * 0.22) % span + span) % span - 80;
      const len = 60 + (i % 3) * 26;
      const sway = Math.sin(bgTime * 1.2 + i) * 10;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.quadraticCurveTo(bx + sway, len * 0.5, bx + sway * 1.4, len);
      ctx.stroke();
      ctx.fillStyle = 'rgba(40,120,55,0.6)';
      ctx.beginPath(); ctx.ellipse(bx + sway * 1.4, len, 9, 5, 0.5, 0, TAU); ctx.fill();
    }
    ctx.lineCap = 'butt';
  } else if(d === 'neon'){
    // 霓虹都市：暗色楼宇剪影 + 顶部霓虹粉/青灯牌，闪烁
    // 【内容扩展修复】压矮 + 实心剪影 + 退到远景：原来太高显空心、挤进了赛道
    const span = W + 200;
    for(let i = 0; i < 8; i++){
      const bx = ((i * 130 - game.dist * 0.18) % span + span) % span - 100;
      const bw = 64 + (i % 3) * 20, bh = 52 + (i % 4) * 22;   // 矮一半：当远处天际线
      ctx.fillStyle = '#1a1430';                              // 比夜空亮一点，看得出是实心楼
      ctx.fillRect(bx, GROUND_Y - bh, bw, bh);
      const neon = (i % 2 === 0) ? '#ff5ea8' : '#7df9ff';
      ctx.strokeStyle = neon; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
      ctx.strokeRect(bx + 1, GROUND_Y - bh + 1, bw - 2, bh - 2);
      ctx.fillStyle = neon;
      ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(bgTime * 2 + i));
      ctx.fillRect(bx + bw * 0.3, GROUND_Y - bh + 10, 6, 6);
      ctx.fillRect(bx + bw * 0.62, GROUND_Y - bh + 24, 6, 6);
      ctx.globalAlpha = 1;
    }
  } else if(d === 'bubble'){
    // 海底：从下往上飘的气泡群
    ctx.strokeStyle = 'rgba(220,250,255,0.55)'; ctx.lineWidth = 1.5;
    for(let i = 0; i < 14; i++){
      const bx = ((i * 73 - game.dist * 0.12) % (W + 60) + (W + 60)) % (W + 60) - 30;
      const by = GROUND_Y - ((bgTime * 22 + i * 47) % (GROUND_Y - 10));
      const r = 3 + (i % 4) * 2.2;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.stroke();
    }
  } else if(d === 'lava'){
    // 火山：地平线上鼓出的熔岩泡 + 飘升的火星
    ctx.fillStyle = 'rgba(255,120,40,0.7)';
    for(let i = 0; i < 7; i++){
      const bx = ((i * 150 - game.dist * 0.28) % (W + 120) + (W + 120)) % (W + 120) - 60;
      const r = 8 + 5 * Math.abs(Math.sin(bgTime * 1.6 + i));
      ctx.beginPath(); ctx.arc(bx, GROUND_Y - 2, r, Math.PI, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,200,80,0.8)';
    for(let i = 0; i < 10; i++){
      const bx = ((i * 97 - game.dist * 0.2) % (W + 40) + (W + 40)) % (W + 40) - 20;
      const by = GROUND_Y - ((bgTime * 30 + i * 33) % 160);
      ctx.fillRect(bx, by, 2.5, 2.5);
    }
  } else if(d === 'candy'){
    // 糖果世界：飘浮的棒棒糖/糖豆，粉彩点缀
    const cols = ['#ff8ac0', '#9be4ff', '#fff0a0', '#c2a0ff'];
    for(let i = 0; i < 9; i++){
      const bx = ((i * 120 - game.dist * 0.16) % (W + 80) + (W + 80)) % (W + 80) - 40;
      const by = 60 + (i % 3) * 40 + Math.sin(bgTime * 1.3 + i) * 8;
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath(); ctx.arc(bx, by, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, 9, -0.6, 1.0); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// 坑：地面上的致命缺口，画成一个越往下越黑的深洞
function drawPits(){
  for(const pt of pits){
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, '#3a3142');
    g.addColorStop(1, '#120e1a');
    ctx.fillStyle = g;
    ctx.fillRect(pt.x, GROUND_Y, pt.w, H - GROUND_Y);
    // 【清晰化】黑坑在深色地面上极难看清——给洞口两侧加高对比"危险唇"(亮黄) + 内侧暗边，边界一眼就分清
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(pt.x + 3, GROUND_Y, 4, H - GROUND_Y);
    ctx.fillRect(pt.x + pt.w - 7, GROUND_Y, 4, H - GROUND_Y);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(pt.x - 2, GROUND_Y - 1, 6, 6);
    ctx.fillRect(pt.x + pt.w - 4, GROUND_Y - 1, 6, 6);
    // 洞口上方常驻一个脉动的警示标（坑=必死，所有坑都要醒目，不只教学坑）
    const wy = GROUND_Y - 22 + Math.sin(bgTime * 7) * 4, wx2 = pt.x + pt.w / 2;
    ctx.fillStyle = pt.warn ? '#ff4d4d' : 'rgba(255,90,90,0.92)';
    ctx.beginPath();   // 倒三角警示牌
    ctx.moveTo(wx2 - 9, wy - 7); ctx.lineTo(wx2 + 9, wy - 7); ctx.lineTo(wx2, wy + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(wx2 - 1.5, wy - 5, 3, 6); ctx.fillRect(wx2 - 1.5, wy + 2, 3, 3);   // 叹号
  }
  // 纪录旗：上次破纪录跑到的位置，插一面小金旗（追过它就是新纪录的节奏！）
  if(endlessOnly() && game.state === 'playing' && save.bestDist > 1000){   // 【酷跑2】闯关赛道不画无尽纪录旗
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
const GROUND_OBS = { cactus: 1, double: 1, spikes: 1, roller: 1, trampoline: 1 };   // 落地型障碍：脚下投影
function drawObstacles(){
  for(const o of obstacles){
    const top = GROUND_Y - o.h;
    if(GROUND_OBS[o.type]){   // 【清晰化】落地阴影：障碍脚下一团暗影，和五花八门的背景拉开对比，更醒目
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, GROUND_Y + 2, Math.max(10, o.w * 0.55), 5, 0, 0, TAU); ctx.fill();
    }
    if(o.type === 'cactus'){
      const cx = o.x + o.w / 2;
      ctx.fillStyle = '#3f8c4b';
      rr(cx - 7, top, 14, o.h, 7); ctx.fill();                       // 主干
      ctx.strokeStyle = 'rgba(10,34,16,0.65)'; ctx.lineWidth = 2.5;   // 【真机反馈】描边提对比
      rr(cx - 7, top, 14, o.h, 7); ctx.stroke();
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
      ctx.fillStyle = '#e3ecf8';   // 【真机反馈】尖刺调亮 + 描边，灰刺在灰山前看不清
      ctx.strokeStyle = 'rgba(20,26,40,0.6)'; ctx.lineWidth = 2;
      const n = Math.max(3, Math.round(o.w / 14));
      for(let i = 0; i < n; i++){
        const sx = o.x + i * (o.w / n);
        ctx.beginPath();
        ctx.moveTo(sx, GROUND_Y);
        ctx.lineTo(sx + o.w / n / 2, GROUND_Y - o.h);
        ctx.lineTo(sx + o.w / n, GROUND_Y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
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
    } else if(o.type === 'trampoline'){
      drawTrampoline(o);
    } else if(o.type === 'bar' || o.type === 'lowbar'){
      drawBar(o);
    } else if(o.type === 'laser'){
      drawLaser(o);
    } else if(o.type === 'flame'){
      drawFlame(o);
    } else if(o.type === 'saw'){
      // 【丰富度】滚锯：高速旋转的锯齿轮，朝你滚来
      o.roll = (o.roll || 0) + 0.5;
      const R = o.w / 2, rx = o.x + R, ry = GROUND_Y - R;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(rx, GROUND_Y + 3, R, 5, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(rx, ry); ctx.rotate(o.roll);
      ctx.fillStyle = '#c4cbd6';
      ctx.beginPath();
      for(let i = 0; i < 12; i++){
        const a = i / 12 * TAU, a2 = (i + 0.5) / 12 * TAU;
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
        ctx.lineTo(Math.cos(a2) * (R + 5), Math.sin(a2) * (R + 5));
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(20,26,40,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#8a93a3'; ctx.beginPath(); ctx.arc(0, 0, R * 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5b6473'; ctx.beginPath(); ctx.arc(0, 0, R * 0.16, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-R * 0.4, 0); ctx.lineTo(R * 0.4, 0); ctx.stroke();
      ctx.restore();
      if(Math.random() < 0.5){ ctx.fillStyle = '#ffd34d'; ctx.fillRect(rx - R + rand(-3, 3), GROUND_Y - 2, 2, 2); }
    } else if(o.type === 'spiketrap'){
      // 【丰富度】地刺机关：周期升起的尖刺；预警时底座闪红
      const lv = spikeLevel(o);
      ctx.fillStyle = '#4a4150'; ctx.fillRect(o.x, GROUND_Y - 4, o.w, 4);
      if(spikeWarn(o)){ ctx.fillStyle = 'rgba(255,80,80,' + (0.4 + 0.4 * Math.abs(Math.sin(bgTime * 12))) + ')'; ctx.fillRect(o.x, GROUND_Y - 4, o.w, 4); }
      const sh = 22 * lv;
      if(sh > 0.5){
        ctx.fillStyle = '#e3ecf8'; ctx.strokeStyle = 'rgba(20,26,40,0.6)'; ctx.lineWidth = 1.5;
        const n = Math.max(3, Math.round(o.w / 12)), seg = (o.w - 6) / n;
        for(let i = 0; i < n; i++){
          const sx = o.x + 3 + i * seg;
          ctx.beginPath(); ctx.moveTo(sx, GROUND_Y - 4); ctx.lineTo(sx + seg / 2, GROUND_Y - 4 - sh); ctx.lineTo(sx + seg, GROUND_Y - 4); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
    } else if(o.type === 'hammer'){
      // 【丰富度】落锤：从天而降的冲压锤，砸下时锤头变红 + 地面震击影
      const hy = hammerHeadY(o), down = hammerDown(o), hx = o.x + o.w / 2;
      ctx.fillStyle = '#3a3f4d'; ctx.fillRect(hx - 3, 0, 6, hy - 22);
      ctx.fillStyle = down ? '#d05b5b' : '#9aa3b4';
      rr(o.x, hy - 22, o.w, 26, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; rr(o.x, hy - 22, o.w, 26, 4); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; rr(o.x + 3, hy - 19, o.w - 6, 4, 2); ctx.fill();
      if(down){ ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(hx, GROUND_Y, o.w * 0.7, 5, 0, 0, TAU); ctx.fill(); }
    } else if(o.type === 'meteor'){
      const my = meteorY(o);
      if(my === null){
        // 【真机反馈】预警改成亮橙色脉动靶圈：旧版黑影子在雪夜的黑地面上等于隐身
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(bgTime * 8));
        ctx.strokeStyle = 'rgba(255,176,77,' + pulse + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(o.x + 15, GROUND_Y + 2, 10 + (bgTime % 0.4) * 24, 6, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,120,50,' + pulse + ')';
        ctx.beginPath(); ctx.ellipse(o.x + 15, GROUND_Y + 2, 5, 3, 0, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';   // 落点阴影
        ctx.beginPath(); ctx.ellipse(o.x + 15, GROUND_Y + 4, 16, 5, 0, 0, TAU); ctx.fill();
        if(my < GROUND_Y){   // 坠落拖尾：又粗又亮
          ctx.strokeStyle = 'rgba(255,200,90,0.85)'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(o.x + 15, my - 70); ctx.lineTo(o.x + 15, my - 14); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,140,60,0.5)'; ctx.lineWidth = 12;
          ctx.beginPath(); ctx.moveTo(o.x + 15, my - 52); ctx.lineTo(o.x + 15, my - 18); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,150,60,0.35)';   // 外圈光晕
        ctx.beginPath(); ctx.arc(o.x + 15, my - 13, 24, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff7b2f';
        ctx.beginPath(); ctx.arc(o.x + 15, my - 13, 16, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath(); ctx.arc(o.x + 10, my - 17, 7, 0, TAU); ctx.fill();
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
// 【酷跑1】高处横杆：一根带黑黄警示斜纹的醒目栏杆，两端竖支柱撑到地面，提示"从下面滑过去"
function drawBar(o){
  const barY = GROUND_Y - o.alt - o.h;        // 杆身顶端 y
  const barBot = GROUND_Y - o.alt;            // 杆身底端 y（玩家头要从这条线下方钻过）
  // 两根支柱：从杆身底撑到地面，让横杆"挂得住"，也提示这里有个门要钻
  ctx.fillStyle = '#6b5a3a';
  ctx.fillRect(o.x + 2, barBot, 5, o.alt);
  ctx.fillRect(o.x + o.w - 7, barBot, 5, o.alt);
  // 杆身底色 + 深描边（保证各世界底色下都看得清）
  ctx.fillStyle = '#3a2f1e';
  rr(o.x, barY, o.w, o.h, 4); ctx.fill();
  // 黑黄警示斜纹（经典"危险横杆"）：裁剪在杆身内画斜条
  ctx.save();
  rr(o.x, barY, o.w, o.h, 4); ctx.clip();
  const stripeW = 12;
  for(let sx = o.x - o.h; sx < o.x + o.w + o.h; sx += stripeW * 2){
    ctx.fillStyle = '#ffcf33';
    ctx.beginPath();
    ctx.moveTo(sx, barY + o.h); ctx.lineTo(sx + stripeW, barY + o.h);
    ctx.lineTo(sx + stripeW + o.h, barY); ctx.lineTo(sx + o.h, barY);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // 高光 + 醒目描边
  ctx.strokeStyle = 'rgba(20,16,8,0.7)'; ctx.lineWidth = 2.5;
  rr(o.x, barY, o.w, o.h, 4); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  rr(o.x + 3, barY + 2, o.w - 6, 3, 1.5); ctx.fill();
  // 头顶飘一个"⬇"小箭头，第一眼就知道是要下滑（脉动更显眼）
  const ay = barY - 14 - Math.abs(Math.sin(bgTime * 5)) * 4;
  ctx.fillStyle = '#8ee6ff';
  ctx.font = 'bold 16px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('⬇', o.x + o.w / 2, ay);
}
// 【内容扩展】蹦床：两根支腿撑一张有弹性的橙黄色弹面，踩中会压扁回弹；上方一串金币（在 makeObstacle 里已生成）
function drawTrampoline(o){
  const surfY = GROUND_Y - o.h;
  const cx = o.x + o.w / 2;
  // 压扁动画：squish 量随时间回弹（被踩时在 update 里置为 0.5）
  o.squish = Math.max(0, (o.squish || 0) - 0.06);
  const dip = o.squish * 12;                 // 弹面被踩下去的深度
  // 支腿
  ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(o.x + 5, surfY + 4); ctx.lineTo(o.x + 9, GROUND_Y);
  ctx.moveTo(o.x + o.w - 5, surfY + 4); ctx.lineTo(o.x + o.w - 9, GROUND_Y);
  ctx.stroke();
  // 弹面（一条向下凹的弹性曲线，醒目橙黄 + 深描边）
  ctx.fillStyle = '#ffb23d';
  ctx.beginPath();
  ctx.moveTo(o.x, surfY);
  ctx.quadraticCurveTo(cx, surfY + 8 + dip, o.x + o.w, surfY);
  ctx.quadraticCurveTo(cx, surfY - 4 + dip, o.x, surfY);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,10,0.7)'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(o.x, surfY);
  ctx.quadraticCurveTo(cx, surfY + 8 + dip, o.x + o.w, surfY);
  ctx.stroke();
  // 上跳指示箭头（脉动），告诉玩家"踩我会弹上去"
  const ap = 0.5 + 0.5 * Math.sin(bgTime * 6);
  ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.5 * ap) + ')';
  ctx.beginPath();
  ctx.moveTo(cx, surfY - 18 - ap * 6); ctx.lineTo(cx - 7, surfY - 8); ctx.lineTo(cx + 7, surfY - 8);
  ctx.closePath(); ctx.fill();
}
// 【内容扩展】激光门：天花板/地面两个发射座 + 中间一道竖光柱。开着=红亮致命，关着=暗淡可过，
//   切换前 0.35 秒闪烁预警，颜色醒目（红/橙），节奏可预判
function drawLaser(o){
  const cx = o.x + o.w / 2;
  const on = laserOn(o);
  const ph = laserPhase(o);
  // 两端的发射器底座（一直可见，提示"这里有激光门"）
  ctx.fillStyle = '#3a2230';
  rr(o.x + 1, 0, o.w - 2, 16, 4); ctx.fill();
  rr(o.x + 1, GROUND_Y - 16, o.w - 2, 16, 4); ctx.fill();
  ctx.fillStyle = '#ffd34d';
  rr(o.x + 4, 12, o.w - 8, 4, 2); ctx.fill();
  rr(o.x + 4, GROUND_Y - 16, o.w - 8, 4, 2); ctx.fill();
  // 关闭期临近开启（最后 25%）→ 红点闪烁预警
  const warning = !on && ph > o.onFrac + (1 - o.onFrac) * 0.6;
  if(on){
    // 致命光柱：外层光晕 + 内层亮芯，整条贯穿
    const pulse = 0.7 + 0.3 * Math.sin(bgTime * 30);
    ctx.fillStyle = 'rgba(255,60,60,' + (0.32 * pulse) + ')';
    ctx.fillRect(cx - 12, 16, 24, GROUND_Y - 32);
    ctx.fillStyle = 'rgba(255,90,90,0.85)';
    ctx.fillRect(cx - 5, 16, 10, GROUND_Y - 32);
    ctx.fillStyle = '#fff3f3';
    ctx.fillRect(cx - 2, 16, 4, GROUND_Y - 32);
  } else {
    // 关闭：暗淡的待机光纹 + （临近开启时）闪烁的警示
    const a = warning ? (0.4 + 0.4 * Math.abs(Math.sin(bgTime * 18))) : 0.16;
    ctx.fillStyle = 'rgba(255,70,70,' + a + ')';
    ctx.fillRect(cx - 1.5, 16, 3, GROUND_Y - 32);
  }
}
// 【内容扩展】火焰喷射口：地面一个金属喷嘴，周期向上喷火柱。喷前 warn 秒口部冒火星预警，
//   喷发时画一条跳动的橙红火舌（高度随 flameLevel 变化），间隙只剩喷嘴可安全通过
function drawFlame(o){
  const cx = o.x + o.w / 2;
  // 喷嘴底座
  ctx.fillStyle = '#444';
  rr(o.x + 6, GROUND_Y - 12, o.w - 12, 12, 3); ctx.fill();
  ctx.fillStyle = '#666';
  rr(o.x + 10, GROUND_Y - 16, o.w - 20, 6, 2); ctx.fill();
  const lv = flameLevel(o);
  if(lv > 0){
    const fh = o.h * lv;
    const topY = GROUND_Y - 14 - fh;
    // 外焰（橙）→ 内焰（黄）→ 芯（白），边缘用正弦抖动模拟火舌跳动
    const wob = Math.sin(bgTime * 24) * 4;
    ctx.fillStyle = 'rgba(255,120,30,0.92)';
    ctx.beginPath();
    ctx.moveTo(cx - 13, GROUND_Y - 14);
    ctx.quadraticCurveTo(cx - 9 + wob, topY + fh * 0.4, cx, topY);
    ctx.quadraticCurveTo(cx + 9 - wob, topY + fh * 0.4, cx + 13, GROUND_Y - 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,210,70,0.95)';
    ctx.beginPath();
    ctx.moveTo(cx - 8, GROUND_Y - 14);
    ctx.quadraticCurveTo(cx - 5 - wob, topY + fh * 0.5, cx, topY + fh * 0.18);
    ctx.quadraticCurveTo(cx + 5 + wob, topY + fh * 0.5, cx + 8, GROUND_Y - 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,235,0.9)';
    ctx.beginPath();
    ctx.moveTo(cx - 3, GROUND_Y - 14);
    ctx.quadraticCurveTo(cx, topY + fh * 0.45, cx + 3, GROUND_Y - 14);
    ctx.closePath(); ctx.fill();
    // 升腾的火星
    for(let i = 0; i < 3; i++){
      const sp = (bgTime * 2.2 + i * 0.4) % 1;
      ctx.fillStyle = 'rgba(255,180,60,' + (0.8 - sp) + ')';
      ctx.beginPath();
      ctx.arc(cx + Math.sin(i * 2 + bgTime * 5) * 8, GROUND_Y - 14 - sp * fh, 2, 0, TAU);
      ctx.fill();
    }
  } else if(flameWarn(o)){
    // 预警：喷口冒红光 + 跳动的小火星，提示"马上喷火"
    const a = 0.4 + 0.4 * Math.abs(Math.sin(bgTime * 16));
    ctx.fillStyle = 'rgba(255,90,40,' + a + ')';
    ctx.beginPath(); ctx.ellipse(cx, GROUND_Y - 16, 9, 4, 0, 0, TAU); ctx.fill();
    for(let i = 0; i < 3; i++){
      ctx.fillStyle = 'rgba(255,160,60,' + a + ')';
      ctx.beginPath();
      ctx.arc(cx + (i - 1) * 6, GROUND_Y - 20 - Math.abs(Math.sin(bgTime * 12 + i)) * 8, 1.6, 0, TAU);
      ctx.fill();
    }
  }
}
// 【血条Boss】画 Boss（一条盘旋在右上方的巨龙）+ 头顶红色血条 + 它的攻击物（俯冲影/落石/冲击波）
function drawBoss(){
  const bx = boss.x, by = boss.y;
  ctx.save();
  // —— 龙身：深红椭圆躯干 + 翅膀拍动 + 头部 + 眼睛 ——
  const flap = Math.sin(boss.t * 6) * 0.5;   // 翅膀拍动相位
  // 翅膀（左右各一片，随 flap 上下扇）
  ctx.fillStyle = '#7a1020';
  for(const s of [-1, 1]){
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + s * 52, by - 30 - flap * 26);
    ctx.lineTo(bx + s * 60, by + 6);
    ctx.closePath();
    ctx.fill();
  }
  // 躯干
  ctx.fillStyle = '#b51d2e';
  ctx.beginPath(); ctx.ellipse(bx, by, 34, 24, 0, 0, TAU); ctx.fill();
  // 肚皮高光
  ctx.fillStyle = '#d94452';
  ctx.beginPath(); ctx.ellipse(bx, by + 6, 22, 13, 0, 0, TAU); ctx.fill();
  // 头（朝左盯着玩家）
  ctx.fillStyle = '#b51d2e';
  ctx.beginPath(); ctx.ellipse(bx - 30, by - 6, 18, 14, 0, 0, TAU); ctx.fill();
  // 犄角
  ctx.fillStyle = '#f2e6c0';
  ctx.beginPath(); ctx.moveTo(bx - 36, by - 16); ctx.lineTo(bx - 30, by - 30); ctx.lineTo(bx - 28, by - 16); ctx.closePath(); ctx.fill();
  // 眼睛（发光的黄眼，受伤时更红）
  ctx.fillStyle = boss.hp < boss.maxHp * 0.35 ? '#ff3a3a' : '#ffd34d';
  ctx.beginPath(); ctx.arc(bx - 38, by - 8, 4, 0, TAU); ctx.fill();
  // 嘴里隐约的火光（攻击临近时更亮）
  const heat = clamp(1 - boss.nextAtk / 1.4, 0, 1);
  ctx.fillStyle = 'rgba(255,150,40,' + (0.3 + 0.5 * heat).toFixed(2) + ')';
  ctx.beginPath(); ctx.arc(bx - 48, by - 4, 4 + 3 * heat, 0, TAU); ctx.fill();

  // —— 头顶 Boss 血条（红色，按 hp/maxHp）——
  const bw = 90, bh = 8, bbx = bx - bw / 2, bby = by - 52;
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bbx - 2, bby - 2, bw + 4, bh + 4);
  ctx.fillStyle = '#ff3a3a';
  ctx.fillRect(bbx, bby, bw * clamp(boss.hp / boss.maxHp, 0, 1), bh);
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
  ctx.strokeRect(bbx, bby, bw, bh);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('👹 BOSS', bx, bby - 3);
  ctx.restore();

  // —— Boss 攻击物 ——
  ctx.save();
  for(const a of bossAtks){
    if(a.type === 'dive'){
      // 俯冲影：半透明红色冲击爪影
      ctx.fillStyle = 'rgba(255,60,60,0.55)';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,150,0.6)';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 0.5, 0, TAU); ctx.fill();
    } else if(a.type === 'rock'){
      // 火球/落石：橙红核心 + 拖尾
      ctx.fillStyle = '#7a1010';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff7a2a';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 0.6, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,180,60,0.5)';
      ctx.beginPath(); ctx.arc(a.x - a.vx * 0.015, a.y - a.vy * 0.015, a.r * 0.4, 0, TAU); ctx.fill();
    } else {
      // 地面冲击波：贴地的半圆能量墙
      ctx.fillStyle = 'rgba(255,90,90,0.7)';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,120,0.7)';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 0.6, Math.PI, TAU); ctx.fill();
    }
  }
  ctx.restore();
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
    } else if(it.type === 'shrink'){
      // 【内容扩展】缩小：一个大箭头 + 一个小箭头朝中心（"变小"），下方一只迷你小动物
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(-3, -3); ctx.moveTo(-3, -7); ctx.lineTo(-3, -3); ctx.lineTo(-7, -3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9, 9); ctx.lineTo(3, 3); ctx.moveTo(3, 7); ctx.lineTo(3, 3); ctx.lineTo(7, 3); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();   // 缩到一点的小身子
    } else if(it.type === 'ghost'){
      // 【内容扩展】幽灵：半透明小幽灵（圆头 + 波浪下摆 + 两只黑眼睛）
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, -2, 8, Math.PI, 0);            // 圆脑袋
      ctx.lineTo(8, 7);
      ctx.lineTo(4, 4); ctx.lineTo(0, 7); ctx.lineTo(-4, 4); ctx.lineTo(-8, 7);   // 波浪下摆
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#3a3f5a';
      ctx.beginPath(); ctx.arc(-3, -2, 1.7, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(3, -2, 1.7, 0, TAU); ctx.fill();
    } else if(it.type === 'scorex3'){
      // 【内容扩展】分数狂潮：金色 "×3" 字样
      ctx.fillStyle = col;
      ctx.font = 'bold 14px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×3', 0, 1);
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
// 【内容扩展】神秘宝箱：发光的木箱（金边 + 锁扣 + 呼吸光晕 + 顶上一个 ? ），很醒目
function drawBoxes(){
  for(const b of boxes){
    const bob = Math.sin(bgTime * 3.5 + b.phase) * 4;        // 上下漂浮
    const glow = 0.5 + 0.5 * Math.sin(bgTime * 5 + b.phase);  // 一呼一吸的光
    ctx.save();
    ctx.translate(b.x, b.y + bob);
    // 呼吸光晕
    ctx.fillStyle = 'rgba(255,211,77,' + (0.18 + 0.16 * glow).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(0, 2, 22 + glow * 3, 0, TAU); ctx.fill();
    // 箱体
    ctx.fillStyle = '#8a5a2b';
    rr(-13, -4, 26, 18, 3); ctx.fill();
    ctx.fillStyle = '#a9702f';                                // 箱盖（拱形）
    ctx.beginPath();
    ctx.moveTo(-13, -4); ctx.lineTo(13, -4);
    ctx.lineTo(13, -8); ctx.quadraticCurveTo(0, -16, -13, -8);
    ctx.closePath(); ctx.fill();
    // 金属包边
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2.5;
    rr(-13, -4, 26, 18, 3); ctx.stroke();
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(-2, -14, 4, 28);                             // 中缝竖条
    // 锁扣
    ctx.fillStyle = '#fff3b0';
    rr(-4, 4, 8, 6, 2); ctx.fill();
    // 顶上一个问号，提示"未知大奖"
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.7 + 0.3 * glow;
    ctx.fillText('?', 0, -22);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
// 【内容扩展】字母卡：发光圆牌上一个大字「狐/狸/快/跑」，四角不同主色，醒目易认
const LETTER_COLORS = ['#ffd34d', '#ff8aa0', '#7df9ff', '#b0fc38'];
function drawLetters(){
  for(const lt of letters){
    const bob = Math.sin(bgTime * 4 + lt.phase) * 5;
    const glow = 0.5 + 0.5 * Math.sin(bgTime * 6 + lt.phase);
    const col = LETTER_COLORS[lt.idx % LETTER_COLORS.length];
    ctx.save();
    ctx.translate(lt.x, lt.y + bob);
    // 光晕
    ctx.fillStyle = 'rgba(255,255,255,' + (0.14 + 0.14 * glow).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(0, 0, 18 + glow * 2, 0, TAU); ctx.fill();
    // 圆牌底
    ctx.fillStyle = 'rgba(20,24,40,0.82)';
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.stroke();
    // 大字
    ctx.fillStyle = col;
    ctx.font = 'bold 16px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(LETTER_CHARS[lt.idx], 0, 1);
    ctx.restore();
  }
}
function rock(x, w, h){
  // 【内容扩展】岩石颜色跟着当前视觉世界走（覆盖全部 WORLD_THEMES，越界兜底草原灰绿）
  const wt = WORLD_THEMES[curBiome] || WORLD_THEMES[0];
  ctx.fillStyle = wt.rock || '#6e7d63';
  rr(x, GROUND_Y - h, w, h, Math.min(8, w / 3)); ctx.fill();
  if(wt.dark){
    // 【内容扩展】霓虹都市/海底/火山这类暗场景：给障碍加一圈青色自发光描边，保证看得见（参考岩石原描边做法）
    ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 3;
    rr(x, GROUND_Y - h, w, h, Math.min(8, w / 3)); ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3;   // 【真机反馈】描边：和地面拉开对比
    rr(x, GROUND_Y - h, w, h, Math.min(8, w / 3)); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
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
    // 柔和金色外发光：金币在任何背景上都跳出来
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 14);
    glow.addColorStop(0, 'rgba(255,221,90,0.55)');
    glow.addColorStop(1, 'rgba(255,221,90,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
    ctx.scale(Math.max(0.15, spin), 1);
    // 深金外圈
    ctx.fillStyle = '#c8920f';
    ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, TAU); ctx.fill();
    // 主体径向渐变（左上亮、右下暗 = 金属球面）
    const cg = ctx.createRadialGradient(-2.5, -3, 1, 0, 0, 9);
    cg.addColorStop(0, '#fff6c8');
    cg.addColorStop(0.45, '#ffd34d');
    cg.addColorStop(1, '#e8a317');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    // 高光点
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.ellipse(-2.6, -3.2, 2.2, 1.4, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// 【酷跑2】画当前出战的萌宠：飘在玩家身后上方，用 emoji 当本体（轻量、好认），技能触发时加特效。
//   日赛(dailyMode)下 activePet 返回 null，不画——和"日赛禁用萌宠"一致。
function drawPet(p){
  const ap = activePet();
  if(!ap) return;
  const px2 = p.x - 22, py2 = p.y - p.h - 22 + Math.sin(bgTime * 4) * 4;   // 身后偏上，轻轻上下浮
  // 星宝/吸金喵：磁吸时（脉冲期或常驻）泛起青色光环
  const magnetic = (ap.id === 'star' && bgTime < petPulseUntil) || ap.id === 'magnetpet';
  if(magnetic){
    ctx.strokeStyle = 'rgba(125,249,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px2, py2, 12 + (bgTime % 0.5) * 30, 0, TAU); ctx.stroke();
  }
  // 铁拳熊：刚撞完的短暂拳印（橙色星花圈）
  if(ap.id === 'smashpet' && bgTime < petSmashFx){
    ctx.strokeStyle = 'rgba(255,138,92,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(px2, py2, 10 + (petSmashFx - bgTime) * 40, 0, TAU); ctx.stroke();
  }
  // 不死鸟：本局复活机会还在时，身上裹一层暖金微光（用过就不发光，提示"救援已用掉"）
  if(ap.id === 'revivepet' && !petReviveUsed){
    ctx.fillStyle = 'rgba(255,184,77,' + (0.18 + 0.12 * Math.sin(bgTime * 4)) + ')';
    ctx.beginPath(); ctx.arc(px2, py2, 13, 0, TAU); ctx.fill();
  }
  ctx.save();
  ctx.font = '20px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ap.emoji, px2, py2);
  ctx.restore();
}

function drawPlayer(){
  const p = player;
  const ch = dailyMode ? CHARS.fox : (CHARS[save.char] || CHARS.fox);
  // 脚下接地阴影：在地面投一团柔影，跳得越高越小越淡（让角色"踩在地上"而不是飘着）
  {
    const air = clamp((GROUND_Y - p.y) / 130, 0, 1);   // 离地高度比例（0=贴地，1=跳到高处）
    const sa = 0.30 * (1 - air * 0.72);
    if(sa > 0.02){
      const sw = p.w * (0.95 - air * 0.45);
      ctx.fillStyle = 'rgba(0,0,0,' + sa.toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(p.x + p.w / 2, GROUND_Y - 1, Math.max(6, sw), Math.max(2.5, sw * 0.26), 0, 0, TAU); ctx.fill();
    }
  }
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
  // 【内容扩展】幽灵：身后拖 2 道渐淡残影（位置略往左后错开），半透明像飘忽的鬼影
  const ghosting = game.state === 'playing' && bgTime < ghostUntil;
  const shrinking = game.state === 'playing' && bgTime < shrinkUntil;
  const shrinkS = shrinking ? 0.6 : 1;   // 缩小药水：身形缩到 0.6（和碰撞框缩小相呼应）
  if(ghosting){
    for(let gi = 2; gi >= 1; gi--){
      ctx.save();
      ctx.globalAlpha = 0.16 * gi;       // 越远的残影越淡
      ctx.translate(p.x + p.w / 2 - gi * 9, p.y);
      ctx.scale(p.sx * shrinkS, p.sy * shrinkS);
      if(p.gliding) ctx.rotate(-0.12);
      drawCharacter(ctx, ch, {
        time: bgTime - gi * 0.05, grounded: p.grounded,
        swing: p.grounded ? Math.sin(p.phase - gi * 0.4) * 0.6 : 0,
        gliding: p.gliding, blinking: p.blinking, dead: false, face: '',
        avatar: null, pal: dailyMode ? CHARS.fox.c : charC(save.char),
      });
      ctx.restore();
    }
  }
  ctx.save();
  // 刚撞到障碍的短暂无敌期：闪烁提示
  if(game.state === 'playing' && bgTime < invulnUntil){
    ctx.globalAlpha = 0.45 + 0.35 * Math.sin(bgTime * 30);
  }
  if(ghosting) ctx.globalAlpha *= 0.5;   // 【内容扩展】幽灵：本体也半透明
  ctx.translate(p.x + p.w / 2, p.y);   // 以脚底中心为基准
  const gs = (power.type === 'giant') ? 1.6 : 1;   // 变大药水：整只放大
  // 【酷跑1】下滑：身体压扁(Y×0.55)、略横向拉长(X×1.18)，并向前倾——像贴地滑铲
  const slideY = p.sliding ? 0.55 : 1, slideX = p.sliding ? 1.18 : 1;
  ctx.scale(p.sx * gs * shrinkS * slideX, p.sy * gs * shrinkS * slideY);   // 压扁/拉伸 × 巨大化 × 缩小 ×【酷跑1】下滑压扁
  if(p.sliding) ctx.rotate(0.35);      // 【酷跑1】下滑时上身前倾（正角度=向前扑）
  else if(p.gliding) ctx.rotate(-0.12);   // 滑翔时身体微微前倾，更有飞行感
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
  // 【酷跑2】萌宠：当前出战的伙伴飘在身后上方，随技能触发有特效
  drawPet(p);
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
    } else if(o.face === 'focus'){
      // 【酷跑1】专注！眼睛眯成一道坚定的细线、上方压一道斜眉（下滑冲刺时的表情）
      c.strokeStyle = '#43281a'; c.lineWidth = 2.6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(ex - 4, ey + 1); c.lineTo(ex + 4, ey + 1); c.stroke();   // 眯眼细线
      c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(ex - 5, ey - 5); c.lineTo(ex + 2, ey - 3); c.stroke();   // 斜压的眉毛
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
  } else if(ch.kind === 'cat'){
    // —— 猫：竖直三角耳 + 上翘细尾 + 胡须，灵动版狐狸 ——
    c.save();   // 细长往上翘的尾巴
    c.translate(-19, -12);
    c.rotate(-0.15 - wag * 0.5 + (o.gliding ? 0.4 : 0));
    c.strokeStyle = col.tail; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 2); c.quadraticCurveTo(-18, 0, -20, -16); c.stroke();
    c.fillStyle = col.dark;   // 尾尖一圈
    c.beginPath(); c.arc(-20, -16, 3.5, 0, TAU); c.fill();
    c.restore();
    scarfTails();
    legs();
    body(14);
    scarfKnot();
    belly();
    c.fillStyle = col.body;   // 竖直三角猫耳（比狐狸更直、更靠近）
    tri(5, -34, 7, -47, 13, -34);
    tri(13, -34, 19, -47, 21, -34);
    c.fillStyle = col.ear || col.dark;
    tri(7.6, -35, 8.8, -43, 11.4, -35);
    tri(14.6, -35, 17, -43, 18.4, -35);
    eye(12, -24);
    c.fillStyle = '#ff8aa0';   // 粉色小三角鼻
    c.beginPath(); c.moveTo(19.5, -19); c.lineTo(23, -19); c.lineTo(21.3, -16.3); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.2; c.lineCap = 'round';   // 胡须
    c.beginPath();
    c.moveTo(22, -18); c.lineTo(32, -20);
    c.moveTo(22, -16); c.lineTo(32, -15);
    c.stroke();
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
  // 【对标天天酷跑·根治遮挡】分两栏，全部落在角色泳道(x≤164)右侧 + 屏幕正中，角色跳/飞都够不到，栏内各自从上往下排不叠字：
  //   左栏(LX=178，紧贴角色右侧)=得分/金币/血条/道具条；中栏(CX=正中)=最高·关卡·日赛/副行/冲刺/连击；横幅+字母格各自归位。
  const LX = 178, CX = W / 2;
  const breaking = endlessOnly() && game.startBest > 0 && game.score > game.startBest && game.state !== 'ready';   // 【酷跑2】闯关不显示破纪录金光
  // ===== 左栏 =====
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  let lY = 8;
  ctx.fillStyle = breaking ? '#ffd34d' : '#fff';   // 得分（大号；破纪录变金）
  ctx.font = 'bold 24px ' + FONT;
  hudText('得分 ' + game.score, LX, lY);
  lY += 28;
  ctx.font = 'bold 15px ' + FONT; ctx.fillStyle = '#ffd34d';   // 金币
  hudText('🪙 ' + save.coins, LX, lY);
  lY += 22;
  {   // 血条（❤数字压条上居中）
    const hbW = 128, hbH = 12, hbX = LX, hbY = lY;
    const frac = clamp(playerHP / effMaxHP(), 0, 1);
    const hpColor = frac > 0.5 ? '#5bd66a' : frac > 0.25 ? '#ffd34d' : '#ff5a5a';
    ctx.save(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(hbX, hbY, hbW, hbH);
    ctx.fillStyle = hpColor; ctx.fillRect(hbX, hbY, hbW * frac, hbH);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2; ctx.strokeRect(hbX, hbY, hbW, hbH);
    ctx.restore();
    ctx.font = 'bold 11px ' + FONT; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    hudText('❤ ' + Math.ceil(playerHP), hbX + hbW / 2, hbY);
    ctx.textAlign = 'left';
    lY += hbH + 6;
  }
  // 道具剩余时间条（左栏，名字 + 64px 短条，一行一条，往下排——名字都短，整条不超过角色泳道与中栏的安全区）
  const drawPBar = (name, color, frac) => {
    ctx.font = 'bold 12px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    hudText(name, LX, lY);
    const nameW = ctx.measureText(name).width, bx = LX + nameW + 6, by = lY + 2;
    ctx.save(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx, by, 64, 9);
    ctx.fillStyle = color; ctx.fillRect(bx, by, 64 * clamp(frac, 0, 1), 9);
    ctx.restore();
    lY += 16;
  };
  if(power.type) drawPBar(POWER_INFO[power.type].name, POWER_INFO[power.type].color, (power.until - bgTime) / power.total);
  if(bgTime < magnetUntil) drawPBar('磁铁', POWER_INFO.magnet.color, (magnetUntil - bgTime) / magnetTotal);
  if(bgTime < coinx2Until) drawPBar('双倍', POWER_INFO.coinx2.color, (coinx2Until - bgTime) / coinx2Total);
  if(bgTime < slowUntil) drawPBar('时停', POWER_INFO.slow.color, (slowUntil - bgTime) / slowTotal);
  if(bgTime < shrinkUntil) drawPBar(POWER_INFO.shrink.name, POWER_INFO.shrink.color, (shrinkUntil - bgTime) / shrinkTotal);
  if(bgTime < ghostUntil) drawPBar(POWER_INFO.ghost.name, POWER_INFO.ghost.color, (ghostUntil - bgTime) / ghostTotal);
  if(bgTime < scorex3Until) drawPBar('狂潮×3', POWER_INFO.scorex3.color, (scorex3Until - bgTime) / scorex3Total);
  // ===== 中栏（屏幕正中，游标 cY） =====
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  let cY = 8;
  ctx.font = 'bold 16px ' + FONT; ctx.fillStyle = '#cfe0ff';   // 主行：闯关进度 / 日赛米数 / 最高分
  hudText(
    adventureMode && curStage
      ? '🗺️ 第' + curStage.id + '关 · 还剩 ' + Math.max(0, curStage.dist - Math.floor(game.runDist / 12)) + ' 米'
      : (dailyMode ? '🌞 ' + Math.min(3000, Math.floor(game.runDist / 12)) + ' / 3000 米'
                   : '最高 ' + game.best),
    CX, cY);
  cY += 21;
  let subLine, subColor;   // 副行：距纪录 / 挑战 / 新纪录 / 闯关金币进度
  if(adventureMode && curStage){
    subLine = '💰 ' + stageCoins + '/' + curStage.goalCoins + ' · ' + (stageHurt ? '受伤✗' : '不受伤✓');
    subColor = stageHurt ? '#ff8aa0' : '#7fd89a';
  } else if(dailyMode){
    const drB = (save.dailyRun && save.dailyRun.date === todayStr()) ? save.dailyRun.best : 0;
    subLine = '🌞 今日最佳 ' + drB + ' 分'; subColor = '#ffd34d';
  } else if(breaking){
    subLine = '🔥 新纪录进行中！'; subColor = '#ffd34d';
  } else if(challenge && save.lastBeat !== challenge.name && game.score <= challenge.score){
    subLine = '🆚 距击败 ' + challenge.name + ' 还差 ' + (challenge.score - game.score + 1) + ' 分'; subColor = '#ff8aa0';
  } else if(game.startBest > 0){
    subLine = '距最高还差 ' + Math.max(1, game.startBest - game.score + 1) + ' 分'; subColor = '#c5cede';
  } else {
    subLine = ''; subColor = '#c5cede';
  }
  if(subLine){ ctx.font = 'bold 12px ' + FONT; ctx.fillStyle = subColor; hudText(subLine, CX, cY); cY += 19; }
  if(game.state === 'playing' && endlessOnly() && bgTime >= bonusUntil && nextBonusAt - game.coinCount <= 25){   // 奖励关钩子：提前到差25枚就显示倒计时，给"快到了"的紧迫感
    ctx.font = 'bold 12px ' + FONT; ctx.fillStyle = '#ffd34d';
    hudText('再吃 ' + Math.max(1, nextBonusAt - game.coinCount) + ' 枚 → ✨奖励关', CX, cY);
    cY += 18;
  }
  if(boostDist > 0 && game.runDist < boostDist && game.state === 'playing'){   // 开局冲刺
    ctx.font = 'bold 14px ' + FONT; ctx.fillStyle = '#ffd34d';
    hudText('🚀 开局冲刺 · 还剩 ' + Math.max(0, Math.ceil((boostDist - game.runDist) / 12)) + ' 米', CX, cY);
    cY += 19;
  }
  if(game.state === 'playing' && combo >= 5){   // 连击
    const feverNow = bgTime < feverUntil;
    const cFs = Math.round(15 * Math.min(1.5, 1 + combo / 100));
    ctx.font = 'bold ' + cFs + 'px ' + FONT;
    ctx.fillStyle = feverNow ? '#ffd34d' : '#fff';
    hudText('x' + combo + ' 连击', CX, cY);
    cY += cFs + 6;
    if(feverNow){   // 狂热剩余时间小条
      ctx.save(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(CX - 45, cY, 90, 5);
      ctx.fillStyle = '#ff8a5c'; ctx.fillRect(CX - 45, cY, 90 * clamp((feverUntil - bgTime) / 5, 0, 1), 5);
      ctx.restore();
      cY += 9;
    }
  }
  // 【内容扩展】字母收集进度：右上角四格「狐狸快跑」，集到的点亮（跑动中才显示）
  //   画在右上角偏下（躲开微信胶囊按钮 ···◎），每格一个字，点亮=主色填充 + 字变白，未得=暗格
  if(game.state === 'playing'){
    const cell = 24, gap = 4, n = 4;
    const totW = n * cell + (n - 1) * gap;
    const gx = W - totW - 16, gy = 70;   // 右上角，留出胶囊空间
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for(let i = 0; i < n; i++){
      const cx = gx + i * (cell + gap), cy = gy;
      const got = letterGot[i];
      const col = LETTER_COLORS[i % LETTER_COLORS.length];
      ctx.fillStyle = got ? col : 'rgba(0,0,0,0.4)';
      rr(cx, cy, cell, cell, 5); ctx.fill();
      ctx.strokeStyle = got ? '#fff' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      rr(cx, cy, cell, cell, 5); ctx.stroke();
      ctx.fillStyle = got ? '#fff' : 'rgba(255,255,255,0.55)';
      ctx.font = 'bold 15px ' + FONT;
      ctx.fillText(LETTER_CHARS[i], cx + cell / 2, cy + cell / 2 + 1);
    }
  }
  // 中央大横幅（破纪录 / 奖励关 / 复活 / 抓到兔子）：落在左右两栏下方的空白中带，横向再宽也压不到顶部 HUD
  if(bgTime < banner.until){
    ctx.globalAlpha = Math.min(1, (banner.until - bgTime) / 0.4);
    ctx.font = 'bold 26px ' + FONT;
    ctx.fillStyle = banner.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    hudText(banner.text, CX, Math.min(150, Math.max(cY, lY) + 10));   // 排在两栏最低点之下、屏幕中带
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
      ctx.fillText('点击屏幕继续', W / 2, H / 2 + 24);
    }
    return;
  }
  if(game.state === 'ready'){
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 42px ' + FONT;
    ctx.fillText('狐狸快跑', W / 2, H / 2 - 46);
    ctx.fillStyle = '#ffe9c4';
    ctx.font = '17px ' + FONT;
    ctx.fillText('点击屏幕 开始', W / 2, H / 2 + 8);
    ctx.fillStyle = '#aab6d0';
    ctx.font = '14px ' + FONT;
    ctx.fillText('黑坑会摔死——看到坑就跳！其他障碍只扣分', W / 2, H / 2 + 36);
    const dly = (save.daily && save.daily.date === todayStr()) ? save.daily : null;
    if(dly){
      const doneN0 = dly.tasks.filter(t => t.done).length;
      ctx.fillText('📋 今日任务 ' + doneN0 + '/3：' + dly.tasks.map(t => (t.done ? '✅' : '⬜') + taskName(t)).join('　'), W / 2, H / 2 + 58);
    } else {
      ctx.fillText('吃道具变强 · 金币攒起来逛商店（按 B） · 左下角还有今日挑战', W / 2, H / 2 + 58);
    }
    if(challenge){
      ctx.fillStyle = '#ff8aa0';
      ctx.font = 'bold 16px ' + FONT;
      ctx.fillText('🆚 ' + challenge.name + ' 向你发起挑战：' + challenge.score + ' 分', W / 2, H / 2 + 84);
    }
  } else if(game.state === 'dead'){
    // 结算文字都在 DOM 卡片（#deadCard）里，这里只保留遮罩和角色倒地的画面
  }
}

// 【酷跑2】闯关终点门：随着接近终点从右侧驶入。门 x = 玩家位置 + 还差的距离(像素=米×12)。
//   画一道带"🏁 终点"牌子的拱门，跑到门处即触发 finishStage（update 里按米数判定，这里只负责画）。
function drawFinish(){
  if(!adventureMode || !curStage || game.state !== 'playing') return;
  const remainPx = curStage.dist * 12 - game.runDist;   // 离终点还有多少像素
  const gx = player.x + remainPx;                         // 终点门在屏幕上的 x
  if(gx < -40 || gx > W + 120) return;                    // 还没驶入屏幕 / 已驶过，就不画
  const topY = 40, postW = 10;
  // 左右两根门柱（黑黄相间的赛道警示色）
  for(const px of [gx - 26, gx + 26 - postW]){
    ctx.fillStyle = '#2b2f3a';
    ctx.fillRect(px, topY, postW, GROUND_Y - topY);
    ctx.fillStyle = '#ffd34d';
    for(let yy = topY; yy < GROUND_Y; yy += 24){ ctx.fillRect(px, yy, postW, 12); }
  }
  // 顶部横梁 + 旗牌
  ctx.fillStyle = '#2b2f3a';
  ctx.fillRect(gx - 30, topY - 4, 60, 14);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px ' + FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.strokeText('🏁 终点', gx, topY - 16);
  ctx.fillText('🏁 终点', gx, topY - 16);
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
  // 【内容扩展】进入新世界就弹横幅报世界名（只在跑动中、且确实换了世界时播一次）
  //   name 形如 "🌴 丛林"，拆成 emoji + 纯名，拼成 "🌴 进入丛林"（首段开场不弹，避免和开局横幅打架）
  if(game.state === 'playing' && pal.worldName && pal.worldName !== curWorldName){
    if(curWorldName !== ''){
      const m = pal.worldName.match(/^(\S+)\s*(.*)$/);
      const txt = m ? (m[1] + ' 进入' + m[2]) : ('进入' + pal.worldName);
      showBanner(txt + '！', 2.2, '#ffd34d');
    }
    curWorldName = pal.worldName;
  }
  drawBackground(pal);
  // 【真机反馈】夜色滤镜只罩背景：障碍/金币/角色保持鲜亮，雪夜里也看得一清二楚
  if(pal.night > 0.02){
    ctx.fillStyle = 'rgba(10,16,42,' + (0.16 * pal.night) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  drawPits();
  drawObstacles();
  drawFinish();   // 【酷跑2】闯关终点门：画在障碍层之上、角色之下，随距离从右驶入
  if(boss) drawBoss();   // 【血条Boss】Boss 与其弹幕画在障碍之后、金币/角色之前
  if(bunny) drawBunny();
  drawCoins();   // 金币画在障碍之后（也就是上层），万一和障碍重叠也看得见
  drawItems();
  drawBoxes();     // 【内容扩展】神秘宝箱
  drawLetters();   // 【内容扩展】字母收集卡
  drawParticles();
  drawChaser();    // 【追逐】巨石在角色身后（先画巨石，角色盖在前面=巨石在追）
  drawTrail();     // 【角色拖尾】画在角色之后面（先画尾迹，再画角色盖在前面）
  drawPlayer();
  // （夜色滤镜已挪到背景层，见 drawBackground 之后）
  // 【血条Boss】Boss 战：铺一层暗红滤镜（写法同奖励关金色滤镜），轻微脉动营造危机感
  if(boss){
    const pulse = 0.10 + 0.05 * (0.5 + 0.5 * Math.sin(bgTime * 4));
    ctx.fillStyle = 'rgba(120,0,0,' + pulse.toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  // 超级奖励时间：铺一层金色滤镜
  if(bgTime < bonusUntil){
    ctx.fillStyle = 'rgba(255,205,70,0.12)';
    ctx.fillRect(0, 0, W, H);
  }
  // 【留存包】① 狂热时刻：铺一层暖橙滤镜（写法同上面奖励关的金色滤镜，叠在它后面）
  if(bgTime < feverUntil){
    ctx.fillStyle = 'rgba(255,120,40,0.10)';
    ctx.fillRect(0, 0, W, H);
  }
  // 【内容扩展】分数狂潮：全屏轻微金色脉动（用 sin 让透明度一呼一吸，提示"现在分数 ×3"）
  if(bgTime < scorex3Until){
    const pulse = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(bgTime * 6));
    ctx.fillStyle = 'rgba(255,200,60,' + pulse.toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  // 【新手】第一局还没跳过：在角色上方飘一条脉动"点屏幕跳！"，跳一下就消失
  if(save.runs <= 1 && game.state === 'playing' && !jumpedRun && !paused){
    const a = 0.6 + 0.4 * Math.sin(bgTime * 6);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = 'bold 22px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.fillStyle = '#fff';
    const hy = player.y - player.h - 26;
    ctx.strokeText('👆 点屏幕跳！', player.x + player.w / 2, hy);
    ctx.fillText('👆 点屏幕跳！', player.x + player.w / 2, hy);
    ctx.restore();
  }
  ctx.restore();
  drawHUD();
  drawOverlay();
}

/* —— 主页像素场景：低清画布 + 放大 = 像素风 —— */
const homeStars = [];
for(let i = 0; i < 42; i++){
  homeStars.push({ x: Math.random() * 320, y: Math.random() * 95, s: Math.random() < 0.25 ? 2 : 1, tw: Math.random() * TAU });
}
let homeScroll = 0;
function drawHomeScene(){
  const t = performance.now() / 1000;
  homeScroll += 0.7;
  // 【质感升级】黄昏渐变天空（渐变放大不糊，取代纯色夜空）
  const sky = hctx.createLinearGradient(0, 0, 0, 180);
  sky.addColorStop(0, '#241a4d');     // 顶：深靛蓝
  sky.addColorStop(0.45, '#3b2a6b');  // 紫
  sky.addColorStop(0.72, '#7e4a84');  // 暖紫
  sky.addColorStop(0.88, '#c87a72');  // 珊瑚色地平线
  sky.addColorStop(1, '#f0a86a');     // 暖光
  hctx.fillStyle = sky; hctx.fillRect(0, 0, 320, 180);
  // 柔光月亮（外晕 + 本体），替换原来那个十字像素月
  hctx.save();
  hctx.globalAlpha = 0.32; hctx.fillStyle = '#ffe9b0';
  hctx.beginPath(); hctx.arc(264, 34, 20, 0, TAU); hctx.fill();
  hctx.globalAlpha = 0.92; hctx.fillStyle = '#fff4d6';
  hctx.beginPath(); hctx.arc(264, 34, 11, 0, TAU); hctx.fill();
  hctx.restore();
  for(const s of homeStars){                                      // 柔光星星（靠近地平线渐隐）
    const fade = clamp((120 - s.y) / 70, 0, 1);
    if(fade <= 0) continue;
    hctx.globalAlpha = fade * (0.35 + 0.6 * Math.abs(Math.sin(t * 1.5 + s.tw)));
    hctx.fillStyle = '#fff';
    hctx.beginPath(); hctx.arc(s.x, s.y, s.s * 0.5 + 0.35, 0, TAU); hctx.fill();
  }
  hctx.globalAlpha = 1;
  // 远山两层（远层更亮更朦胧=空气透视；近层更深）
  hctx.fillStyle = '#5a4170';
  hctx.beginPath(); hctx.moveTo(0, 150); hctx.lineTo(70, 110); hctx.lineTo(150, 150);
  hctx.moveTo(200, 150); hctx.lineTo(300, 104); hctx.lineTo(360, 150); hctx.closePath(); hctx.fill();
  hctx.fillStyle = '#2e2350';
  hctx.beginPath(); hctx.moveTo(-20, 150); hctx.lineTo(60, 116); hctx.lineTo(140, 150);
  hctx.moveTo(120, 150); hctx.lineTo(210, 96); hctx.lineTo(320, 150); hctx.closePath(); hctx.fill();
  // 地平线暖光带
  const hz = hctx.createLinearGradient(0, 138, 0, 152);
  hz.addColorStop(0, 'rgba(255,190,120,0)');
  hz.addColorStop(1, 'rgba(255,170,110,0.32)');
  hctx.fillStyle = hz; hctx.fillRect(0, 138, 320, 14);
  // 地面（竖向渐变 + 柔和跑道刻度）
  const gnd = hctx.createLinearGradient(0, 150, 0, 180);
  gnd.addColorStop(0, '#241f3e'); gnd.addColorStop(1, '#14122a');
  hctx.fillStyle = gnd; hctx.fillRect(0, 150, 320, 30);
  hctx.fillStyle = 'rgba(255,255,255,0.10)';
  for(let x = -(homeScroll % 26); x < 320; x += 26) hctx.fillRect(x | 0, 156, 10, 2);
  hctx.save();                                                    // 奔跑的当前角色（戴头像也会显示）
  hctx.translate(64, 150); hctx.scale(0.85, 0.85);
  drawCharacter(hctx, CHARS[save.char] || CHARS.fox, {
    time: t, grounded: true, swing: Math.sin(t * 10) * 0.65, gliding: false,
    blinking: (t % 3) < 0.12 ? 1 : 0, dead: false,
    pal: charC(save.char in CHARS ? save.char : 'fox'),
    avatar: (save.useAvatar && avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) ? avatarImg : null,
  });
  hctx.restore();
  // 大标题已挪到主画布全分辨率绘制（uiDrawHome 里渐变金+发光），这里不再画低清标题
}
/* —— 加载过场：PPT 像素块 合拢→揭开 —— */
const LOAD_COVER = 750, LOAD_REVEAL = 750;   // 像素块合拢 / 揭开 的时长
const LOAD_TIPS = ['提示：长按跳得更高', '提示：紫色高空鸟——千万别跳！', '提示：黑坑会摔死，看到就跳',
                   '提示：金币攒够会进入超级奖励关', '提示：钻石兔要跳起来扑住', '提示：冲刺时可以撞碎一切',
                   '提示：连跳角色掉坑瞬间还能自救', '提示：高处横杆要下滑躲过'];   // 【酷跑1】加一条下滑提示
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
  UI.loadTip = LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];   // 【小游戏改造】提示语直接画在屏幕上
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

/* ========== 15. 画布 UI 层 ==========
   网页版的主页/商店/签到/结算都是 DOM 弹窗，小游戏没有 DOM——全部改成"直接画在画布上"。
   【小游戏改造】微型 UI 框架：每帧画界面的同时，把"哪里可以点"登记进 UI.zones
   （每个元素 {id, x, y, w, h, draw, cb}，坐标用画布的设备像素）。
   手指按下时从最上层往下做命中测试：点中了就执行回调；谁都没点中，才算"游戏操作"（跳跃）。
   业务规则（价格/概率/文案）与网页版一字不差。 */

/* —— 界面状态机 —— */
let uiScreen = 'home';     // 当前界面：'home'=主页 | 'shop'=商店 | 'sign'=签到 | 'rank'=好友榜 | 'ach'=成就 | 'none'=游戏中（【留存包】新增 rank/ach 两页）
let uiHome = true;         // 主页大厅开关（game.state 同时为 ready 才真正显示）
let uiAvatarAsk = false;   // "把主角换成你"小卡片（首次照片邀请）
let uiCopyLabel = '📋 复制战绩发群里';   // 结算卡"复制战绩"按钮的文案（复制成功后会变）
function homeOpen(){ return uiHome && game.state === 'ready'; }
function shopOpen(){ return uiScreen === 'shop'; }
function signOpen(){ return uiScreen === 'sign'; }

// 低清离屏画布按 cover 放大铺满全屏（关掉平滑 = 像素颗粒感）
function blitCover(srcCv){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const s = Math.max(canvas.width / srcCv.width, canvas.height / srcCv.height);
  const w = srcCv.width * s, h = srcCv.height * s;
  ctx.drawImage(srcCv, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  ctx.restore();
}
function blitHome(){
  // 【小游戏改造】主页场景按"高度贴满"缩放：手机屏幕比 320×180 的场景更宽，
  // cover 模式会把顶上的大标题裁掉，所以改成完整显示、左右用同色色带延伸补满
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const s = canvas.height / 180;
  const w = 320 * s, ox = (canvas.width - w) / 2;
  ctx.fillStyle = '#0d1024'; ctx.fillRect(0, 0, canvas.width, canvas.height);        // 夜空
  ctx.fillStyle = '#141a36'; ctx.fillRect(0, 96 * s, canvas.width, canvas.height);   // 低空
  ctx.fillStyle = '#1c2447'; ctx.fillRect(0, 150 * s, canvas.width, canvas.height);  // 地面
  ctx.drawImage(homeCv, ox, 0, w, 180 * s);
  ctx.restore();
}
function blitLoading(){
  blitCover(loadCv);
  if(!UI.loadTip) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = Math.round(canvas.height * 0.038) + 'px sans-serif';
  ctx.fillStyle = '#7e879c';
  ctx.fillText(UI.loadTip, canvas.width / 2, canvas.height * 0.92);
  ctx.restore();
}

/* —— 画 UI 的小工具（都在"设备像素"坐标系下工作） ——
   所有尺寸/字号都按 canvas.height 的百分比算：手机分辨率千差万别，写死像素会忽大忽小 */
function dRR(x, y, w, h, r){   // 设备坐标系下的圆角矩形路径（新机型用自带的 roundRect，老机型自己画）
  r = Math.min(r, w / 2, h / 2);
  if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x, y, w, h, [r]); return; }   // 【小游戏改造】圆角必须传数组：开发者工具的画布不认单个数字
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
function dText(s, x, y, px, color, align, bold){   // 画一行字（基线居中）
  ctx.font = (bold ? 'bold ' : '') + px + 'px ' + FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
function fitText(s, maxW, px, bold){   // 太长的字截断加省略号（商店说明在小屏上放不下）
  ctx.font = (bold ? 'bold ' : '') + px + 'px ' + FONT;
  if(ctx.measureText(s).width <= maxW) return s;
  while(s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function addZone(id, x, y, w, h, cb){   // 登记一块"可以点的区域"（cb 为空 = 只挡住下层，不做事）
  UI.zones.push({ id: id, x: x, y: y, w: w, h: h, draw: null, cb: cb || null });
}
function addZoneClipped(id, x, y, w, h, clip, cb){   // 滚动列表里的按钮：只有露出来的部分能点
  const x2 = Math.max(x, clip.x), y2 = Math.max(y, clip.y);
  const r2 = Math.min(x + w, clip.x + clip.w), b2 = Math.min(y + h, clip.y + clip.h);
  if(r2 - x2 > 4 && b2 - y2 > 4) addZone(id, x2, y2, r2 - x2, b2 - y2, cb);
}
// 【质感升级】颜色工具：把 '#rgb'/'#rrggbb'/'rgb()'/'rgba()' 解析出 r,g,b,a，再按比例提亮(amt>0)/压暗(amt<0)
function _rgb(c){
  if(typeof c !== 'string') return null;
  if(c[0] === '#'){
    let h = c.slice(1);
    if(h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if(m){ const p = m[1].split(',').map(s => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; }
  return null;
}
function shade(c, amt){   // 返回提亮/压暗后的 rgba 串，保留原透明度；解析失败原样返回
  const o = _rgb(c); if(!o) return c;
  const f = amt < 0 ? (1 + amt) : 1, add = amt > 0 ? amt * 255 : 0;
  const ch2 = v => Math.round(Math.max(0, Math.min(255, v * f + add)));
  return 'rgba(' + ch2(o.r) + ',' + ch2(o.g) + ',' + ch2(o.b) + ',' + o.a + ')';
}
// 万能按钮（质感版）：竖向渐变(上亮下暗=立体) + 投影(浮起) + 顶部玻璃高光 + 描边 + 文字微阴影。
// cant=买不起（灰底但能点，点了提示差多少钱），disabled=完全不可点
function uiBtn(o){
  const r = Math.min(o.h * 0.34, canvas.height * 0.03);
  if(o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  const dead = o.cant || o.disabled;
  const base = dead ? '#3a4357' : (o.bg || '#ffd34d');
  if(base !== 'none'){
    // 投影：按钮像实体一样浮在界面上
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.40)';
    ctx.shadowBlur = canvas.height * 0.02;
    ctx.shadowOffsetY = canvas.height * 0.005;
    // 主体竖向渐变（上提亮、下压暗 = 果冻立体感）
    const grad = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
    grad.addColorStop(0, shade(base, 0.17));
    grad.addColorStop(0.5, base);
    grad.addColorStop(1, shade(base, -0.18));
    ctx.fillStyle = grad;
    dRR(o.x, o.y, o.w, o.h, r); ctx.fill();
    ctx.restore();
    // 顶部玻璃高光：上半部叠一层白色渐变（裁剪在圆角内）
    ctx.save();
    dRR(o.x, o.y, o.w, o.h, r); ctx.clip();
    const sheen = ctx.createLinearGradient(0, o.y, 0, o.y + o.h * 0.62);
    sheen.addColorStop(0, 'rgba(255,255,255,' + (dead ? 0.05 : 0.30) + ')');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(o.x, o.y, o.w, o.h * 0.62);
    ctx.restore();
    // 描边：底色压暗后做边，更立体；可被 o.stroke 覆盖
    ctx.strokeStyle = o.stroke || shade(base, dead ? -0.05 : -0.34);
    ctx.lineWidth = Math.max(1.2, canvas.height * 0.0035);
    dRR(o.x, o.y, o.w, o.h, r); ctx.stroke();
  }
  const fgc = dead ? '#97a1b8' : (o.fg || '#4a3500');
  ctx.save();
  if(!dead){ ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = canvas.height * 0.005; ctx.shadowOffsetY = 1; }
  dText(o.label, o.x + o.w / 2, o.y + o.h / 2, o.size, fgc, 'center', o.bold !== false);
  ctx.restore();
  if(o.alpha !== undefined) ctx.globalAlpha = 1;
  if(!o.disabled && o.cb){
    if(o.clip) addZoneClipped(o.id, o.x, o.y, o.w, o.h, o.clip, o.cb);
    else addZone(o.id, o.x, o.y, o.w, o.h, o.cb);
  }
}
function uiChip(t, x, cy, px, bg){   // 角色能力的小徽章（"二连跳/滑翔"这种小药丸）
  ctx.font = 'bold ' + px + 'px ' + FONT;
  const w = ctx.measureText(t).width + px * 1.1;
  ctx.fillStyle = bg;
  dRR(x, cy - px * 0.75, w, px * 1.5, px * 0.75); ctx.fill();
  dText(t, x + w / 2, cy, px, '#fff', 'center', true);
  return w;
}
function uiCard(x, y, w, h){   // 深色弹窗卡片底（质感版：竖向渐变 + 投影 + 顶部高光 + 细边）
  const r = canvas.height * 0.03;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = canvas.height * 0.035;
  ctx.shadowOffsetY = canvas.height * 0.008;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#2b3447');
  g.addColorStop(1, '#161c2b');
  ctx.fillStyle = g;
  dRR(x, y, w, h, r); ctx.fill();
  ctx.restore();
  ctx.save();
  dRR(x, y, w, h, r); ctx.clip();
  const sh = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
  sh.addColorStop(0, 'rgba(255,255,255,0.10)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(x, y, w, h * 0.4);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = Math.max(1, canvas.height * 0.003);
  dRR(x, y, w, h, r); ctx.stroke();
}
function uiPanel(x, y, w, h){   // 主页上的半透明信息面板
  ctx.fillStyle = 'rgba(13,16,36,0.8)';
  dRR(x, y, w, h, canvas.height * 0.018); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = Math.max(1, canvas.height * 0.004);
  dRR(x, y, w, h, canvas.height * 0.018); ctx.stroke();
}

/* —— 商店货架数据（kind 为 char 的是角色，up 的是可升级项；与网页版一字不差） —— */
const SHOP_GOODS = [
  { id: 'fox',     kind: 'char' },
  { id: 'pig',     kind: 'char' },
  { id: 'monkey',  kind: 'char' },
  { id: 'cat',     kind: 'char' },
  { id: 'snowfox', kind: 'char' },
  { id: 'panda',   kind: 'char' },
  { id: 'cosmic',  kind: 'char' },
  { id: 'dragon',  kind: 'char' },
  { id: 'flame',   kind: 'char' },
  { id: 'dur', kind: 'up', name: '道具时长', desc: '每级让所有道具多持续 1.5 秒（最多 3 级）', prices: [100, 250, 500] },
];
// 钻石商店的高级货（价格与网页版一致）
const GEM_GOODS = [
  { id: 'mount', name: '坐骑·筋斗云',   desc: '脚踩白云：所有角色额外 +1 段跳！', emoji: '⛅', cost: 25 },
  { id: 'board', name: '坐骑·火箭滑板', desc: '+1 段跳，并且每局免费开局冲刺 200 米！', emoji: '🛹', cost: 40 },
  { id: 'pet',   name: '精灵·星宝',     desc: '飘在身边的小精灵，每 8 秒自动帮你吸一波金币（买后进入下方"萌宠"图鉴可切换）', emoji: '🧚', cost: 12 },
  { id: 'moth',  name: '精灵·月光蝶',   desc: '每局一次：掉坑的瞬间把你救回空中！', emoji: '🦋', cost: 18 },
];
// 【酷跑2】萌宠图鉴：对标天天酷跑的"宠物"——多只可收集，每只一项主动技能，同一时间只出战一只。
//   star（星宝）是迁移自老的 save.pet（金币购买，最便宜）；强力的用钻石。价格从便宜到贵递增。
//   cur: 'coin'=金币购买 | 'gem'=钻石购买。所有技能在日赛(dailyMode)下统一禁用，保证公平。
const PETS = [
  { id: 'star',      name: '星宝',   emoji: '🧚', cur: 'coin', cost: 600,
    skill: '每隔 8 秒自动帮你吸一波金币（迁移自老精灵·星宝）' },
  { id: 'goldpet',   name: '招财猫', emoji: '🐱', cur: 'coin', cost: 1800,
    skill: '吃到的每枚金币都额外 +1（温和的"双倍"替代）' },
  { id: 'magnetpet', name: '吸金喵', emoji: '😺', cur: 'gem',  cost: 16,
    skill: '常驻小范围磁吸：附近金币一直被你吸过来（比星宝弱但持续）' },
  { id: 'smashpet',  name: '铁拳熊', emoji: '🐻', cur: 'gem',  cost: 22,
    skill: '每隔约 6 秒自动撞飞前方最近一个普通障碍，并 +2 分' },
  { id: 'revivepet', name: '不死鸟', emoji: '🐦', cur: 'gem',  cost: 30,
    skill: '每局一次：濒死的瞬间自动满血复活，免费！' },
];
function petById(id){ for(const p of PETS) if(p.id === id) return p; return null; }
function ownPet(id){ return Array.isArray(save.petOwned) && save.petOwned.includes(id); }   // 【酷跑2】是否已拥有某萌宠
function activePet(){   // 【酷跑2】当前出战的萌宠数据（日赛禁用萌宠，直接当作没有）
  if(dailyMode || !save.petActive) return null;
  return ownPet(save.petActive) ? petById(save.petActive) : null;
}

/* —— 【酷跑2】天赋养成树：对标天天酷跑的"天赋系统"——花金币永久升级，越肝越强 ——
 *   数据驱动：每条天赋 {id, name, emoji, desc, max(最高等级), base/step(价格公式 price(lv)=base+step*lv)}。
 *   存档在 save.talents[id]（已升等级，无则 0）。所有效果只在 !dailyMode（无尽/闯关）生效，日赛用裸值保公平。
 *   step：每升一级的"数值步进"（如金币 +6% 就是 0.06），由各应用点自己乘 talentLv 算，TALENTS 里只放展示用的 desc。 */
const TALENTS = [
  { id: 'coin',   name: '财源', emoji: '💰', max: 5, base: 200, step: 120,
    desc: '吃金币价值 +6% / 级', fmt: lv => '+' + (6 * lv) + '% 金币' },
  { id: 'hp',     name: '铁骨', emoji: '🛡️', max: 5, base: 250, step: 150,
    desc: '开局血量上限 +12 / 级', fmt: lv => '+' + (12 * lv) + ' 血量' },
  { id: 'magnet', name: '磁场', emoji: '🧲', max: 5, base: 220, step: 130,
    desc: '磁吸范围 +12% / 级', fmt: lv => '+' + (12 * lv) + '% 磁吸' },
  { id: 'dur',    name: '持久', emoji: '⏳', max: 5, base: 200, step: 120,
    desc: '道具时长 +0.6 秒 / 级', fmt: lv => '+' + (0.6 * lv).toFixed(1) + 's 时长' },
  { id: 'revive', name: '重生', emoji: '💖', max: 5, base: 300, step: 180,
    desc: '复活费用 -10% / 级', fmt: lv => '-' + (10 * lv) + '% 复活价' },
  { id: 'fever',  name: '狂热', emoji: '🔥', max: 5, base: 260, step: 160,
    desc: '触发狂热所需连击 -2 / 级（下限 10）', fmt: lv => '狂热阈值 ' + Math.max(10, 30 - 2 * lv) },
  { id: 'slide',  name: '灵动', emoji: '💨', max: 5, base: 180, step: 100,
    desc: '滑行时长 +0.08 秒 / 级', fmt: lv => '+' + (0.08 * lv).toFixed(2) + 's 滑行' },
];
function talentDef(id){ for(const t of TALENTS) if(t.id === id) return t; return null; }
// 当前等级：日赛禁用天赋（一律按 0 级裸值跑），其余模式读存档；存档兜底防 undefined
function talentLv(id){ if(dailyMode) return 0; const v = (save.talents || {})[id]; return (typeof v === 'number' && v > 0) ? v : 0; }
// 当前数值/倍率（按 base/step 思路给玩法用的便捷封装；多数应用点直接用 talentLv 自己算，这里给需要的统一出口）
function talentVal(id){
  const lv = talentLv(id);
  switch(id){
    case 'coin':   return 1 + 0.06 * lv;          // 吃币价值倍率
    case 'hp':     return 12 * lv;                // 额外血量
    case 'magnet': return 1 + 0.12 * lv;          // 磁吸范围倍率
    case 'dur':    return 0.6 * lv;               // 额外道具秒数
    case 'revive': return 1 - 0.1 * lv;           // 复活价折扣倍率
    case 'fever':  return Math.max(10, 30 - 2 * lv);   // 触发狂热的连击阈值
    case 'slide':  return 0.08 * lv;              // 额外滑行秒数
    default:       return lv;
  }
}
// 下一级价格（满级返回 null）。注意：买的是"从 lv 升到 lv+1"，所以 price 用当前等级算
function talentPrice(id){ const t = talentDef(id); if(!t) return null; const lv = ((save.talents || {})[id]) || 0; if(lv >= t.max) return null; return t.base + t.step * lv; }
// 买天赋（升一级）：350ms 防双击、金币不足闪提示、扣钱、等级 +1、存档
function buyTalent(id){
  if(performance.now() - lastBuyAt < 350) return;
  lastBuyAt = performance.now();
  const t = talentDef(id); if(!t) return;
  const price = talentPrice(id);
  if(price === null) return;                       // 已满级：点了不做事
  if(save.coins < price){ setShopErr('talent-' + id, '金币不够！', 900); return; }
  save.coins -= price;
  if(!save.talents || typeof save.talents !== 'object') save.talents = {};
  save.talents[id] = (save.talents[id] || 0) + 1;
  sfx.power();
  saveSave();
}
// 有效血量上限：基础满血 + 铁骨天赋（日赛 talentLv 返回 0 → 裸值 PLAYER_MAX_HP）。开局/血条/回血/复活都用它
function effMaxHP(){ return PLAYER_MAX_HP + 12 * talentLv('hp'); }
// 有效道具时长加成：原商店道具时长 durLevel*1.5 + 持久天赋 0.6/级（日赛天赋为 0 → 只剩商店那份）
function effDur(){ return save.durLevel * 1.5 + 0.6 * talentLv('dur'); }

// 签到日历的 7 天奖励（与网页版一致）
const SIGN_REWARDS = ['💰50', '💰80', '💰120', '💰160', '💎1', '💰250', '💎2+💰300'];
function canClaimSign(){ return save.lastLogin !== todayStr(); }   // 今天还没签过 = 可以领

let shopTab = 'coin';        // 当前页签：coin=金币商店 | gem=钻石商店 | skin=装扮
let shopScroll = 0;          // 货架列表的滚动偏移（0=顶部，往上滚是负数）
let shopViewH = 1, shopContentH = 0;   // 列表可视高度 / 内容总高度（算滚动边界用）
let lastBuyAt = 0;           // 连点保护：两次购买至少间隔 350 毫秒，防止手抖双击连买两级
let lastGachaMsg = '';       // 上一次抽奖结果（显示在抽奖行里）
let lastBoostAt = 0;         // 手机上手抖双击会"选中又立刻取消"，350ms 内只认第一下
// 网页版"按钮上闪一下错误提示再复原"的效果：记下哪个按钮、显示什么、显示到几点
const shopErr = { key: '', text: '', until: 0 };
function setShopErr(key, text, dur){ shopErr.key = key; shopErr.text = text; shopErr.until = performance.now() + dur; }
function shopErrText(key){ return (shopErr.key === key && performance.now() < shopErr.until) ? shopErr.text : null; }
let boostErrKey = '', boostErrUntil = 0;   // 出发加成按钮的"金币不够！"提示

/* —— 商店购买逻辑（照抄网页版 shopList 的点击处理） —— */
function gachaClick(){   // 🎰 幸运抽奖
  if(performance.now() - lastBuyAt < 600) return;
  lastBuyAt = performance.now();
  if(save.coins < 150){ setShopErr('gacha', '金币不够！', 900); return; }
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
  saveSave();
}
function buyChar(id){   // 买角色
  if(performance.now() - lastBuyAt < 350) return;
  lastBuyAt = performance.now();
  const price = CHARS[id].price;
  if(save.coins < price){ setShopErr('buy-' + id, '金币不够！', 900); return; }
  save.coins -= price; save.chars.push(id); save.char = id;
  sfx.power();
  saveSave();
}
function upDur(){   // 升级道具时长
  if(performance.now() - lastBuyAt < 350) return;
  lastBuyAt = performance.now();
  const cost = [100, 250, 500][save.durLevel];
  if(save.coins < cost){ setShopErr('up-dur', '金币不够！', 900); return; }
  save.coins -= cost; save.durLevel++;
  sfx.power();
  saveSave();
}
function gemBuy(gid){   // 钻石商品（坐骑/精灵）
  const gemCosts = { mount: 25, board: 40, pet: 12, moth: 18 };
  const gcost = gemCosts[gid];
  if(performance.now() - lastBuyAt < 350) return;
  lastBuyAt = performance.now();
  if(save.gems < gcost){ setShopErr('gem-' + gid, '钻石不够！追兔子去', 1000); return; }
  save.gems -= gcost; save[gid] = true;
  sfx.power(); saveSave();
}
// 【酷跑2】买萌宠：按 cur 扣金币或钻石，加入 petOwned，并自动出战（首次拥有立刻能用）
function buyPet(id){
  const pt = petById(id);
  if(!pt || ownPet(id)) return;
  if(performance.now() - lastBuyAt < 350) return;
  lastBuyAt = performance.now();
  if(pt.cur === 'gem'){
    if(save.gems < pt.cost){ setShopErr('pet-' + id, '钻石不够！追兔子去', 1000); return; }
    save.gems -= pt.cost;
  } else {
    if(save.coins < pt.cost){ setShopErr('pet-' + id, '金币不够！', 900); return; }
    save.coins -= pt.cost;
  }
  save.petOwned.push(id);
  save.petActive = id;   // 买了就直接出战
  if(id === 'star') save.pet = true;   // 兼容老字段（万一别处还读 save.pet）
  sfx.power(); saveSave();
}
// 【酷跑2】出战某萌宠（必须已拥有）
function wearPet(id){
  if(!ownPet(id)) return;
  save.petActive = id;
  if(id === 'star') save.pet = true;
  sfx.coin(); saveSave();
}
function skinWear(cid, sid){   // 穿皮肤 / 换回原色
  if(sid) save.skinOn[cid] = sid;
  else delete save.skinOn[cid];
  saveSave();
}
function skinBuy(cid, sid){   // 买皮肤
  const sk = (SKINS2[cid] || []).find(s => s.id === sid);
  if(!sk) return;
  if(performance.now() - lastBuyAt < 350) return;
  lastBuyAt = performance.now();
  if(save.gems < sk.price){ setShopErr('skin-' + cid + '-' + sid, '钻石不够！', 900); return; }
  save.gems -= sk.price;
  (save.skins[cid] = save.skins[cid] || []).push(sk.id);
  save.skinOn[cid] = sk.id;
  sfx.power(); saveSave();
}
// 【小游戏改造】头像上传：网页版是 <input type=file> + FileReader + FaceDetector 人脸检测；
// 小游戏改用 wx.chooseImage 选照片 → wx.createImage 加载 → 画到 96×96 离屏画布
// （取照片中央的正方形——小游戏没有 FaceDetector，就不做人脸定位了）→ toDataURL 存进存档
function chooseAvatar(after){
  if(!wx.chooseImage) return;
  try{
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res){
        const fp = res && res.tempFilePaths && res.tempFilePaths[0];
        if(!fp) return;
        const img = wx.createImage();
        img.onload = function(){
          const size = 96;
          const cv2 = wx.createCanvas();   // 第二次以后 createCanvas 拿到的是离屏画布
          cv2.width = size; cv2.height = size;
          const c2 = cv2.getContext('2d');
          const iw = img.width || size, ih = img.height || size;
          const s = Math.min(iw, ih);   // 中心正方形裁剪
          c2.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, size, size);
          save.avatar = cv2.toDataURL();
          save.useAvatar = true;
          loadAvatarImg();
          saveSave();
          if(after) after();
        };
        img.src = fp;
      },
    });
  }catch(e){}
}

/* —— 开关商店（暂停/恢复逻辑照抄网页版 toggleShop） —— */
function toggleShop(show){
  if(show){
    if(game.state === 'playing') paused = true;   // 打开商店时自动暂停，逛完再继续
    shopScroll = 0;
    uiScreen = 'shop';
  } else {
    uiScreen = homeOpen() ? 'home' : 'none';
    if(game.state === 'playing' && paused && !resumeUntil){
      resumeUntil = performance.now() + 1500;   // 关店直接进 3-2-1，省掉一个"已暂停"页
    }
    // 画布版每帧都重画，回大厅不用再手动刷新余额
  }
}
function closeSign(){ uiScreen = homeOpen() ? 'home' : 'none'; }

/* —— 【留存包】好友榜 / 成就页的开关（都只能从主页进，关了就回主页） —— */
function openRank(){
  uiScreen = 'rank';
  // 喊"开放数据域"去拉好友分数并画到 sharedCanvas（隐私规则：好友数据只有那边能碰）
  try{
    const odc = wx.getOpenDataContext();
    if(odc && odc.canvas){ odc.canvas.width = 720; odc.canvas.height = 520; }   // 给排行榜画布定个固定清晰度
    if(odc && odc.postMessage) odc.postMessage({ cmd: 'rank' });                // 每次打开都重新拉一次最新数据
  }catch(e){}
}
function closeRank(){ uiScreen = homeOpen() ? 'home' : 'none'; }
function closeAch(){ uiScreen = homeOpen() ? 'home' : 'none'; }
function closeAdv(){ uiScreen = homeOpen() ? 'home' : 'none'; }   // 【酷跑2】关闭闯关选关页
function weekBestNow(){   // 【留存包】⑥ 本周最高分（存档里若还是上周的记录就按 0 算：跨周段位从头打）
  return (save.week && save.week.key === weekKey()) ? (save.week.best || 0) : 0;
}
/* —— 【留存包】⑦ 广告位预留：以后在微信后台申请好"激励视频广告位"，把 ID 填进 rewardedId、
   adReady() 改成真正的"广告加载好了吗"，结算卡上那颗灰按钮就会自己活过来 —— */
const AD = { rewardedId: '' };
function adReady(){ return false; }   // 目前没有广告位：永远没准备好，按钮先灰着占位

/* —— 今日挑战 / 回主页 / 复制战绩（业务逻辑照抄网页版） —— */
function startDaily(){
  dailyMode = true;
  adventureMode = false; curStage = null;   // 【酷跑2】日赛与闯关互斥：开日赛先清掉闯关标记
  startGame();
  showBanner('🌞 今日挑战：全国同一张图，跑满 3000 米！', 2.8, '#ffd34d');
}
// 【酷跑2】开始一关闯关：和 startGame 同一套初始化，只是先立好 adventureMode/curStage 标记，
//   startGame 会按 curStage.id 播种子（同关同图）、清零本关进度计数。
function startStage(stageObj){
  if(!stageObj) return;
  dailyMode = false;            // 闯关不是日赛
  adventureMode = true;
  curStage = stageObj;
  uiScreen = 'none'; uiHome = false;
  startLoading(() => {
    startGame();               // adventureMode/curStage 已立好 → startGame 走闯关分支
    showBanner('🗺️ 第' + stageObj.id + '关 · ' + stageObj.name + ' · 跑到 ' + stageObj.dist + ' 米！', 2.6, '#ffd34d');
  });
}
function goHome(){
  dailyMode = false;
  adventureMode = false; curStage = null;   // 【酷跑2】回主页清掉闯关标记，下一局默认无尽
  game.state = 'ready';
  resetPlayer();
  uiHome = true; uiScreen = 'home';   // 【小游戏改造】原来是显示 #home 元素，现在拨界面状态机
  // 玩了两局还没设头像：回大厅这个"闲时"再邀请（绝不在结算页打断玩家）
  if(save.runs >= 2 && !save.avatar && !save.skippedAvatar){
    startAfterAvatar = false;
    uiAvatarAsk = true;
  }
}
function quitToHome(){   // 跑到一半不玩了：本局不结算，直接回大厅
  stopBGM();
  paused = false; resumeUntil = 0;
  goHome();
}
function uiDrawPauseMenu(){   // 暂停时屏幕中央给一个"回主页"出口（真机反馈：以前死路一条）
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));   // 字号小工具（和其他界面函数一样按屏高算）
  const bw = cw * 0.2, bh = ch * 0.105;
  uiBtn({ id: 'pauseHome', x: (cw - bw) / 2, y: ch * 0.66, w: bw, h: bh, label: '🏠 回主页',
          size: fs(0.04), bg: 'rgba(13,16,36,0.85)', fg: '#dfe6f5', stroke: 'rgba(255,255,255,0.25)',
          bold: false, cb(){ quitToHome(); } });
  ctx.restore();
}
function copyDaily(){   // 复制日赛战报（文案拼法照抄网页版 copyBtn）
  const dr = (save.dailyRun && save.dailyRun.date === todayStr()) ? save.dailyRun : { best: game.score, tries: 1 };
  const stars = dr.best >= 1500 ? '⭐⭐⭐' : dr.best >= 1000 ? '⭐⭐' : dr.best >= 600 ? '⭐' : '';
  const d = new Date();
  // 【小游戏改造】网页版末尾带挑战链接；小游戏没有网址，结尾就到"敢来比吗？"
  const txt = '【狐狸快跑·每日挑战 ' + (d.getMonth() + 1) + '.' + d.getDate() + '】我跑了 ' + dr.best + ' 分 ' + stars +
              ' 全国同一张图，敢来比吗？';
  try{
    wx.setClipboardData({ data: txt, success(){ try{ wx.showToast({ title: '已复制' }); }catch(e){} } });
  }catch(e){}
  uiCopyLabel = '✅ 已复制，去微信粘贴';
}
function pausePressed(){   // 暂停按钮（逻辑照抄网页版 pauseBtn）
  if(game.state === 'playing'){
    if(!paused) paused = true;
    else if(!resumeUntil) resumeUntil = performance.now() + 1500;   // 恢复前先 3-2-1
  }
}
// 【小游戏改造】改昵称：网页版是 <input>；小游戏弹微信自带键盘，确认后存档
function editNick(){
  if(!wx.showKeyboard) return;
  try{
    wx.showKeyboard({ defaultValue: save.nick || '', maxLength: 12, multiple: false, confirmHold: false, confirmType: 'done' });
  }catch(e){}
}

/* —— 出发加成（购买/取消逻辑照抄网页版 homeBoosts 的点击处理） —— */
function boostClick(kind){
  if(performance.now() - lastBoostAt < 350) return;
  lastBoostAt = performance.now();
  if(kind === 'shield'){
    const cost = 60;
    if(pendingShield){ pendingShield = false; save.coins += cost; }                 // 取消=退款
    else if(save.coins >= cost){ pendingShield = true; save.coins -= cost; sfx.coin(); }
    else { boostErrKey = 'shield'; boostErrUntil = performance.now() + 800; return; }
  } else {
    const k = kind;
    const opts2 = [{ k: 300, cost: 80 }, { k: 500, cost: 150 }, { k: 1000, cost: 300 }];
    const cost = opts2.find(x => x.k === k).cost;
    const prev = opts2.find(x => x.k === pendingSprint);
    if(pendingSprint === k){ pendingSprint = 0; save.coins += cost; }               // 再点一次=取消退款
    else {
      if(prev) save.coins += prev.cost;                                             // 换档先退上一档
      if(save.coins >= cost){ pendingSprint = k; save.coins -= cost; sfx.coin(); }
      else { pendingSprint = 0; boostErrKey = String(k); boostErrUntil = performance.now() + 800; }
    }
  }
  saveSave();
}

/* —— 死亡结算卡的内容（数据照抄网页版 updateDeadCard，绘制在 drawDead） —— */
const deadCard = { title: '', sub: '', score: '', stats: [], goal: null, adv: false, advWin: false, stars: 0 };
function updateDeadCard(){
  // 【酷跑2】闯关结算卡：通关(finish)/失败(撞死掉坑) 两种样式——★评价 + 奖励 + 三星明细
  if(adventureMode && curStage){
    const win = game.deathBy === 'finish';
    deadCard.adv = true; deadCard.advWin = win; deadCard.stars = win ? stageStars : 0;
    deadCard.goal = null;
    if(win){
      deadCard.title = '第' + curStage.id + '关 · ' + curStage.name;
      deadCard.sub = stageStars >= 3 ? '🏆 完美三星！' : (stageStars === 2 ? '👍 两星，再加把劲！' : '过关！');
      deadCard.score = '★'.repeat(stageStars) + '☆'.repeat(3 - stageStars);
      deadCard.stats = [
        '✅ 完赛　' + (stageHurt ? '❌ 不受伤' : '✅ 不受伤') +
        '　' + (stageCoins >= curStage.goalCoins ? '✅' : '❌') + ' 金币 ' + stageCoins + '/' + curStage.goalCoins,
      ];
      const rw = curStage.reward || {};
      const parts = [];
      if(rw.coins) parts.push('+' + rw.coins + '💰'); if(rw.gems) parts.push('+' + rw.gems + '💎');
      if(rw.char && CHARS[rw.char]) parts.push('解锁角色「' + CHARS[rw.char].name + '」');
      if(parts.length) deadCard.stats.push('🎁 奖励：' + parts.join(' · '));
    } else {
      deadCard.title = '挑战失败';
      deadCard.sub = game.deathBy === 'pit' ? '掉进坑里啦，看到坑要跳～' : '撞到障碍没血了，再试一次！';
      deadCard.score = '第' + curStage.id + '关 · ' + curStage.name;
      deadCard.stats = ['跑了 ' + Math.floor(game.runDist / 12) + ' / ' + curStage.dist + ' 米 · 金币 ' + stageCoins + '/' + curStage.goalCoins];
    }
    return;
  }
  deadCard.adv = false;
  const finish = dailyMode && game.deathBy === 'finish';
  deadCard.title = finish ? '🏁 完赛！' : '游戏结束';
  const nearMiss = endlessOnly() && !game.newBest && game.startBest > 0 && game.score >= game.startBest * 0.85;
  deadCard.sub =
    nearMiss ? '就差 ' + (game.startBest - game.score + 1) + ' 分破纪录！' :
    (game.newBest && endlessOnly() ? '🎉 新纪录！' : (game.deathBy === 'pit' ? '掉进坑里啦，看到坑要跳～' : ''));
  deadCard.score = game.score + ' 分';
  if(dailyMode){
    const dr = (save.dailyRun && save.dailyRun.date === todayStr()) ? save.dailyRun : { best: 0, tries: 0 };
    const stars = dr.best >= 1500 ? '⭐⭐⭐' : dr.best >= 1000 ? '⭐⭐' : dr.best >= 600 ? '⭐' : '';
    deadCard.stats = ['今日最佳 ' + dr.best + ' 分 ' + stars + ' · 第 ' + dr.tries + ' 次尝试',
                      '复制战绩发到群里，群友就是排行榜'];
  } else {
    const doneN = (save.daily && save.daily.date === todayStr()) ? save.daily.tasks.filter(t => t.done).length : 0;
    deadCard.stats = ['本局金币 +' + game.coinCount + ' · 最高纪录 ' + game.best + ' · 今日任务 ' + doneN + '/3'];
    if(challenge && game.score > challenge.score) deadCard.stats.push('🆚 击败了 ' + challenge.name + '！转发链接回去让他好看');
  }
  // 【留存包】⑥ 段位进度：本周最佳 + 距下一段位还差多少（die() 里 endRunStats 先跑，week.best 已是最新）
  const wb = weekBestNow(), rk = rankOf(wb);
  deadCard.stats.push(rk.rank.e + rk.rank.name + ' · 本周最佳 ' + wb + ' 分' +
                      (rk.next ? ' · 距' + rk.next.e + rk.next.name + '还差 ' + rk.toNext + ' 分' : ' · 已是最高段位！'));
  deadCard.goal = dailyMode ? null : nextGoal();
}

/* —— 主页大厅（【主页改版】参考主流跑酷手游的横屏大厅排版） ——
   ┌──────────────────────────────────────────────────┐
   │ 💰胶囊 💎胶囊       像素大标题(场景画的)      (微信胶囊) │
   │                     昵称📝 / 🏆战绩一行小字            │
   │    ✨发光展台                      🦊 开始游戏(超大)    │
   │    大号出战角色                   挑战 | 商店 | 签到    │
   │ 今日任务胶囊×3                       出发加成 2×2      │
   └──────────────────────────────────────────────────┘
   元素和点击逻辑与旧版一一对应（按钮 id 一个没改），改的只是"摆在哪、长多大" */
function uiDrawHome(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  const cx = cw / 2;
  const t = performance.now() / 1000;   // 【主页改版】呼吸/脉动动画共用的时钟（秒）

  // —— 顶部左：货币胶囊（主流手游都把钱包钉在左上角；SAFE.l = 刘海宽度，往右让开） ——
  const capH = ch * 0.065;
  let capX = SAFE.l + ch * 0.03;
  const capY = ch * 0.035;
  const moneyCap = (txt, color) => {   // 质感版：深玻璃渐变 + 投影 + 顶部高光 + 同色描边
    ctx.font = 'bold ' + fs(0.034) + 'px ' + FONT;
    const w2 = ctx.measureText(txt).width + capH * 1.1;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = ch * 0.016; ctx.shadowOffsetY = ch * 0.004;
    const g = ctx.createLinearGradient(0, capY, 0, capY + capH);
    g.addColorStop(0, 'rgba(44,52,78,0.94)'); g.addColorStop(1, 'rgba(13,16,36,0.94)');
    ctx.fillStyle = g; dRR(capX, capY, w2, capH, capH / 2); ctx.fill();
    ctx.restore();
    ctx.save(); dRR(capX, capY, w2, capH, capH / 2); ctx.clip();
    const sh = ctx.createLinearGradient(0, capY, 0, capY + capH * 0.6);
    sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh; ctx.fillRect(capX, capY, w2, capH * 0.6); ctx.restore();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(1, ch * 0.004);
    dRR(capX, capY, w2, capH, capH / 2); ctx.stroke(); ctx.globalAlpha = 1;
    dText(txt, capX + w2 / 2, capY + capH / 2, fs(0.034), color, 'center', true);
    capX += w2 + ch * 0.018;   // 下一颗胶囊接着往右排
  };
  moneyCap('💰 ' + save.coins, '#ffd34d');
  moneyCap('💎 ' + save.gems, '#8ee6ff');

  // —— 顶部正中：大标题（主画布全分辨率：厚描边 + 渐变金 + 外发光，告别低清马赛克） ——
  {
    const titleY = ch * 0.17, tFs = Math.min(cw * 0.082, ch * 0.125);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 ' + tFs + 'px ' + FONT;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,170,40,0.55)'; ctx.shadowBlur = ch * 0.05;   // 外发光
    ctx.strokeStyle = '#5a3d00'; ctx.lineWidth = tFs * 0.16;                 // 厚描边
    ctx.strokeText('狐狸快跑呀', cx, titleY);
    ctx.shadowBlur = 0;
    const tg = ctx.createLinearGradient(0, titleY - tFs * 0.6, 0, titleY + tFs * 0.6);   // 渐变金
    tg.addColorStop(0, '#fff6c2'); tg.addColorStop(0.5, '#ffd34d'); tg.addColorStop(1, '#ffab1e');
    ctx.fillStyle = tg;
    ctx.fillText('狐狸快跑呀', cx, titleY);
    ctx.font = 'bold ' + (tFs * 0.2) + 'px ' + FONT;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('F O X   R U N', cx, titleY + tFs * 0.62);
    ctx.restore();
  }

  // 【留存包】④ 礼包：昨天玩过→"明日礼包"(200💰)；3 天没来→"回归礼包"(500💰+2💎)。
  // 货币胶囊正下方一颗发光小按钮，点了 claimGift() 当场发钱+横幅，领完（'done'）就不再画
  const gst = giftState();
  if(gst === 'tomorrow' || gst === 'back'){
    const gw = ch * 0.36, gh = ch * 0.062;
    const gx = SAFE.l + ch * 0.03, gy = capY + capH + ch * 0.024;
    ctx.fillStyle = '#ffd34d';   // 一圈呼吸的金色光晕：喊你快来领
    ctx.globalAlpha = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3.2));
    dRR(gx - ch * 0.01, gy - ch * 0.01, gw + ch * 0.02, gh + ch * 0.02, gh * 0.7); ctx.fill();
    ctx.globalAlpha = 1;
    uiBtn({ id: 'homeGift', x: gx, y: gy, w: gw, h: gh,
      label: gst === 'back' ? '🎁 回归礼包' : '🎁 领取明日礼包', size: fs(0.028),
      bg: '#ffd34d', fg: '#4a3500', cb(){ claimGift(); } });
  }

  // —— 标题正下方：昵称一行 + 战绩一行小字（紧贴副标题下方的空带；这个高度右侧是空的，避开右边的开始按钮，不再被它挡住） ——
  const nickY = ch * 0.31;
  dText('昵称：' + (save.nick || '神秘小狐狸') + '  📝', cx, nickY, fs(0.032), '#dfe6f5', 'center');
  addZone('homeNick', cx - cw * 0.13, nickY - ch * 0.03, cw * 0.26, ch * 0.06, editNick);
  const rk0 = rankOf(weekBestNow());   // 【留存包】⑥ 周段位徽章拼在战绩后面（如 🥉青铜狐）
  dText('🏆 最高 ' + game.best + ' 分' + (save.streak ? ' · 🔥 连签 ' + save.streak + ' 天' : '') +
        ' · ' + rk0.rank.e + rk0.rank.name,
        cx, nickY + ch * 0.052, fs(0.028), '#97a1b8', 'center');
  // 【收集进度总览】把散在各二级页的收集度聚到主页一行：一眼看到"就差几个了" → 忍不住再开一局补齐
  {
    const achUn = (save.ach && save.ach.un) || {};
    const achN = ACHIEVEMENTS.filter(a => achUn[a.id]).length;
    const starN = Object.values(save.stageProg || {}).reduce((a, b) => a + b, 0);
    const charN = (save.chars || ['fox']).length;
    dText('📖 ' + achN + '/' + ACHIEVEMENTS.length + '成就 · 🗺️ ' + starN + '★/36 · 🦊 ' + charN + '/' + Object.keys(CHARS).length + '角色',
          cx, nickY + ch * 0.09, fs(0.026), '#9fb0cc', 'center');
  }
  // 偶尔出现的活动/挑战信息：再往下小字提一句（fitText 限宽，免得伸到右边开始按钮底下）
  let evY = nickY + ch * 0.13;
  if(weekendBoost()){
    dText(fitText('🎉 周末狂欢：金币双倍进行中！', cw * 0.2, fs(0.028), true), cx, evY, fs(0.028), '#ffd9a0', 'center', true);
    evY += ch * 0.048;
  }
  if(challenge) dText(fitText('🆚 ' + challenge.name + ' 挑战你：' + challenge.score + ' 分', cw * 0.2, fs(0.028), true),
                      cx, evY, fs(0.028), '#ff8aa0', 'center', true);

  // —— 左侧中部：出战角色大展台（点角色 = 进商店换人，和大厂跑酷的"角色橱窗"一个意思） ——
  const s2 = ch / 180;                    // 像素场景的放大倍数（场景是 320×180 的低清图）
  const heroH = ch * 0.31;                // 角色总高 ≈ 屏高 31%（约等于游戏里的 2.2 倍大）
  const heroK = heroH / 56;               // drawCharacter 画出来的角色约 56 个单位高
  // 站位对准场景里原来那只小角色的脚下：大角色一盖上去，就像它走到了台前
  let heroX = (cw - 320 * s2) / 2 + 64 * s2;
  heroX = Math.max(heroX, SAFE.l + heroH * 0.6);   // 特别窄的屏幕兜底：别被刘海切到
  const baseY = 150 * s2;                          // 场景的地面线（低清图里地面在 y=150）
  // 发光圆台：两层椭圆叠出光晕，亮度跟着时间慢慢呼吸
  const glow = 0.5 + 0.5 * Math.sin(t * 2.2);
  ctx.fillStyle = '#ffd34d';
  ctx.globalAlpha = 0.10 + 0.08 * glow;
  ctx.beginPath(); ctx.ellipse(heroX, baseY, heroH * 0.62, heroH * 0.17, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.20 + 0.12 * glow;
  ctx.beginPath(); ctx.ellipse(heroX, baseY, heroH * 0.46, heroH * 0.12, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = Math.max(1, ch * 0.004);
  ctx.beginPath(); ctx.ellipse(heroX, baseY, heroH * 0.46, heroH * 0.12, 0, 0, TAU); ctx.stroke();
  // 大号角色本体：原地小跑 + 眨眼（参数和场景里那只完全一样，盖上去严丝合缝），
  // 再加一点"呼吸"：横向胖一点点、纵向矮一点点，脚始终钉在地上（商店预览 drawCharPreview 同款画法）
  ctx.save();
  ctx.translate(heroX, baseY);
  const breath = 1 + 0.02 * Math.sin(t * 2.6);
  ctx.scale(heroK * breath, heroK * (2 - breath));
  drawCharacter(ctx, CHARS[save.char] || CHARS.fox, {
    time: t, grounded: true, swing: Math.sin(t * 10) * 0.65, gliding: false,
    blinking: (t % 3) < 0.12 ? 1 : 0, dead: false,
    pal: charC(save.char in CHARS ? save.char : 'fox'),
    avatar: (save.useAvatar && avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) ? avatarImg : null,
  });
  ctx.restore();
  // 角色名 + 整块展台都能点：直接开商店
  dText((CHARS[save.char] || CHARS.fox).name + ' ▸', heroX, baseY + ch * 0.032, fs(0.028), '#c5cede', 'center', true);
  addZone('homeHero', heroX - heroH * 0.55, baseY - heroH * 1.05, heroH * 1.1, heroH * 1.05 + ch * 0.05,
          () => { if(!homeOpen() || loadingStart) return; ensureAudio(); toggleShop(true); });

  // —— 右侧中部偏下：超大开始按钮（轻微脉动 1±0.03，回显已买的出发加成） ——
  const startW = Math.min(cw * 0.30, ch * 0.9);          // 基础宽度（超宽屏不无限拉大）
  const scx2 = cw - SAFE.r - ch * 0.04 - startW / 2;     // 按钮中心：靠右、避开圆角安全区
  const scy2 = ch * 0.49;   // 【留存包】从 0.55 挪高一点：下面要再开一排"好友榜/成就"入口，别压到出发加成
  const pulse = 1 + 0.03 * Math.sin(t * 3);              // 【主页改版】缩放脉动：一直轻轻"喊你来点"
  const sw2 = startW * pulse, sh2 = ch * 0.15 * pulse;
  const boostTag = (pendingSprint ? ' · 🚀' + pendingSprint + '米' : '') + (pendingShield ? ' · 🛡️' : '');
  uiBtn({ id: 'homeStart', x: scx2 - sw2 / 2, y: scy2 - sh2 / 2, w: sw2, h: sh2,
    label: '🦊 开始游戏' + boostTag,
    size: fs(boostTag ? 0.04 : 0.052),   // 带加成回显时字变多，字号收一点免得挤出按钮
    bg: '#ffd34d', fg: '#4a3500', stroke: '#3a2a00',
    cb(){ if(!homeOpen() || loadingStart) return; ensureAudio(); uiHome = false; uiScreen = 'none'; startLoading(() => startGame()); } });
  // 开始按钮正下方一排小入口：今日挑战（第一局先藏着：渐进披露）/ 商店 / 签到
  const rowY = scy2 + ch * 0.075 + ch * 0.03, rowH = ch * 0.1;
  const defs = [];
  if(save.runs > 0) defs.push(['homeDaily', '🌞 今日挑战',
    () => { if(!homeOpen() || loadingStart) return; ensureAudio(); uiHome = false; uiScreen = 'none'; startLoading(() => startDaily()); }]);
  defs.push(['homeShop', '🛒 商店', () => { if(!homeOpen() || loadingStart) return; ensureAudio(); toggleShop(true); }]);
  defs.push(['homeSign', '📅 签到', () => { if(!homeOpen() || loadingStart) return; ensureAudio(); uiScreen = 'sign'; }]);
  const bGap = ch * 0.014, bw = (startW - bGap * 2) / 3;   // 三个按钮拼起来正好和开始按钮一样宽
  const totW = defs.length * bw + (defs.length - 1) * bGap;
  defs.forEach((d, i) => {
    const bx = scx2 - totW / 2 + i * (bw + bGap);
    uiBtn({ id: d[0], x: bx, y: rowY, w: bw, h: rowH, label: d[1], size: fs(0.032),
            bg: 'rgba(13,16,36,0.85)', fg: '#dfe6f5', stroke: 'rgba(255,255,255,0.25)', bold: false, cb: d[2] });
    if(d[0] === 'homeSign' && canClaimSign()){   // 今天还没领签到奖励：画个小红点提醒
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(bx + bw - ch * 0.008, rowY + ch * 0.008, ch * 0.013, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1d2433'; ctx.lineWidth = Math.max(1, ch * 0.004); ctx.stroke();
    }
  });
  // 【留存包】挑战/商店/签到下面再开一排：闯关 + 好友榜 + 成就 +【酷跑2】天赋（同一套宽度体系，整排拼满开始按钮宽）
  const row2Y = rowY + rowH + bGap, row2H = ch * 0.085;
  const defs2 = [
    ['homeAdv',    '🗺️ 闯关',   () => { if(!homeOpen() || loadingStart) return; ensureAudio(); uiScreen = 'adventure'; advScroll = 0; }],   // 【酷跑2】闯关冒险模式入口
    ['homeRank',   '🏆 好友榜', () => { if(!homeOpen() || loadingStart) return; ensureAudio(); openRank(); }],
    ['homeAch',    '📖 成就',   () => { if(!homeOpen() || loadingStart) return; ensureAudio(); achScroll = 0; uiScreen = 'ach'; }],
    ['homeTalent', '🌟 天赋',   () => { if(!homeOpen() || loadingStart) return; ensureAudio(); uiScreen = 'talent'; talentScroll = 0; }],   // 【酷跑2】天赋养成树入口
  ];
  const bw2c = (startW - bGap * (defs2.length - 1)) / defs2.length, tot2W = defs2.length * bw2c + (defs2.length - 1) * bGap;
  defs2.forEach((d, i) => {
    uiBtn({ id: d[0], x: scx2 - tot2W / 2 + i * (bw2c + bGap), y: row2Y, w: bw2c, h: row2H, label: d[1], size: fs(0.03),
            bg: 'rgba(13,16,36,0.85)', fg: '#dfe6f5', stroke: 'rgba(255,255,255,0.25)', bold: false, cb: d[2] });
  });

  // —— 底部左：今日任务三条横排小胶囊（✅/⬜ + 任务名 + 进度；第一局先藏着） ——
  if(save.runs > 0 && save.daily && save.daily.date === todayStr()){
    const tasks = save.daily.tasks;
    const capH2 = ch * 0.068, tGap = ch * 0.014;
    const tx0 = SAFE.l + ch * 0.03;
    const availW = cw * 0.60 - tx0;   // 最多铺到屏宽 60%，右边留给出发加成
    const tcw = (availW - tGap * (tasks.length - 1)) / tasks.length;
    const ty0 = ch * 0.965 - capH2;
    tasks.forEach((tk, i) => {
      const x2 = tx0 + i * (tcw + tGap);
      uiPanel(x2, ty0, tcw, capH2);
      const col = tk.done ? '#7fd89a' : '#c5cede';
      const prog = Math.min(tk.prog, tk.goal) + '/' + tk.goal;
      let txt = (tk.done ? '✅ ' : '⬜ ') + taskName(tk) + ' ' + prog;
      ctx.font = fs(0.026) + 'px ' + FONT;
      if(ctx.measureText(txt).width > tcw - capH2 * 0.6){   // 挤不下就只留 图标+进度
        txt = (tk.done ? '✅ ' : '⬜ ') + prog;
      }
      dText(txt, x2 + tcw / 2, ty0 + capH2 / 2, fs(0.026), col, 'center');
    });
  }

  // —— 底部右：出发加成 2×2 小按钮（只换了摆法，买/取消/退款逻辑原封没动） ——
  if(save.runs > 0){
    const bw2 = cw * 0.125, bh2 = ch * 0.062, gGap = ch * 0.012;
    const gx0 = cw - SAFE.r - ch * 0.03 - bw2 * 2 - gGap;   // 2×2 网格的左上角
    const gy0 = ch * 0.965 - bh2 * 2 - gGap;
    dText('🎁 出发加成 · 只管下一局 · 再点一次取消退款', gx0 + bw2 * 2 + gGap, gy0 - ch * 0.018, fs(0.022), '#97a1b8', 'right');
    const errOn = k => boostErrKey === k && performance.now() < boostErrUntil;
    const opts = [{ k: 300, cost: 80 }, { k: 500, cost: 150 }, { k: 1000, cost: 300 }];
    opts.forEach((o2, i) => {   // 三档冲刺占网格的前三格
      const can = pendingSprint === o2.k || save.coins >= o2.cost;
      const on = pendingSprint === o2.k;
      uiBtn({ id: 'boost-' + o2.k,
        x: gx0 + (i % 2) * (bw2 + gGap), y: gy0 + Math.floor(i / 2) * (bh2 + gGap), w: bw2, h: bh2,
        label: errOn(String(o2.k)) ? '金币不够！' : on ? '✅ ' + o2.k + '米 已选'
             : '🚀' + o2.k + '米 ' + (can ? o2.cost + '💰' : '差' + (o2.cost - save.coins) + '💰'),
        size: fs(0.026), bg: on ? '#ffd34d' : 'rgba(13,16,36,0.85)', fg: on ? '#4a3500' : '#dfe6f5',
        stroke: on ? '#ffd34d' : 'rgba(255,255,255,0.25)', bold: on, alpha: (can || on) ? 1 : 0.55,
        cb: () => boostClick(o2.k) });
    });
    const canS = pendingShield || save.coins >= 60;   // 护盾占第四格
    uiBtn({ id: 'boost-shield', x: gx0 + bw2 + gGap, y: gy0 + bh2 + gGap, w: bw2, h: bh2,
      label: errOn('shield') ? '金币不够！' : pendingShield ? '✅ 护盾 已选'
           : '🛡️护盾 ' + (canS ? '60💰' : '差' + (60 - save.coins) + '💰'),
      size: fs(0.026), bg: pendingShield ? '#ffd34d' : 'rgba(13,16,36,0.85)', fg: pendingShield ? '#4a3500' : '#dfe6f5',
      stroke: pendingShield ? '#ffd34d' : 'rgba(255,255,255,0.25)', bold: pendingShield, alpha: canS ? 1 : 0.55,
      cb: () => boostClick('shield') });
  }
  ctx.restore();
}

/* —— 商店：货架数据（行的内容/按钮状态照抄网页版 renderShop） —— */
function shopRows(){
  const rows = [];
  if(shopTab === 'coin'){
    // 🎰 幸运抽奖：金币消耗的惊喜口（能抽到稀有角色！）
    rows.push({ prev: { kind: 'emoji', v: '🎰' }, title: '幸运抽奖',
      desc: lastGachaMsg || '150💰 抽一次：金币 / 💎 / 免费冲刺券 / 皮肤，还有小概率直接抽中稀有角色！',
      btns: [{ id: 'shopGacha', label: shopErrText('gacha') || '150 💰', cant: save.coins < 150, cb: gachaClick }] });
    for(const g of SHOP_GOODS){
      if(g.kind === 'char'){
        const ch2 = CHARS[g.id];
        const chips = [{ t: ch2.jumps === 1 ? '单跳' : ch2.jumps + '连跳', c: '#4f87d6' }];
        if(ch2.glide) chips.push({ t: '滑翔', c: '#9b59d0' });
        let btn;
        if(save.char === g.id)             btn = { id: 'shopWear-' + g.id, label: '出战中', disabled: true };
        else if(save.chars.includes(g.id)) btn = { id: 'shopWear-' + g.id, label: '出战', cb(){ save.char = g.id; saveSave(); } };
        else btn = { id: 'shopBuy-' + g.id, label: shopErrText('buy-' + g.id) || ch2.price + ' 金币',
                     cant: save.coins < ch2.price, cb: () => buyChar(g.id) };
        rows.push({ prev: { kind: 'char', v: g.id }, title: ch2.name, chips: chips, desc: ch2.desc, btns: [btn] });
      } else {
        const full = save.durLevel >= g.prices.length;
        rows.push({ prev: { kind: 'emoji', v: '⏰' }, title: g.name, desc: g.desc,
          note: 'Lv ' + save.durLevel + '/' + g.prices.length,
          btns: [ full ? { id: 'shopUp-dur', label: '已满级', disabled: true }
                       : { id: 'shopUp-dur', label: shopErrText('up-dur') || '升级 ' + g.prices[save.durLevel] + ' 金币',
                           cant: save.coins < g.prices[save.durLevel], cb: upDur } ] });
      }
    }
    // 真人头像专区
    const avBtns = [{ id: 'shopAvatarUp', label: save.avatar ? '换照片' : '上传照片', cb: () => chooseAvatar(null) }];
    if(save.avatar) avBtns.push({ id: 'shopAvatarToggle', label: save.useAvatar ? '摘下' : '戴上',
                                  cb(){ save.useAvatar = !save.useAvatar; saveSave(); } });
    rows.push({ prev: { kind: 'avatar' }, title: '真人头像',
      chips: save.useAvatar ? [{ t: '使用中', c: '#9b59d0' }] : [],
      desc: '上传一张照片，角色的脑袋换成你！撞到、吃道具、阵亡都有专属表情', btns: avBtns });
  } else if(shopTab === 'gem'){
    // —— 钻石商店：💎 专属高级货，和金币商店完全分开 ——
    rows.push({ prev: { kind: 'emoji', v: '🐰' }, title: '怎么获得钻石？',
      desc: '路上偶尔出现背着钻石的小兔子——跳起来扑住它就 +1 💎（未来会有更多获取方式）', btns: [] });
    for(const g2 of GEM_GOODS){
      let gbtn;
      // 【酷跑2】星宝（pet）已并入下方"萌宠"图鉴：默认就拥有，所以这里的按钮变成"出战/出战中"，
      //   既保留老的 shopGemBuy-pet 入口（一键让星宝出战），又不会出现"已拥有"灰按钮点不了。
      if(g2.id === 'pet'){
        gbtn = save.petActive === 'star'
          ? { id: 'shopGemBuy-pet', label: '出战中', cb: () => wearPet('star') }
          : { id: 'shopGemBuy-pet', label: '出战', cb: () => wearPet('star') };
      } else {
        gbtn = save[g2.id] ? { id: 'shopGemBuy-' + g2.id, label: '已拥有', disabled: true }
                           : { id: 'shopGemBuy-' + g2.id, label: shopErrText('gem-' + g2.id) || g2.cost + ' 💎',
                               cant: save.gems < g2.cost, cb: () => gemBuy(g2.id) };
      }
      rows.push({ prev: { kind: 'emoji', v: g2.emoji }, title: g2.name,
        chips: [{ t: '钻石专属', c: '#23bcc9' }], desc: g2.desc, btns: [gbtn] });
    }
    // 【酷跑2】萌宠图鉴：每只 PETS 一行——预览(emoji) + 名字/技能 + 右按钮（买/差额灰显/出战/出战中）。
    //   zone id 用 petBuy-/petWear-（新 id，不与现有冲突）。一只用金币买、一只用钻石买，按 cur 区分。
    rows.push({ prev: { kind: 'emoji', v: '🐾' }, title: '萌宠图鉴',
      desc: '收集多只伙伴，每只一项主动技能；同时只能出战一只，随时切换。日赛公平起见暂停萌宠', btns: [] });
    for(const pt of PETS){
      const owned = ownPet(pt.id);
      const active = save.petActive === pt.id;
      const priceLabel = pt.cur === 'gem' ? pt.cost + ' 💎' : pt.cost + ' 💰';
      const enough = pt.cur === 'gem' ? save.gems >= pt.cost : save.coins >= pt.cost;
      let btn;
      if(active)      btn = { id: 'petWear-' + pt.id, label: '出战中', disabled: true };
      else if(owned)  btn = { id: 'petWear-' + pt.id, label: '出战', cb: () => wearPet(pt.id) };
      else            btn = { id: 'petBuy-' + pt.id,
                              label: shopErrText('pet-' + pt.id) || (enough ? priceLabel : (pt.cur === 'gem' ? '差' + (pt.cost - save.gems) + '💎' : '差' + (pt.cost - save.coins) + '💰')),
                              cant: !enough, cb: () => buyPet(pt.id) };
      rows.push({ prev: { kind: 'emoji', v: pt.emoji }, title: pt.name,
        chips: [{ t: pt.cur === 'gem' ? '钻石' : '金币', c: pt.cur === 'gem' ? '#23bcc9' : '#d6a02a' }],
        desc: pt.skill, btns: [btn] });
    }
  } else {
    // —— 装扮间：给已拥有的伙伴换配色皮肤（💎 购买，随时切换） ——
    rows.push({ prev: { kind: 'emoji', v: '👗' }, title: '换装间',
      desc: '已拥有的伙伴才能换装；买了皮肤随时切换，预览实时试穿', btns: [] });
    for(const cid of save.chars){
      const list = SKINS2[cid] || [];
      if(!list.length) continue;
      const btns = [{ id: 'shopSkinWear-' + cid + '-base', label: '原色',
                      disabled: !save.skinOn[cid], cb: () => skinWear(cid, '') }];
      for(const sk of list){
        const owned = (save.skins[cid] || []).includes(sk.id);
        const on = save.skinOn[cid] === sk.id;
        btns.push(owned
          ? { id: 'shopSkinWear-' + cid + '-' + sk.id, label: on ? sk.name + ' ✅' : '穿' + sk.name,
              disabled: on, cb: () => skinWear(cid, sk.id) }
          : { id: 'shopSkinBuy-' + cid + '-' + sk.id, label: shopErrText('skin-' + cid + '-' + sk.id) || sk.name + ' ' + sk.price + '💎',
              cant: save.gems < sk.price, cb: () => skinBuy(cid, sk.id) });
      }
      rows.push({ prev: { kind: 'char', v: cid }, title: CHARS[cid].name, desc: '', btns: btns });
    }
  }
  return rows;
}
// 画一行货架：左边小预览 + 名字/说明 + 右侧按钮（角色预览是活的：每帧用真实时间重画）
function drawShopRow(row, x, y, w, h, clip, fs){
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';   // 行与行之间的细分隔线
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
  // 预览框
  const pvH = h * 0.72, pvW = pvH * 1.3, pvY = y + (h - pvH) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  dRR(x, pvY, pvW, pvH, h * 0.1); ctx.fill();
  if(row.prev.kind === 'char'){
    // 货架上的小动物用游戏同款 drawCharacter 画，原地小跑 + 眨眼（对应网页版 drawCharPreview）
    ctx.save();
    dRR(x, pvY, pvW, pvH, h * 0.1); ctx.clip();
    const t = performance.now() / 1000;
    const id = row.prev.v;
    ctx.translate(x + pvW * 0.55, pvY + pvH * 0.89);
    const k = pvH / 56 * 0.9;
    ctx.scale(k, k);
    drawCharacter(ctx, CHARS[id] || CHARS.fox, {
      time: t, grounded: true, swing: Math.sin(t * 9) * 0.6, gliding: false,
      blinking: (t % 3) < 0.12 ? 1 : 0, dead: false,
      pal: charC(id in CHARS ? id : 'fox'),   // 预览也穿着当前皮肤
    });
    ctx.restore();
  } else if(row.prev.kind === 'avatar' && save.avatar && avatarImg && avatarImg.complete){
    ctx.save();
    dRR(x, pvY, pvW, pvH, h * 0.1); ctx.clip();
    try{ ctx.drawImage(avatarImg, x, pvY, pvW, pvH); }catch(e){}
    ctx.restore();
  } else {
    dText(row.prev.kind === 'avatar' ? '🤳' : row.prev.v, x + pvW / 2, pvY + pvH / 2, fs(0.05), '#fff', 'center');
  }
  // 右侧按钮：从右往左排（一行可能有好几个，比如皮肤的 原色/穿/买）
  const btnH = Math.min(h * 0.52, canvas.height * 0.075);
  // 【商店修复】窄屏自适应：按钮多了排不下时，自动把字号和内边距一起缩小，
  // 保证再窄的手机、再多的按钮（原色+多个皮肤）都排得开、每个都点得到
  let bFs = fs(0.032), padK = 0.8, minK = 1.5, gapK = 0.008;
  if(row.btns.length >= 2){
    const avail = w * 0.6;   // 给预览+名字留 40%，剩下给按钮
    let natural = 0;
    ctx.font = 'bold ' + bFs + 'px ' + FONT;
    for(const b of row.btns) natural += Math.max(btnH * minK, ctx.measureText(b.label).width + btnH * padK) + w * gapK;
    if(natural > avail){
      bFs = Math.max(fs(0.023), Math.round(bFs * Math.max(0.72, avail / natural)));
      padK = 0.5; minK = 1.2; gapK = 0.006;
    }
  }
  let bx = x + w;
  for(let i = row.btns.length - 1; i >= 0; i--){
    const b = row.btns[i];
    ctx.font = 'bold ' + bFs + 'px ' + FONT;
    const bw3 = Math.max(btnH * minK, ctx.measureText(b.label).width + btnH * padK);
    bx -= bw3;
    uiBtn({ id: b.id, x: bx, y: y + (h - btnH) / 2, w: bw3, h: btnH, label: b.label, size: bFs,
            bg: '#ffd34d', fg: '#4a3500', cant: b.cant, disabled: b.disabled, cb: b.cb, clip: clip });
    bx -= w * gapK;
  }
  if(row.note){   // 行级小注释（道具时长的 "Lv 1/3"）
    ctx.font = fs(0.028) + 'px ' + FONT;
    const nw = ctx.measureText(row.note).width;
    dText(row.note, bx - w * 0.006, y + h / 2, fs(0.028), '#97a1b8', 'right');
    bx -= nw + w * 0.012;
  }
  // 名字 + 能力徽章 + 说明
  const tx2 = x + pvW + w * 0.018;
  const maxW = Math.max(40, bx - w * 0.015 - tx2);
  dText(fitText(row.title, maxW, fs(0.036), true), tx2, y + h * 0.32, fs(0.036), '#fff', 'left', true);
  ctx.font = 'bold ' + fs(0.036) + 'px ' + FONT;
  let chipX = tx2 + ctx.measureText(row.title).width + w * 0.01;
  for(const c3 of (row.chips || [])){
    chipX += uiChip(c3.t, chipX, y + h * 0.32, fs(0.024), c3.c) + w * 0.005;
  }
  if(row.desc) dText(fitText(row.desc, maxW, fs(0.028)), tx2, y + h * 0.68, fs(0.028), '#97a1b8', 'left');
}
/* —— 商店全屏卡片：页签 + 可拖动滚动的货架 + 关闭 —— */
function uiDrawShop(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  // 半透明遮罩：点旁边暗处也能关店（同网页版）
  ctx.fillStyle = 'rgba(8,12,24,0.65)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('shopBack', 0, 0, cw, ch, () => toggleShop(false));
  // 深色卡片
  const cardW = Math.min(cw * 0.76, ch * 2.2), cardH = ch * 0.92;
  const cardX = (cw - cardW) / 2, cardY = (ch - cardH) / 2;
  uiCard(cardX, cardY, cardW, cardH);
  addZone('shopCard', cardX, cardY, cardW, cardH, null);   // 挡住卡片底下的"点暗处关店"
  const pad = ch * 0.03;
  let y = cardY + pad;
  // 标题 + 余额
  dText('🛒 商店', cardX + pad, y + fs(0.05) * 0.6, fs(0.05), '#fff', 'left', true);
  dText('💰 ' + save.coins + '　💎 ' + save.gems, cardX + cardW - pad, y + fs(0.05) * 0.6, fs(0.04), '#ffd34d', 'right', true);
  y += fs(0.05) + pad * 0.55;
  // 三个页签（选中色和网页版一致：金=金币 青=钻石 紫=装扮）
  const tabs = [['coin', '💰 金币', '#ffd34d', '#4a3500'], ['gem', '💎 钻石', '#23bcc9', '#04353a'], ['skin', '👗 装扮', '#c77dff', '#2a0a3a']];
  const tabH = ch * 0.082, tabGap = pad * 0.4, tabW = (cardW - pad * 2 - tabGap * 2) / 3;
  tabs.forEach((tb, i) => {
    const act = shopTab === tb[0];
    uiBtn({ id: 'shopTab' + tb[0].charAt(0).toUpperCase() + tb[0].slice(1),
      x: cardX + pad + i * (tabW + tabGap), y: y, w: tabW, h: tabH, label: tb[1], size: fs(0.036),
      bg: act ? tb[2] : 'rgba(255,255,255,0.10)', fg: act ? tb[3] : '#97a1b8', bold: act,
      cb(){ shopTab = tb[0]; shopScroll = 0; } });
  });
  y += tabH + pad * 0.5;
  // 关闭按钮先占住底部，货架用剩下的空间
  const closeH = ch * 0.088;
  const closeY = cardY + cardH - pad - closeH;
  const listX = cardX + pad, listW = cardW - pad * 2;
  const listY = y, listH = closeY - pad * 0.5 - y;
  const clip = { x: listX, y: listY, w: listW, h: listH };
  // 货架（可上下拖动；rowH 略大于按钮，手指好点）
  const rows = shopRows();
  const rowH = ch * 0.16;
  shopViewH = listH;
  shopContentH = rows.length * rowH + rowH * 0.3;   // 【商店修复】底部留白：最后一行不被关闭键压住
  shopScroll = clamp(shopScroll, Math.min(0, listH - shopContentH), 0);
  ctx.save();
  ctx.beginPath(); ctx.rect(listX, listY, listW, listH); ctx.clip();
  rows.forEach((row, i) => {
    const ry = listY + i * rowH + shopScroll;
    if(ry + rowH < listY || ry > listY + listH) return;   // 滚出视野的行不画
    drawShopRow(row, listX, ry, listW, rowH, clip, fs);
  });
  ctx.restore();
  if(shopContentH > listH){   // 细细的滚动条：提示"下面还有货"
    const barH = Math.max(listH * 0.1, listH * listH / shopContentH);
    const barY = listY + (-shopScroll / (shopContentH - listH)) * (listH - barH);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    dRR(cardX + cardW - pad * 0.45, barY, pad * 0.18, barH, pad * 0.09); ctx.fill();
  }
  uiBtn({ id: 'shopClose', x: listX, y: closeY, w: listW, h: closeH, label: '关 闭', size: fs(0.036),
          bg: 'rgba(255,255,255,0.14)', fg: '#fff', bold: false, cb: () => toggleShop(false) });
  ctx.restore();
}

/* —— 签到日历（7 格 + 领取按钮；判定逻辑照抄网页版 renderSign） —— */
function uiDrawSign(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  ctx.fillStyle = 'rgba(8,12,24,0.65)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('signBack', 0, 0, cw, ch, closeSign);   // 点暗处关闭（同网页版）
  const pad = ch * 0.028;
  const cellH = ch * 0.21, claimH = ch * 0.105, closeH = ch * 0.085;
  const cardW = Math.min(cw * 0.56, ch * 1.6);
  const cardH = pad * 4.5 + ch * 0.05 + cellH + claimH + closeH;
  const cardX = (cw - cardW) / 2, cardY = (ch - cardH) / 2;
  uiCard(cardX, cardY, cardW, cardH);
  addZone('signCard', cardX, cardY, cardW, cardH, null);
  dText('📅 连续签到', cardX + cardW / 2, cardY + pad + fs(0.042) * 0.55, fs(0.042), '#fff', 'center', true);
  // 7 格日历：已领 = 金色底，今天 = 金色描边
  const claimable = canClaimSign();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const nextStreak = claimable ? ((save.lastLogin === yest.toDateString()) ? save.streak + 1 : 1) : save.streak;
  const todayIdx = ((Math.max(1, nextStreak) - 1) % 7);
  const gap = cardW * 0.012;
  const cellW = (cardW - pad * 2 - gap * 6) / 7;
  const gy = cardY + pad * 1.6 + ch * 0.05;
  for(let i = 0; i < 7; i++){
    const cx3 = cardX + pad + i * (cellW + gap);
    const got = claimable ? i < todayIdx : (i <= todayIdx && save.streak > 0);
    ctx.fillStyle = got ? 'rgba(255,211,77,0.18)' : 'rgba(255,255,255,0.08)';
    dRR(cx3, gy, cellW, cellH, ch * 0.014); ctx.fill();
    if(i === todayIdx){
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = Math.max(2, ch * 0.005);
      dRR(cx3, gy, cellW, cellH, ch * 0.014); ctx.stroke();
    }
    const tcol = i === todayIdx ? '#fff' : (got ? '#ffd34d' : '#aab6d0');
    dText('第' + (i + 1) + '天', cx3 + cellW / 2, gy + cellH * 0.24, fs(0.026), tcol, 'center');
    dText(SIGN_REWARDS[i], cx3 + cellW / 2, gy + cellH * 0.52, fs(0.026), tcol, 'center');
    if(got) dText('✅', cx3 + cellW / 2, gy + cellH * 0.8, fs(0.03), tcol, 'center', true);
  }
  // 领取按钮：今天没领过才亮
  const claimY = gy + cellH + pad;
  uiBtn({ id: 'signClaim', x: cardX + pad, y: claimY, w: cardW - pad * 2, h: claimH,
    label: claimable ? '领取第 ' + nextStreak + ' 天奖励' : '今天已领，明天再来！',
    size: fs(0.036), bg: '#ffd34d', fg: '#4a3500', disabled: !claimable,
    cb(){ if(!canClaimSign()) return; dailyCheckIn(); sfx.power(); } });
  uiBtn({ id: 'signClose', x: cardX + pad, y: claimY + claimH + pad * 0.5, w: cardW - pad * 2, h: closeH,
          label: '关 闭', size: fs(0.032), bg: 'rgba(255,255,255,0.14)', fg: '#fff', bold: false, cb: closeSign });
  ctx.restore();
}

/* —— 【留存包】① 好友排行榜面板：壳子（遮罩/卡片/标题/关闭）是主域画的，
   中间的名次列表是"开放数据域"（open-data/index.js）画在 sharedCanvas 上的——整张等比贴进来。
   每次打开都会 postMessage 让那边重新拉一次好友分数 —— */
function uiDrawRank(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  ctx.fillStyle = 'rgba(8,12,24,0.65)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('rankBack', 0, 0, cw, ch, closeRank);   // 点暗处关闭（和商店/签到一个习惯）
  const pad = ch * 0.028;
  const cardW = Math.min(cw * 0.52, ch * 1.3), cardH = ch * 0.92;
  const cardX = (cw - cardW) / 2, cardY = (ch - cardH) / 2;
  uiCard(cardX, cardY, cardW, cardH);
  addZone('rankCard', cardX, cardY, cardW, cardH, null);   // 挡住卡片底下的"点暗处关闭"
  dText('🏆 好友排行榜', cardX + cardW / 2, cardY + pad + fs(0.042) * 0.55, fs(0.042), '#fff', 'center', true);
  const closeH = ch * 0.085;
  const closeY = cardY + cardH - pad - closeH;
  const areaX = cardX + pad, areaY = cardY + pad * 1.6 + ch * 0.05;
  const areaW = cardW - pad * 2, areaH = closeY - pad * 0.5 - areaY;
  try{   // sharedCanvas 等比缩放贴进内容区（contain 模式：好友头像不变形）
    const odc = wx.getOpenDataContext();
    const sc = odc && odc.canvas;
    if(sc && sc.width > 0 && sc.height > 0){
      const s = Math.min(areaW / sc.width, areaH / sc.height);
      ctx.drawImage(sc, areaX + (areaW - sc.width * s) / 2, areaY + (areaH - sc.height * s) / 2,
                    sc.width * s, sc.height * s);
    }
  }catch(e){}
  uiBtn({ id: 'rankClose', x: areaX, y: closeY, w: areaW, h: closeH, label: '关 闭', size: fs(0.036),
          bg: 'rgba(255,255,255,0.14)', fg: '#fff', bold: false, cb: closeRank });
  ctx.restore();
}

/* —— 【留存包】② 成就页：可滚动列表（滚动手感和商店货架同一套），
   每条 = 表情+名字+描述+进度条(累计/目标)；达成打✅；带称号(🎖)的条目达成后能点击佩戴/再点摘下 —— */
let achScroll = 0, achViewH = 1, achContentH = 0;   // 成就列表的滚动状态（同 shopScroll 三件套）
let advScroll = 0, advViewH = 1, advContentH = 0;   // 【酷跑2】闯关选关列表的滚动状态（同上三件套）
function uiDrawAch(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  ctx.fillStyle = 'rgba(8,12,24,0.65)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('achBack', 0, 0, cw, ch, closeAch);
  const cardW = Math.min(cw * 0.64, ch * 1.9), cardH = ch * 0.92;
  const cardX = (cw - cardW) / 2, cardY = (ch - cardH) / 2;
  uiCard(cardX, cardY, cardW, cardH);
  addZone('achCard', cardX, cardY, cardW, cardH, null);
  const pad = ch * 0.03;
  const st = save.stat || {};
  const un = (save.ach && save.ach.un) || {};
  let y = cardY + pad;
  const gotN = ACHIEVEMENTS.filter(a => un[a.id]).length;
  dText('📖 成就', cardX + pad, y + fs(0.05) * 0.6, fs(0.05), '#fff', 'left', true);
  dText('已达成 ' + gotN + ' / ' + ACHIEVEMENTS.length, cardX + cardW - pad, y + fs(0.05) * 0.6, fs(0.036), '#ffd34d', 'right', true);
  y += fs(0.05) + pad * 0.45;
  dText(save.ach && save.ach.title
        ? '当前称号：【' + save.ach.title + '】 · 点别的🎖可以换，再点一次摘下'
        : '每类做到最高档可得🎖称号，达成后点那一条即可佩戴',
        cardX + pad, y + fs(0.026) * 0.7, fs(0.026), '#97a1b8', 'left');
  y += fs(0.026) * 1.5 + pad * 0.35;
  // 列表区（底部留给关闭按钮），row 滚出视野就不画——和商店货架一样省力气
  const closeH = ch * 0.085;
  const closeY = cardY + cardH - pad - closeH;
  const listX = cardX + pad, listW = cardW - pad * 2;
  const listY = y, listH = closeY - pad * 0.5 - y;
  const clip = { x: listX, y: listY, w: listW, h: listH };
  const rowH = ch * 0.145;
  achViewH = listH;
  achContentH = ACHIEVEMENTS.length * rowH;
  achScroll = clamp(achScroll, Math.min(0, listH - achContentH), 0);
  ctx.save();
  ctx.beginPath(); ctx.rect(listX, listY, listW, listH); ctx.clip();
  ACHIEVEMENTS.forEach((a, i) => {
    const ry = listY + i * rowH + achScroll;
    if(ry + rowH < listY || ry > listY + listH) return;
    const done = !!un[a.id];
    const cur = st[a.stat] || 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';   // 行与行之间的细分隔线
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(listX, ry + rowH); ctx.lineTo(listX + listW, ry + rowH); ctx.stroke();
    // 左：表情图标框（达成的换金色底）
    const pvH = rowH * 0.6, pvY = ry + (rowH - pvH) / 2;
    ctx.fillStyle = done ? 'rgba(255,211,77,0.14)' : 'rgba(255,255,255,0.07)';
    dRR(listX, pvY, pvH, pvH, rowH * 0.12); ctx.fill();
    dText(a.emoji, listX + pvH / 2, pvY + pvH / 2, fs(0.045), '#fff', 'center');
    // 右：达成✅ + 称号徽章（没达成的称号先灰着馋你）
    let rx = listX + listW - ch * 0.012;
    if(done){ dText('✅', rx, ry + rowH * 0.30, fs(0.036), '#7fd89a', 'right'); rx -= fs(0.036) * 1.6; }
    if(a.title){
      const on = save.ach && save.ach.title === a.title;
      ctx.font = 'bold ' + fs(0.028) + 'px ' + FONT;
      const bw = ctx.measureText('🎖 ' + a.title).width + ch * 0.05;
      if(done){
        uiBtn({ id: 'achTitle-' + a.id, x: rx - bw, y: ry + rowH * 0.14, w: bw, h: rowH * 0.34,
          label: (on ? '✅ ' : '🎖 ') + a.title, size: fs(0.028),
          bg: on ? '#ffd34d' : 'rgba(255,255,255,0.12)', fg: on ? '#4a3500' : '#ffd34d', bold: on, clip: clip,
          cb(){ save.ach.title = (save.ach.title === a.title) ? '' : a.title; saveSave(); } });   // 点一下佩戴，再点摘下
      } else {
        dText('🎖 ' + a.title, rx, ry + rowH * 0.30, fs(0.026), '#5b6478', 'right');
      }
    }
    // 中：名字 + 描述 + 进度条
    const tx2 = listX + pvH + ch * 0.024;
    const nameW = Math.max(40, listX + listW * 0.6 - tx2);
    dText(fitText(a.name, nameW, fs(0.034), true), tx2, ry + rowH * 0.26, fs(0.034), done ? '#ffd34d' : '#fff', 'left', true);
    dText(fitText(a.desc, listW - (tx2 - listX) - ch * 0.02, fs(0.026)), tx2, ry + rowH * 0.53, fs(0.026), '#97a1b8', 'left');
    const barW = listW * 0.34, barH = ch * 0.014, by = ry + rowH * 0.78;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    dRR(tx2, by - barH / 2, barW, barH, barH / 2); ctx.fill();
    const frac = clamp(cur / a.goal, 0, 1);
    if(frac > 0.02){
      ctx.fillStyle = done ? '#7fd89a' : '#7fb3ff';
      dRR(tx2, by - barH / 2, barW * frac, barH, barH / 2); ctx.fill();
    }
    dText(Math.min(cur, a.goal) + ' / ' + a.goal, tx2 + barW + ch * 0.014, by, fs(0.024), '#97a1b8', 'left');
  });
  ctx.restore();
  if(achContentH > listH){   // 细细的滚动条：提示"下面还有"
    const sbH = Math.max(listH * 0.08, listH * listH / achContentH);
    const sbY = listY + (-achScroll / (achContentH - listH)) * (listH - sbH);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    dRR(cardX + cardW - pad * 0.45, sbY, pad * 0.18, sbH, pad * 0.09); ctx.fill();
  }
  uiBtn({ id: 'achClose', x: listX, y: closeY, w: listW, h: closeH, label: '关 闭', size: fs(0.036),
          bg: 'rgba(255,255,255,0.14)', fg: '#fff', bold: false, cb: closeAch });
  ctx.restore();
}

/* —— 【酷跑2】天赋养成树面板（uiScreen='talent'）：全屏深色卡 + 可滚动列表 ——
 *   每行：emoji+名字 / 当前效果(如"+18% 金币") / 等级点(●●●○○) / 升级按钮(价格 或 已满级灰显)。
 *   滚动用 talentScroll/talentViewH/talentContentH 三件套（与商店货架/成就同一套手感）。
 *   zone id：talentUp-<id>（升级）/ talentClose（关闭按钮）/ talentBack（点空白关）。日赛入口不开放，但这里也不依赖模式。 */
let talentScroll = 0, talentViewH = 1, talentContentH = 0;
function closeTalent(){ uiScreen = homeOpen() ? 'home' : 'none'; }
function uiDrawTalent(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  ctx.fillStyle = 'rgba(8,12,24,0.65)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('talentBack', 0, 0, cw, ch, closeTalent);   // 点卡片外的空白＝关闭
  const cardW = Math.min(cw * 0.64, ch * 1.9), cardH = ch * 0.92;
  const cardX = (cw - cardW) / 2, cardY = (ch - cardH) / 2;
  uiCard(cardX, cardY, cardW, cardH);
  addZone('talentCard', cardX, cardY, cardW, cardH, null);   // 卡片本身挡住，别穿透到下层
  const pad = ch * 0.03;
  let y = cardY + pad;
  // 标题行：左标题，右当前金币（升级要花金币，顺手提示余额）
  dText('🌟 天赋养成树', cardX + pad, y + fs(0.05) * 0.6, fs(0.05), '#fff', 'left', true);
  dText('💰 ' + save.coins, cardX + cardW - pad, y + fs(0.05) * 0.6, fs(0.036), '#ffd34d', 'right', true);
  y += fs(0.05) + pad * 0.45;
  dText('花金币永久升级，越肝越强（日赛不生效，保证公平）', cardX + pad, y + fs(0.026) * 0.7, fs(0.026), '#97a1b8', 'left');
  y += fs(0.026) * 1.5 + pad * 0.35;
  // 列表区（底部留给关闭按钮）
  const closeH = ch * 0.085;
  const closeY = cardY + cardH - pad - closeH;
  const listX = cardX + pad, listW = cardW - pad * 2;
  const listY = y, listH = closeY - pad * 0.5 - y;
  const clip = { x: listX, y: listY, w: listW, h: listH };
  const rowH = ch * 0.145;
  talentViewH = listH;
  talentContentH = TALENTS.length * rowH;
  talentScroll = clamp(talentScroll, Math.min(0, listH - talentContentH), 0);
  ctx.save();
  ctx.beginPath(); ctx.rect(listX, listY, listW, listH); ctx.clip();
  TALENTS.forEach((tl, i) => {
    const ry = listY + i * rowH + talentScroll;
    if(ry + rowH < listY || ry > listY + listH) return;   // 滚出视野的行不画
    const lv = (save.talents && save.talents[tl.id]) || 0;
    const maxed = lv >= tl.max;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';   // 行间细分隔线
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(listX, ry + rowH); ctx.lineTo(listX + listW, ry + rowH); ctx.stroke();
    // 左：emoji 图标框（满级换金色底）
    const pvH = rowH * 0.6, pvY = ry + (rowH - pvH) / 2;
    ctx.fillStyle = maxed ? 'rgba(255,211,77,0.14)' : 'rgba(255,255,255,0.07)';
    dRR(listX, pvY, pvH, pvH, rowH * 0.12); ctx.fill();
    dText(tl.emoji, listX + pvH / 2, pvY + pvH / 2, fs(0.045), '#fff', 'center');
    // 中：名字 + 当前效果 + 等级点（●已升 / ○未升）
    const tx2 = listX + pvH + ch * 0.024;
    dText(tl.name, tx2, ry + rowH * 0.26, fs(0.034), maxed ? '#ffd34d' : '#fff', 'left', true);
    // 当前效果：0 级时显示天赋说明（desc），有等级时显示折算后的数值（fmt）
    const effTxt = lv > 0 ? tl.fmt(lv) : tl.desc;
    dText(fitText(effTxt, listW * 0.52, fs(0.026)), tx2, ry + rowH * 0.53, fs(0.026), '#97a1b8', 'left');
    let dots = '';
    for(let d = 0; d < tl.max; d++) dots += d < lv ? '●' : '○';
    dText(dots, tx2, ry + rowH * 0.78, fs(0.03), maxed ? '#ffd34d' : '#7fb3ff', 'left');
    // 右：升级按钮（满级灰显"已满级"，否则显示下一级价；金币不足按钮自带"金币不够！"闪提示）
    const price = talentPrice(tl.id);
    const btnW = listW * 0.26, btnH = rowH * 0.42, btnX = listX + listW - btnW, btnY = ry + (rowH - btnH) / 2;
    if(maxed){
      uiBtn({ id: 'talentUp-' + tl.id, x: btnX, y: btnY, w: btnW, h: btnH, label: '已满级', size: fs(0.03),
              disabled: true, bold: false });
    } else {
      const cant = save.coins < price;
      uiBtn({ id: 'talentUp-' + tl.id, x: btnX, y: btnY, w: btnW, h: btnH,
              label: shopErrText('talent-' + tl.id) || '升级 ' + price + '💰', size: fs(0.028),
              bg: '#ffd34d', fg: '#4a3500', stroke: '#3a2a00', cant: cant, clip: clip,
              cb: () => buyTalent(tl.id) });
    }
  });
  ctx.restore();
  if(talentContentH > listH){   // 细滚动条：提示下面还有
    const sbH = Math.max(listH * 0.08, listH * listH / talentContentH);
    const sbY = listY + (-talentScroll / (talentContentH - listH)) * (listH - sbH);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    dRR(cardX + cardW - pad * 0.45, sbY, pad * 0.18, sbH, pad * 0.09); ctx.fill();
  }
  uiBtn({ id: 'talentClose', x: listX, y: closeY, w: listW, h: closeH, label: '关 闭', size: fs(0.036),
          bg: 'rgba(255,255,255,0.14)', fg: '#fff', bold: false, cb: closeTalent });
  ctx.restore();
}

/* —— 【酷跑2】闯关选关页（uiScreen='adventure'）：全屏深色卡 + 可滚动关卡列表 ——
 *   每行：序号+关名 / 终点米数·目标金币 / 历史最高星(★★☆) / 进入按钮(已解锁) 或 灰锁🔒(未解锁)。
 *   滚动用 advScroll/advViewH/advContentH 三件套（与商店/成就/天赋同一套手感）。
 *   zone id：stageGo-<id>（进入该关）/ advClose（关闭按钮）/ advBack（点空白关）。*/
function uiDrawAdv(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  ctx.fillStyle = 'rgba(8,12,24,0.65)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('advBack', 0, 0, cw, ch, closeAdv);   // 点卡片外的空白＝关闭
  const cardW = Math.min(cw * 0.64, ch * 1.9), cardH = ch * 0.92;
  const cardX = (cw - cardW) / 2, cardY = (ch - cardH) / 2;
  uiCard(cardX, cardY, cardW, cardH);
  addZone('advCard', cardX, cardY, cardW, cardH, null);   // 卡片本身挡住，别穿透到下层
  const pad = ch * 0.03;
  const stageMax = save.stageMax || 1;
  const prog = save.stageProg || {};
  let y = cardY + pad;
  // 标题行：左标题，右"已通关 N/总关数"
  const clearedN = STAGES.filter(s => (prog[s.id] || 0) > 0).length;
  dText('🗺️ 闯关冒险', cardX + pad, y + fs(0.05) * 0.6, fs(0.05), '#fff', 'left', true);
  dText('已通关 ' + clearedN + ' / ' + STAGES.length, cardX + cardW - pad, y + fs(0.05) * 0.6, fs(0.036), '#ffd34d', 'right', true);
  y += fs(0.05) + pad * 0.45;
  dText('一关一关打：跑到终点过关，不受伤+集够金币拿满三星（天赋装备照常生效）',
        cardX + pad, y + fs(0.026) * 0.7, fs(0.026), '#97a1b8', 'left');
  y += fs(0.026) * 1.5 + pad * 0.35;
  // 列表区（底部留给关闭按钮）
  const closeH = ch * 0.085;
  const closeY = cardY + cardH - pad - closeH;
  const listX = cardX + pad, listW = cardW - pad * 2;
  const listY = y, listH = closeY - pad * 0.5 - y;
  const clip = { x: listX, y: listY, w: listW, h: listH };
  const rowH = ch * 0.145;
  advViewH = listH;
  advContentH = STAGES.length * rowH;
  advScroll = clamp(advScroll, Math.min(0, listH - advContentH), 0);
  ctx.save();
  ctx.beginPath(); ctx.rect(listX, listY, listW, listH); ctx.clip();
  STAGES.forEach((s, i) => {
    const ry = listY + i * rowH + advScroll;
    if(ry + rowH < listY || ry > listY + listH) return;   // 滚出视野的行不画
    const unlocked = s.id <= stageMax;
    const stars = prog[s.id] || 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';   // 行间细分隔线
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(listX, ry + rowH); ctx.lineTo(listX + listW, ry + rowH); ctx.stroke();
    // 左：关卡序号图标框（已通关换金色底，未解锁灰底）
    const pvH = rowH * 0.6, pvY = ry + (rowH - pvH) / 2;
    ctx.fillStyle = !unlocked ? 'rgba(255,255,255,0.04)' : (stars > 0 ? 'rgba(255,211,77,0.14)' : 'rgba(255,255,255,0.07)');
    dRR(listX, pvY, pvH, pvH, rowH * 0.12); ctx.fill();
    dText(unlocked ? String(s.id) : '🔒', listX + pvH / 2, pvY + pvH / 2, fs(0.04), unlocked ? '#fff' : '#7a8398', 'center', true);
    // 中：关名 + 终点/目标 + 三星（★已得 / ☆未得）
    const tx2 = listX + pvH + ch * 0.024;
    dText(unlocked ? s.name : '？？？', tx2, ry + rowH * 0.26, fs(0.034), unlocked ? (stars > 0 ? '#ffd34d' : '#fff') : '#7a8398', 'left', true);
    dText('终点 ' + s.dist + 'm · 目标金币 ' + s.goalCoins, tx2, ry + rowH * 0.53, fs(0.026), '#97a1b8', 'left');
    let starStr = '';
    for(let d = 0; d < 3; d++) starStr += d < stars ? '★' : '☆';
    dText(starStr, tx2, ry + rowH * 0.79, fs(0.03), stars > 0 ? '#ffd34d' : '#5b6478', 'left');
    // 右：进入按钮（已解锁可点）/ 灰"未解锁"
    const btnW = listW * 0.26, btnH = rowH * 0.42, btnX = listX + listW - btnW, btnY = ry + (rowH - btnH) / 2;
    if(unlocked){
      uiBtn({ id: 'stageGo-' + s.id, x: btnX, y: btnY, w: btnW, h: btnH,
              label: stars > 0 ? '重玩' : '挑战', size: fs(0.03),
              bg: '#ffd34d', fg: '#4a3500', stroke: '#3a2a00', clip: clip,
              cb: () => startStage(s) });
    } else {
      uiBtn({ id: 'stageLock-' + s.id, x: btnX, y: btnY, w: btnW, h: btnH, label: '🔒 未解锁', size: fs(0.026),
              disabled: true, bold: false });
    }
  });
  ctx.restore();
  if(advContentH > listH){   // 细滚动条：提示下面还有
    const sbH = Math.max(listH * 0.08, listH * listH / advContentH);
    const sbY = listY + (-advScroll / (advContentH - listH)) * (listH - sbH);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    dRR(cardX + cardW - pad * 0.45, sbY, pad * 0.18, sbH, pad * 0.09); ctx.fill();
  }
  uiBtn({ id: 'advClose', x: listX, y: closeY, w: listW, h: closeH, label: '关 闭', size: fs(0.036),
          bg: 'rgba(255,255,255,0.14)', fg: '#fff', bold: false, cb: closeAdv });
  ctx.restore();
}

/* —— 死亡结算卡：内容来自 updateDeadCard，复活按钮的条件每帧现算（照抄网页版主循环） —— */
function uiDrawDead(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  ctx.fillStyle = 'rgba(8,12,24,0.55)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('deadBack', 0, 0, cw, ch, null);   // 整屏挡住：结算时点空白不应该触发跳跃
  // 先算复活按钮该不该出现（逻辑照抄网页版主循环里的 revFree/revCost）
  const revFree = !save.freeReviveUsed;
  const revCost = reviveCost();   // 【酷跑2】复活价含重生天赋折扣（与 revive() 收费口径一致）
  const adv = deadCard.adv;   // 【酷跑2】闯关结算：自成一套按钮（下一关/重玩/回主页），不摆复活/广告/礼包
  const showRev = endlessOnly() && (revFree || save.coins >= revCost);   // 【酷跑2】闯关失败不复活（重试整关）
  // 闯关下一关是否存在（通关 + 还有后续关 + 已解锁）
  const nextStage = (adv && deadCard.advWin && curStage) ? STAGES.find(s => s.id === curStage.id + 1) : null;
  const hasNext = !!(nextStage && nextStage.id <= (save.stageMax || 1));
  // 量一量卡片总高度，再居中摆
  const pad = ch * 0.028;
  const btnH = ch * 0.085, btnGap = ch * 0.013, homeH = ch * 0.06;
  const statH = deadCard.stats.length * ch * 0.042;
  const goalH = deadCard.goal ? ch * 0.075 : 0;
  const giftTease = !adv && giftState() !== 'done';        // 【留存包】④ 明天还有礼包可领：在分数下面预告一句（闯关不显示）
  const giftH = giftTease ? ch * 0.036 : 0;
  const adH = (adv || dailyMode) ? 0 : ch * 0.06 + btnGap;  // 【留存包】⑦ 广告复活占位按钮（日赛/闯关没有复活，不摆）
  const nBtn = adv ? (1 + (hasNext ? 1 : 0)) : (1 + (showRev ? 1 : 0) + 1);   // 非闯关：再来一局 + 复活? + 分享/复制(总有一个)
  const cardH = pad * 2 + ch * (0.06 + 0.042 + 0.095) + giftH + statH + goalH + nBtn * (btnH + btnGap) + adH + homeH;
  const cardW = Math.min(cw * 0.4, ch * 1.2);
  const cardX = (cw - cardW) / 2, cardY = Math.max(ch * 0.02, (ch - cardH) / 2);
  uiCard(cardX, cardY, cardW, cardH);
  const inX = cardX + pad, inW = cardW - pad * 2, cx = cardX + cardW / 2;
  let y = cardY + pad;
  dText(deadCard.title, cx, y + ch * 0.028, fs(0.05), '#fff', 'center', true);          y += ch * 0.06;
  if(deadCard.sub) dText(deadCard.sub, cx, y + ch * 0.018, fs(0.032), '#ffd34d', 'center', true);
  y += ch * 0.042;
  dText(deadCard.score, cx, y + ch * 0.045, fs(0.075), '#ffd34d', 'center', true);      y += ch * 0.095;
  if(giftTease){   // 【留存包】④ 给"明天再来"一个看得见的理由
    dText('明天来领 🎁200 金币', cx, y + ch * 0.012, fs(0.026), '#ffd9a0', 'center');
    y += ch * 0.036;
  }
  for(const s of deadCard.stats){
    dText(fitText(s, inW, fs(0.028)), cx, y + ch * 0.018, fs(0.028), '#aab6d0', 'center');
    y += ch * 0.042;
  }
  if(deadCard.goal){   // 下一个目标的进度条：金币攒到哪儿了
    const goal = deadCard.goal;
    const frac = clamp(save.coins / goal.price, 0, 1);
    const barH = ch * 0.02;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    dRR(inX, y, inW, barH, barH / 2); ctx.fill();
    if(frac > 0.01){
      ctx.fillStyle = frac >= 1 ? '#ffd34d' : '#7fb3ff';
      dRR(inX, y, inW * frac, barH, barH / 2); ctx.fill();
    }
    const gtxt = frac >= 1 ? '💰 金币够了！去商店把「' + goal.label + '」接回家'
                           : '下一个目标：' + goal.label + '　' + save.coins + ' / ' + goal.price;
    dText(fitText(gtxt, inW, fs(0.028)), cx, y + barH + ch * 0.022, fs(0.028), '#c5cede', 'center');
    y += goalH;
  }
  y += btnGap;
  if(adv){
    // 【酷跑2】闯关结算按钮：下一关(通关且有后续) → 重玩本关 → 回主页
    if(hasNext){
      uiBtn({ id: 'advNext', x: inX, y: y, w: inW, h: btnH, label: '➡️ 下一关：' + nextStage.name, size: fs(0.034),
              bg: '#ffd34d', fg: '#4a3500', cb(){ if(game.state !== 'dead') return; ensureAudio(); startStage(nextStage); } });
      y += btnH + btnGap;
    }
    // 重玩本关：adventureMode/curStage 仍在 → startGame 走闯关分支重置本关（复用 deadAgain id）
    uiBtn({ id: 'deadAgain', x: inX, y: y, w: inW, h: btnH, label: deadCard.advWin ? '🔁 重玩本关' : '🔁 再试一次', size: fs(0.036),
            bg: 'rgba(255,255,255,0.16)', fg: '#fff', cb(){ if(game.state !== 'dead') return; ensureAudio(); startLoading(() => startGame()); } });
    y += btnH + btnGap;
    uiBtn({ id: 'deadHome', x: inX, y: y, w: inW, h: homeH, label: '🏠 回主页', size: fs(0.03),
            bg: 'none', fg: '#97a1b8', bold: false, cb(){ if(game.state !== 'dead') return; goHome(); } });
    ctx.restore();
    return;
  }
  if(showRev){
    const nearTxt = (!game.newBest && game.startBest > 0 && game.score >= game.startBest * 0.85) ? '，冲纪录！' : '';
    const revTxt = revFree ? '🎁 新手专享：免费复活！' : '💰 花 ' + revCost + ' 金币复活' + nearTxt;
    uiBtn({ id: 'deadRevive', x: inX, y: y, w: inW, h: btnH, label: revTxt, size: fs(0.036),
            bg: '#ffd34d', fg: '#4a3500', cb(){ if(game.state !== 'dead') return; revive(); } });
    y += btnH + btnGap;
  }
  if(!dailyMode){   // 【留存包】⑦ 看广告免费复活：广告位还没申请下来，先灰着占位（adReady 永远 false → 不登记点击区）
    uiBtn({ id: 'deadAdRevive', x: inX, y: y, w: inW, h: ch * 0.06, label: '📺 看广告免费复活（即将开放）',
            size: fs(0.026), bold: false, disabled: !adReady(),
            cb: adReady() ? function(){ /* 以后在这里接 wx.createRewardedVideoAd(AD.rewardedId) */ } : null });
    y += ch * 0.06 + btnGap;
  }
  uiBtn({ id: 'deadAgain', x: inX, y: y, w: inW, h: btnH, label: '🔁 再来一局', size: fs(0.036),
          bg: 'rgba(255,255,255,0.16)', fg: '#fff', cb(){ if(game.state !== 'dead') return; ensureAudio(); startGame(); } });
  y += btnH + btnGap;
  if(dailyMode){   // 日赛专属：把战报发到群里，群友就是排行榜
    uiBtn({ id: 'deadCopy', x: inX, y: y, w: inW, h: btnH, label: uiCopyLabel, size: fs(0.036),
            bg: '#7df9ff', fg: '#04353a', cb: copyDaily });
    y += btnH + btnGap;
  } else {   // 【社交接通】无尽局：在破纪录/击败好友这个分享欲最高的瞬间，给一键发战书的承接按钮
    const beat = challenge && game.score > challenge.score;
    const shTxt = game.newBest ? '🆚 晒新纪录 · 发战书' : beat ? '🆚 反将一军 · 发战书' : '🆚 发战书给好友';
    uiBtn({ id: 'deadShare', x: inX, y: y, w: inW, h: btnH, label: shTxt, size: fs(0.036),
            bg: '#7df9ff', fg: '#04353a', cb(){ if(game.state !== 'dead') return; shareChallenge(); } });
    y += btnH + btnGap;
  }
  uiBtn({ id: 'deadHome', x: inX, y: y, w: inW, h: homeH, label: '🏠 回主页', size: fs(0.03),
          bg: 'none', fg: '#97a1b8', bold: false, cb(){ if(game.state !== 'dead') return; goHome(); } });
  ctx.restore();
}

/* —— 首次照片邀请："上传照片?"两按钮小卡片（替代网页版的 #avatarAsk 弹窗） —— */
function uiDrawAvatarAsk(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const fs = k => Math.max(9, Math.round(ch * k));
  ctx.fillStyle = 'rgba(8,12,24,0.7)';
  ctx.fillRect(0, 0, cw, ch);
  addZone('avatarBack', 0, 0, cw, ch, null);   // 全屏挡住，必须二选一
  const cardW = Math.min(cw * 0.38, ch * 1.15), cardH = ch * 0.5;
  const cardX = (cw - cardW) / 2, cardY = (ch - cardH) / 2;
  uiCard(cardX, cardY, cardW, cardH);
  const pad = ch * 0.028, cx = cardX + cardW / 2;
  let y = cardY + pad;
  dText('📸 把主角换成你！', cx, y + ch * 0.026, fs(0.044), '#fff', 'center', true);   y += ch * 0.07;
  dText(fitText('刚才那个阵亡表情，换成你自己的脸更搞笑——', cardW - pad * 2, fs(0.03)), cx, y, fs(0.03), '#aab6d0', 'center');
  y += ch * 0.046;
  dText(fitText('上传照片，撞墙 / 吃道具 / 阵亡都有你的专属表情包', cardW - pad * 2, fs(0.03)), cx, y, fs(0.03), '#aab6d0', 'center');
  y += ch * 0.062;
  const closeAsk = () => {   // 关掉弹窗后若约好了"传完就开局"，立刻开跑
    uiAvatarAsk = false;
    if(startAfterAvatar){ startAfterAvatar = false; startGame(); }
  };
  uiBtn({ id: 'avatarAskUp', x: cardX + pad, y: y, w: cardW - pad * 2, h: ch * 0.095,
    label: '📷 上传照片（推荐）', size: fs(0.038), bg: '#ffd34d', fg: '#4a3500',
    cb: () => chooseAvatar(closeAsk) });
  y += ch * 0.108;
  uiBtn({ id: 'avatarAskSkip', x: cardX + pad, y: y, w: cardW - pad * 2, h: ch * 0.078,
    label: '稍后再说', size: fs(0.032), bg: 'rgba(255,255,255,0.12)', fg: '#97a1b8', bold: false,
    cb(){ save.skippedAvatar = true; saveSave(); closeAsk(); } });
  ctx.restore();
}

/* —— 游戏中的悬浮按钮：右上角 暂停 / 静音 ——
   【小游戏改造】画布画不了 SVG，图标直接用矩形和三角形拼（喇叭也是手画的） */
function uiDrawGameBtns(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const s = ch * 0.088, m = ch * 0.028, gap = ch * 0.018;
  // 【小游戏改造】微信的"···◎"胶囊永远压在右上角，咱们的按钮摆到它正下方
  let yB = m, xEdge = cw - m;
  if(CAPSULE && CAPSULE.bottom){
    yB = CAPSULE.bottom * DPR + ch * 0.02;
    xEdge = CAPSULE.right * DPR;
  } else if(SAFE.r > 0){
    xEdge = cw - SAFE.r - m;
  }
  const xMute = xEdge - s, xPause = xMute - gap - s;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  dRR(xPause, yB, s, s, s * 0.22); ctx.fill();
  dRR(xMute,  yB, s, s, s * 0.22); ctx.fill();
  ctx.fillStyle = '#fff';
  if(UI.pauseIcon === 'pause'){            // ⏸：两根白条
    ctx.fillRect(xPause + s * 0.30, yB + s * 0.27, s * 0.14, s * 0.46);
    ctx.fillRect(xPause + s * 0.56, yB + s * 0.27, s * 0.14, s * 0.46);
  } else {                                 // ▶：一个白三角
    ctx.beginPath();
    ctx.moveTo(xPause + s * 0.36, yB + s * 0.26);
    ctx.lineTo(xPause + s * 0.36, yB + s * 0.74);
    ctx.lineTo(xPause + s * 0.76, yB + s * 0.50);
    ctx.closePath(); ctx.fill();
  }
  // 小喇叭：方箱 + 喇叭口
  ctx.fillRect(xMute + s * 0.18, yB + s * 0.38, s * 0.14, s * 0.24);
  ctx.beginPath();
  ctx.moveTo(xMute + s * 0.32, yB + s * 0.50);
  ctx.lineTo(xMute + s * 0.50, yB + s * 0.26);
  ctx.lineTo(xMute + s * 0.50, yB + s * 0.74);
  ctx.closePath(); ctx.fill();
  ctx.lineWidth = Math.max(2, s * 0.06);
  if(muted){                               // 静音：喇叭旁画一个 ×
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(xMute + s * 0.58, yB + s * 0.38); ctx.lineTo(xMute + s * 0.80, yB + s * 0.62);
    ctx.moveTo(xMute + s * 0.80, yB + s * 0.38); ctx.lineTo(xMute + s * 0.58, yB + s * 0.62);
    ctx.stroke();
  } else {                                 // 有声：两道声波弧线
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(xMute + s * 0.52, yB + s * 0.50, s * 0.14, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(xMute + s * 0.52, yB + s * 0.50, s * 0.26, -0.9, 0.9); ctx.stroke();
  }
  addZone('btnPause', xPause, yB, s, s, pausePressed);
  addZone('btnMute',  xMute,  yB, s, s, toggleMute);
  ctx.restore();
  drawSlideBtn();   // 【酷跑1】右下角"⬇ 滑"圆钮（和暂停/静音同风格，放右下角让新手一眼看到）
}
// 【酷跑1】右下角核心操作钮：上=跳、下=滑。做大 + 半透明（不挡视野），新手一眼就能上手。
//   跳钮在 touchStart 里"按下即触发"（和点屏幕一样支持长按跳更高）；滑钮抬手触发 startSlide。
function actionBtn(cx, cy, r, icon, label, active, rgb){
  ctx.fillStyle = active ? 'rgba(' + rgb + ',0.42)' : 'rgba(255,255,255,0.13)';   // 半透明底，不挡视野
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = active ? 'rgba(' + rgb + ',0.95)' : 'rgba(255,255,255,0.38)';
  ctx.lineWidth = Math.max(2, r * 0.07);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  ctx.fillStyle = active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.5)';    // 文字半透明
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold ' + (r * 0.62) + 'px ' + FONT;
  ctx.fillText(icon, cx, cy - r * 0.2);
  ctx.font = 'bold ' + (r * 0.42) + 'px ' + FONT;
  ctx.fillText(label, cx, cy + r * 0.36);
}
function drawSlideBtn(){
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cw = canvas.width, ch = canvas.height;
  const r = ch * 0.094, m = ch * 0.03;          // 比原来(0.072)更大
  let cx = cw - m - r, cy = ch - m - r;          // 滑钮圆心：贴右下角
  if(SAFE.r > 0) cx -= SAFE.r;                    // 躲开右侧安全区（刘海屏横向）
  const jcy = cy - 2 * r - ch * 0.022;           // 跳钮在滑钮正上方
  actionBtn(cx, jcy, r, '⬆', '跳', jumpHeld === 'pointer', '90,200,255');
  addZone('btnJump', cx - r, jcy - r, r * 2, r * 2, () => {});   // 跳跃在 touchStart 里按下即触发
  actionBtn(cx, cy, r, '⬇', '滑', player.sliding, '142,230,255');
  addZone('btnSlide', cx - r, cy - r, r * 2, r * 2, () => startSlide());
  ctx.restore();
}

/* —— UI 入口：触摸分发 + 各界面的画法 —— */
const uiTouch = { on: false, x: 0, y: 0, moved: 0, pendId: null, startY: 0, slideFired: false };   // 当前手指位置 + 累计位移 + 待触发按钮 +【酷跑1】手势起点Y/本次手势是否已触发下滑
const UI = {
  pauseIcon: 'pause',
  loadTip: '',
  zones: [],   // 本帧登记的所有"可点区域"，每帧由各 draw 函数重建
  touchStart(x, y){   // x/y 是设备像素坐标
    ensureAudio();
    uiTouch.on = true; uiTouch.x = x; uiTouch.y = y;
    uiTouch.moved = 0; uiTouch.pendId = null;
    uiTouch.startY = y; uiTouch.slideFired = false;   // 【酷跑1】记下手势起点，给"向下滑触发下滑"用
    // 命中测试：后画的盖在上层，所以从数组末尾往前找
    for(let i = UI.zones.length - 1; i >= 0; i--){
      const z = UI.zones[i];
      if(x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h){
        // 跳钮特殊：按下即起跳（和点屏幕一样，支持长按跳更高），抬手在 touchEnd 里松开
        if(z.id === 'btnJump'){ uiTouch.jumpBtn = true; pressJump('pointer'); return; }
        // 【小游戏改造】其它按钮"抬起时才触发"（和网页版 click 一致）：
        // 想滚商店货架的手指就算落在按钮上，拖走也不会误买
        uiTouch.pendId = z.cb ? z.id : null;
        return;   // 点在界面上（哪怕是卡片空白处）就不再当游戏操作
      }
    }
    pressJump('pointer');   // 谁都没点中：这一下是游戏操作（跳跃/暂停恢复）
    if(game.state === 'playing' || homeOpen()) startBGM();   // 【主页音乐】大厅也有 BGM
  },
  touchMove(x, y){   // 手指拖动：目前只有商店货架需要滚 +【酷跑1】游戏中向下滑＝下滑躲避
    uiTouch.moved += Math.abs(x - uiTouch.x) + Math.abs(y - uiTouch.y);
    if(uiTouch.moved > canvas.height * 0.03) uiTouch.pendId = null;   // 拖远了＝滚动手势，取消待点按钮
    // 【酷跑1】游戏进行中（没开任何界面），手指相对起点向下滑超过阈值 → 触发下滑。一次手势只触发一次，避免连发。
    if(uiTouch.on && !uiTouch.slideFired && game.state === 'playing' && uiScreen === 'none' && !paused && !loadingStart &&
       (y - uiTouch.startY) > canvas.height * 0.06){
      uiTouch.slideFired = true; uiTouch.pendId = null;   // 判定为下滑手势：取消"抬手点击"，免得误触按钮
      startSlide();
    }
    if(uiTouch.on && shopOpen()){
      shopScroll = clamp(shopScroll + (y - uiTouch.y), Math.min(0, shopViewH - shopContentH), 0);
    }
    if(uiTouch.on && uiScreen === 'ach'){   // 【留存包】成就列表也能拖着滚（和商店货架同一套手感）
      achScroll = clamp(achScroll + (y - uiTouch.y), Math.min(0, achViewH - achContentH), 0);
    }
    if(uiTouch.on && uiScreen === 'talent'){   // 【酷跑2】天赋列表同样可拖动滚动
      talentScroll = clamp(talentScroll + (y - uiTouch.y), Math.min(0, talentViewH - talentContentH), 0);
    }
    if(uiTouch.on && uiScreen === 'adventure'){   // 【酷跑2】闯关选关列表可拖动滚动
      advScroll = clamp(advScroll + (y - uiTouch.y), Math.min(0, advViewH - advContentH), 0);
    }
    uiTouch.x = x; uiTouch.y = y;
  },
  touchEnd(){
    uiTouch.on = false;
    if(uiTouch.jumpBtn){ uiTouch.jumpBtn = false; releaseJump('pointer'); return; }   // 跳钮抬手：松开（长按越久跳越高）
    const pid = uiTouch.pendId; uiTouch.pendId = null;
    if(pid){
      // 抬起时手指还停在同一个按钮上才算点击（按钮每帧重画，按 id 找它现在的位置）
      for(let i = UI.zones.length - 1; i >= 0; i--){
        const z = UI.zones[i];
        if(z.id === pid && z.cb &&
           uiTouch.x >= z.x && uiTouch.x <= z.x + z.w && uiTouch.y >= z.y && uiTouch.y <= z.y + z.h){
          z.cb();
          UI.zones.length = 0;   // 一次手势只触发一个按钮，下一帧按新界面重建（防同帧连点两个）
          break;
        }
      }
    } else {
      releaseJump('pointer');
    }
    ensureAudio();
    if(game.state === 'playing' || homeOpen()) startBGM();   // 【主页音乐】大厅也有 BGM
  },
  tap(id){   // 测试台用：按 id 直接触发某个按钮
    for(let i = UI.zones.length - 1; i >= 0; i--){
      const z = UI.zones[i];
      if(z.id === id && z.cb){ z.cb(); return true; }
    }
    return false;
  },
  drawHome: uiDrawHome,
  drawShop: uiDrawShop,
  drawSign: uiDrawSign,
  drawRank: uiDrawRank,   // 【留存包】好友排行榜
  drawAch: uiDrawAch,     // 【留存包】成就页
  drawTalent: uiDrawTalent,   // 【酷跑2】天赋养成树
  drawAdv: uiDrawAdv,         // 【酷跑2】闯关选关页
  drawDead: uiDrawDead,
  drawAvatarAsk: uiDrawAvatarAsk,
  drawGameBtns: uiDrawGameBtns,
  drawPauseMenu: uiDrawPauseMenu,
};

/* —— 微信分享：转发卡片就是挑战书（替代网页版的 updateShareUrl 改地址栏） —— */
// 【小游戏改造】有人点了卡片进来，启动参数里的 c/n/s 会被开头的挑战书解析逻辑接住
try{
  wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });   // 同时开"发给好友"和"分享到朋友圈"
  wx.onShareAppMessage(function(){ return buildShare(); });            // 发给好友/群（统一走 buildShare）
  if(wx.onShareTimeline) wx.onShareTimeline(function(){               // 【社交接通】朋友圈广播：一对多裂变，拉新效率最高
    const s = buildShare();
    return { title: s.title, query: s.query };
  });
}catch(e){}
// 【小游戏改造】昵称键盘的"确认"回调：全局注册一次
try{
  if(wx.onKeyboardConfirm) wx.onKeyboardConfirm(function(res){
    save.nick = String((res && res.value) || '').slice(0, 12);
    saveSave();
  });
}catch(e){}

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
  if(!paused && performance.now() >= freezeUntil) update(dt);   // 【打击感】命中顿帧期间冻结世界，渲染照常（定格一下）
  clearDevice();   // 【小游戏改造】先刷全屏底色
  if(!homeOpen()) render();   // 【小游戏改造】主页时游戏世界整个被场景盖住，跳过白画的一帧
  UI.pauseIcon = paused ? 'play' : 'pause';   // 【小游戏改造】暂停图标的状态交给画布 UI
  UI.zones.length = 0;   // 【小游戏改造】每帧重建"可点区域"：界面画到哪，按钮登记到哪
  if(homeOpen()){ drawHomeScene(); blitHome(); UI.drawHome(); }   // 【小游戏改造】像素场景铺满屏，再画大厅按钮
  if(game.state === 'playing' && uiScreen === 'none' && !loadingStart){
    UI.drawGameBtns();   // 【小游戏改造】游戏中右上角的 暂停/静音 悬浮按钮
    if(paused && !resumeUntil) UI.drawPauseMenu();   // 暂停页：继续(点屏幕) + 回主页
  }
  // 死亡结算：死后 0.6 秒结算卡才浮上来，先看清自己怎么死的（复活按钮的条件在 drawDead 里现算）
  const showDead = game.state === 'dead' && bgTime - game.deadAt > 0.6 && !shopOpen();
  if(showDead) UI.drawDead();   // 【小游戏改造】原来是 DOM 卡片（#deadCard），现在直接画
  if(shopOpen()) UI.drawShop();   // 【小游戏改造】商店开着＝游戏已暂停；货架小动物每帧重画所以是活的
  if(signOpen()) UI.drawSign();   // 【小游戏改造】签到日历
  if(uiScreen === 'rank') UI.drawRank();   // 【留存包】好友排行榜（榜单内容由开放数据域画）
  if(uiScreen === 'ach') UI.drawAch();     // 【留存包】成就页
  if(uiScreen === 'talent') UI.drawTalent();   // 【酷跑2】天赋养成树
  if(uiScreen === 'adventure') UI.drawAdv();   // 【酷跑2】闯关选关页
  if(avatarAskOpen()) UI.drawAvatarAsk();   // 【小游戏改造】"把主角换成你"小卡片，画在最上层
  if(loadingStart){                       // 加载过场：合拢→开局→揭开→3·2·1
    drawLoading(); blitLoading();   // 【小游戏改造】
    UI.zones.length = 0;   // 【小游戏改造】过场期间屏蔽所有按钮，防止手快连点两次"开始"
    const lel = performance.now() - loadingStart;
    if(!loadingMidFired && lel >= LOAD_COVER){
      loadingMidFired = true;
      const cb = loadingCb; loadingCb = null;
      if(cb) cb();                         // 屏幕全黑的这一刻切到游戏
      paused = true;                       // 揭开期间数 3·2·1，倒数完才开跑
      resumeUntil = performance.now() + LOAD_REVEAL + 1500;
    }
    if(lel >= LOAD_COVER + LOAD_REVEAL + 120) loadingStart = 0;   // 【小游戏改造】过场结束（没有 DOM 要藏了）
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 【小游戏改造】把 UI 挂到小游戏的全局对象上：测试台可以按 id 触发按钮（GameGlobal.__UI.tap('homeStart')）
if(typeof GameGlobal !== 'undefined') GameGlobal.__UI = UI;
