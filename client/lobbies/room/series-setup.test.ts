import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import {
  BEST_OF_DISPLAY_NAME_MAX_LENGTH,
  BEST_OF_LOGO_MAX_DIMENSION,
  BEST_OF_LOGO_MAX_SIZE_BYTES,
  BEST_OF_SIDE_NAME_MAX_LENGTH,
  getBestOfTextProblem,
  LobbyBestOfJson,
  LobbyBestOfSides,
} from '../../../common/lobbies/lobby-best-of'
import { LobbyServiceErrorCode } from '../../../common/lobbies/lobby-network'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { FetchError } from '../../network/fetch-errors'
import { bestOfFormatLabel } from './best-of-parts'
import {
  batchDisplayNameLookups,
  bestOfFormatHint,
  bestOfLogoErrorMessage,
  bestOfTextProblemMessage,
  buildStartBestOfParams,
  buildUpdateBestOfParams,
  checkLogoFile,
  DisplayNameFields,
  fillRememberedDisplayNames,
  formatSeriesSetupSummary,
  getDisplayNamesToLoad,
  getFormatChangeOutcome,
  initialDisplayNameFields,
  LogoSlotValue,
  SeriesSetupValues,
  typeDisplayName,
} from './series-setup'

/**
 * Fills a default value's `{{placeholders}}` from its options, the way i18next does, picking the
 * English plural form by `count` when one is given.
 */
const t = ((_key: string, options?: string | Record<string, unknown>) => {
  if (typeof options === 'string') {
    return options
  }
  const plural =
    typeof options?.count === 'number'
      ? options[options.count === 1 ? 'defaultValue_one' : 'defaultValue_other']
      : undefined
  const template = String(plural ?? options?.defaultValue ?? '')
  return template.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name]))
}) as unknown as TFunction

const A = makeSbUserId(1)
const B = makeSbUserId(2)
const C = makeSbUserId(3)
const SIDES: LobbyBestOfSides = [[A], [B]]

const STORED_LOGO = { url: 'https://cdn.example.com/logo.png', fileName: 'logo.png' }
const PICKED_FILE = new File(['png'], 'new.png', { type: 'image/png' })
const NONE: LogoSlotValue = { kind: 'none' }
const STORED: LogoSlotValue = { kind: 'stored', logo: STORED_LOGO }
const PICKED: LogoSlotValue = { kind: 'picked', file: PICKED_FILE }
const UNKNOWN: LogoSlotValue = { kind: 'unknown' }

const NO_FIELDS: DisplayNameFields = new Map()

function values(overrides: Partial<SeriesSetupValues> = {}): SeriesSetupValues {
  return {
    length: 3,
    playAll: false,
    title: '',
    sides: SIDES,
    sideNames: ['', ''],
    displayNames: NO_FIELDS,
    line1: '',
    line2: '',
    logo: NONE,
    ...overrides,
  }
}

/** The fields as the page would hold them after a remembered load answered and the host typed. */
function fields(
  remembered: ReadonlyArray<{ userId: typeof A; name: string }>,
  typed: ReadonlyArray<[typeof A, string]> = [],
  start: DisplayNameFields = NO_FIELDS,
): DisplayNameFields {
  let result = fillRememberedDisplayNames(start, remembered)
  for (const [userId, value] of typed) {
    result = typeDisplayName(result, userId, value)
  }
  return result
}

describe('formatSeriesSetupSummary', () => {
  test('a new series names its length, its sides and its title', () => {
    expect(
      formatSeriesSetupSummary(t, {
        format: { length: 7 },
        sideLabels: ['claude-2', 'claude-3'],
        title: 'Grand Final',
      }),
    ).toBe('Best of 7 · claude-2 vs claude-3 · Grand Final')
  })

  test('a running series shows the score between its sides', () => {
    expect(
      formatSeriesSetupSummary(t, {
        format: { length: 7 },
        sideLabels: ['claude-2', 'claude-3'],
        score: [2, 1],
        title: 'Grand Final',
      }),
    ).toBe('Best of 7 · claude-2 2–1 claude-3 · Grand Final')
  })

  test('leaves out the title when there is none, even when it is only spaces', () => {
    expect(
      formatSeriesSetupSummary(t, {
        format: { length: 3 },
        sideLabels: ['a, b', 'c, d'],
        title: '   ',
      }),
    ).toBe('Best of 3 · a, b vs c, d')
  })

  test('leaves out the sides while either side is empty', () => {
    expect(
      formatSeriesSetupSummary(t, {
        format: { length: 5 },
        sideLabels: undefined,
        title: 'Final',
      }),
    ).toBe('Best of 5 · Final')
    expect(
      formatSeriesSetupSummary(t, {
        format: { length: 5 },
        sideLabels: undefined,
        score: [1, 0],
        title: '',
      }),
    ).toBe('Best of 5')
  })

  test('leaves out the length while it is not a valid one', () => {
    expect(
      formatSeriesSetupSummary(t, { format: undefined, sideLabels: ['a', 'b'], title: '' }),
    ).toBe('a vs b')
  })
})

