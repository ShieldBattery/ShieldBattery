import { TFunction } from 'i18next'
import { FilesErrorCode } from '../../../common/files'
import {
  BEST_OF_LOGO_ACCEPTED_TYPES,
  BEST_OF_LOGO_MAX_DIMENSION,
  BEST_OF_LOGO_MAX_SIZE_BYTES,
  BEST_OF_MAX_SIDE_SIZE,
  BestOfDecidedOutcome,
  BestOfDisplayName,
  BestOfDisplayNameChange,
  BestOfTextProblem,
  getBestOfDecidedOutcome,
  getBestOfDisplayName,
  getBestOfSideName,
  getBestOfWinsNeeded,
  LobbyBestOfJson,
  LobbyBestOfLogoJson,
  LobbyBestOfSideNames,
  LobbyBestOfSides,
} from '../../../common/lobbies/lobby-best-of'
import { LobbyServiceErrorCode } from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { isFetchError } from '../../network/fetch-errors'
import { StartBestOfParams, UpdateBestOfParams } from '../action-creators'
import { bestOfFormatLabel } from './best-of-parts'

/** The logo size limit as the page writes it, in megabytes. */
export const BEST_OF_LOGO_MAX_SIZE_MB = BEST_OF_LOGO_MAX_SIZE_BYTES / (1024 * 1024)

/** What the series page's logo slot holds. */
export type LogoSlotValue =
  /** No logo: the series has none, or the host removed it. */
  | { kind: 'none' }
  /** A logo already on the server: the running series' one, or the host's remembered one. */
  | { kind: 'stored'; logo: LobbyBestOfLogoJson }
  /** A file the host picked on the page, not uploaded yet. */
  | { kind: 'picked'; file: File }
  /**
   * The host's remembered logo couldn't be loaded, so whether they have one isn't known. Starting
   * a series without touching the slot gives it whatever remembered logo the host has.
   */
  | { kind: 'unknown' }

/** Returns the slot value for a logo the server reported, which may be none. */
export function storedLogoSlot(logo: LobbyBestOfLogoJson | undefined): LogoSlotValue {
  return logo ? { kind: 'stored', logo } : { kind: 'none' }
}

function sameSides(a: Readonly<LobbyBestOfSides>, b: Readonly<LobbyBestOfSides>): boolean {
  return a.every(
    (side, i) => side.length === b[i].length && side.every((userId, j) => userId === b[i][j]),
  )
}

/** A "Shown as" field on the series page: the display name observers see someone under. */
export interface DisplayNameField {
  /** What the field holds, as typed. */
  value: string
  /**
   * What the page filled the field with on its own: the running series' display name for the
   * person, or the one the host is remembered to give them. Empty when it filled in nothing.
   */
  filled: string
  /** Whether the host has typed in the field, after which the page never fills it in again. */
  touched: boolean
}

/** The page's "Shown as" fields by person. A person without an entry has an empty field. */
export type DisplayNameFields = ReadonlyMap<SbUserId, DisplayNameField>

/** The "Shown as" fields a page opens with: the display names of the series it edits, if any. */
export function initialDisplayNameFields(
  editing: Pick<LobbyBestOfJson, 'displayNames'> | undefined,
): DisplayNameFields {
  return new Map(
    (editing?.displayNames ?? []).map(({ userId, name }) => [
      userId,
      { value: name, filled: name, touched: false },
    ]),
  )
}

/** Returns the fields with the host's typing in one person's field applied. */
export function typeDisplayName(
  fields: DisplayNameFields,
  userId: SbUserId,
  value: string,
): DisplayNameFields {
  const next = new Map(fields)
  next.set(userId, { value, filled: fields.get(userId)?.filled ?? '', touched: true })
  return next
}

/** Whether the page may still fill in a field: the host hasn't typed in it and it is empty. */
function isFillable(field: DisplayNameField | undefined): boolean {
  return !field || (!field.touched && !field.value)
}

/**
 * Returns the fields with the display names the host is remembered to give people filled in, but
 * only into fields `isFillable` allows: a remembered name can land after the host started typing,
 * and never replaces a display name the running series already has.
 */
export function fillRememberedDisplayNames(
  fields: DisplayNameFields,
  remembered: ReadonlyArray<BestOfDisplayName>,
): DisplayNameFields {
  const next = new Map(fields)
  for (const { userId, name } of remembered) {
    if (isFillable(fields.get(userId))) {
      next.set(userId, { value: name, filled: name, touched: false })
    }
  }
  return next
}

/** Returns the people on the sides whose remembered display name could still be filled in. */
export function getDisplayNamesToLoad(
  sides: Readonly<LobbyBestOfSides>,
  fields: DisplayNameFields,
): SbUserId[] {
  return sides.flat().filter(userId => isFillable(fields.get(userId)))
}

