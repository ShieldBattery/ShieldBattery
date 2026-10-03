import { TFunction } from 'i18next'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  TitleCriterion,
  TitleDefinition,
  TitleDivision,
  TitleId,
  TitleMode,
} from '../../common/titles'

/**
 * Returns the display name of a title. `created` is the holder's account creation timestamp, which
 * the `established` title shows the year of.
 */
export function getTitleName(id: TitleId, t: TFunction, created?: number): string {
  switch (id) {
    case 'novice':
      return t('users.titles.novice', 'Novice')
    case 'additionalPylons':
      return t('titles.names.additionalPylons', 'Additional Pylons')
    case 'enTaroAdun':
      return t('titles.names.enTaroAdun', 'En Taro Adun')
    case 'stormCaller':
      return t('titles.names.stormCaller', 'Storm Caller')
    case 'powerOverwhelming':
      return t('titles.names.powerOverwhelming', 'Power Overwhelming')
    case 'khalasChosen':
      return t('titles.names.khalasChosen', "Khala's Chosen")
    case 'executor':
      return t('titles.names.executor', 'Executor')
    case 'spawnMoreOverlords':
      return t('titles.names.spawnMoreOverlords', 'Spawn More Overlords')
    case 'lingFlood':
      return t('titles.names.lingFlood', 'Ling Flood')
    case 'mutaStacker':
      return t('titles.names.mutaStacker', 'Muta Stacker')
    case 'darkSwarm':
      return t('titles.names.darkSwarm', 'Dark Swarm')
    case 'hiveMind':
      return t('titles.names.hiveMind', 'Hive Mind')
    case 'cerebrate':
      return t('titles.names.cerebrate', 'Cerebrate')
    case 'supplyBlocked':
      return t('titles.names.supplyBlocked', 'Supply Blocked')
    case 'stimJunkie':
      return t('titles.names.stimJunkie', 'Stim Junkie')
    case 'spiderMiner':
      return t('titles.names.spiderMiner', 'Spider Miner')
    case 'mechManiac':
      return t('titles.names.mechManiac', 'Mech Maniac')
    case 'nuclearLaunchDetected':
      return t('titles.names.nuclearLaunchDetected', 'Nuclear Launch Detected')
    case 'magistrate':
      return t('titles.names.magistrate', 'Magistrate')
    case 'coinFlip':
      return t('titles.names.coinFlip', 'Coin Flip')
    case 'wildcard':
      return t('titles.names.wildcard', 'Wildcard')
    case 'identityCrisis':
      return t('titles.names.identityCrisis', 'Identity Crisis')
    case 'agentOfChaos':
      return t('titles.names.agentOfChaos', 'Agent of Chaos')
    case 'chimera':
      return t('titles.names.chimera', 'Chimera')
    case 'xelNaga':
      return t('titles.names.xelNaga', "Xel'Naga")
    case 'dabbler':
      return t('titles.names.dabbler', 'Dabbler')
    case 'offRacer':
      return t('titles.names.offRacer', 'Off-Racer')
    case 'tripleThreat':
      return t('titles.names.tripleThreat', 'Triple Threat')
    case 'triumvirate':
      return t('titles.names.triumvirate', 'Triumvirate')
    case 'bronzeAge':
      return t('titles.names.bronzeAge', 'Bronze Age')
    case 'silverBullet':
      return t('titles.names.silverBullet', 'Silver Bullet')
    case 'goldStandard':
      return t('titles.names.goldStandard', 'Gold Standard')
    case 'wentPlatinum':
      return t('titles.names.wentPlatinum', 'Went Platinum')
    case 'gosu':
      return t('titles.names.gosu', 'Gosu')
    case 'bonjwa':
      return t('titles.names.bonjwa', 'Bonjwa')
    case 'onTheBoard':
      return t('titles.names.onTheBoard', 'On the Board')
    case 'bracketBuster':
      return t('titles.names.bracketBuster', 'Bracket Buster')
    case 'contender':
      return t('titles.names.contender', 'Contender')
    case 'leagueMenace':
      return t('titles.names.leagueMenace', 'League Menace')
    case 'hallOfFamer':
      return t('titles.names.hallOfFamer', 'Hall of Famer')
    case 'loneWolf':
      return t('titles.names.loneWolf', 'Lone Wolf')
    case 'dynamicDuo':
      return t('titles.names.dynamicDuo', 'Dynamic Duo')
    case 'bigGameHunter':
      return t('titles.names.bigGameHunter', 'Big Game Hunter')
    case 'freeForAllStar':
      return t('titles.names.freeForAllStar', 'Free-for-All-Star')
    case 'funMapFanatic':
      return t('titles.names.funMapFanatic', 'Fun Map Fanatic')
    case 'freshMeat':
      return t('titles.names.freshMeat', 'Fresh Meat')
    case 'oneMoreGame':
      return t('titles.names.oneMoreGame', 'One More Game')
    case 'grinder':
      return t('titles.names.grinder', 'Grinder')
    case 'warMachine':
      return t('titles.names.warMachine', 'War Machine')
    case 'broodWarDemigod':
      return t('titles.names.broodWarDemigod', 'Brood War Demigod')
    case 'clockedIn':
      return t('titles.names.clockedIn', 'Clocked In')
    case 'overtime':
      return t('titles.names.overtime', 'Overtime')
    case 'noLifer':
      return t('titles.names.noLifer', 'No-Lifer')
    case 'touchGrass':
      return t('titles.names.touchGrass', 'Touch Grass')
    case 'established':
      return t('titles.names.established', {
        defaultValue: 'Est. {{year}}',
        year: new Date(created ?? Date.now()).getFullYear(),
      })
    case 'seasonTicketHolder':
      return t('titles.names.seasonTicketHolder', 'Season Ticket Holder')
    case 'perfectAttendance':
      return t('titles.names.perfectAttendance', 'Perfect Attendance')
    case 'cheesemonger':
      return t('titles.names.cheesemonger', 'Cheesemonger')
    case 'minedOut':
      return t('titles.names.minedOut', 'Mined Out')
    case 'siblingRivalry':
      return t('titles.names.siblingRivalry', 'Sibling Rivalry')
    case 'keyboardWarrior':
      return t('titles.names.keyboardWarrior', 'Keyboard Warrior')
    case 'leagueChampion':
      return t('titles.names.leagueChampion', 'League Champion')
    case 'exterminator':
      return t('titles.names.exterminator', 'Exterminator')
    case 'playByPlay':
      return t('titles.names.playByPlay', 'Play-by-Play')
    case 'administrator':
      return t('titles.names.administrator', 'Administrator')
    case 'moderator':
      return t('titles.names.moderator', 'Moderator')
    case 'developer':
      return t('titles.names.developer', 'Developer')
    default:
      return assertUnreachable(id)
  }
}

