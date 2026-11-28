import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import {
  BEST_OF_LOGO_MAX_DIMENSION,
  BEST_OF_LOGO_MAX_SIZE_BYTES,
  LobbyBestOfJson,
  LobbyBestOfSides,
} from '../../../common/lobbies/lobby-best-of'
import { LobbyServiceErrorCode } from '../../../common/lobbies/lobby-network'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { FetchError } from '../../network/fetch-errors'
import {
  bestOfLogoErrorMessage,
  buildStartBestOfParams,
  buildUpdateBestOfParams,
  checkLogoFile,
  formatSeriesSetupSummary,
  LogoSlotValue,
  SeriesSetupValues,
} from './series-setup'

/** Fills a default value's `{{placeholders}}` from its options, the way i18next does. */
const t = ((_key: string, options?: string | Record<string, unknown>) => {
  if (typeof options === 'string') {
    return options
  }
  const template = String(options?.defaultValue ?? '')
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

function values(overrides: Partial<SeriesSetupValues> = {}): SeriesSetupValues {
  return { title: '', sides: SIDES, line1: '', line2: '', logo: NONE, ...overrides }
}

describe('formatSeriesSetupSummary', () => {
  test('a new series names its length, its sides and its title', () => {
    expect(
      formatSeriesSetupSummary(t, {
        length: 7,
        sideLabels: ['claude-2', 'claude-3'],
        title: 'Grand Final',
      }),
    ).toBe('Best of 7 · claude-2 vs claude-3 · Grand Final')
  })

  test('a running series shows the score between its sides', () => {
    expect(
      formatSeriesSetupSummary(t, {
        length: 7,
        sideLabels: ['claude-2', 'claude-3'],
        score: [2, 1],
        title: 'Grand Final',
      }),
    ).toBe('Best of 7 · claude-2 2–1 claude-3 · Grand Final')
  })

  test('leaves out the title when there is none, even when it is only spaces', () => {
    expect(
      formatSeriesSetupSummary(t, { length: 3, sideLabels: ['a, b', 'c, d'], title: '   ' }),
    ).toBe('Best of 3 · a, b vs c, d')
  })

  test('leaves out the sides while either side is empty', () => {
    expect(formatSeriesSetupSummary(t, { length: 5, sideLabels: undefined, title: 'Final' })).toBe(
      'Best of 5 · Final',
    )
    expect(
      formatSeriesSetupSummary(t, { length: 5, sideLabels: undefined, score: [1, 0], title: '' }),
    ).toBe('Best of 5')
  })

  test('leaves out the length while it is not a valid one', () => {
    expect(
      formatSeriesSetupSummary(t, { length: undefined, sideLabels: ['a', 'b'], title: '' }),
    ).toBe('a vs b')
  })
})

describe('buildStartBestOfParams', () => {
  test('trims the title and the lines, and leaves out the ones that are empty', () => {
    expect(
      buildStartBestOfParams(
        3,
        values({ title: '  Final  ', line1: '   ', line2: ' Observer  Royo ' }),
        NONE,
      ),
    ).toEqual({ length: 3, title: 'Final', sides: SIDES, line2: 'Observer  Royo' })
  })

  test('an untouched remembered logo is left to the server', () => {
    expect(buildStartBestOfParams(1, values({ logo: STORED }), STORED)).toEqual({
      length: 1,
      sides: SIDES,
    })
  })

  test('a picked logo is sent as a file', () => {
    expect(buildStartBestOfParams(1, values({ logo: PICKED }), STORED)).toEqual({
      length: 1,
      sides: SIDES,
      logo: PICKED_FILE,
    })
  })

  test('removing the remembered logo sends deleteLogo', () => {
    expect(buildStartBestOfParams(1, values({ logo: NONE }), STORED)).toEqual({
      length: 1,
      sides: SIDES,
      deleteLogo: true,
    })
  })

  test('a slot that opened empty or unknown sends nothing about the logo', () => {
    expect(buildStartBestOfParams(1, values({ logo: NONE }), NONE)).toEqual({
      length: 1,
      sides: SIDES,
    })
    expect(buildStartBestOfParams(1, values({ logo: UNKNOWN }), UNKNOWN)).toEqual({
      length: 1,
      sides: SIDES,
    })
  })
})

describe('buildUpdateBestOfParams', () => {
  const editing: Pick<LobbyBestOfJson, 'title' | 'sides' | 'overlay'> = {
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
        { title: undefined, sides: SIDES, overlay: undefined },
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
