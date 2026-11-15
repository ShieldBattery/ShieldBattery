# Russian translation glossary (ru)

Per-language term decisions for `ru`. Read alongside the common [glossary.md](../glossary.md) (how to use the
glossary and `terms/`, brand/proper nouns, register, general rules) and look terms up with
`pnpm run i18n terms ru <query>`. Add new decisions here, under the right heading.

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
  veto→Вето, ban→забанить, kick→кикнуть, unrated→Без рейтинга. Menu actions use the verb
  (**Кикнуть {{user}}**, Забанить {{user}}), never the bare noun "Кик"; lobby removal dialog titles
  are the nouns **Кик из лобби / Бан в лобби**.
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
- **Plural `other` is the fraction case (genitive singular).** For a bare noun it usually matches
  `few` (2 друга / 1,5 друга; `many` is 5 друзей); it can differ when an adjective agrees
  (2 открытых слота vs 1,5 открытого слота), so derive it rather than copying `few`.
- **Availability (user status):** Online/Away/Do not disturb→**В сети / Нет на месте / Не
  беспокоить** (the ICQ/Skype-era set; no gendered participles); picker label→Статус.
- **Game card results toggle→Показать итоги / Скрыть итоги** (both labels share one cell, and
  «результаты» crowded the header meta). User card emblem Unranked→**Без ранга** (60px box;
  «Без рейтинга» truncates there, elsewhere it stays). "Hosted by"→**Хост: <1></1>**.
- CLDR's `narrow` relative time for ru renders as «−6 л.» / «−30 мин» (no «назад»); this comes
  from `narrowDuration`, not the translation files.
- **Day divider carries no verb** («<2>{{day}}</2>»): the date starts with a numeral, so any verb
  would need an unguaranteeable gender agreement. Dialog titles avoid gendered participles about the
  reader («Бан в матчмейкинге», not «Забанен …»).
- **Tileset names** (`maps.tileset.*`) follow the export's `Map tileset` rows, capitalized as UI
  labels and with ё: Пустошь / Космос (Space platform) / Станция / Вулкан / Джунгли (Jungle world) /
  Пустыня / Лёд / Сумрак. They had been left in English.
- **Known debt:** ~40 older keys (`auth.*`, `landing.*`, `users.errors.friendsList.*`, …) write
  lowercase вы/ваш; sweep them to Вы as their own pass.
- **Private channels:** private channel→**приватный канал**, invite link→**ссылка-приглашение**
  (hyphenated compound, declines both halves: по ссылке-приглашению), channel owner→**владелец
  канала** (in-file), channel moderator→**модератор канала**, member (of a channel)→**участник**.
  Chat display modes Classic/Cozy→**Классический / Уютный**.
- **Rollback netcode:** rollback→**откат** (Баланс отката); scale ends Плавнее/Отзывчивее;
  value marker Recommended→**Рекомендуется** (matches "Авто (рекомендуется)").
- **/quote unit lines use the SC:R Russian dub** (the game's `ruRU` speech, transcribed from the
  game files), which freely localizes the jokes (He's dead, Jim→«Ну всё, выносите.», FDIC
  approved→«АБС в норме!»). Characters address the player as ты/кэп there. Khalani phrases stay
  transliterated (Эн таро Адун!, Адун Торидас, За Айур!). **Chat transcript→лог чата**, scope tags **(ВСЕМ) /
  (КОМАНДЕ)**; departure lines are verbless («<0>X</0>: выход из игры» / «обрыв соединения») to
  dodge gendered past tense. review→**проверка** (Запросить проверку). Map queue→**очередь карт**,
  Up next→Далее, Then→Затем; lock alliances→**Закрепить союзы**. Playlist names get a governing
  noun («в плейлист {{playlist}}», «из плейлиста {{playlist}}»).
- **Post-game commends** (Dota 2 terms): commend→**Похвалить** / похвала (Похвалы: N), report
  button→**Пожаловаться**. Names get a governing noun (похвалить игрока {{user}}; «Игрок <0>…</0>
  похвалил Вас»).
