import { BotRaceName } from '../../common/bots/bot-catalog'
import { BotKey, PracticeBotSelection } from '../../common/bots/bot-library'
import { botFormatCompatibility, BotView } from '../../common/bots/bot-view'
import {
  canPlayPracticeRace,
  customGameType,
  HIDDEN_OPPONENT_NAME,
  PracticeBotRace,
  PracticeGameOpponent,
  PracticeGameRecord,
  PracticeLaunchRequest,
  resolvePracticeRace,
} from '../../common/bots/practice'
import { computePoolReadiness, drawMatchup, PoolReadiness } from '../../common/bots/practice-logic'
import { GameType } from '../../common/games/game-type'
import { TypedIpcRenderer } from '../../common/ipc'
import { MapInfoJson } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { closeDialog, openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { installBot } from './bot-actions'
import { effectivePoolMapIds } from './ladder-pool'
import {
  botViewsAtom,
  downloadingMapHashesAtom,
  installedMapHashesAtom,
  localGameStatusAtom,
  practiceSessionAtom,
  practiceStoreAtom,
} from './practice-atoms'
import { showPracticeResult } from './practice-result-navigation'
import { recordPracticeGame, updatePracticeStore } from './practice-store'

const ipcRenderer = new TypedIpcRenderer()

/** Names StarCraft accepts for the visible player: printable ASCII, at most 24 characters. */
const PLAYER_NAME_REGEX = /^[\x20-\x7e]{1,24}$/
const FALLBACK_PLAYER_NAME = 'Player'

export interface LaunchOpponent {
  bot: BotView
  race: PracticeBotRace
}

/** An opponent with any Random pick drawn, as it is launched and recorded. */
interface ResolvedOpponent {
  bot: BotView
  race: BotRaceName
  random: boolean
}

export interface LaunchPracticeGameParams {
  mode: 'matchmaking' | 'custom'
  map: MapInfoJson
  gameType: GameType.Melee | GameType.FreeForAll | GameType.TopVsBottom
  playerRace: RaceChar
  opponents: LaunchOpponent[]
  /** Conceal opponent identity: the in-game name is generic and the UI hides the draw. */
  hidden: boolean
  /** Watch the bots play each other from an observer seat instead of taking a slot. */
  observe?: boolean
}

/**
 * Tracks the launch currently in flight, so a cancel that lands between the map download and the
 * supervisor's reply still stops the game instead of leaving an orphaned session running.
 */
interface LaunchAttempt {
  cancelled: boolean
}

let currentAttempt: LaunchAttempt | undefined
let unwatchSession: (() => void) | undefined

function readSelfUserName(): string {
  let name: string | undefined
  dispatch((_, getState) => {
    name = getState().auth.self?.user.name
  })
  return name && PLAYER_NAME_REGEX.test(name) ? name : FALLBACK_PLAYER_NAME
}

function setDownloading(hashes: ReadonlyArray<string>, downloading: boolean): void {
  jotaiStore.set(downloadingMapHashesAtom, prev => {
    const next = new Set(prev)
    for (const hash of hashes) {
      if (downloading) {
        next.add(hash)
      } else {
        next.delete(hash)
      }
    }
    return next
  })
}

/** Refreshes {@link installedMapHashesAtom} for these maps from the local map store. */
export async function refreshInstalledMaps(maps: ReadonlyArray<MapInfoJson>): Promise<void> {
  if (maps.length === 0) {
    return
  }

  const present = await ipcRenderer.invoke(
    'mapStoreCheckMaps',
    maps.map(m => ({ hash: m.hash, format: m.mapData.format })),
  )
  if (!present) {
    return
  }

  const found = new Set(present)
  jotaiStore.set(installedMapHashesAtom, prev => {
    const next = new Set(prev)
    for (const map of maps) {
      if (found.has(map.hash)) {
        next.add(map.hash)
      } else {
        next.delete(map.hash)
      }
    }
    return next
  })
}

/** Downloads any of these maps that aren't in the local map store yet. */
export async function ensureMapsDownloaded(maps: ReadonlyArray<MapInfoJson>): Promise<void> {
  const installed = jotaiStore.get(installedMapHashesAtom)
  const needed = maps.filter(m => !installed.has(m.hash))
  if (needed.length === 0) {
    return
  }

  const hashes = needed.map(m => m.hash)
  setDownloading(hashes, true)
  try {
    for (const map of needed) {
      if (!map.mapUrl) {
        continue
      }
      await ipcRenderer.invoke('mapStoreDownloadMap', map.hash, map.mapData.format, map.mapUrl)
    }
  } finally {
    setDownloading(hashes, false)
  }

  await refreshInstalledMaps(needed)
}

function closeLaunchingDialog(): void {
  dispatch(closeDialog(DialogType.PracticeLaunching))
}

function stopWatching(): void {
  unwatchSession?.()
  unwatchSession = undefined
}

/**
 * Moves to the result screen once the game is over and there is something to show. A session that
 * was cancelled before it produced a result or an error just disappears.
 */
function maybeShowResult(sessionId: string): void {
  const status = jotaiStore.get(localGameStatusAtom)
  if (!status || status.id !== sessionId) {
    return
  }
  if (status.state !== 'finished' && status.state !== 'error') {
    return
  }

  closeLaunchingDialog()

  const session = jotaiStore.get(practiceSessionAtom)
  if (!session || session.record.sessionId !== sessionId) {
    return
  }
  if (!session.record.result && !session.error) {
    return
  }

  stopWatching()
  showPracticeResult()
}

function watchSession(sessionId: string): void {
  stopWatching()

  const onChange = () => {
    const status = jotaiStore.get(localGameStatusAtom)
    if (status?.id === sessionId && status.state === 'playing') {
      closeLaunchingDialog()
    }
    maybeShowResult(sessionId)
  }

  const unsubStatus = jotaiStore.sub(localGameStatusAtom, onChange)
  const unsubSession = jotaiStore.sub(practiceSessionAtom, onChange)
  unwatchSession = () => {
    unsubStatus()
    unsubSession()
  }
  onChange()
}

function toRecordOpponents(opponents: ReadonlyArray<ResolvedOpponent>): PracticeGameOpponent[] {
  return opponents.map(o => ({
    key: o.bot.key,
    releaseId: o.bot.releaseId,
    name: o.bot.name,
    version: o.bot.version,
    race: o.race,
    ...(o.random ? { random: true } : {}),
  }))
}

function toBotSelections(
  opponents: ReadonlyArray<ResolvedOpponent>,
  hidden: boolean,
): PracticeBotSelection[] {
  return opponents.map(o => ({
    key: o.bot.key,
    releaseId: o.bot.releaseId,
    race: o.race,
    inGameName: hidden ? HIDDEN_OPPONENT_NAME : undefined,
  }))
}

/**
 * Starts a practice game: shows the launch dialog, makes sure the map is on disk, asks the main
 * process to run the session, and keeps the result reachable afterwards. A failure leaves the saved
 * setup exactly as it was.
 */
export async function launchPracticeGame(params: LaunchPracticeGameParams): Promise<void> {
  const { mode, map, gameType, playerRace, hidden, observe = false } = params
  const opponents = params.opponents.map((o): ResolvedOpponent => ({
    bot: o.bot,
    race: resolvePracticeRace(o.race),
    random: o.race === 'random',
  }))

  const attempt: LaunchAttempt = { cancelled: false }
  currentAttempt = attempt
  stopWatching()

  dispatch(
    openDialog({
      type: DialogType.PracticeLaunching,
      initData: {
        onCancel: () => {
          cancelPracticeLaunch().catch(err => {
            logger.error(`Failed to cancel the practice launch: ${err?.stack ?? err}`)
          })
        },
      },
    }),
  )

  // Until the supervisor answers there is no session id, so this record stays in memory and is
  // never written to history.
  const pending: PracticeGameRecord = {
    sessionId: '',
    playerGameId: '',
    mode,
    startedAt: Date.now(),
    hidden,
    mapId: map.id,
    mapName: map.name,
    playerRace,
    opponents: toRecordOpponents(opponents),
    observed: observe,
    gameType,
  }
  jotaiStore.set(practiceSessionAtom, () => ({
    record: pending,
    launching: true,
    resultShown: false,
  }))

  try {
    await ensureMapsDownloaded([map])
    if (attempt.cancelled) {
      return
    }

    const request: PracticeLaunchRequest = {
      map,
      player: { name: readSelfUserName(), race: playerRace, observer: observe },
      gameType,
      bots: toBotSelections(opponents, hidden),
    }
    const status = await ipcRenderer.invoke('practiceGameStart', request)
    if (!status) {
      throw new Error('Practice games can only be started from the desktop app')
    }
    if (attempt.cancelled) {
      await ipcRenderer.invoke('localGameStop')
      return
    }

    const record: PracticeGameRecord = {
      ...pending,
      sessionId: status.id,
      playerGameId: status.playerGameId,
    }
    jotaiStore.set(practiceSessionAtom, () => ({
      record,
      launching: status.state === 'launching',
      resultShown: false,
    }))
    jotaiStore.set(localGameStatusAtom, status)
    recordPracticeGame(record)
    watchSession(status.id)
  } catch (err: any) {
    if (attempt.cancelled) {
      return
    }
    logger.error(`Failed to start a practice game: ${err?.stack ?? err}`)
    closeLaunchingDialog()
    jotaiStore.set(practiceSessionAtom, () => undefined)
    dispatch(
      openSimpleDialog(
        i18n.t('practice.launch.failedTitle', "Couldn't start the game"),
        err?.message ??
          i18n.t('practice.launch.failedGeneric', 'Something went wrong starting the game.'),
      ),
    )
  } finally {
    if (currentAttempt === attempt) {
      currentAttempt = undefined
    }
  }
}

/** Stops a launch in progress and forgets the session it would have produced. */
export async function cancelPracticeLaunch(): Promise<void> {
  if (currentAttempt) {
    currentAttempt.cancelled = true
  }
  stopWatching()
  closeLaunchingDialog()
  jotaiStore.set(practiceSessionAtom, () => undefined)

  try {
    await ipcRenderer.invoke('localGameStop')
  } catch (err: any) {
    logger.error(`Failed to stop the practice game: ${err?.stack ?? err}`)
  }
}

function currentReadiness(): PoolReadiness {
  const store = jotaiStore.get(practiceStoreAtom)
  return computePoolReadiness({
    lineup: store.matchmaking.lineup,
    bots: jotaiStore.get(botViewsAtom),
    poolMapIds: effectivePoolMapIds(store),
    knownMaps: store.knownMaps,
    installedMapHashes: jotaiStore.get(installedMapHashesAtom),
  })
}

/** How many separate things stand between the pool and a drawable matchup. */
function countProblemGroups(readiness: PoolReadiness): number {
  let groups = 0
  if (readiness.missingMaps.length > 0 || readiness.unknownMapIds.length > 0) {
    groups += 1
  }
  if (
    readiness.entries.some(
      e =>
        !e.bot ||
        e.bot.readiness.state === 'notInstalled' ||
        e.bot.readiness.state === 'installFailed',
    )
  ) {
    groups += 1
  }
  if (readiness.entries.some(e => e.bot?.readiness.state === 'missingRuntime')) {
    groups += 1
  }
  if (
    readiness.entries.some(
      e => e.bot && e.bot.readiness.state === 'ready' && e.playableMapIds.length === 0,
    )
  ) {
    groups += 1
  }
  return groups
}

function downloadLineupBots(readiness: PoolReadiness): void {
  for (const entry of readiness.entries) {
    if (entry.bot?.readiness.state === 'notInstalled' && entry.bot.readiness.canDownload) {
      installBot(entry.bot).catch(err => {
        logger.error(`Failed to install a practice bot: ${err?.stack ?? err}`)
      })
    }
  }
}

function downloadPoolMaps(readiness: PoolReadiness): void {
  ensureMapsDownloaded(readiness.missingMaps).catch(err => {
    logger.error(`Failed to download practice maps: ${err?.stack ?? err}`)
  })
}

function removeFromLineup(key: BotKey): void {
  updatePracticeStore(draft => {
    draft.matchmaking.lineup = draft.matchmaking.lineup.filter(b => b.key !== key)
  })
}

function drawAndLaunch(readiness: PoolReadiness): void {
  const store = jotaiStore.get(practiceStoreAtom)
  const previousKey = store.history[0]?.opponents[0]?.key
  const drawn = drawMatchup(readiness, previousKey)
  if (!drawn) {
    return
  }

  const map = readiness.installedMaps.find(m => m.id === drawn.mapId)
  if (!map) {
    return
  }

  launchPracticeGame({
    mode: 'matchmaking',
    map,
    gameType: GameType.Melee,
    playerRace: store.matchmaking.playerRace,
    opponents: [{ bot: drawn.bot, race: drawn.race }],
    hidden: store.matchmaking.hideOpponent,
  }).catch(err => {
    logger.error(`Failed to launch a practice game: ${err?.stack ?? err}`)
  })
}

/**
 * The practice matchmaking Start action: checks the pool, explains anything blocking a draw, then
 * draws a map, an opponent and a race that opponent supports and starts the game.
 */
export function startPracticeMatchmaking(): void {
  const readiness = currentReadiness()

  if (!readiness.canDraw) {
    const payload =
      countProblemGroups(readiness) > 1
        ? ({
            kind: 'problems',
            readiness,
            onDownloadBots: () => downloadLineupBots(readiness),
            onEditLineup: () => push('/play/practice/setup'),
            onChangeMapPool: () => push('/play/practice/setup'),
            onRemoveBot: removeFromLineup,
            onStartWithReady: () => startPracticeMatchmaking(),
          } as const)
        : ({
            kind: 'nothingPlayable',
            readiness,
            onDownloadMaps: () => downloadPoolMaps(readiness),
            onDownloadBots: () => downloadLineupBots(readiness),
            onChangeMapPool: () => push('/play/practice/setup'),
            onEditLineup: () => push('/play/practice/opponents'),
          } as const)
    dispatch(openDialog({ type: DialogType.PracticeReadiness, initData: payload }))
    return
  }

  const store = jotaiStore.get(practiceStoreAtom)
  const partial = readiness.playableEntries.length < readiness.entries.length
  if (partial && !store.matchmaking.skipPartialLineupWarning) {
    dispatch(
      openDialog({
        type: DialogType.PracticeReadiness,
        initData: {
          kind: 'partialLineup',
          readiness,
          onStartAnyway: (dontAskAgain: boolean) => {
            if (dontAskAgain) {
              updatePracticeStore(draft => {
                draft.matchmaking.skipPartialLineupWarning = true
              })
            }
            drawAndLaunch(readiness)
          },
          onFixFirst: () => push('/play/practice/setup'),
        },
      }),
    )
    return
  }

  drawAndLaunch(readiness)
}

function removeCustomGameSlot(key: BotKey): void {
  updatePracticeStore(draft => {
    draft.customGame.slots = draft.customGame.slots.filter(s => s.bot.key !== key)
  })
}

/**
 * The custom game Start action: every filled slot must be able to play, with a race the bot
 * supports, on a map big enough for everyone.
 */
export function startCustomGame(): void {
  const store = jotaiStore.get(practiceStoreAtom)
  const setup = store.customGame
  const bots = jotaiStore.get(botViewsAtom)

  const map = setup.mapId ? store.knownMaps[setup.mapId] : undefined
  if (!map) {
    dispatch(
      openSimpleDialog(
        i18n.t('practice.customGame.noMapTitle', 'Pick a map'),
        i18n.t('practice.customGame.noMapText', 'Choose a map before starting the game.'),
      ),
    )
    return
  }
  const observe = !!setup.observe
  if (observe && setup.slots.length < 2) {
    dispatch(
      openSimpleDialog(
        i18n.t('practice.customGame.needTwoBotsTitle', 'Add another bot'),
        i18n.t('practice.customGame.needTwoBotsText', 'Watching needs at least two bots.'),
      ),
    )
    return
  }
  if (setup.slots.length === 0) {
    dispatch(
      openSimpleDialog(
        i18n.t('practice.customGame.noOpponentsTitle', 'Add an opponent'),
        i18n.t('practice.customGame.noOpponentsText', 'A game needs at least one bot opponent.'),
      ),
    )
    return
  }
  if (map.mapData.slots < setup.slots.length + (observe ? 0 : 1)) {
    dispatch(
      openSimpleDialog(
        i18n.t('practice.customGame.tooManyPlayersTitle', 'Not enough slots'),
        i18n.t('practice.customGame.tooManyPlayersText', {
          defaultValue:
            '{{mapName}} only has {{slots}} slots. Remove an opponent or pick a bigger map.',
          mapName: map.name,
          slots: map.mapData.slots,
        }),
      ),
    )
    return
  }

  const opponents: LaunchOpponent[] = []
  for (const slot of setup.slots) {
    const bot = bots.find(b => b.key === slot.bot.key)
    if (!bot) {
      dispatch(
        openSimpleDialog(
          i18n.t('practice.customGame.missingBotTitle', 'Opponent unavailable'),
          i18n.t('practice.customGame.missingBotText', {
            defaultValue:
              '{{name}} is no longer in your bot library. Remove it or pick another bot.',
            name: slot.bot.name,
          }),
        ),
      )
      return
    }

    if (!canPlayPracticeRace(bot.races, slot.race)) {
      dispatch(
        openDialog({
          type: DialogType.PracticeReadiness,
          initData: {
            kind: 'incompatibleRace',
            bot,
            race: slot.race,
            onSetRace: (race: BotRaceName) => {
              updatePracticeStore(draft => {
                const target = draft.customGame.slots.find(s => s.bot.key === bot.key)
                if (target) {
                  target.race = race
                }
              })
            },
            onRemove: () => removeCustomGameSlot(bot.key),
          },
        }),
      )
      return
    }

    if (bot.readiness.state !== 'ready') {
      openNotReadyDialog(bot)
      return
    }

    // Each bot faces the other bots, plus the human when the human plays.
    const compat = botFormatCompatibility(
      bot,
      customGameType(setup),
      observe ? setup.slots.length - 1 : setup.slots.length,
    )
    if (compat.support === 'incompatible') {
      dispatch(
        openSimpleDialog(
          i18n.t('practice.customGame.incompatibleFormatTitle', 'Unsupported game type'),
          compat.notes ??
            i18n.t('practice.customGame.incompatibleFormatText', {
              defaultValue: "{{name}} can't play this kind of game.",
              name: bot.name,
            }),
        ),
      )
      return
    }

    opponents.push({ bot, race: slot.race })
  }

  launchPracticeGame({
    mode: 'custom',
    map,
    gameType: customGameType(setup),
    playerRace: store.matchmaking.playerRace,
    opponents,
    hidden: false,
    observe,
  }).catch(err => {
    logger.error(`Failed to launch a practice game: ${err?.stack ?? err}`)
  })
}

function openNotReadyDialog(bot: BotView): void {
  switch (bot.readiness.state) {
    case 'missingRuntime':
      dispatch(
        openDialog({
          type: DialogType.PracticeReadiness,
          initData: { kind: 'missingRuntime', bot },
        }),
      )
      break
    case 'installFailed':
      dispatch(
        openDialog({
          type: DialogType.PracticeReadiness,
          initData: {
            kind: 'downloadFailed',
            bot,
            onRemove: () => removeCustomGameSlot(bot.key),
          },
        }),
      )
      break
    case 'notInstalled':
      // A chosen but uninstalled bot is a download waiting to happen, so start it and show the
      // same progress dialog an already-running install gets.
      installBot(bot).catch(err => {
        logger.error(`Failed to install a practice bot: ${err?.stack ?? err}`)
      })
      dispatch(
        openDialog({ type: DialogType.PracticeReadiness, initData: { kind: 'downloading', bot } }),
      )
      break
    case 'installing':
      dispatch(
        openDialog({ type: DialogType.PracticeReadiness, initData: { kind: 'downloading', bot } }),
      )
      break
    default:
      dispatch(
        openSimpleDialog(
          i18n.t('practice.customGame.botNotReadyTitle', 'Opponent not ready'),
          i18n.t('practice.customGame.botNotReadyText', {
            defaultValue: "{{name}} can't run right now. Check its details for what's missing.",
            name: bot.name,
          }),
        ),
      )
      break
  }
}
