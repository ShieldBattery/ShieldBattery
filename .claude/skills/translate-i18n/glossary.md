# Translation glossary

Read this before translating any language. It's the single source of consistency across our ~1000
strings — the thing generic machine translation can't do.

## Term data (Blizzard-matched)

Authoritative term translations live in [terms/](./terms/), one file per language. **Most entries are
exported directly from the game's own translations**, so they match the strings StarCraft: Remastered
shows in-game. **Always consult the relevant `terms/<lang>.csv` before translating, and prefer its
`target` for any term it covers.** When the same English word appears more than once, use the `context`
column (e.g. `Race`, `Game type`, `Map tileset`) to pick the right sense. See
[terms/README.md](./terms/README.md) for the column layout and how to refresh the export from Weblate.

Look terms up with the helper instead of grepping the CSV by hand (it parses quoted fields correctly
and shows the disambiguating `context` column):

```bash
pnpm run i18n terms ko Observer    # → 옵저버 (unit) vs 관전자 (spectator), etc.
```

If `terms/<lang>.csv` is absent or the lookup returns nothing, the term isn't game-derived — fall back
to the rules below, web research, and your best judgment, and add the decision to the glossary so it
stays consistent.

## Brand & proper nouns (all languages)

- **ShieldBattery** — never translated, never transliterated. Always "ShieldBattery".
- **StarCraft**, **Brood War**, **Remastered** — use Blizzard's official localized form for the
  language if one exists (see `terms/`); otherwise keep the English name.
- Map names, unit names, race names (Terran/Protoss/Zerg) — follow Blizzard's official localization
  via `terms/`. These are exactly the terms the Weblate glossary export covers.
- Product/feature names that are ShieldBattery-specific (e.g. menu sections) — translate normally
  unless `terms/` says otherwise.

## Formality / register per language

Audience: a competitive StarCraft: Brood War community, roughly 20–50 years old. Voice is friendly and
direct, never corporate. Lean toward the more **casual, natural** side for each language — how a player
would actually talk — while staying clear and readable. Keep the register consistent within a language:

| Language | Register | Notes |
| --- | --- | --- |
| `es` (Spanish) | Informal **tú** | Gaming-community standard; avoid "usted". |
| `ru` (Russian) | Formal **Вы** | The existing file is consistently formal Вы (~58×); match it — Russian UIs commonly use Вы and it doesn't read as stiff. |
| `ko` (Korean) | Friendly polite **해요체** | Prefer the warmer 해요 over stiff 합니다/honorific-heavy phrasing; don't go full banmal in UI. |
| `zh-Hans` (Chinese, Simplified) | Conversational/standard | Natural Mainland phrasing; avoid overly formal wording. |

(These are sensible defaults — adjust if the user has a preference, and record it here.)

## General rules

- Translate **meaning, not words**. Idiomatic beats literal.
- Keep buttons/labels short — translations tend to run longer than English and overflow UI. When a
  string is a button or fixed-width label (check usage context), favor the shortest natural wording.
- Preserve `{{interpolations}}` and `<0>…</0>` Trans tags **exactly** (enforced by the apply step).
- Keep widely-understood gaming acronyms as-is unless `terms/` localizes them: **MMR**, **APM**,
  **FPS**, **UMS**. Spell out / localize others where natural.
- Match capitalization conventions of the target language, not English title case.

## Per-language term decisions

Beyond the Blizzard `terms/` data, record ad-hoc decisions here as you make them, so future runs stay
consistent. (Seed — extend over time.)

### es
- **Common action buttons:** Stop (playback)→**Detener**, Hide→**Ocultar**,
  Reveal (masked information)→**Mostrar**, Join (channel/league/lobby)→**Unirse**.
  Use infinitives for action labels, consistent with Aceptar, Guardar, and Cancelar.
