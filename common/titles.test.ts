import { describe, expect, test } from 'vitest'
import {
  ALL_TITLE_IDS,
  getEarnedTitleIds,
  getTitleDefinition,
  getTitleProgress,
  GRANTED_TITLE_IDS,
  isTitleId,
  makeEmptyTitleMetrics,
  meetsTitleCriterion,
  TitleDivision,
  TitleMetrics,
  TitleMode,
  TITLES,
  TitleTone,
} from './titles'

function metrics(overrides: Partial<TitleMetrics>): TitleMetrics {
  return { ...makeEmptyTitleMetrics(), ...overrides }
}

describe('common/titles', () => {
  test('defines every title id exactly once', () => {
    expect(TITLES.map(t => t.id)).toEqual(ALL_TITLE_IDS)
  })

  test('isTitleId', () => {
    expect(isTitleId('hiveMind')).toBe(true)
    expect(isTitleId('notATitle')).toBe(false)
    expect(isTitleId(undefined)).toBe(false)
  })

  test('a new player has only earned the default title', () => {
    expect(getEarnedTitleIds(makeEmptyTitleMetrics())).toEqual(['novice'])
  })

  test('race titles unlock at each threshold and color the top tiers', () => {
    const earned = getEarnedTitleIds(metrics({ raceWins: { p: 0, t: 0, z: 1240, r: 0 } }))
    expect(earned).toEqual(expect.arrayContaining(['spawnMoreOverlords', 'darkSwarm', 'hiveMind']))
    expect(earned).not.toContain('cerebrate')

    expect(getTitleDefinition('mutaStacker').tone).toBe(TitleTone.Standard)
    expect(getTitleDefinition('darkSwarm').tone).toBe(TitleTone.Zerg)
    expect(getTitleDefinition('cerebrate').tone).toBe(TitleTone.Zerg)
  })

  test('every-race titles track the lowest race', () => {
    const m = metrics({ raceWins: { p: 140, t: 12, z: 1240, r: 30 } })
    expect(getTitleProgress(getTitleDefinition('offRacer').criterion, m)).toEqual({
      current: 12,
      target: 25,
    })
    expect(meetsTitleCriterion(getTitleDefinition('dabbler').criterion, m)).toBe(true)
    expect(meetsTitleCriterion(getTitleDefinition('offRacer').criterion, m)).toBe(false)
  })

  test('reaching a division awards it and every division below', () => {
    const earned = getEarnedTitleIds(metrics({ peakDivision: TitleDivision.Gold }))
    expect(earned).toEqual(expect.arrayContaining(['bronzeAge', 'silverBullet', 'goldStandard']))
    expect(earned).not.toContain('wentPlatinum')
  })

  test('mode, time, and veteran titles', () => {
    const earned = getEarnedTitleIds(
      metrics({
        modeWins: { [TitleMode.OneVOne]: 99, [TitleMode.TwoVTwo]: 250, [TitleMode.Bgh]: 0 },
        hoursPlayed: 100.5,
        hasPlayed: true,
        rankedSeasons: 3,
      }),
    )
    expect(earned).toEqual(
      expect.arrayContaining([
        'dynamicDuo',
        'clockedIn',
        'overtime',
        'established',
        'seasonTicketHolder',
      ]),
    )
    expect(earned).not.toContain('loneWolf')
    expect(earned).not.toContain('noLifer')
  })

  test('the APM feat needs enough games', () => {
    const criterion = getTitleDefinition('keyboardWarrior').criterion
    expect(
      meetsTitleCriterion(criterion, metrics({ recentApm: { average: 300, games: 49 } })),
    ).toBe(false)
    expect(
      meetsTitleCriterion(criterion, metrics({ recentApm: { average: 250, games: 50 } })),
    ).toBe(true)
  })

  test('granted titles are never earned', () => {
    const maxed = metrics({
      raceWins: { p: 10000, t: 10000, z: 10000, r: 10000 },
      gamesPlayed: 10000,
      hasPlayed: true,
      hoursPlayed: 10000,
      peakDivision: TitleDivision.Champion,
    })
    const earned = getEarnedTitleIds(maxed)
    for (const id of GRANTED_TITLE_IDS) {
      expect(earned).not.toContain(id)
    }
    expect(GRANTED_TITLE_IDS).toEqual([
      'leagueChampion',
      'exterminator',
      'playByPlay',
      'administrator',
      'moderator',
      'developer',
    ])
  })
})