- **Event mode→Турнирный режим** (режим мероприятий is stiff, режим события is the wrong sense);
  banner value On→**Включён**, Advanced (form section)→**Дополнительно**, game bugs→**баги** (the
  bug-report strings use ошибка, which reads as "error" for in-game behavior).
- **Explainer articles** (`matchmaking.explainer.*`, `ladder.explainer.*`): the ladder is
  **ладдер** in running text, because the page title «Рейтинг» collides with рейтинг = MMR (the
  ladder article explains both). placement games→**калибровочные матчи** (in-file), bonus
  pool→**бонусный пул**, catch-up bonus→**догоняющий бонус**, uncertainty→**неопределённость**.
  The example players (Arbiter, Reaver, …) stay in English: they're names in an English image.
- **In-game UI (`game.json`, observer/replay HUD + tier-2 dialogs):** observer (spectator)→зритель,
  replay→реплей / the matchup-bar tag Реплей vs live→**В эфире**, spoiler-free→Без спойлеров,
  matchup→**Матчап**, expansion (a new base)→**Экспанд** (community term), idle workers→**спит/спят**
  (46 px chip; «без дела» elides), drop (the manual removal of a stuck peer)→**кик** family
  (Кикнуть / Кик через {{time}} / Кик запрошен), an unclean departure in the netstat
  table→**Обрыв** vs a deliberate one→Вышел, link up/down→Есть / Нет, relay→релей, buffer→буфер,
  a network turn→**ход**, stall→Ст60 / Всего. The disconnect row's peer state is
  **Подключается** (the noun Переподключение is 25 % too wide for the column); our own status line
  keeps Переподключение. The chat-scope chip is **Своим** (72 px; Союзники elides).
- **Observer team cards / graphs:** minerals column→**Мин**, gas→**Газ** (what players say; the
  export's «веспен» is the flavour name and the column is the generic one), supply→Припасы
  (matches `seriesSupply`), control groups→**Группы юнитов** — «Контрольные группы» lays out at
  ~135 px and the dock's label slot is 132 px, so it would elide. Grouped graph titles
  "{{series}} по командам" / "{{series}} по игрокам"; team name→**Команда {{number}}**.

- **Game menu / disconnect dialog (`game.json`):** the menu's buttons are Вернуться в игру /
  Настройки (Options) / Союзы + Сообщения (two half-width plates, each opening SC:R's own dialog) /
  Покинуть игру (a player holds it: «Удерживайте: покинуть игру»), inside a 344 px plate in tracked
  caps. Victory/defeat card: Победа / Поражение, Создано / Убито / Потеряно юнитов, Добыто
  минералов / газа, Средний APM, Продолжить игру. Long app chip labels are shortened in game
  where the row can't hold them (color overrides: Выключено / Только на миникарте / Везде;
  starting fog: Местность и ресурсы / Ресурсы; TR24: Добавить задержку TR24 Low). Abandoning from the disconnect notice is **бросить игру**, kept apart from the menu's
  Покинуть игру; its 300 px hold plate draws its label uncropped, so it is «Удерживайте: бросить
  игру». The roster's state column is 150 px and set lowercase like its siblings: на связи /
  не отвечает / подключается… {{time}} / кик запрошен. teammate→**союзник** (84 px tag).

- **Licenses page:** open source→**открытое ПО / с открытым исходным кодом**, license notices→уведомления о лицензиях, release build→**релизная сборка**. The lobby ready toggle (rail) keeps the header's **Готов / Отменить готовность**.
- **Discord activity:** activity→активность; the details line for an observer is «Зритель: {{mode}}»
  (dodges a verb against a nominative mode label), Ranked {{mode}}→Рейтинговый {{mode}}. preorder
  skin→**Предзаказ**. The Defaults page's link to the Battle.net page is **Страница Battle.net**:
  «Открыть страницу Battle.net» clips in its slot beside the note.