- **Clear (action) → Borrar**, **Clear filters → Borrar filtros** for consistent filter and
  notification actions. "Claro" expresses clarity or agreement, not clearing. "Limpiar filtros"
  is also idiomatic; use "Borrar filtros" consistently in this UI. Reset→**Restablecer** for
  restoring settings or defaults.
- Register: informal **tú** (matches the existing file: Introduce, Selecciona, tu instalación).
- **news post → noticia** (Noticia creada, Crear noticia); required-field validation follows the
  in-file "Introduce …" imperative style. Statuses agree with feminine "noticia"
  (Publicada/Programada/Creada/Editada).
- **link → enlace** in new strings (dominant in-file: 5× enlace vs 2× link; matches
  "Copiar enlace a la liga").
- Team sizes use the **`1x1` / `2x2` / `3x3`** format (the `x` convention, per the term export).
- Map names kept in recognized English forms: **Fastest, Hunters, Big Game Hunters, BGH** (the export
  keeps "Fastest" English).
- In-file term renderings to match: matchmaking→Emparejamiento, map pool→Grupo de mapas, queue→cola,
  ladder→escalera, veto→vetar/vetado, ban→banear, kick→expulsar, unrated→Sin clasificar.
- **Replay library terms:** replay→replay (loanword, in-file), **playlist→playlist** (loanword,
  feminine: la playlist; Spotify-style), **bookmark/Bookmarked→marcador/Marcadores** (Añadir
  marcador/Quitar marcador; the replay bookmark — kept distinct from a map's favorite),
  **library→biblioteca**, game (a played match)→partida, **spoiler-free→Sin spoilers**.
- **Lobby terms:** lobby→lobby (loanword, masculine: el lobby, lleno), **bench (waiting members) →
  banquillo** (the sports substitutes' bench), observer (spectator)→observador,
  host (person)→anfitrión, slot→espacio ("Espacios libres"; slot rows use Abierto/Cerrado).
- **color override(s) → reemplazo (de colores)** (noun; verb reemplazar). On/Off mode options use
  Activado/Desactivado. Color scheme→esquema de colores.
- **video → video** (sin tilde, LatAm form; matches the in-file settings "Video" title).
- **Recycle Bin → Papelera de reciclaje** (the Windows name). **resolve (game results) →
  resolver**; Disputed status chip → En disputa; Manually resolved chip → Resolución manual
  (noun form dodges the juego/partida gender clash).
- **Home (nav) → Inicio** (fixed from old MT "Hogar"); social Chat tab label → **Chat** (noun, not
  "Charlar").
- **join code → código** (Introducir código / Introduce este código; no qualifier needed — context
  carries it). **the app (desktop client) → la app** (feminine: instalada). Buttons use the
  infinitive (Introducir código), inline prompts use tú imperative (Introduce este código).
- Old MT rendered slot as "ranura" in the lobby strings — fixed to **espacio** (Espacios,
  Abrir/Cerrar espacio). Watch for "ranura" resurfacing.
- **Game defaults preset (first-run dialog / Settings › Game › Defaults):** Recommended→**Recomendado**,
  Legacy→**Clásico** everywhere (starting fog option, unit limit, preset; the old MT "Legado" means a
  bequest and was replaced), preset→preajuste, Defaults page→**Predeterminados**, starting fog→**niebla inicial**, drag
  pan→**arrastre de cámara** (in-file), Settings nav→**Ajustes** (never "Configuración" in paths).
- **Chat commands:** whisper→susurro/susurrar, /me action line→acción, aliases→alias, channel/lobby/whisper
  surfaces→canales/lobbies/susurros; mute channel→**Silenciar canal**; "only you" gutter→**solo tú**.
- **Chat command lines:** `/help` descriptions are third-person present ("Bloquea a un usuario: …");
  result lines addressed to the invoker use tú preterite ("Bloqueaste a X."); errors keep the
  "No se pudo …: {{errorMessage}}" shape. online/offline→**conectado/desconectado** (never "en
  línea"); presence words active/idle/offline→**activo/ausente/desconectado**. friend
  request→solicitud de amistad, unfriend→quitar de tus amigos, unblock→desbloquear, unban→desbanear.
- **Server-settled outcome lines** (`/flip`, `/roll`, `/8ball`, `/quote`) render right after a bare
  username, so they are subject-less third-person verbs: "lanza una moneda: …", "saca {{value}}
  (1-{{max}})", "le pregunta a la bola 8 \"…\"", "cita a <unidad>: \"…\"" (no article — units are
  mixed gender). 8-ball→**bola 8**; heads/tails→**cara/cruz**; answers follow the classic Spanish
  toy wordings and stay short (uppercase nowrap chip).
- **Unit names come from the es term export** (`pnpm run i18n terms es <Unit>`): **VCE** for SCV,
  Médica, Zelot, Dragún, Portanaves, Ánima, … — don't keep the English names.
- **Key names in keyboard/screen-reader text:** Space→**la barra espaciadora** (never "Espacio",
  which is the slot noun), Escape→Escape, arrow keys→las flechas.
- **Lobby room:** unit limit→**Límite de unidades** (values Ampliado / Clásico); the "Teams" stat
  label→**Equipos**; computer player→computadora; "once it regroups"→"cuando todos vuelvan al
  lobby". Series: one game→**partida**, the tiny chip `G{{number}}`→**P{{number}}**, the in-progress
  chip→**En curso** (siblings Pendiente / Iniciando). The arrival card's seat line is third person
  and verb-initial like `seatedOn` "ocupa {{seat}}" → observer arrival = "ocupa un espacio de
  observador". Hold buttons spell out the verb: "Mantén pulsado para empezar". "ready reset"→"se
  reinició el estado de listo".
- **reply (message) → responder** ("Respondiendo a X" / "Dejar de responder"); distinct from `/r`,
  which answers a whisper.
- **User card:** "{{count}} partidas · {{wins}}–{{losses}}"; Unranked/Unrated→**Sin clasificar**
  everywhere (the old "Sin rango" was folded in); Profile button→**Perfil**; the profile stat label
  Record→**Victorias/derrotas** (not "Registro").
- **Plurals:** the `many` form takes **de** before the noun ("{{count}} de partidas"); when no noun
  follows the count, `many` equals `other` ("y {{count}} más").
- **Day divider (`messaging.newDayMessage`) is just the date** ("<2>{{day}}</2>"): it renders
  between two rules, so "Día cambiado a" was redundant. The channel-join divider is "Te uniste a
  <2><0></0></2>" (the old MT dropped the "a").

### ru
- Register: formal **Вы** (the existing file is consistently Вы; do not use ты here).
- **Plurals need all four CLDR forms — one/few/many/other.** The file historically had only
  one/few/many; the `other` form is the fraction case = the genitive-singular form (e.g. userCount
  `other` = `{{count}} участника`, same ending as `few`; maxLength `other` = `{{count}} символа`, same
  as `one`). Preserve existing one/few/many and add `other`.
- Type labels kept English (the export keeps `1v1 Fastest` fully Latin): **2v2 Fastest / BGH /
  Hunters**. Solo→Соло, Team→Команда in the descriptions.
- **news post → новость**; required-field validation follows the in-file "Введите …" imperative
  style. Quotes use **«»** (in-file precedent), ё is written out (ещё). "by <user>" attribution
  prefix → **"автор: "** (works for both created and edited history entries).
- In-file term renderings to match: matchmaking→матчмейкинг, map pool→Пул карт, queue→очередь,
  veto→Вето, ban→забанить, kick→кикнуть, unrated→Без рейтинга.
- **Replay library terms:** replay→реплей (in-file), **playlist→плейлист**,
  **bookmark/Bookmarked→закладки** family (В закладки/Убрать из закладок/Закладки; kept distinct
  from a map's favorite, which stays избранное), **library→библиотека**,
  **spoiler-free→Без спойлеров**.
- **Lobby terms:** lobby→лобби (indeclinable, neuter: лобби заполнено), **bench (waiting members)
  → скамейка** (на скамейке), observer (spectator)→зритель, host→хост, slot rows use
  Открыто/Закрыто, legacy unit limit→классический лимит.
- **color override(s) → замена (цветов)**. On/Off mode options use Включено/Выключено. Color
  scheme→цветовая схема.
- **Recycle Bin → корзина** (lowercase in menu phrases: Переместить в корзину). **resolve (game
  results) → разрешить спор** family (Disputed chip → Спорные результаты, Manually resolved →
  Решено вручную; the dialog "resolves the dispute", not the results).
- **join code → код лобби** (Введите код лобби; button "Ввести код"). Lobby slot noun stays
  **слот** in the lobby-slot strings (Открыть/Закрыть слот) — the Открыто/Закрыто rows are the
  slot *states*, not the noun.
- **Game defaults preset:** Recommended→**Рекомендуемый**, Legacy→**Классический**, preset→пресет (in
  quotes «» when interpolated), Defaults page→**По умолчанию**, starting fog→**начальный туман**, drag
  pan→**перетаскивание камеры** (in-file), Settings nav→**Настройки**.
- **Chat commands:** whisper (noun)→личное сообщение, the whisper chip label→**Личный чат**, /me action
  line→действие, aliases→псевдонимы, surfaces in prepositional case (в каналах / в лобби / в личных
  сообщениях); mute channel→**Отключить уведомления канала**, Muted→Уведомления отключены.
- **Mentions never decline.** A `<0><0></0></0>` / `<2><0></0></2>` mention renders a raw username,
  so keep it in the nominative or hang a governing noun in front that carries the case
  («Не удалось заблокировать пользователя <2><0></0></2>», «отправлен пользователю …»). The same
  trick fixes gender («Пользователь … Вас заблокировал» agrees with «пользователь»). Friend
  request→**запрос в друзья**. Presence words active/idle/offline→**активен / бездействует /
  офлайн**; list-header counts→**в сети / не в сети**.
- **Outcome lines** (`/flip`, `/roll`, `/8ball`, `/quote`) render after a bare username: third
  person singular **present** («бросает монету: …», «бросает кубик: …», «спрашивает у шара: «…»»,
  «цитирует <unit>: «…»»), never gendered past tense. Quoted speech inside uses «». 8-ball→
  **магический шар**; answers follow the established Russian set adjusted to Вы and shortened for
  the nowrap chip.
- **Unit names** use the SC:R export but **drop its guillemets** (Арбитр, Корсар, Голиаф, …) and
  write ё (Тёмный тамплиер, Огнемётчик).
- **Lobby room:** unit limit→**Лимит юнитов** (Расширенный / Классический); "Teams" stat→**Команды**;
  the tiny series chip `G{{number}}`→**№{{number}}** («И» reads as "and"); series status labels are
  nouns (Запуск / Ожидание / **В игре**), never a bare verb; game headlines put the winner in the
  nominative with a present verb («Игра N: побеждает {{player}} (…)»); the arrival card's observer
  seat line is «входит как зритель», parallel to «занимает {{seat}}». Key names: Пробел / стрелки /
  Esc.
- **reply (message):** Ответить / «Ответ пользователю <1>{{name}}</1>» / Отменить ответ.
- **User card:** Unranked→**Без рейтинга** (now also `matchmaking.division.unrated`), Profile
  button→**Профиль**, «{{count}} игра/игры/игр · {{wins}}–{{losses}}».
- **Plural `other` is the fraction case (genitive singular), not a copy of `few`** — for animate
  nouns they differ: `few` «{{count}} друзей» vs `other` «{{count}} друга».
- **Day divider carries no verb** («<2>{{day}}</2>»): the date starts with a numeral, so any verb
  would need an unguaranteeable gender agreement. Dialog titles avoid gendered participles about the
  reader («Бан в матчмейкинге», not «Забанен …»).
- **Tileset names** (`maps.tileset.*`) follow the export's `Map tileset` rows, capitalized as UI
  labels and with ё: Пустошь / Космос (Space platform) / Станция / Вулкан / Джунгли (Jungle world) /
  Пустыня / Лёд / Сумрак. They had been left in English.
- **Known debt:** ~40 older keys (`auth.*`, `landing.*`, `users.errors.friendsList.*`, …) write
  lowercase вы/ваш; sweep them to Вы as their own pass.

### ko
- **Register: use formal-polite 합니다/습니다체 for sentences.** The existing `ko/global.json` is
  overwhelmingly 합니다체 (~191 vs 3), which is the conventional, non-stiff register for Korean
  software UIs — consistency with the file wins over the "casual 해요체" default above. Keep the
  *casual/native feel* through community vocabulary, not through informal verb endings. (The old-MT
  반말/해요체 stragglers were swept to 합니다체 on 2026-09-16; see the register-cleanup bullet below.)
- Team sizes use the colon format: `1v1`→`1:1`, `2v2`→`2:2`, `3v3`→`3:3` (matches the in-game
  `1v1 Fastest`→`1:1 빨무`).
- **Fastest / Fastest Map → 빨무 / 빨무 맵** (community slang for money/fast maps; in `terms` as 빨무).
- **Hunters → 헌터** (the community drops the trailing 스 — 헌터스 is technically correct but reads as
  non-native; Koreans habitually drop the last syllable). **Big Game Hunters → 빅헌터** when spelled
  out; **BGH** kept as-is (the acronym) for short labels.
- **veto → 거부** (래더 "맵 거부"), **matchup → 종족전**, **ladder → 래더**, **queue → 대기열**,
  **map pool → 맵 풀**, **MMR → MMR** (kept).
- Rank → 순위; tier/grade → 등급 (both already used in-file).
- **news → 소식** (matches home's 최신 소식), **publish → 게시** (게시됨/지금 게시/게시 취소),
  **cover image → 대표 이미지** (Korean CMS convention), **draft → 초안**, **schedule(d) →
  예약(됨)**. Required-field validation follows the in-file "…을 입력하세요" style.
- **Replay library terms:** replay→리플레이 (in-file), **playlist→재생목록** (YouTube convention),
  **bookmark→북마크** (북마크 추가/북마크 해제; Bookmarked nav→북마크; distinct from maps' 즐겨찾기),
  **library→라이브러리** (Steam convention), **spoiler-free→스포일러 방지**.
- **Lobby terms:** lobby→로비, **bench (waiting members) → 벤치**, observer (spectator)→관전자
  (unit stays 옵저버 per terms), host→호스트, slot rows use 열림/닫힘, legacy unit limit→옛 유닛
  제한 (in-file useLegacyLimits).
- **color override(s) → (색상) 대체**. On/Off mode options use 사용/사용 안 함 phrasing. Color
  scheme→색상 구성 (with 내 for "your"). Rust (color)→러스트 (fashion-color loanword; never 녹색).
- **video (file/media) → 동영상** (uploads, inserts); the graphics settings tab stays 비디오.
- **Recycle Bin → 휴지통** (휴지통으로 이동, the Windows phrasing). **resolve (game results) →
  확정** (결과 확정 button/title, 수동 확정됨 chip); Disputed status chip → 결과 불일치 (the
  condition is conflicting reports, not a player-filed dispute). Ladder points → 점수 (matches
  랭크 점수 in-file).
- **join code → 참가 코드** (dialog title 참가 코드 입력; browser button just 코드 입력). **the
  app → 앱** (ShieldBattery 앱에서 열기).
- **Game defaults preset:** Recommended→**권장**, Legacy→**클래식** (matches 클래식 외교; the starting fog
  option was aligned to 클래식 too so the Defaults table reads consistently), preset→프리셋, Defaults page→**기본값**, starting fog→**초기 안개**, drag pan→**화면
  끌기** (in-file), Settings nav→**설정**. Particles with interpolated preset names use the (으)로 / 을(를)
  hedge since the value can be 권장 or 클래식.
- **Chat commands:** whisper→귓속말, /me action line→행동 메시지, aliases→별칭, mute channel→**채널 음소거**,
  "only you" gutter→**나만 보임**, mention→멘션.
- **Mentions take 님.** A `<0><0></0></0>` / `<2><0></0></2>` mention renders a bare username of
  unknown final consonant, so attach **님** right after the tag and let the particle ride on it
  (`<0><0></0></0>님은 이미 차단되어 있습니다.`). Plain styled slots (`<1>{{name}}</1>`) still need
  the (이)라는 / (으)로 hedge.
- **Action lines** (`chat.outcomes.*.line`) start with **님이** and finish the sentence: the renderer
  composes `* ` + username + space + string (`님이 동전을 던졌습니다: <1>{{result}}</1>`). Where
  English apposes a value (`rolls <1>42</1>`), restructure to `…했습니다: <chip>` rather than
  putting a particle on a number. Magic 8-ball→**매직 8볼** (8볼 in the line).
- **Presence words** active/idle/offline→**활동 중 / 자리 비움 / 오프라인**, identical on
  `chat.userList.*` and `chat.commands.whois.presence.*` (the old 실행 / 개발 환경 were dev-tool MT).
- **Chat command vocabulary:** block→차단 / unblock→차단 해제, friend request→친구 요청,
  topic→**주제**, division→**디비전**, moderator→관리자, Brood War→**브루드 워**. "any game you
  launch" (block scope)→**참가하는 모든 게임** — 직접 실행하는 게임 reads as "games you host" and is
  wrong.
- **Unit names** per the term export: 아비터 / 아콘 / 배틀크루저 / 캐리어 / 커세어 / 다크 템플러 /
  드라군 / 드롭십 / 파이어뱃 / 고스트 / 골리앗 / 마린 / 메딕 / SCV / 셔틀 / 시즈 탱크 / 하이 템플러 /
  발키리 / 벌쳐 / 레이스 / 질럿.
- **Lobby room:** slot in the *room* is **자리** (자리 바꾸기, {{number}}번 자리) while the
  browser/summary stat label stays 슬롯. Unit limit label **유닛 제한**, values **확장 / 옛 방식**
  (matches 옛 유닛 제한; not the preset's 클래식). "Teams" stat→**팀 구성**. Series chip
  `G{{number}}`→**{{number}}판**. Team headings `{{number}} 팀` (matches `game.teamName.number`).
  Arrival-card seat lines are full 합니다 sentences (`{{seat}}에 앉았습니다` / 관전자로
  참가했습니다) — move both together if one is ever shortened. Key names: 스페이스 / 방향키 / Esc.
- **reply (message):** 답장 / `<1>{{name}}</1>님에게 답장` / 답장 취소 (distinct from the /r whisper).
- **User card:** Unranked→**랭크 없음** (≠ 배치 전, which means "still in placements"),
  `{{count}}전 · {{wins}}–{{losses}}`, Profile button→**프로필**.
- **스타크래프트: 리마스터**, never 리마스터드.
- **Register cleanup (2026-09-16):** the old-MT 반말 / 해요체 leftovers across `auth.*`,
  `bugReport.*`, `leagues.*`, `ladder.*`, `settings.user.account.*` etc. were rewritten in 합니다체.
  Treat any …어/…야/…거야 or …어요/…에요 ending as a bug. Drop the subject rather than write 너/당신
  where a subject-less sentence works; "your machine"→사용자 컴퓨터; "ShieldBattery staff"→운영진.

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
- **Chat command vocabulary:** block→**屏蔽** (ban→封禁, mute→静音), unblock→解除屏蔽,
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