/**
 * Splits the people to look remembered display names up for into the requests the server takes,
 * each asking about at most as many people as both sides can hold.
 */
export function batchDisplayNameLookups(userIds: ReadonlyArray<SbUserId>): SbUserId[][] {
  const batchSize = BEST_OF_MAX_SIDE_SIZE * 2
  const batches: SbUserId[][] = []
  for (let i = 0; i < userIds.length; i += batchSize) {
    batches.push(userIds.slice(i, i + batchSize))
  }
  return batches
}

/** What the host entered on the series page. */
export interface SeriesSetupValues {
  /** A valid length (see `isValidBestOfLength`). */
  length: number
  playAll: boolean
  title: string
  sides: LobbyBestOfSides
  /** As typed, in side order. */
  sideNames: [side1: string, side2: string]
  displayNames: DisplayNameFields
  line1: string
  line2: string
  logo: LogoSlotValue
}

function trimmedSideNames(values: Pick<SeriesSetupValues, 'sideNames'>): LobbyBestOfSideNames {
  return [values.sideNames[0].trim() || null, values.sideNames[1].trim() || null]
}

/**
 * Lists the display name changes the fields make for the people on the sides, compared to the
 * display names `current` has (none, for a series being started):
 *
 * - a field holding a name other than the current one sets it
 * - an empty field clears the display name when the page had filled the field in or the person has
 *   one, which also makes the server forget the name it remembers for them
 * - anything else changes nothing, so a field that was simply left blank leaves alone whatever the
 *   server remembers (which the page may have failed to load)
 */
function getDisplayNameChanges(
  values: Pick<SeriesSetupValues, 'sides' | 'displayNames'>,
  current: Pick<LobbyBestOfJson, 'displayNames'>,
): BestOfDisplayNameChange[] {
  return values.sides.flat().flatMap((userId): BestOfDisplayNameChange[] => {
    const field = values.displayNames.get(userId)
    const name = field?.value.trim() ?? ''
    const currentName = getBestOfDisplayName(current, userId) ?? ''
    if (name) {
      return name !== currentName ? [{ userId, name }] : []
    }
    return field?.filled || currentName ? [{ userId, name: null }] : []
  })
}

/**
 * Builds the request that starts a series from what the host entered. The logo slot's starting
 * value decides what an empty slot means: removing a logo the slot opened with also forgets it as
 * the host's remembered logo, while a slot that opened empty (or unknown) sends nothing about it.
 * Display names follow the same idea (see `getDisplayNameChanges`).
 */
export function buildStartBestOfParams(
  values: SeriesSetupValues,
  initialLogo: LogoSlotValue,
): StartBestOfParams {
  const title = values.title.trim()
  const sideNames = trimmedSideNames(values)
  const displayNames = getDisplayNameChanges(values, {})
  const line1 = values.line1.trim()
  const line2 = values.line2.trim()
  return {
    length: values.length,
    ...(values.playAll ? { playAll: true } : {}),
    ...(title ? { title } : {}),
    sides: values.sides,
    ...(sideNames[0] || sideNames[1] ? { sideNames } : {}),
    ...(displayNames.length ? { displayNames } : {}),
    ...(line1 ? { line1 } : {}),
    ...(line2 ? { line2 } : {}),
    ...logoChange(values.logo, initialLogo),
  }
}

/**
 * Builds the request that saves the host's changes to a running series, holding only what differs
 * from the series as the page opened on it. Returns undefined when nothing changed, since the
 * server refuses a request that changes nothing.
 */
export function buildUpdateBestOfParams(
  editing: Pick<
    LobbyBestOfJson,
    'length' | 'playAll' | 'title' | 'sides' | 'sideNames' | 'displayNames' | 'overlay'
  >,
  values: SeriesSetupValues,
): UpdateBestOfParams | undefined {
  const title = values.title.trim()
  const sideNames = trimmedSideNames(values)
  const sideNamesChanged = ([0, 1] as const).some(
    side => sideNames[side] !== (getBestOfSideName(editing, side) ?? null),
  )
  const displayNames = getDisplayNameChanges(values, editing)
  const line1 = values.line1.trim()
  const line2 = values.line2.trim()

  const changes: UpdateBestOfParams = {
    ...(values.length !== editing.length ? { length: values.length } : {}),
    ...(values.playAll !== !!editing.playAll ? { playAll: values.playAll } : {}),
    ...(title !== (editing.title ?? '') ? { title: title || null } : {}),
    ...(!sameSides(values.sides, editing.sides) ? { sides: values.sides } : {}),
    // Both names go whenever either changed, since the server replaces them together.
    ...(sideNamesChanged ? { sideNames } : {}),
    ...(displayNames.length ? { displayNames } : {}),
    ...(line1 !== (editing.overlay?.line1 ?? '') ? { line1: line1 || null } : {}),
    ...(line2 !== (editing.overlay?.line2 ?? '') ? { line2: line2 || null } : {}),
    ...logoChange(values.logo, storedLogoSlot(editing.overlay?.logo)),
  }

  return Object.keys(changes).length > 0 ? changes : undefined
}