describe('series format', () => {
  test('is worded as a best-of, or as a number of games when every game is played', () => {
    expect(bestOfFormatLabel({ length: 3 }, t)).toBe('Best of 3')
    expect(bestOfFormatLabel({ length: 4 }, t)).toBe('Best of 4')
    expect(bestOfFormatLabel({ length: 4, playAll: true }, t)).toBe('4 games')
    expect(bestOfFormatLabel({ length: 1, playAll: true }, t)).toBe('1 game')
  })

  test('the summary names the format the host picked', () => {
    expect(
      formatSeriesSetupSummary(t, {
        format: { length: 6, playAll: true },
        sideLabels: ['a', 'b'],
        title: '',
      }),
    ).toBe('6 games · a vs b')
  })

  test('the hint says what it takes to win, and when an even series is drawn', () => {
    expect(bestOfFormatHint({ length: 5 }, t)).toBe('First to 3 wins the series.')
    expect(bestOfFormatHint({ length: 4 }, t)).toBe(
      'First to 3 wins the series. It is drawn at 2–2.',
    )
    expect(bestOfFormatHint({ length: 4, playAll: true }, t)).toBe(
      'All 4 games are played. The side with more wins takes the series.',
    )
    expect(bestOfFormatHint({ length: 1, playAll: true }, t)).toBe(
      '1 game is played. The side that wins it takes the series.',
    )
  })
})

describe('getFormatChangeOutcome', () => {
  // A Bo7 at 2–1, with a game that counts for nobody.
  const running: Pick<LobbyBestOfJson, 'length' | 'playAll' | 'games' | 'outcome'> = {
    length: 7,
    games: [
      { gameId: 'g1', players: SIDES, status: 'won', winner: 0 },
      { gameId: 'g2', players: SIDES, status: 'noWinner' },
      { gameId: 'g3', players: SIDES, status: 'won', winner: 1 },
      { resultId: 'r1', status: 'won', winner: 0 },
    ],
  }

  test('is nothing for a save that leaves the format alone or the series undecided', () => {
    expect(getFormatChangeOutcome(running, {})).toBeUndefined()
    expect(getFormatChangeOutcome(running, { length: 5 })).toBeUndefined()
    expect(getFormatChangeOutcome(running, { playAll: true })).toBeUndefined()
  })

  test('is how a length the results already decide ends the series', () => {
    expect(getFormatChangeOutcome(running, { length: 3 })).toEqual({ kind: 'won', winner: 0 })
    expect(getFormatChangeOutcome(running, { length: 1 })).toEqual({ kind: 'won', winner: 0 })
  })

  test('a length every counted game has filled ends it drawn when the sides are level', () => {
    const level = { ...running, games: running.games.slice(0, 3) }
    expect(getFormatChangeOutcome(level, { length: 2 })).toEqual({ kind: 'drawn' })
    expect(getFormatChangeOutcome(level, { length: 2, playAll: true })).toEqual({ kind: 'drawn' })
  })

  test('playing every game holds off a majority until all of them have counted', () => {
    // 5 games, all played, at 3–1.
    const playAll: typeof running = {
      length: 5,
      playAll: true,
      games: [...running.games, { gameId: 'g4', players: SIDES, status: 'won', winner: 0 }],
    }
    expect(getFormatChangeOutcome(playAll, { length: 6 })).toBeUndefined()
    expect(getFormatChangeOutcome(playAll, { playAll: false })).toEqual({ kind: 'won', winner: 0 })
    expect(getFormatChangeOutcome(playAll, { length: 4 })).toEqual({ kind: 'won', winner: 0 })
  })

  test('is nothing for a series that has already ended', () => {
    expect(
      getFormatChangeOutcome({ ...running, outcome: { kind: 'unfinished' } }, { length: 3 }),
    ).toBeUndefined()
  })
})

