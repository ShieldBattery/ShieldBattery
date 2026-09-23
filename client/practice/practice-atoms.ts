import { atom } from 'jotai'
import { atomWithImmer } from 'jotai-immer'
import { BotLibrarySnapshot } from '../../common/bots/bot-library'
import { BotView, buildBotViews } from '../../common/bots/bot-view'
import {
  PracticeGameRecord,
  PracticeStoreData,
  createDefaultPracticeStore,
} from '../../common/bots/practice'
import { LocalGameStatus } from '../../common/games/local-game'
import { RaceChar } from '../../common/races'

/** The latest bot library snapshot from the main process, or `undefined` before the first load. */
export const botLibraryAtom = atom<BotLibrarySnapshot | undefined>(undefined)

/** View models for every bot in the library, sorted by name. */
export const botViewsAtom = atom<BotView[]>(get => {
  const library = get(botLibraryAtom)
  return library ? buildBotViews(library) : []
})

/**
 * The persisted practice setup, presets and history. Edit through {@link updatePracticeStore} so
 * changes reach disk; reading it before {@link practiceStoreLoadedAtom} is true gives defaults.
 */
export const practiceStoreAtom = atomWithImmer<PracticeStoreData>(createDefaultPracticeStore())

export const practiceStoreLoadedAtom = atom(false)

/** Map hashes whose files the app has confirmed are in the local map store. */
export const installedMapHashesAtom = atomWithImmer<ReadonlySet<string>>(new Set())

/** Map hashes currently being downloaded for practice. */
export const downloadingMapHashesAtom = atomWithImmer<ReadonlySet<string>>(new Set())

export const localGameStatusAtom = atom<LocalGameStatus | undefined>(undefined)

/**
 * The practice game the user most recently started from this client: what was drawn or set up,
 * how the launch is going, and its outcome once known. Survives navigation so the result screen
 * and "play again" actions can use it.
 */
export interface PracticeSession {
  record: PracticeGameRecord
  /** Set while the launch request is in flight, before the main process reports a status. */
  launching: boolean
  /** A displayable reason the launch or game failed. */
  error?: string
  /** The race the player ended up with (differs from the setup when Random was chosen). */
  playerAssignedRace?: RaceChar
  /** Whether the result screen has been shown for this session. */
  resultShown: boolean
}

export const practiceSessionAtom = atomWithImmer<PracticeSession | undefined>(undefined)