function logoChange(
  logo: LogoSlotValue,
  initialLogo: LogoSlotValue,
): Pick<StartBestOfParams, 'logo' | 'deleteLogo'> {
  if (logo.kind === 'picked') {
    return { logo: logo.file }
  } else if (logo.kind === 'none' && initialLogo.kind === 'stored') {
    return { deleteLogo: true }
  } else {
    return {}
  }
}

/**
 * The message a text field on the series page shows for text that can't be used, given the most
 * characters the field takes.
 */
export function bestOfTextProblemMessage(
  problem: BestOfTextProblem,
  maxLength: number,
  t: TFunction,
): string {
  switch (problem) {
    case 'tooLong':
      return t('lobbies.seriesSetup.textTooLong', {
        defaultValue: 'At most {{max}} characters',
        max: maxLength,
      })
    case 'invalidCharacters':
      return t(
        'lobbies.seriesSetup.textInvalidCharacters',
        "Contains characters that can't be used",
      )
    default:
      return problem satisfies never
  }
}

/**
 * Returns how saving a change to a running series' length or to whether it is played to its full
 * length would decide the series at once, given its current results, or `undefined` when the
 * change leaves it running (or doesn't touch its format). Such a save ends the series, so the page
 * asks the host first.
 */
export function getFormatChangeOutcome(
  running: Pick<LobbyBestOfJson, 'length' | 'playAll' | 'games' | 'outcome'>,
  changes: Pick<UpdateBestOfParams, 'length' | 'playAll'>,
): BestOfDecidedOutcome | undefined {
  if (running.outcome || (changes.length === undefined && changes.playAll === undefined)) {
    return undefined
  }
  const playAll = changes.playAll ?? !!running.playAll
  return getBestOfDecidedOutcome({
    length: changes.length ?? running.length,
    ...(playAll ? { playAll: true } : {}),
    games: running.games,
  })
}

/**
 * Says what a series' format means for how it is won, for the hint under the length on the series
 * page.
 */
export function bestOfFormatHint(
  { length, playAll }: Pick<LobbyBestOfJson, 'length' | 'playAll'>,
  t: TFunction,
): string {
  if (playAll) {
    return t('lobbies.seriesSetup.formatHintPlayAll', {
      defaultValue_one: '{{count}} game is played. The side that wins it takes the series.',
      defaultValue_other:
        'All {{count}} games are played. The side with more wins takes the series.',
      count: length,
    })
  }
  const winsNeeded = getBestOfWinsNeeded(length)
  return length % 2 === 0
    ? t('lobbies.seriesSetup.formatHintEven', {
        defaultValue: 'First to {{winsNeeded}} wins the series. It is drawn at {{half}}–{{half}}.',
        winsNeeded,
        half: length / 2,
      })
    : t('lobbies.seriesSetup.formatHintOdd', {
        defaultValue: 'First to {{winsNeeded}} wins the series.',
        winsNeeded,
      })
}

/**
 * Writes the series page's footer summary: its format, its two sides (with the score while it
 * runs), and its title. A part that has nothing to say is left out: the format while its length
 * isn't a valid one, the sides while either is empty, and the title while there is none.
 */
export function formatSeriesSetupSummary(
  t: TFunction,
  {
    format,
    sideLabels,
    score,
    title,
  }: {
    format: Pick<LobbyBestOfJson, 'length' | 'playAll'> | undefined
    /** Undefined while either side is empty. */
    sideLabels: [side1: string, side2: string] | undefined
    /** Given while the series runs. */
    score?: [number, number]
    title: string
  },
): string {
  let sidesPart: string | undefined
  if (sideLabels) {
    sidesPart = score
      ? t('lobbies.seriesSetup.summarySidesScore', {
          defaultValue: '{{side1}} {{score1}}–{{score2}} {{side2}}',
          side1: sideLabels[0],
          side2: sideLabels[1],
          score1: score[0],
          score2: score[1],
        })
      : t('lobbies.seriesSetup.summarySides', {
          defaultValue: '{{side1}} vs {{side2}}',
          side1: sideLabels[0],
          side2: sideLabels[1],
        })
  }

  return [format ? bestOfFormatLabel(format, t) : undefined, sidesPart, title.trim() || undefined]
    .filter(Boolean)
    .join(' · ')
}

/** Why a file picked for the logo was refused before anything was sent. */
export type LogoFileProblem =
  | { kind: 'type' }
  | { kind: 'size' }
  | { kind: 'dimensions'; width: number; height: number }
  | { kind: 'unreadable' }