describe('buildStartBestOfParams', () => {
  test('sends that every game is played only when it is', () => {
    expect(buildStartBestOfParams(values({ length: 4, playAll: true }), NONE)).toEqual({
      length: 4,
      playAll: true,
      sides: SIDES,
    })
    expect(buildStartBestOfParams(values({ length: 4 }), NONE)).not.toHaveProperty('playAll')
  })

  test('trims the title and the lines, and leaves out the ones that are empty', () => {
    expect(
      buildStartBestOfParams(
        values({ length: 3, title: '  Final  ', line1: '   ', line2: ' Observer  Royo ' }),
        NONE,
      ),
    ).toEqual({ length: 3, title: 'Final', sides: SIDES, line2: 'Observer  Royo' })
  })

  test('an untouched remembered logo is left to the server', () => {
    expect(buildStartBestOfParams(values({ length: 1, logo: STORED }), STORED)).toEqual({
      length: 1,
      sides: SIDES,
    })
  })

  test('a picked logo is sent as a file', () => {
    expect(buildStartBestOfParams(values({ length: 1, logo: PICKED }), STORED)).toEqual({
      length: 1,
      sides: SIDES,
      logo: PICKED_FILE,
    })
  })

  test('removing the remembered logo sends deleteLogo', () => {
    expect(buildStartBestOfParams(values({ length: 1, logo: NONE }), STORED)).toEqual({
      length: 1,
      sides: SIDES,
      deleteLogo: true,
    })
  })

  test('a slot that opened empty or unknown sends nothing about the logo', () => {
    expect(buildStartBestOfParams(values({ length: 1, logo: NONE }), NONE)).toEqual({
      length: 1,
      sides: SIDES,
    })
    expect(buildStartBestOfParams(values({ length: 1, logo: UNKNOWN }), UNKNOWN)).toEqual({
      length: 1,
      sides: SIDES,
    })
  })
})

describe('buildUpdateBestOfParams', () => {
  const editing: Pick<
    LobbyBestOfJson,
    'length' | 'playAll' | 'title' | 'sides' | 'sideNames' | 'displayNames' | 'overlay'
  > = {
    length: 3,
    title: 'Grand Final',
    sides: SIDES,
    overlay: { line1: 'Casters  Alice & Bob', line2: 'Observer  Carol', logo: STORED_LOGO },
  }
  const unchanged = values({
    title: 'Grand Final',
    line1: 'Casters  Alice & Bob',
    line2: 'Observer  Carol',
    logo: STORED,
  })

  test('returns nothing when nothing changed, including changes only in surrounding spaces', () => {
    expect(buildUpdateBestOfParams(editing, unchanged)).toBeUndefined()
    expect(
      buildUpdateBestOfParams(editing, {
        ...unchanged,
        title: ' Grand Final ',
        line1: ' Casters  Alice & Bob',
      }),
    ).toBeUndefined()
  })

  test('sends the length and play-all only when they changed', () => {
    expect(buildUpdateBestOfParams(editing, { ...unchanged, length: 4 })).toEqual({ length: 4 })
    expect(buildUpdateBestOfParams(editing, { ...unchanged, playAll: true })).toEqual({
      playAll: true,
    })
    expect(
      buildUpdateBestOfParams({ ...editing, playAll: true }, { ...unchanged, playAll: false }),
    ).toEqual({ playAll: false })
    expect(
      buildUpdateBestOfParams({ ...editing, playAll: true }, { ...unchanged, playAll: true }),
    ).toBeUndefined()
  })

  test('sends only the title when only the title changed', () => {
    expect(buildUpdateBestOfParams(editing, { ...unchanged, title: 'Semi Final' })).toEqual({
      title: 'Semi Final',
    })
  })

  test('sends a cleared title or line as null', () => {
    expect(buildUpdateBestOfParams(editing, { ...unchanged, title: ' ', line2: '' })).toEqual({
      title: null,
      line2: null,
    })
  })

  test('sends a changed line, and a line set on a series that had none', () => {
    expect(
      buildUpdateBestOfParams(
        { length: 3, title: undefined, sides: SIDES, overlay: undefined },
        values({ line1: 'Casters  Dave' }),
      ),
    ).toEqual({ line1: 'Casters  Dave' })
    expect(buildUpdateBestOfParams(editing, { ...unchanged, line1: 'Casters  Dave' })).toEqual({
      line1: 'Casters  Dave',
    })
  })

  test('sends the sides when they changed, including only their order', () => {
    expect(buildUpdateBestOfParams(editing, { ...unchanged, sides: [[A, C], [B]] })).toEqual({
      sides: [[A, C], [B]],
    })
    expect(
      buildUpdateBestOfParams(
        { ...editing, sides: [[A, C], [B]] },
        { ...unchanged, sides: [[C, A], [B]] },
      ),
    ).toEqual({ sides: [[C, A], [B]] })
  })

  test('keeps an untouched logo, replaces it with a file and removes it with deleteLogo', () => {
    expect(buildUpdateBestOfParams(editing, { ...unchanged, logo: STORED })).toBeUndefined()
    expect(buildUpdateBestOfParams(editing, { ...unchanged, logo: PICKED })).toEqual({
      logo: PICKED_FILE,
    })
    expect(buildUpdateBestOfParams(editing, { ...unchanged, logo: NONE })).toEqual({
      deleteLogo: true,
    })
  })

  test('a series without a logo that still has none sends nothing about it', () => {
    expect(
      buildUpdateBestOfParams(
        { ...editing, overlay: { line1: 'Casters  Alice & Bob' } },
        { ...unchanged, line2: '', logo: NONE },
      ),
    ).toBeUndefined()
  })
})

