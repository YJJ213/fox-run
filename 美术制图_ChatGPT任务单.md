# 美术制图任务单（给 ChatGPT 生图用）

> 2026-07-14 出品。结论先说：**角色的"灵动"90% 靠代码动画，不靠图**——天天酷跑那种活蹦乱跳，
> 核心是"耳朵尾巴慢半拍地甩、落地压扁、越跑越前倾、会眨眼会咧嘴"这些程序动画，我已经排了
> 12 条代码改造在做。**千万别让 ChatGPT 画跑步动画序列帧**：AI 每张图的狐狸脸型比例都会漂，
> 8 帧拼起来是"8 只不同的狐狸在抽搐"，白费功夫。
>
> 真正值得生图的只有下面 4 张（图确实比代码画得好的地方）。每张的提示词直接整段复制给
> ChatGPT 即可，生成后把原图发我，裁剪、压缩、接进游戏都我来。

---

## ① 标题艺术字 Logo（最优先）

**用在哪**：主页大标题、结算页、分享卡。现在标题是普通字体打的字，立体卡通艺术字才有"正经游戏"的门面。

**提示词（复制整段）**：

```
Game logo art for a cute endless runner mobile game: the Chinese characters
「狐狸快跑」 rendered as chunky rounded 3D cartoon lettering with a playful
bounce arrangement, warm orange-to-cream gradient fill, thick white outer
stroke plus dark brown outline, one tiny fox paw print as a decorative accent,
in the style of Tencent casual mobile game logos, flat vector look, isolated
on a fully transparent background, PNG
```

**验收要点**：
- 四个字「狐狸快跑」一个都不能错、不能缺笔画——**AI 画中文很容易写错字，务必放大逐字检查**
- 背景必须透明（棋盘格），不是白底
- 如果反复生成中文都出错：退而求其次，让它只画装饰性的"FOX RUN!"英文+边框，中文我用代码描边字体叠上去

---

## ② 分享卡 / 加载页主视觉

**用在哪**：微信里分享给好友的卡片图（决定别人点不点开你的挑战链接）+ 游戏加载屏。这是拉新门面，图片必赢的阵地。

**提示词（复制整段）**：

```
Promotional key art for a cute mobile endless runner game: a kawaii chibi fox
with a round dumpling-shaped body, about 2.5 heads tall, orange fur, cream
belly, big glossy determined eyes, a red scarf streaming behind, sprinting to
the right with motion speed lines, gold coins and small stars scattered
mid-air, bright sunny meadow background with rolling green hills, flat vector
illustration style with soft gradients and bold dark outlines, vibrant warm
colors, keep the top-left quarter of the composition clean for a logo overlay,
5:4 aspect ratio
```

**验收要点**：
- 狐狸必须和游戏里同款配色：**橙毛 + 奶白肚子 + 红围巾**，不然分享图和进游戏"不是同一只狐狸"
- 多生成几张挑最顺眼的
- 左上角留白（放 Logo 用）

---

## ③ 小游戏平台图标

**用在哪**：微信小游戏的头像图标（后台强制要求上传位图）。

**提示词（复制整段）**：

```
App icon for a cute mobile runner game: close-up head-and-shoulders of a
kawaii chibi fox, orange fur, cream muzzle, big glossy cheerful eyes, warm
smile, red scarf knotted under the chin, character centered and filling the
frame, flat vector style with soft gradients and a bold dark outline, simple
warm radial gradient background, rounded-square app icon composition,
no text anywhere
```

**验收要点**：图标上**不要有任何文字**；狐狸头要大、居中、占满画面（缩到手机桌面那么小也看得清）。

---

## ④ 表情+动作设定参考图（不进游戏，给我当图纸）

**用在哪**：这张图不放进游戏——是**设计稿**。你用 ChatGPT 反复迭代"狐狸大笑/惨叫/得意/害怕长什么样、
待机时做什么小动作"，挑出你最喜欢的版本发我，我照着图纸用代码画进游戏。这才是零代码策划参与
角色设计的正确姿势（AI 出单张设定图很稳，出动画帧必崩）。

**提示词（复制整段）**：

```
Character expression and pose reference sheet for a game mascot: a kawaii
chibi fox with a round dumpling-shaped body, about 2.5 heads tall, orange fur,
cream belly, red scarf, arranged in a clean labeled grid on a plain white
background, showing 6 facial expressions (determined default, happy open-mouth
smile, comedic hurt with X eyes and wailing open mouth, smug proud grin with
closed eyes, scared with shrunken pupils and a sweat drop, focused squint)
and 4 idle poses (breathing stand, head tilt, ear flick, tiny foot stomp),
strictly consistent character design across every cell, flat vector style
with bold outlines
```

**验收要点**：格子里每只狐狸必须是同一只（配色、比例一致）；表情越夸张越好用。

---

## 体积账（我管，你不用操心）

微信包上限 4MB，现在整包约 306KB。进包的只有 ①Logo（≤80KB）和加载屏，②分享卡走接口不进包，
③图标传后台不进包，④设定图纯参考。总预算 ≤250KB，绰绰有余。

**刻意不列的**：手绘背景图——现在的昼夜循环+矢量远山和角色是一套风格，硬塞 AI 油画背景反而打架；
角色跑步/跳跃动画帧——前面说了，AI 做不了，代码做得更好。