const LOGO_EXTENSION_TYPES: ReadonlyArray<[extension: string, type: string]> = [
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]

/**
 * The type a picked logo file is offered as: what the browser reports for it, or, when it reports
 * nothing, what its extension says. The server tells the formats apart by content either way.
 */
function getLogoFileType(file: File): string {
  if (file.type) {
    return file.type
  }
  const name = file.name.toLowerCase()
  return LOGO_EXTENSION_TYPES.find(([extension]) => name.endsWith(extension))?.[1] ?? ''
}

/** Reads the pixel size of an image file by loading it locally. */
export function loadImageFileDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`could not load ${file.name} as an image`))
    }
    image.src = url
  })
}

/**
 * Checks a file picked for the logo against what the server accepts, as far as that can be told
 * locally: PNG, WebP or SVG, at most `BEST_OF_LOGO_MAX_SIZE_BYTES`, and for PNG and WebP at most
 * `BEST_OF_LOGO_MAX_DIMENSION` pixels on the longest side. Returns undefined for a file that
 * passes.
 */
export async function checkLogoFile(
  file: File,
  loadDimensions: (
    file: File,
  ) => Promise<{ width: number; height: number }> = loadImageFileDimensions,
): Promise<LogoFileProblem | undefined> {
  const type = getLogoFileType(file)
  if (!BEST_OF_LOGO_ACCEPTED_TYPES.includes(type)) {
    return { kind: 'type' }
  }
  if (file.size > BEST_OF_LOGO_MAX_SIZE_BYTES) {
    return { kind: 'size' }
  }
  if (type === 'image/svg+xml') {
    return undefined
  }

  try {
    const { width, height } = await loadDimensions(file)
    return Math.max(width, height) > BEST_OF_LOGO_MAX_DIMENSION
      ? { kind: 'dimensions', width, height }
      : undefined
  } catch {
    return { kind: 'unreadable' }
  }
}

/** The message the logo slot shows for a file refused before anything was sent. */
export function logoFileProblemMessage(problem: LogoFileProblem, t: TFunction): string {
  switch (problem.kind) {
    case 'type':
      return t('lobbies.seriesSetup.logoErrorType', 'Choose a PNG, WebP or SVG image.')
    case 'size':
      return t('lobbies.seriesSetup.logoErrorSize', {
        defaultValue: 'This file is larger than {{size}} MB.',
        size: BEST_OF_LOGO_MAX_SIZE_MB,
      })
    case 'dimensions':
      return t('lobbies.seriesSetup.logoErrorDimensions', {
        defaultValue:
          'This image is {{width}}×{{height}}. A PNG or WebP logo can be at most {{max}}px on its longest side.',
        width: problem.width,
        height: problem.height,
        max: BEST_OF_LOGO_MAX_DIMENSION,
      })
    case 'unreadable':
      return t('lobbies.seriesSetup.logoErrorUnreadable', "This image couldn't be read.")
    default:
      return problem satisfies never
  }
}

/**
 * Returns the message for a start or save the server refused because of its logo, which the page
 * shows on the logo slot, or undefined for a refusal about anything else.
 */
export function bestOfLogoErrorMessage(err: unknown, t: TFunction): string | undefined {
  if (!isFetchError(err)) {
    return undefined
  }
  if (err.status === 413 || err.code === FilesErrorCode.MaxFileSizeExceeded) {
    return logoFileProblemMessage({ kind: 'size' }, t)
  }

  switch (err.code as LobbyServiceErrorCode | undefined) {
    case LobbyServiceErrorCode.BestOfLogoInvalidFormat:
      return t(
        'lobbies.seriesSetup.logoErrorInvalidFormat',
        "This file isn't a PNG, WebP or SVG image that can be read.",
      )
    case LobbyServiceErrorCode.BestOfLogoTooLarge:
      return t('lobbies.seriesSetup.logoErrorTooLarge', {
        defaultValue:
          'This image is too large. A PNG or WebP logo can be at most {{max}}px on its longest side, and an SVG has to be drawable at a reasonable size.',
        max: BEST_OF_LOGO_MAX_DIMENSION,
      })
    case LobbyServiceErrorCode.BestOfLogoInappropriate:
      return t(
        'lobbies.seriesSetup.logoErrorInappropriate',
        "This image can't be used as a logo. Choose a different one.",
      )
    case LobbyServiceErrorCode.BestOfLogoUnsupportedSvg:
      return t(
        'lobbies.seriesSetup.logoErrorUnsupportedSvg',
        "This SVG uses something a logo can't have, such as an embedded image or a link to another file. Export it with everything drawn as shapes, or as a PNG.",
      )
    default:
      return undefined
  }
}