describe('checkLogoFile', () => {
  const fits = async () => ({ width: BEST_OF_LOGO_MAX_DIMENSION, height: 256 })
  const tooWide = async () => ({ width: BEST_OF_LOGO_MAX_DIMENSION + 1, height: 256 })
  const tooTall = async () => ({ width: 256, height: 2048 })
  const unreadable = async (): Promise<{ width: number; height: number }> => {
    throw new Error('not an image')
  }

  test('accepts a PNG or WebP within the pixel limit', async () => {
    await expect(
      checkLogoFile(new File(['x'], 'a.png', { type: 'image/png' }), fits),
    ).resolves.toBeUndefined()
    await expect(
      checkLogoFile(new File(['x'], 'a.webp', { type: 'image/webp' }), fits),
    ).resolves.toBeUndefined()
  })

  test('refuses a PNG or WebP over the pixel limit on either side', async () => {
    await expect(
      checkLogoFile(new File(['x'], 'a.png', { type: 'image/png' }), tooWide),
    ).resolves.toEqual({ kind: 'dimensions', width: BEST_OF_LOGO_MAX_DIMENSION + 1, height: 256 })
    await expect(
      checkLogoFile(new File(['x'], 'a.webp', { type: 'image/webp' }), tooTall),
    ).resolves.toEqual({ kind: 'dimensions', width: 256, height: 2048 })
  })

  test('accepts an SVG without measuring it', async () => {
    await expect(
      checkLogoFile(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }), tooWide),
    ).resolves.toBeUndefined()
  })

  test('refuses other types, going by the extension when the browser reports none', async () => {
    await expect(
      checkLogoFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), fits),
    ).resolves.toEqual({ kind: 'type' })
    await expect(checkLogoFile(new File(['x'], 'a.gif'), fits)).resolves.toEqual({ kind: 'type' })
    await expect(checkLogoFile(new File(['x'], 'A.PNG'), fits)).resolves.toBeUndefined()
  })

  test('refuses a file over the size limit, at exactly the limit or under it is fine', async () => {
    const big = new File([new Uint8Array(BEST_OF_LOGO_MAX_SIZE_BYTES + 1)], 'a.svg', {
      type: 'image/svg+xml',
    })
    const atLimit = new File([new Uint8Array(BEST_OF_LOGO_MAX_SIZE_BYTES)], 'a.png', {
      type: 'image/png',
    })
    await expect(checkLogoFile(big, fits)).resolves.toEqual({ kind: 'size' })
    await expect(checkLogoFile(atLimit, fits)).resolves.toBeUndefined()
  })

  test('refuses a PNG that cannot be loaded as an image', async () => {
    await expect(
      checkLogoFile(new File(['x'], 'a.png', { type: 'image/png' }), unreadable),
    ).resolves.toEqual({ kind: 'unreadable' })
  })
})

