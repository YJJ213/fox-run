/* ============================================================
   狐狸快跑呀 · 好友排行榜（微信开放数据域）【留存包】
   ------------------------------------------------------------
   这是一个"隔离沙箱"：按微信的隐私规则，好友的昵称/头像/云存档
   只有这里能拿到，主域（game.js）连看都看不到。
   双方的分工：
     主域  → 玩出新纪录时 wx.setUserCloudStorage 存一条 score；
             打开榜单时 postMessage({cmd:'rank'}) 喊我们干活，
             然后把我们画好的 sharedCanvas 整张贴进它的面板。
     这里  → 收到 'rank' 就拉好友分数 → 排序取前 10 → 画到 sharedCanvas。
   ============================================================ */
const sharedCanvas = wx.getSharedCanvas();   // 主域和我们共用的那张画布（主域只能"看"，我们只能"画"）
const ctx = sharedCanvas.getContext('2d');

let list = [];    // 排好序的前 10 名：[{ nick, score, avatarUrl, img, isMe }]
let me = null;    // 自己的资料（用来把"我"那行画成金色）

// 圆角矩形小工具（开放数据域也可能跑在不认 roundRect 的老机型上，保险起见自己画）
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

// 认出"我自己"：getFriendCloudStorage 的名单里也包含本人，
// 先问微信要自己的昵称+头像，名单里对得上的那行就是我
function isMe(row){ return !!(me && row.nick === me.nickName && row.avatarUrl === me.avatarUrl); }
try{
  wx.getUserInfo({
    openIdList: ['selfOpenId'],
    success(res){
      me = (res.data && res.data[0]) || null;
      for(const row of list) row.isMe = isMe(row);
      draw();
    },
  });
}catch(e){}

// 主域每次打开榜单都会喊一声 cmd:'rank'——重新拉一次最新数据
wx.onMessage(function(msg){
  if(msg && msg.cmd === 'rank') refresh();
});

function refresh(){
  try{
    wx.getFriendCloudStorage({
      keyList: ['score'],   // 只关心主域存的那条最高分
      success(res){
        const rows = [];
        for(const u of (res.data || [])){
          let sc = 0;
          for(const kv of (u.KVDataList || [])) if(kv.key === 'score') sc = parseInt(kv.value) || 0;
          if(sc > 0) rows.push({ nick: u.nickname || '神秘玩家', score: sc,
                                 avatarUrl: u.avatarUrl || '', img: null, isMe: false });
        }
        rows.sort(function(a, b){ return b.score - a.score; });   // 分高的在前
        list = rows.slice(0, 10);                                  // 只取前 10 名
        for(const row of list){
          row.isMe = isMe(row);
          if(row.avatarUrl){   // 头像是网络图，加载完成后重画一遍把它补上
            const img = wx.createImage();
            img.onload = function(){ row.img = img; draw(); };
            img.src = row.avatarUrl;
          }
        }
        draw();
      },
      fail(){ draw(); },
    });
  }catch(e){ draw(); }
}

function draw(){
  const w = sharedCanvas.width || 1, h = sharedCanvas.height || 1;
  ctx.clearRect(0, 0, w, h);
  // 深色面板底（和主域的弹窗卡片一个风格）
  ctx.fillStyle = '#181f30';
  rr(0, 0, w, h, h * 0.04); ctx.fill();
  ctx.textBaseline = 'middle';
  if(!list.length){   // 还没有好友数据：放一句邀请，别让页面空得尴尬
    ctx.fillStyle = '#97a1b8';
    ctx.font = Math.round(h * 0.06) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('邀请好友一起玩，这里就热闹了', w / 2, h / 2);
    return;
  }
  const rowH = h / 10;   // 固定 10 行的格子，人不满就空着
  list.forEach(function(row, i){
    const y = i * rowH, cy = y + rowH / 2;
    if(row.isMe){   // 自己那行：金色高亮底，一眼找到自己
      ctx.fillStyle = 'rgba(255,211,77,0.16)';
      rr(w * 0.015, y + rowH * 0.06, w * 0.97, rowH * 0.88, rowH * 0.2); ctx.fill();
    }
    const main = row.isMe ? '#ffd34d' : '#dfe6f5';
    // 名次：前三名给奖牌色（金/银/铜）
    ctx.textAlign = 'center';
    ctx.font = 'bold ' + Math.round(rowH * 0.42) + 'px sans-serif';
    ctx.fillStyle = i === 0 ? '#ffd34d' : i === 1 ? '#c9d4e8' : i === 2 ? '#e8a06a'
                  : (row.isMe ? '#ffd34d' : '#97a1b8');
    ctx.fillText(String(i + 1), w * 0.06, cy);
    // 头像：圆形裁剪（图还没到就先垫个深色圆）
    const r = rowH * 0.36, ax = w * 0.115;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax + r, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2a3450';
    ctx.fillRect(ax, cy - r, r * 2, r * 2);
    if(row.img){ try{ ctx.drawImage(row.img, ax, cy - r, r * 2, r * 2); }catch(e){} }
    ctx.restore();
    // 昵称（太长就截断加省略号）
    ctx.textAlign = 'left';
    ctx.font = Math.round(rowH * 0.38) + 'px sans-serif';
    ctx.fillStyle = main;
    let nick = row.nick;
    const maxW = w * 0.5;
    while(nick.length > 1 && ctx.measureText(nick + '…').width > maxW) nick = nick.slice(0, -1);
    if(nick !== row.nick) nick += '…';
    ctx.fillText(nick, ax + r * 2 + w * 0.02, cy);
    // 分数：右对齐
    ctx.textAlign = 'right';
    ctx.font = 'bold ' + Math.round(rowH * 0.42) + 'px sans-serif';
    ctx.fillStyle = main;
    ctx.fillText(String(row.score), w * 0.97, cy);
    // 行间分隔细线
    if(i < list.length - 1){
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w * 0.03, y + rowH); ctx.lineTo(w * 0.97, y + rowH); ctx.stroke();
    }
  });
}

draw();   // 一进来先画个底，免得主域贴过去是透明一片
