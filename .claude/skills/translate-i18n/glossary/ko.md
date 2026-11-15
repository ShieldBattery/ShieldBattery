# Korean translation glossary (ko)

Per-language term decisions for `ko`. Read alongside the common [glossary.md](../glossary.md) (how to use the
glossary and `terms/`, brand/proper nouns, register, general rules) and look terms up with
`pnpm run i18n terms ko <query>`. Add new decisions here, under the right heading.

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
- **Username (login, signup, account recovery) and login name → 아이디**, never 사용자 이름 or
  로그인 이름: players read 이름 as their real name and entered it. 아이디 ends in a vowel, so it
  takes 를/가/는/나. Strings about another player's displayed name (`common.loading.username`) stay
  사용자 이름.
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
- **User-action menu items put the object first:** **{{user}} 강퇴 / {{user}} 차단** (not 강퇴 {{user}}).
  kick→강퇴, lobby/channel ban→차단 (same word as block; in-file).
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
- **Availability (user status):** Online/Away/Do not disturb→**온라인 / 자리 비움 / 방해 금지**
  (picker label 상태); the set line hedges `<1>{{label}}</1>(으)로`. "Hosted by"→**호스트: <1></1>**.
- **Register cleanup (2026-09-16):** the old-MT 반말 / 해요체 leftovers across `auth.*`,
  `bugReport.*`, `leagues.*`, `ladder.*`, `settings.user.account.*` etc. were rewritten in 합니다체.
  Treat any …어/…야/…거야 or …어요/…에요 ending as a bug. Drop the subject rather than write 너/당신
  where a subject-less sentence works; "your machine"→사용자 컴퓨터; "ShieldBattery staff"→운영진.
- **Private channels:** private channel→**비공개 채널**, invite link→**초대 링크**, channel
  owner→**채널 소유자** (in-file), channel moderator→**채널 관리자** (matches the ban errors'
  관리자), member→**멤버**; join a channel→**참가** (not 가입). Chat display modes
  Classic/Cozy→**클래식 / 편안하게**.
- **Rollback netcode:** rollback→**롤백** (롤백 밸런스, FGC usage); trade-off scale ends use the
  "~ 우선" pattern (부드러움 우선 / 반응 속도 우선); value marker Recommended→**권장**.
- **/quote unit lines use the SC:R Korean dub** (음역 version: SCV / 고스트 / 레이스 / 배틀크루저,
  not 건설로봇 / 유령 / 망령 / 전투순양함), taken from the StarCraft (Brood War) 대사 tables on
  namu.wiki's unit pages, footnote markers dropped. The dub's text wins even where it departs from the
  English (Power overwhelming→압도적인 힘으로!, Achtung!→준비 완료.). A line our catalogue gives to a
  different unit than Brood War does uses that unit's dub (e.g. Khassar de templari is the High
  Templar's). Lines with no Brood War counterpart (Shuttle, some Vulture/Corsair/Carrier/Arbiter
  lines) are translated in character. **Chat transcript→채팅 기록**, scope tags **(전체) / (팀)**;
  review→**검토** (검토 요청 / 요청 기각). Map queue→**맵 대기열**, Up next→**다음 맵**,
  Then→그다음; lock alliances→**동맹 고정**.
- **Post-game commends** (Dota 2 terms): commend→**칭찬하기** / 칭찬 (칭찬 N회, 받은 칭찬),
  report→**신고하기**. Names take **님** ({{user}} 님을), which also sidesteps 을/를 agreement.
- **Event mode→이벤트 모드**; banner value On→**사용** (the On/Off convention), Advanced (form
  section)→**고급**, game bugs→**버그**. "(not recommended)"→(권장하지 않음), no space before it.
- **Explainer articles** (`matchmaking.explainer.*`, `ladder.explainer.*`): placement
  games→**배치전** (in-file), bonus pool→**보너스 풀**, catch-up bonus→**따라잡기 보너스**,
  uncertainty→**불확실성**, grinding→**노가다**; "you" in prose→**본인** (never 당신). Quoted player
  questions use plain 해라체 (…됐다. 왜?) so they don't break the 합니다체 rule. Bold must not end in
  punctuation right before a Korean letter (`**레이팅(MMR)**과` doesn't parse): bold the word, put
  the parenthetical after it. The example players (Arbiter, Reaver, …) stay in English.
- **In-game UI (`game.json`, observer/replay HUD + tier-2 dialogs):** observer (spectator)→관전자,
  replay→리플레이 / live→**라이브**, spoiler-free→스포일러 방지, matchup→종족전,
  expansion (a new base)→**멀티** (the community word), workers→일꾼, idle→**유휴**,
  army value→병력 가치, kills→처치 (킬 in the cramped k/l columns), map control→맵 장악,
  drop (removing a stuck peer)→**강퇴**, an unclean netstat departure→접속 끊김 vs a deliberate
  one→나감, relay→릴레이, a network turn→턴. Race chips are single syllables from the SC:R export:
  **테 / 저 / 프 / 무**. Dock preset names must differ in their *first* syllable — the collapsed
  dock shows only that character (최소 / 표준 / 분석).
- **Observer team cards / graphs:** minerals→미네랄, gas→가스, supply→**보급품** (matches
  `seriesSupply`; the community's 인구 was passed over to keep the file consistent), control
  groups→**부대 지정** (Blizzard's Korean name for the feature). Grouped graph titles are
  modifier-first: **팀별 {{series}} / 플레이어별 {{series}}** (player→플레이어, matching
  `netstat.columnPlayer`). Team name→**{{number}} 팀** (matches `game.teamName.number`).

- **Game menu / disconnect dialog (`game.json`):** the menu's buttons are 게임으로 돌아가기 /
  설정 (Options) / 동맹 + 메시지 (two half-width plates, each opening SC:R's own dialog) / 게임
  나가기 (a player holds it: 길게 눌러 게임 나가기). Victory/defeat card: 승리 / 패배, 생산한 유닛 /
  처치한 유닛 / 잃은 유닛 / 채취한 미네랄 / 채취한 가스 / 평균 APM, 계속 플레이. desync→디싱크. Abandoning from the disconnect notice is
  **게임 포기**, kept apart from the menu's 게임 나가기, and the hold plate follows the in-file
  길게 눌러 … pattern: 길게 눌러 게임 포기. Roster state column: 연결됨 / 응답 없음 /
  재연결 중… {{time}} / 강퇴 요청됨 — English set these lowercase, which Korean does not mirror.
  teammate→**팀원**.

- **Licenses page:** open source→**오픈 소스**, license→라이선스, license notices→라이선스 고지, release build→**릴리스 빌드**, fonts→글꼴. The lobby ready toggle (rail) keeps **준비 완료 / 준비 취소**; the heart Support button→**후원하기** (donations, not help).
- **Discord activity:** activity→활동, Ranked {{mode}}→**{{mode}} 래더** (matches
  `game.gameSource.ranked`), observing→관전 중. StarCraft in running text and the Battle.net page's
  section heading→스타크래프트 (the settings nav keeps its Latin "StarCraft").