describe('bestOfLogoErrorMessage', () => {
  function refusal(status: number, code?: string) {
    return new FetchError(new Response(null, { status }), code ? JSON.stringify({ code }) : '')
  }

  test('has a message for every logo refusal', () => {
    for (const err of [
      refusal(413, 'MaxFileSizeExceeded'),
      refusal(400, LobbyServiceErrorCode.BestOfLogoInvalidFormat),
      refusal(400, LobbyServiceErrorCode.BestOfLogoTooLarge),
      refusal(400, LobbyServiceErrorCode.BestOfLogoInappropriate),
      refusal(400, LobbyServiceErrorCode.BestOfLogoUnsupportedSvg),
    ]) {
      expect(bestOfLogoErrorMessage(err, t)).toEqual(expect.any(String))
    }
    expect(bestOfLogoErrorMessage(refusal(413, 'MaxFileSizeExceeded'), t)).toBe(
      'This file is larger than 2 MB.',
    )
  })

  test('leaves every other refusal to the page', () => {
    expect(bestOfLogoErrorMessage(refusal(400, LobbyServiceErrorCode.InvalidBestOf), t)).toBe(
      undefined,
    )
    expect(bestOfLogoErrorMessage(refusal(429), t)).toBe(undefined)
    expect(bestOfLogoErrorMessage(new Error('offline'), t)).toBe(undefined)
  })
})

describe('side names', () => {
  test('a start sends both side names, trimmed, when either is set', () => {
    expect(
      buildStartBestOfParams(values({ length: 3, sideNames: ['  Ironclad ', ''] }), NONE),
    ).toEqual({
      length: 3,
      sides: SIDES,
      sideNames: ['Ironclad', null],
    })
    expect(buildStartBestOfParams(values({ length: 3, sideNames: [' ', '   '] }), NONE)).toEqual({
      length: 3,
      sides: SIDES,
    })
  })

  test('a save sends both names when either changed, and nothing about them otherwise', () => {
    const editing: Pick<LobbyBestOfJson, 'length' | 'sides' | 'sideNames'> = {
      length: 3,
      sides: SIDES,
      sideNames: ['Ironclad', null],
    }
    expect(buildUpdateBestOfParams(editing, values({ sideNames: ['Ironclad ', ''] }))).toBe(
      undefined,
    )
    expect(
      buildUpdateBestOfParams(editing, values({ sideNames: ['Ironclad', ' Nexus '] })),
    ).toEqual({ sideNames: ['Ironclad', 'Nexus'] })
    expect(buildUpdateBestOfParams(editing, values({ sideNames: ['', ''] }))).toEqual({
      sideNames: [null, null],
    })
    expect(
      buildUpdateBestOfParams({ length: 3, sides: SIDES }, values({ sideNames: ['', 'X'] })),
    ).toEqual({
      sideNames: [null, 'X'],
    })
  })
})

describe('display names', () => {
  test('a start sends the names in the fields, in side order, trimmed', () => {
    const displayNames = fields(
      [],
      [
        [B, ' tec27 '],
        [A, 'Rhynso'],
      ],
    )
    expect(buildStartBestOfParams(values({ length: 1, displayNames }), NONE)).toEqual({
      length: 1,
      sides: SIDES,
      displayNames: [
        { userId: A, name: 'Rhynso' },
        { userId: B, name: 'tec27' },
      ],
    })
  })

  test('a start sends a remembered name left in place, so it stays remembered', () => {
    const displayNames = fields([{ userId: A, name: 'Rhynso' }])
    expect(buildStartBestOfParams(values({ length: 1, displayNames }), NONE).displayNames).toEqual([
      { userId: A, name: 'Rhynso' },
    ])
  })

  test('a start clears a remembered name the host emptied, which forgets it', () => {
    const displayNames = fields([{ userId: A, name: 'Rhynso' }], [[A, '  ']])
    expect(buildStartBestOfParams(values({ length: 1, displayNames }), NONE).displayNames).toEqual([
      { userId: A, name: null },
    ])
  })

  test('a field that was simply left blank sends nothing, even after the host typed in it', () => {
    const displayNames = fields(
      [],
      [
        [A, 'x'],
        [A, ''],
      ],
    )
    expect(buildStartBestOfParams(values({ length: 1, displayNames }), NONE)).not.toHaveProperty(
      'displayNames',
    )
  })

  test('with the remembered names unloaded, only what the host typed is sent', () => {
    const displayNames = fields([], [[B, 'tec27']])
    expect(buildStartBestOfParams(values({ length: 1, displayNames }), NONE).displayNames).toEqual([
      { userId: B, name: 'tec27' },
    ])
  })

  test('names for people no longer on a side are not sent', () => {
    const displayNames = fields([], [[C, 'Artosis']])
    expect(buildStartBestOfParams(values({ length: 1, displayNames }), NONE)).not.toHaveProperty(
      'displayNames',
    )
  })

  describe('saving a running series', () => {
    const sides: LobbyBestOfSides = [[A, C], [B]]
    const editing: Pick<LobbyBestOfJson, 'length' | 'sides' | 'displayNames'> = {
      length: 3,
      sides,
      displayNames: [
        { userId: A, name: 'Rhynso' },
        { userId: B, name: 'tec27' },
      ],
    }
    const opened = initialDisplayNameFields(editing)

    test('untouched fields send nothing', () => {
      expect(buildUpdateBestOfParams(editing, values({ sides, displayNames: opened }))).toBe(
        undefined,
      )
    })

    test('sends a changed name and a cleared one, and leaves the rest out', () => {
      const displayNames = fields(
        [],
        [
          [A, 'Rhynso '],
          [B, ''],
          [C, 'Artosis'],
        ],
        opened,
      )
      expect(buildUpdateBestOfParams(editing, values({ sides, displayNames }))).toEqual({
        displayNames: [
          { userId: C, name: 'Artosis' },
          { userId: B, name: null },
        ],
      })
    })

    test('the series name wins over a remembered one, which fills only empty fields', () => {
      const displayNames = fields(
        [
          { userId: A, name: 'OldHandle' },
          { userId: C, name: 'Artosis' },
        ],
        [],
        opened,
      )
      expect(displayNames.get(A)?.value).toBe('Rhynso')
      expect(buildUpdateBestOfParams(editing, values({ sides, displayNames }))).toEqual({
        displayNames: [{ userId: C, name: 'Artosis' }],
      })
    })
  })
})