function getDivisionRequirement(division: TitleDivision, t: TFunction): string {
  switch (division) {
    case TitleDivision.Bronze:
      return t('titles.requirements.reachBronze', 'Reach Bronze in any ranked mode')
    case TitleDivision.Silver:
      return t('titles.requirements.reachSilver', 'Reach Silver in any ranked mode')
    case TitleDivision.Gold:
      return t('titles.requirements.reachGold', 'Reach Gold in any ranked mode')
    case TitleDivision.Platinum:
      return t('titles.requirements.reachPlatinum', 'Reach Platinum in any ranked mode')
    case TitleDivision.Diamond:
      return t('titles.requirements.reachDiamond', 'Reach Diamond in any ranked mode')
    case TitleDivision.Champion:
      return t('titles.requirements.reachChampion', 'Reach Champion in any ranked mode')
    default:
      return assertUnreachable(division)
  }
}

function getGrantedRequirement(id: TitleId, t: TFunction): string {
  switch (id) {
    case 'leagueChampion':
      return t('titles.requirements.leagueChampion', 'Won a ShieldBattery league')
    case 'exterminator':
      return t('titles.requirements.exterminator', 'Reported a bug that got fixed')
    case 'playByPlay':
      return t('titles.requirements.playByPlay', 'Casts ShieldBattery games and events')
    case 'administrator':
      return t('titles.requirements.administrator', 'A ShieldBattery administrator')
    case 'moderator':
      return t('titles.requirements.moderator', 'A ShieldBattery moderator')
    case 'developer':
      return t('titles.requirements.developer', 'A ShieldBattery developer')
    default:
      return t('titles.requirements.granted', 'Awarded by ShieldBattery staff')
  }
}

