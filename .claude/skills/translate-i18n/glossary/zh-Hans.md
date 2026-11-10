# Chinese (Simplified) translation glossary (zh-Hans)

Per-language term decisions for `zh-Hans`. Read alongside the common [glossary.md](../glossary.md) (how to use the
glossary and `terms/`, brand/proper nouns, register, general rules) and look terms up with
`pnpm run i18n terms zh-Hans <query>`. Add new decisions here, under the right heading.

### zh-Hans
- Register: use 您 for second person (the existing file is ~3:1 您 vs 你; it's the normal polite UI
  register, not stiff).
- **"Play" (the game action) → 开始游戏, never 播放.** 播放 means media playback (video/audio/replay)
  — wrong for the main PLAY button / playing a game. (Same trap for any "play": pick the game sense.)
- Map names kept in recognized English forms: Fastest, Hunters, Big Game Hunters, BGH (matches the
  in-game term export and Chinese community usage). Team sizes use the `1v1`/`2v2`/`3v3` format.
- In-file term renderings to match: queue→队列, matchmaking→匹配, map pool→地图池, veto→否决,
  ladder→天梯, ranked→排位.
- **news (posts) → 新闻** (home's legacy 最新消息 header kept as-is), **publish → 发布**,
  **scheduled publish → 定时发布** (status chip 已定时, "Scheduled for X" → 将于 X 发布),
  **draft → 草稿**, **cover image → 封面图片**. Use full-width punctuation（），：；and “”quotes;
  required-field validation follows the in-file 请输入… style.
- **Replay library terms:** replay→录像 (in-file), **playlist→播放列表**, **bookmark→书签**
  (添加书签/取消书签; Bookmarked nav→书签; distinct from maps' 收藏), **replay library→录像库**
  (also the "In library" state: 已在录像库), **spoiler-free→无剧透**. Specific played games use
  游戏 on game pages (matches 复制游戏链接).
- **Lobby terms:** lobby→房间 (in-file; never 大厅 for a joinable lobby), **bench (waiting
  members) → 替补席**, observer (spectator)→观战者 (an observer seat→观战位), host
  (person)→房主 (房主：X; the in-file hostLabel 主机 is legacy MT — prefer 房主 for people),
  slot rows use 开放/已关闭, legacy unit limit→旧版单位限制.
- **color override(s) → (颜色)替换**. On/Off mode options use 开启/关闭 (everywhere→全局开启).
  Color scheme→配色方案.
- **Recycle Bin → 回收站** (移至回收站). **resolve (game results) → 判定** (判定结果 button,
  判定游戏结果 dialog, 已手动判定 chip; Disputed chip → 有争议). **region (server region) → 地区**
  (matches 服务器地区), never 区域. Ladder points → 积分.
- **join code → 房间码** (never plain 代码 — that reads as source code; matches lobby→房间).
  **the app (desktop client) → 客户端** (在 ShieldBattery 客户端中打开 / 下载客户端).
- **Game defaults preset:** Recommended→**推荐**, Legacy→**经典** (matches 经典外交; the starting fog option
  was aligned to 经典 too, while the lobby unit limit keeps 旧版), preset→预设, Defaults
  page→**默认值**, starting fog→**初始迷雾**, drag pan→**中键平移** (in-file), Settings nav→**设置**; nav
  paths are quoted: “设置 › 输入”.
- **Chat commands:** whisper→私聊, /me action line→动作消息, aliases→别名, mute channel→**频道静音**, "only
  you" gutter→**仅您可见**, mention→提及 (level option 仅提及时通知).
- **Chat command vocabulary:** block→**屏蔽** (ban→封禁, kick→踢出, mute→静音), unblock→解除屏蔽,
  friend/friends list→好友 / 好友列表, friend request→好友请求, topic→**主题** (not 话题),
  division→**分级**, errors→"无法…：{{errorMessage}}", presence words active/idle/offline→**活跃 /
  空闲 / 离线** (空闲 matches the 空闲用户 header). **mention→提及 everywhere**, including the
  message menu item (the old 提到 was fixed).
- **Outcome lines** (`/flip`, `/roll`, `/8ball`, `/quote`) render after a bare username, so each is
  a subject-less verb phrase: 抛了一枚硬币：…, 掷出了 …, 问神奇8号球“…”, 引用了 <unit> 的台词“…”.
  8-ball→**神奇8号球**; heads/tails→**正面 / 反面**; answers are the 20 classic ones in oracle voice
  (no 您/你), 2–7 characters for the nowrap chip (e.g. 希望渺茫 for "Very doubtful", not 非常可疑).
- **Unit names come from the SC:R export, not community slang:** Marine→**陆战队员** (not 机枪兵),
  Wraith→**怨灵战机**, Valkyrie→**瓦格雷战机**, Dropship→**运输船**; SCV stays SCV. Brood War on its
  own→**《母巢之战》**.
- **Lobby room:** unit limit→**单位限制** (扩展 / 旧版); "Teams" stat→**队伍**; named team heading
  `{{number}}队 · {{name}}` (matches `game.teamName.number`); hold (a button)→**长按** (长按强制开始);
  the tiny series chip stays **G{{number}}** (fixed 24px column; 第N局 overflows — the long form
  keeps 第 {{number}} 局); the arrival card's observer seat line is **入座观战位**, parallel to
  入座 {{seat}}. Key names: 空格键 / 方向键 / Esc.
- **"Slots" (`lobbies.summary.slotsLabel`) → 座位**, not 空位: the label is shared by the room banner
  (total seats) and the lobby summary (open seats), so it stays neutral and the value carries any
  "open" qualifier.
- **Top vs Bottom team names → 上方队 / 下方队** (the old 主队 / 客队 read as home/away). They carry
  队 themselves because `getTeamNames` returns finished labels alongside `1队`/`2队`.
- **reply (message)→回复** (回复 / 正在回复 X / 取消回复), distinct from 私聊. **User card:** Profile
  button→**资料**, Unranked→**未定级**, `{{count}} 场 · {{wins}}–{{losses}}`.
- **Availability (user status):** Online/Away/Do not disturb→**在线 / 离开 / 请勿打扰** (picker
  label 在线状态). Name-change token→改名道具 (in-file); display name→显示名.
- **Private channels:** private channel→**私人频道** (in-file), invite link→**邀请链接**, channel
  owner→**频道所有者** (in-file), channel moderator→**频道版主** (版主 in-file), member→**成员**.
  Register: the file is dominantly 您 (≈196 vs 29 你) — use 您. Chat display modes
  Classic/Cozy→**经典 / 舒适**.
- **Rollback netcode:** rollback→**回滚** (回滚平衡, FGC usage); trade-off scale ends use "~优先"
  (流畅优先 / 响应优先); value marker Recommended→**推荐**.
- **/quote unit lines use the SC:R Simplified Chinese dub** (the game's `zhCN` speech, transcribed
  from the game files; 你, not 您). Whisper's homophone slips were resolved by meaning where the
  readings sound alike (交火 not 焦火, 借火 not 戒火, 杀虫剂, 已指定). The dub keeps Khalani spoken as
  Khalani (En taro Adun！, not 阿顿在上), says Aiur as **艾尔**, and keeps radio jargon in English
  (请讲，TacCom。 / 人皆有一死，Red。). **Chat transcript→聊天记录**, scope tags **（全体）/
  （队伍）**; review (disputed game)→**复核** (请求复核 / 驳回请求). Map queue→**地图队列**, Up
  next→**接下来**, Then→然后; lock alliances→**锁定同盟**. YouTube "Play" is media playback, so
  播放 is correct there.
- **Post-game commends** (Dota 2 terms): commend→**赞扬** (N 次赞扬, 赞扬：N), report→**举报**.
  The gameReport strings were moved from 你 to 您 to match the file.
- **Event mode→赛事模式**; banner value On→**开启**, Advanced (form section)→**高级**, game
  bugs→**bug** (in-file 反馈 bug). StarCraft: Remastered in running text→《星际争霸：重制版》 (the
  export form).
- **Explainer articles** (`matchmaking.explainer.*`, `ladder.explainer.*`):
  placement games→**定级赛** (in-file), bonus pool→**加分池** (matches the 加分 label),
  catch-up bonus→**追分奖励**, uncertainty→**不确定度**, a matchmade match→**对局**. Put full-width
  punctuation **outside** bold (`**…玩家**。`): `**…。**` only parses when a space follows, which
  shows as a gap. The example players (Arbiter, Reaver, …) stay in English.
- **In-game UI (`game.json`, observer/replay HUD + tier-2 dialogs):** observer (spectator)→观战者
  (the chat chip 观战), replay→录像 / live→**直播**, spoiler-free→无剧透, matchup→对阵,
  expansion (a new base)→**分矿** (the community word), workers→**农民**, idle→空闲,
  army→兵力 (the Military panel itself 军事), kills→消灭 (杀/损 in the cramped k/l columns),
  production→**生产** (the SC:R export's 产量 is the score category, not a build queue),
  drop (removing a stuck peer)→**踢出**, an unclean netstat departure→掉线 vs a deliberate
  one→已离开, relay→中继, a network turn→回合. Race chips are one character from the SC:R
  export: **人 / 虫 / 星 / 随**. Dock preset names must differ in their *first* character — the
  collapsed dock shows only that one (精简 / 标准 / 分析).
- **Observer team cards / graphs:** the resource columns are a parallel two-character set
  **晶矿 / 瓦斯 / 补给** (补给 matches `seriesSupply`), control groups→**编队**, grouped graph
  titles→**各队{{series}} / 各玩家{{series}}**, team name→**{{number}}队** (matches
  `game.teamName.number`).
- **Game menu / disconnect dialog (`game.json`):** the menu's buttons are 返回游戏 / 设置
  (Options) / 同盟 + 发送消息 (two half-width plates, each opening SC:R's own dialog) / 离开游戏 (a
  player holds it: 长按离开游戏). Victory/defeat card: 胜利 / 失败, 生产单位 / 消灭单位 / 损失单位 /
  采集晶矿 / 采集瓦斯 / 平均 APM, 继续游戏. Vision→视野, frame pacing→帧节奏控制, desync→不同步. Abandoning from the disconnect notice is **放弃游戏**,
  kept apart from the menu's 离开游戏, and the hold plate uses the in-file 长按: 长按放弃游戏.
  Roster state column: 已连接 / 无响应 / 正在重连… {{time}} / 已请求踢出 — English set these
  lowercase, which Chinese does not mirror. teammate→**队友**.
- **SD / HD graphics → 旧版图像 / 高清版图像** (the Video settings' in-file pair; "switch to HD"→切换到高清版).
  The leaderboard self chip "You"→**我** (a label on your own row, not an address, so no 您).
- **Licenses page:** open source→**开源**, license→**许可证**, license notices→许可证声明, release build→**正式版构建**, software package→软件包. Support (heart button, donations)→**赞助**.
- **Discord activity → 活动** (Discord's own 活动状态), Ranked {{mode}}→**{{mode}}排位** (matches
  `game.gameSource.ranked`). Discord's desktop app is **Discord 应用**; 客户端 stays reserved for the
  ShieldBattery app. Browsers report `zh-CN`, which the language detector doesn't map to zh-Hans yet; test with a `zh-Hans` locale.
- **Platform rules (`rules.*`):** barcode (an unreadable `IIllIlI`-style name)→**条形码**, a player’s name→**名字**.
- **Account emails (`--ns email`) and recovery forms:** login name→**登录名**, display name→**显示名**, username→**用户名**, account→**账号** (the app's dominant form over 账户), reset code→**重置码**. 您 throughout, with a space between Chinese and Latin text or placeholders. The sign-off "gl hf gogogo" stays as it is.
- **Map browser (`maps.*`):** delist→**下架**, a map (what players pick)→**地图**, a file (one upload of it)→**文件**, the Default file→**默认文件** (chip 默认); never 版本组 / 版本 for these, report to staff→**报告**, Melee lens→对战 (in-file game type), UMS kept, tileset→地形类型 (in-file), Your maps→“我的地图”, On this PC→**此电脑**, staff→工作人员, map counter→张.
