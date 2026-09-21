# SSCAIT saved standings: inspected 2026-09-21

Source: user-supplied browser save of the
[SSCAIT scores page](https://sscaitournament.com/index.php?action=scores), named
`[SSCAIT] Student StarCraft AI Tournament & Ladder.html`. The file's local modified
time is 2026-09-21 11:27:52. This is an inspection/download date, not a verified
server-side standings timestamp. The saved page contains older game-result dates
(2024-01-06), while some bot rows have 2026 update dates. Treat the values below as
**the displayed saved snapshot**, not proof of live ladder activity or freshness.

Source SHA-256: `0b59f4cf6c8aaf13e08ba9e9f987901e70f2306da5c75d76a1c22ee36c6983f3`.

The populated bot table contains **292 entries: 114 enabled and 178 disabled**.
Its `SSCAIT Rank` and `ICCUP Formula` columns contain dashes. The ordering below is
computed from numeric **Elo Rating** among enabled entries, not the site's separate
rank column. The `Updated` values are copied from bot rows; they are not rating
measurement dates or source revision identifiers. Rows generally do not identify
an exact build. Win rate is explicitly labeled as the last 50 games.

## Leading enabled entries by displayed Elo

| Elo order | Entry        | Listed race | Elo  | Row updated         |
| --------- | ------------ | ----------- | ---- | ------------------- |
| 1         | Stardust     | Protoss     | 3445 | 2026-07-17 08:15:55 |
| 2         | BananaBrain  | Protoss     | 3240 | 2026-09-02 21:58:21 |
| 3         | PurpleWave   | Protoss     | 3135 | 2024-10-16 15:32:59 |
| 4         | Monster      | Zerg        | 3128 | 2021-12-22 21:18:34 |
| 5         | Locutus      | Protoss     | 3123 | 2021-01-14 13:19:57 |
| 6         | Crona        | Zerg        | 3104 | 2026-09-02 21:58:38 |
| 7         | Brainiac     | Random      | 3060 | 2026-09-02 21:59:13 |
| 8         | Dragon       | Terran      | 3004 | 2021-04-12 23:42:40 |
| 9         | McRaveZ      | Zerg        | 2992 | 2020-12-23 00:16:54 |
| 10        | Terminus     | Terran      | 2963 | 2026-09-02 21:58:55 |
| 11        | Hao Pan      | Terran      | 2960 | 2022-12-25 21:24:42 |
| 12        | Microwave    | Zerg        | 2950 | 2025-11-23 16:39:12 |
| 13        | adias        | Terran      | 2940 | 2019-11-12 14:38:22 |
| 14        | Steamhammer  | Zerg        | 2914 | 2023-12-14 21:05:36 |
| 15        | MadMixP      | Protoss     | 2884 | 2023-03-17 19:16:03 |
| 16        | Iron bot     | Terran      | 2845 | 2019-03-17 10:08:23 |
| 17        | WillyT       | Terran      | 2825 | 2022-05-08 18:35:31 |
| 18        | PurpleCheese | Random      | 2822 | 2026-08-27 20:45:14 |
| 19        | Randomhammer | Random      | 2815 | 2023-12-14 21:06:49 |
| 20        | NovotHammer  | Zerg        | 2748 | 2026-07-28 21:22:37 |

## Identity and version details that affect the catalog

- **Crona**, **Brainiac**, and **Terminus** describe themselves as BananaBrain
  playing Zerg, random, and Terran respectively. One author conversation may cover
  all four entries; they are not four independently authored bot families.
- **McRaveZ** is the enabled Zerg entry at 2992, described as a development version
  linking to `Cmccrave/McRave`. The separate **McRave** entry is disabled, lists
  Protoss and AIIDE 2019, and has no numeric Elo. Do not assign McRaveZ's rating to
  an arbitrary current build from that repository.
- **Steamhammer** is explicitly **3.6.5**, Zerg, at 2914. **Randomhammer** is also
  described as Steamhammer 3.6.5, playing random, at 2815. These do not establish
  ratings for the newer 5.3.6 source candidate.
- **Chris Coxe** identifies itself as ZZZKBot, enabled, Zerg, at **2631**. The entry
  named **ZZZKBot** is disabled and explicitly directs readers to Chris Coxe for a
  later version. Our tested source build is not thereby verified as the rated build.
- **Dave Churchill** links to UAlbertaBot, enabled, random, at **2551**. The row's
  update date is 2015-12-24; do not equate it to our tested source revision.
- **Ecgberht** is enabled, Terran, at **2521**.
- **PurpleWave** is entered as Protoss here even though its upstream project
  supports other races. Preserve the distinction between a tournament entry and
  package capabilities.
- **WillyT** describes C++/VS19/BWAPI 4.4.0 and says it is ready for FFA on BGH.
  This makes it a useful multi-opponent investigation candidate, not a verified
  compatibility claim. Its description links to `https://github.com/nklausner/WillyT`.

## Consequences for research and outreach

Retain Stardust and PurpleWave as high-strength integration targets. Investigate
**Monster** and the **BananaBrain family** for additional strong Zerg/Terran options;
their distribution terms and source/build access remain to be established. Include
**Dragon** as a leading listed Terran candidate (its description says it is based
on TorchCraftAI/CherryPi), with dependency/runtime feasibility to investigate.
Target **McRaveZ's actual version** when seeking to reproduce that entry's strength.
Keep Steamhammer and Ecgberht for broader code/runtime coverage rather than claiming
they are the strongest entries for their races. Investigate WillyT for multi-bot
formats, since high 1v1 Elo alone does not establish multi-opponent support.

Travis plans author outreach. Prepare per-bot questions about recommended builds,
source/build dependencies, attribution, redistribution, and competitive use. Track
local distribution/use and public ladder/tournament permission independently,
including the scope and version of any author grant. Missing permission remains an
open outreach item, not an assumption of approval or a permanent rejection. No
outreach is performed by this snapshot review.

These observations refine the [local bot plan](local-bwapi-bots-plan.md). They do
not add integrations or establish licenses beyond the separate upstream research.