function getCriterionRequirement(
  id: TitleId,
  criterion: TitleCriterion,
  t: TFunction,
  locale: string,
): string {
  const format = (n: number) => n.toLocaleString(locale)
  switch (criterion.kind) {
    case 'always':
      return t('titles.requirements.novice', 'Everyone starts here')
    case 'granted':
      return getGrantedRequirement(id, t)
    case 'raceWins': {
      const count = criterion.wins
      const number = format(count)
      switch (criterion.race) {
        case 'p':
          return t('titles.requirements.winsAsProtoss', {
            defaultValue: 'Win {{number}} games as Protoss',
            defaultValue_one: 'Win {{number}} game as Protoss',
            count,
            number,
          })
        case 'z':
          return t('titles.requirements.winsAsZerg', {
            defaultValue: 'Win {{number}} games as Zerg',
            defaultValue_one: 'Win {{number}} game as Zerg',
            count,
            number,
          })
        case 't':
          return t('titles.requirements.winsAsTerran', {
            defaultValue: 'Win {{number}} games as Terran',
            defaultValue_one: 'Win {{number}} game as Terran',
            count,
            number,
          })
        case 'r':
          return t('titles.requirements.winsAsRandom', {
            defaultValue: 'Win {{number}} games as Random',
            defaultValue_one: 'Win {{number}} game as Random',
            count,
            number,
          })
        default:
          return assertUnreachable(criterion.race)
      }
    }
    case 'everyRaceWins':
      return t('titles.requirements.winsEveryRace', {
        defaultValue: 'Win {{number}} games with each of Protoss, Terran, and Zerg',
        defaultValue_one: 'Win {{number}} game with each of Protoss, Terran, and Zerg',
        count: criterion.wins,
        number: format(criterion.wins),
      })
    case 'division':
      return getDivisionRequirement(criterion.division, t)
    case 'leagueWins':
      return t('titles.requirements.leagueWins', {
        defaultValue: 'Win {{number}} league games',
        defaultValue_one: 'Win {{number}} league game',
        count: criterion.wins,
        number: format(criterion.wins),
      })
    case 'modeWins': {
      const count = criterion.wins
      const number = format(count)
      switch (criterion.mode) {
        case TitleMode.OneVOne:
          return t('titles.requirements.winsIn1v1', {
            defaultValue: 'Win {{number}} games in 1v1',
            defaultValue_one: 'Win {{number}} game in 1v1',
            count,
            number,
          })
        case TitleMode.TwoVTwo:
          return t('titles.requirements.winsIn2v2', {
            defaultValue: 'Win {{number}} games in 2v2',
            defaultValue_one: 'Win {{number}} game in 2v2',
            count,
            number,
          })
        case TitleMode.Bgh:
          return t('titles.requirements.winsInBgh', {
            defaultValue: 'Win {{number}} games in 2v2 or 3v3 BGH',
            defaultValue_one: 'Win {{number}} game in 2v2 or 3v3 BGH',
            count,
            number,
          })
        default:
          return assertUnreachable(criterion.mode)
      }
    }
    case 'ffaWins':
      return t('titles.requirements.ffaWins', {
        defaultValue: 'Win {{number}} Free for all games',
        defaultValue_one: 'Win {{number}} Free for all game',
        count: criterion.wins,
        number: format(criterion.wins),
      })
    case 'umsGames':
      return t('titles.requirements.umsGames', {
        defaultValue: 'Complete {{number}} Use map settings games',
        defaultValue_one: 'Complete {{number}} Use map settings game',
        count: criterion.games,
        number: format(criterion.games),
      })
    case 'gamesPlayed':
      return t('titles.requirements.gamesPlayed', {
        defaultValue: 'Play {{number}} games',
        defaultValue_one: 'Play {{number}} game',
        count: criterion.games,
        number: format(criterion.games),
      })
    case 'hoursPlayed':
      return t('titles.requirements.hoursPlayed', {
        defaultValue: 'Spend {{number}} hours in game',
        defaultValue_one: 'Spend {{number}} hour in game',
        count: criterion.hours,
        number: format(criterion.hours),
      })
    case 'established':
      return t(
        'titles.requirements.established',
        'Play your first game. Shows the year you joined.',
      )
    case 'rankedSeasons':
      return t('titles.requirements.rankedSeasons', {
        defaultValue: 'Play ranked in {{number}} seasons',
        defaultValue_one: 'Play ranked in {{number}} season',
        count: criterion.seasons,
        number: format(criterion.seasons),
      })
    case 'quickWins':
      return t(
        'titles.requirements.cheesemonger',
        'Win 10 ranked games that end in under 4 minutes',
      )
    case 'longWin':
      return t('titles.requirements.minedOut', 'Win a ranked game lasting over 60 minutes')
    case 'mirrorWins':
      return t('titles.requirements.siblingRivalry', 'Win 100 ranked mirror matchups')
    case 'averageApm':
      return t(
        'titles.requirements.keyboardWarrior',
        'Average 250+ APM across your last 50 ranked games',
      )
    default:
      return assertUnreachable(criterion)
  }
}

/** Returns a description of what it takes to unlock a title. */
export function getTitleRequirement(
  definition: TitleDefinition,
  t: TFunction,
  locale: string,
): string {
  return getCriterionRequirement(definition.id, definition.criterion, t, locale)
}