describe('remembered display names', () => {
  test('fill only fields the host has not typed in and that are empty', () => {
    const typed = fields(
      [],
      [
        [A, 'mine'],
        [B, 'x'],
        [B, ''],
      ],
    )
    const filled = fillRememberedDisplayNames(typed, [
      { userId: A, name: 'Rhynso' },
      { userId: B, name: 'tec27' },
      { userId: C, name: 'Artosis' },
    ])
    expect(filled.get(A)?.value).toBe('mine')
    expect(filled.get(B)?.value).toBe('')
    expect(filled.get(C)).toEqual({ value: 'Artosis', filled: 'Artosis', touched: false })
  })

  test('are asked for only for people whose field could still be filled', () => {
    const current = fields([{ userId: A, name: 'Rhynso' }], [[B, 'x']])
    expect(getDisplayNamesToLoad([[A, B], [C]], current)).toEqual([C])
  })

  test('are asked for in batches of at most both sides full', () => {
    const ids = Array.from({ length: 17 }, (_, i) => makeSbUserId(i + 1))
    expect(batchDisplayNameLookups(ids.slice(0, 16))).toEqual([ids.slice(0, 16)])
    expect(batchDisplayNameLookups(ids)).toEqual([ids.slice(0, 16), [ids[16]]])
    expect(batchDisplayNameLookups([])).toEqual([])
  })
})

describe('text checks', () => {
  test('an emoji cut in half the way a UTF-16 maxLength cuts it is refused', () => {
    const cut = 'Team 🛡'.slice(0, -1)
    expect(getBestOfTextProblem(cut, BEST_OF_SIDE_NAME_MAX_LENGTH)).toBe('invalidCharacters')
    expect(getBestOfTextProblem('Team 🛡', BEST_OF_SIDE_NAME_MAX_LENGTH)).toBeUndefined()
  })

  test('a Korean name fits by characters', () => {
    expect(getBestOfTextProblem('이영호최고의선수', BEST_OF_DISPLAY_NAME_MAX_LENGTH)).toBe(
      undefined,
    )
  })

  test('a name of exactly 24 code points fits even where UTF-16 counts more', () => {
    const emoji24 = '🛡'.repeat(24)
    expect(emoji24.length).toBe(48)
    expect(getBestOfTextProblem(emoji24, BEST_OF_SIDE_NAME_MAX_LENGTH)).toBeUndefined()
    expect(getBestOfTextProblem(emoji24 + 'x', BEST_OF_SIDE_NAME_MAX_LENGTH)).toBe('tooLong')
    expect(getBestOfTextProblem(` ${'a'.repeat(24)} `, BEST_OF_SIDE_NAME_MAX_LENGTH)).toBe(
      undefined,
    )
  })

  test('each problem has a message', () => {
    expect(bestOfTextProblemMessage('tooLong', 16, t)).toBe('At most 16 characters')
    expect(bestOfTextProblemMessage('invalidCharacters', 16, t)).toBe(
      "Contains characters that can't be used",
    )
  })
})
