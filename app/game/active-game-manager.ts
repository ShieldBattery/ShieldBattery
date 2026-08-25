import { HKCU, REG_SZ, WindowsRegistry } from '@shieldbattery/windows-registry'
import { app, screen } from 'electron'
import { EventEmitter } from 'node:events'
import { promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { singleton } from 'tsyringe'
import { getErrorStack } from '../../common/errors'
import {
  GameDebugScreenshot,
  GameDebugScreenshotReply,
  GameDebugState,
} from '../../common/games/game-debug'
import {
  GameLaunchConfig,
  isReplayLaunchConfig,
  isReplayMapInfo,
} from '../../common/games/game-launch-config'
import {
  GameNetworkStatus,
  GameStatus,
  ReportedGameStatus,
  statusToString,
} from '../../common/games/game-status'
import { NetcodeV2ServerSetup, NetcodeV2Setup } from '../../common/games/netcode-v2'
import { GameClientPlayerResult } from '../../common/games/results'
import { SlotType } from '../../common/lobbies/slot'
import { DEFAULT_LOCAL_SETTINGS } from '../../common/settings/default-settings'
import {
  cloneCustomTeamColors,
  resolveFfaColors,
  resolveSeatlessTeamColors,
  resolveTeamColors,
  resolveTeamSelfOverride,
} from '../../common/settings/team-colors'
import { SbUserId } from '../../common/users/sb-user-id'
import { gameLogBaseName } from '../log-paths'
import log from '../logger'
import { LocalSettingsManager, ScrSettingsManager } from '../settings'
import { checkStarcraftPath } from './check-starcraft-path'
import { MapStore } from './map-store'
import { NetcodeV2KeyRing } from './netcode-v2-key-ring'
import { generateNetcodeV2KeyPair, NetcodeV2KeyPair } from './netcode-v2-keys'

// Fixed local UDP port for the game's netcode endpoint (normally ephemeral). A dev aid: pinning a
// known per-client port lets traffic-shaping tools that filter by port (e.g. clumsy) target a
// single client when several run on one machine. Unset/invalid values leave the port ephemeral.
const RALLY_POINT_PORT = Number(process.env.SB_RALLY_POINT_PORT ?? 0)

// How long to wait for a `/game/debug/state` reply before giving up. A release DLL doesn't
// recognize `debugControl` at all, so a query to one never gets a reply and always times out.
const DEBUG_QUERY_TIMEOUT_MS = 5000
// Screenshot capture + PNG encoding is heavier than a state snapshot, so it gets a longer timeout.
// Same "release DLL never replies" semantics as `DEBUG_QUERY_TIMEOUT_MS` apply.
const DEBUG_SCREENSHOT_TIMEOUT_MS = 10000

interface PendingDebugReply<T> {
  resolve: (payload: T) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ActiveGameInfo {
  id: string
  status?: {
    state: GameStatus
    extra: any // TODO(tec27): Type the extra param based on the GameStatus
  }
  /**
   * A promise for when the game process has been launched, returning an instance of the process.
   */
  promise?: Promise<any>
  config?: GameLaunchConfig
  /**
   * The per-session netcode v2 keypair for this game, selected from the manager's key ring once the
   * server's handoff ({@link ActiveGameManager.setNetcodeV2Setup}) names which public key it embedded
   * in this game's session token. The private key is held here (never sent to the server) until it's
   * merged into the game process handoff. Stays set across a relaunch of the same game id -- once a
   * game has adopted a keypair, it keeps it regardless of what the ring holds afterward.
   */
  netcodeV2Keys?: NetcodeV2KeyPair
  /**
   * The complete netcode v2 handoff for the game process (server setup + local private key). For
   * games using netcode v2 this must be delivered before `setupGame`.
   */
  netcodeV2Setup?: NetcodeV2Setup
  /**
   * The results of the game delivered once our local process has completed.
   */
  result?: {
    result: Record<SbUserId, GameClientPlayerResult>
    /** How long the game was played, in milliseconds. */
    time: number
  }
  /**
   * The path to the temporary replay file that is pending upload. This is the path used by the
   * game DLL when saving a replay for upload purposes.
   */
  tempReplayPath?: string
  /**
   * Whether or not the replay was successfully uploaded to the server by the game process.
   */
  replayUploaded?: boolean
  /**
   * Which turn transport the game ended up using, reported once via `/game/networkStatus` during
   * game init.
   */
  networkStatus?: GameNetworkStatus
}

function isGameConfig(
  possibleConfig: GameLaunchConfig | Record<string, never>,
): possibleConfig is GameLaunchConfig {
  return !!(possibleConfig as any).setup
}

export interface ResendReplayRequest {
  gameId: string
  userId: SbUserId
  resultCode: string
  replayPath: string
}

export type ActiveGameManagerEvents = {
  gameCommand: [gameId: string, command: string, ...args: any[]]
  gameResult: [
    info: {
      gameId: string
      /** A mapping of player user ID -> result. */
      result: Record<SbUserId, GameClientPlayerResult>
      /** The time the game took in milliseconds. */
      time: number
    },
  ]
  gameStatus: [statusInfo: ReportedGameStatus]
  replaySaved: [gameId: string, path: string]
  resendReplay: [request: ResendReplayRequest]
}

@singleton()
export class ActiveGameManager extends EventEmitter<ActiveGameManagerEvents> {
  private activeGame: ActiveGameInfo | null = null
  /**
   * Every recent per-session netcode v2 keypair generated by a queue/lobby join (via
   * {@link generateNetcodeV2SessionKeys}), keyed by public key. A player can trigger more than one
   * join in a row before a game launches (double-click, a UI retry), each generating its own
   * keypair and submitting its own pubkey to the server; the server seats the player using whichever
   * join it happened to process, not necessarily the last one generated. Keeping a small ring rather
   * than a single slot means {@link setNetcodeV2Setup} can look the right keypair up by the exact
   * pubkey the server echoes back, instead of guessing it's always the most recent.
   *
   * Entries are deliberately never cleaned up on their own (search canceled, lobby left): the
   * private half never leaves this process, and a keypair is only ever adopted by a launched game
   * whose server-side pubkey came from the same join that generated it — so an orphaned entry is
   * harmless and just ages out via the ring's normal capacity eviction.
   */
  private pendingNetcodeV2Keys = new NetcodeV2KeyRing()
  private serverPort = 0
  /** FIFO queues of pending `debugQueryState` requests, keyed by game ID. */
  private pendingDebugQueries = new Map<string, PendingDebugReply<GameDebugState>[]>()
  /** FIFO queues of pending `debugScreenshot` requests, keyed by game ID. */
  private pendingDebugScreenshots = new Map<string, PendingDebugReply<GameDebugScreenshotReply>[]>()

  constructor(
    private mapStore: MapStore,
    private localSettings: LocalSettingsManager,
    private scrSettings: ScrSettingsManager,
  ) {
    super()
  }

  getStatus(): ReportedGameStatus | null {
    const game = this.activeGame
    if (game) {
      return {
        id: game.id,
        state: statusToString(game.status?.state ?? GameStatus.Unknown),
        extra: game.status?.extra,
        isReplay: game.config ? isReplayLaunchConfig(game.config) : false,
        networkStatus: game.networkStatus,
      }
    } else {
      return null
    }
  }

  setServerPort(port: number) {
    this.serverPort = port
  }

  clearGameConfig(gameId: string) {
    if (this.activeGame?.id === gameId) {
      log.verbose(`Got clearGameConfig for ${gameId}, quitting`)
      this.emit('gameCommand', gameId, 'quit')
      this.setStatus(GameStatus.Unknown)
      this.activeGame = null
      this.rejectPendingDebugQueries(gameId, 'Game config cleared')
    } else {
      log.verbose(`Got clearGameConfig for ${gameId}, but it is not the active game`)
    }
  }

  /**
   * Sets the current game configuration. If this differs from the previous one, a new game client
   * will be launched.
   *
   * @returns the ID of the active game client, or null if there isn't one
   */
  setGameConfig(config: GameLaunchConfig | Record<string, never>): string | null {
    const current = this.activeGame
    if (current && current.id !== config.setup?.gameId) {
      // Means that a previous game left hanging somehow; quit it
      this.emit('gameCommand', current.id, 'quit')
    }
    if (!isGameConfig(config)) {
      this.setStatus(GameStatus.Unknown)
      this.activeGame = null
      return null
    }

    const gameId = config.setup.gameId
    const activeGamePromise = doLaunch(
      gameId,
      this.serverPort,
      this.localSettings,
      this.scrSettings,
    ).then(
      async proc => {
        try {
          const code = await proc.waitForExit()
          this.handleGameExit(gameId, code)
        } catch (err) {
          this.handleGameExitWaitError(gameId, err as Error)
        }
      },
      err => this.handleGameLaunchError(gameId, err),
    )
    // A relaunch of the *same* game id carries that game's already-selected keypair and session
    // handoff forward — reusing them is correct since it's the same session. A *different* game id
    // must not inherit the old (hung) game's session, so it starts with no keypair adopted yet:
    // {@link setNetcodeV2Setup} selects one from the ring once the server's handoff names which
    // pubkey it actually used, which may not be the most recently generated one.
    const carried = current?.id === gameId ? current : undefined
    this.activeGame = {
      ...current,
      netcodeV2Keys: carried?.netcodeV2Keys,
      netcodeV2Setup: carried?.netcodeV2Setup,
      // A fresh launch's transport is unknown until the new game's init reports it; this also
      // applies when relaunching the same game id, so don't carry it over from `current` either.
      networkStatus: undefined,
      id: gameId,
      promise: activeGamePromise,
      config,
      status: { state: GameStatus.Unknown, extra: null },
    }
    log.verbose(`Creating new game ${gameId}`)
    this.setStatus(GameStatus.Launching)
    return gameId
  }

  /**
   * Generates a fresh per-session netcode v2 keypair, adds it to the ring for a later launched game
   * to adopt, and returns the base64 raw public key (submitted to the server at queue/lobby-join
   * time). The private key never leaves this process except in the game-process handoff.
   */
  generateNetcodeV2SessionKeys(): string {
    const keyPair = generateNetcodeV2KeyPair()
    this.pendingNetcodeV2Keys.push(keyPair)
    return keyPair.publicKey
  }

  /**
   * Delivers the server's netcode v2 session handoff. The first time this fires for a game, it
   * selects the keypair matching `setup.clientPubkey` from the ring (or the most recently generated
   * one, for a server too old to echo the pubkey back) and adopts it for the game's lifetime — a
   * later relaunch of the same game id reuses that adopted keypair rather than re-selecting, so it
   * can't drift even if the ring's contents change in between. Once adopted, the keypair is merged
   * with the setup and forwarded to the game process ahead of its game setup.
   */
  setNetcodeV2Setup(gameId: string, setup: NetcodeV2ServerSetup) {
    const current = this.activeGame
    if (!current || current.id !== gameId) {
      log.verbose(`Got setNetcodeV2Setup for ${gameId}, but it is not the active game`)
      return
    }
    const keys =
      current.netcodeV2Keys ??
      (setup.clientPubkey !== undefined
        ? this.pendingNetcodeV2Keys.get(setup.clientPubkey)
        : this.pendingNetcodeV2Keys.mostRecent())
    if (!keys) {
      // The server can only have gotten a token for a pubkey we generated, so this indicates a
      // server/client flow bug (or a ring eviction from an unreasonable number of joins) rather than
      // an expected state. Quit the (already-launched) game process rather than leaving it orphaned
      // on the loading screen.
      this.emit('gameCommand', gameId, 'quit')
      this.setStatus(
        GameStatus.Error,
        new Error('Received netcode v2 setup with no matching generated keypair'),
      )
      this.activeGame = null
      return
    }

    current.netcodeV2Keys = keys
    current.netcodeV2Setup = { ...setup, clientPrivateKey: keys.privateKey }
    this.maybeSendGameSetup(current)
  }

  /**
   * Sends the game setup command (preceded by everything it depends on) once every input has
   * arrived: the config always, plus the netcode v2 handoff for games using it. The game process
   * consumes the netcode v2 setup when its game init starts, so it must be delivered before
   * `setupGame`.
   *
   * May fire before the game process has connected — those sends go nowhere, and
   * `handleGameConnected` re-runs this once the process is ready. Takes the game explicitly (not
   * `this.activeGame`) so callers that suspended across an await operate on the game they
   * captured, not one that replaced it in the meantime.
   */
  private maybeSendGameSetup(game: ActiveGameInfo) {
    if (!game.config) {
      return
    }
    if (game.config.setup.useNetcodeV2 && !game.netcodeV2Setup) {
      return
    }

    if (game.netcodeV2Setup) {
      this.emit('gameCommand', game.id, 'netcodeV2Setup', game.netcodeV2Setup)
    }
    this.emit('gameCommand', game.id, 'setupGame', game.config.setup)
  }

  /** Notifies the manager that a game instance has connected and is ready for configuration. */
  async handleGameConnected(id: string) {
    if (!this.activeGame || this.activeGame.id !== id) {
      // Not our active game, must be one we started before and abandoned
      this.emit('gameCommand', id, 'quit')
      log.verbose(`Game ${id} is not any of our active games, sending quit command`)
      return
    }

    const game = this.activeGame
    this.setStatus(GameStatus.Configuring)
    const config = game.config!
    const { map } = config.setup
    config.setup.mapPath = isReplayMapInfo(map)
      ? map.path
      : this.mapStore.getPath(map.hash, map.mapData.format)

    const local = await this.localSettings.get()
    // The stored settings should already have every field populated (via the defaults/migration
    // in `app/settings.ts`), but fall back to the defaults for anything that's still missing so
    // the resolvers below always have complete team-color settings to work with.
    const resolvedLocal = {
      ...DEFAULT_LOCAL_SETTINGS,
      ...local,
      customTeamColors:
        local.customTeamColors ?? cloneCustomTeamColors(DEFAULT_LOCAL_SETTINGS.customTeamColors),
      customFfaColors: local.customFfaColors ?? [...DEFAULT_LOCAL_SETTINGS.customFfaColors],
    }
    const desiredMonitorBounds =
      local.monitorId !== undefined
        ? screen.getAllDisplays().find(d => d.id === local.monitorId)?.bounds
        : undefined
    const monitorBounds = desiredMonitorBounds
      ? [
          desiredMonitorBounds.x,
          desiredMonitorBounds.y,
          desiredMonitorBounds.width,
          desiredMonitorBounds.height,
        ]
      : undefined

    // A viewer with no seat (replay watcher or observer) gets the seatless resolution, which
    // degrades relational palettes that assume a "you" exists.
    const seatless =
      isReplayLaunchConfig(config) ||
      config.setup.slots.some(s => s.type === SlotType.Observer && s.userId === config.localUser.id)
    const resolvedTeamColors = seatless
      ? resolveSeatlessTeamColors(resolvedLocal)
      : resolveTeamColors(resolvedLocal)

    this.emit('gameCommand', id, 'localUser', config.localUser)
    this.emit('gameCommand', id, 'blockedUsers', config.blockedUsers)
    this.emit('gameCommand', id, 'serverConfig', config.serverConfig)
    this.emit('gameCommand', id, 'settings', {
      local,
      scr: await this.scrSettings.get(),
      settingsFilePath: this.scrSettings.gameFilepath,
      monitorBounds,
      // `local` only stores the active preset *names* plus the custom pools; the DLL has no
      // preset tables of its own, so the active preset is mapped to concrete colors here and the
      // DLL only ever receives resolved hex pools.
      teamColors: {
        usage: resolvedLocal.teamColorUsage,
        shuffle: resolvedLocal.shuffleColors,
        team: resolvedTeamColors,
        teamSelf: resolveTeamSelfOverride(resolvedLocal, resolvedTeamColors) ?? null,
        ffa: resolveFfaColors(resolvedLocal),
        ffaSelf: resolvedLocal.ffaSelfColor ?? null,
      },
    })

    this.maybeSendGameSetup(game)
  }

  handleGameLaunchError(id: string, err: Error) {
    log.error(`Error while launching game ${id}: ${err.stack}`)
    if (this.activeGame && this.activeGame.id === id) {
      this.setStatus(GameStatus.Error, err)
      this.activeGame = null
    }
  }

  handleSetupProgress(gameId: string, info: any) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this.setStatus(info.state, info.extra)
  }

  handleGameStart(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this.setStatus(GameStatus.Playing)
  }

  handleNetworkStatus(gameId: string, info: GameNetworkStatus) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    log.verbose(`Game network status: ${JSON.stringify(info)}`)
    this.activeGame.networkStatus = info
    this.emit('gameStatus', this.getStatus()!)
  }

  /**
   * Queries the active game process's debug state (debug game builds only). Defaults `gameId` to
   * the current active game, rejecting if there isn't one or it doesn't match. Rejects on a
   * {@link DEBUG_QUERY_TIMEOUT_MS} timeout since a build that doesn't support the underlying
   * `debugControl` command never replies.
   */
  debugQueryState(gameId?: string): Promise<GameDebugState> {
    const id = gameId ?? this.activeGame?.id
    if (!id || !this.activeGame || this.activeGame.id !== id) {
      return Promise.reject(
        new Error(
          gameId ? `No active game matching '${gameId}' to query` : 'No active game to query',
        ),
      )
    }

    const result = this.enqueuePendingDebugReply(
      this.pendingDebugQueries,
      id,
      DEBUG_QUERY_TIMEOUT_MS,
      `Timed out waiting for debug state from game ${id} (it may not be a debug build)`,
    )
    this.emit('gameCommand', id, 'debugControl', { type: 'queryState' })
    return result
  }

  /** Resolves the oldest pending `debugQueryState` request for `gameId`, if any. */
  handleDebugState(gameId: string, payload: GameDebugState) {
    this.resolvePendingDebugReply(this.pendingDebugQueries, gameId, payload, 'debug state')
  }

  /**
   * Tells the active game process to force a synced leave of a rally-point2 slot (debug game
   * builds only). Fire-and-forget: there's no reply, callers verify the effect via
   * {@link debugQueryState}.
   */
  forceGameLeave(gameId: string, slot: number): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got forceGameLeave for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'debugControl', { type: 'forceUnsyncedLeave', slot })
  }

  /**
   * Tells the active game process to deliberately desync this client's simulation from its peers by
   * perturbing the local player's minerals (debug game builds only). Fire-and-forget: there's no
   * reply, the effect is observed in-game / via the netcode behavior it triggers.
   */
  forceGameDesync(gameId: string): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got forceGameDesync for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'debugControl', { type: 'forceDesync' })
  }

  /**
   * Tells the active game process to send an in-game chat message over its netcode v2 session, as
   * this client (debug game builds only), through the same send path the in-game chat box's own
   * Enter-key send uses. Fire-and-forget: there's no reply; verify via a peer's rendered chat, or
   * this client's own via {@link debugQueryState}'s `turnState.chatLog`.
   */
  sendGameChat(gameId: string, text: string): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got sendGameChat for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'debugControl', { type: 'sendChat', text })
  }

  /**
   * Tells the active game process to submit a manual drop request for a disconnected rally-point2
   * slot over its netcode v2 session (debug game builds only), the same request the in-game
   * disconnect overlay's Drop button makes. Fire-and-forget: there's no reply; the relay honors it
   * only once the slot has been down past its floor, and confirms it solely via the slot's synced
   * leave. Verify via {@link debugQueryState}'s `turnState.disconnect.rows`.
   */
  requestGameDrop(gameId: string, slot: number): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got requestGameDrop for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'debugControl', { type: 'requestDrop', slot })
  }

  /**
   * Toggles the active game process's in-game network-stats (`/netstat`) overlay (debug game builds
   * only), the same toggle the `/netstat` chat command makes. Fire-and-forget: there's no reply;
   * verify via {@link debugQueryState}'s `turnState.netStats` (the `visible` flag, plus the per-slot
   * stats under `rows`).
   */
  toggleGameNetStats(gameId: string): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got toggleGameNetStats for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'debugControl', { type: 'toggleNetStats' })
  }

  /**
   * Tells the active game process to quit abruptly (debug game builds only, but the underlying
   * `quit` command ships in all builds). This is a hard stop: it cancels the game process's async
   * runtime so the process exits even mid-game (when a graceful `cleanup_and_quit` can't run,
   * because the game thread is blocked inside the game loop) — so it does NOT run BW's exit cleanup
   * or save settings. Routes through the app so this manager tears down its own state cleanly,
   * unlike an external process kill. Fire-and-forget.
   */
  forceQuitGame(gameId: string): void {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      log.verbose(`Got forceQuitGame for ${gameId}, but it is not the active game`)
      return
    }

    this.emit('gameCommand', gameId, 'quit')
  }

  /**
   * Captures a screenshot from the active game process (debug game builds only). Defaults
   * `gameId` to the current active game, rejecting if there isn't one or it doesn't match. Rejects
   * on a {@link DEBUG_SCREENSHOT_TIMEOUT_MS} timeout since a build that doesn't support the
   * underlying `debugControl` command never replies, and rejects if the DLL reports a capture
   * error. On success, decodes the PNG and writes it to a file in the OS temp dir, resolving its
   * path and dimensions.
   */
  async debugScreenshot(gameId?: string): Promise<GameDebugScreenshot> {
    const id = gameId ?? this.activeGame?.id
    if (!id || !this.activeGame || this.activeGame.id !== id) {
      throw new Error(
        gameId
          ? `No active game matching '${gameId}' to screenshot`
          : 'No active game to screenshot',
      )
    }

    const replyPromise = this.enqueuePendingDebugReply(
      this.pendingDebugScreenshots,
      id,
      DEBUG_SCREENSHOT_TIMEOUT_MS,
      `Timed out waiting for debug screenshot from game ${id} (it may not be a debug build)`,
    )
    this.emit('gameCommand', id, 'debugControl', { type: 'screenshot' })
    const reply = await replyPromise

    if (!reply.screenshot) {
      throw new Error(reply.error ?? 'Game process reported a screenshot capture error')
    }

    const { width, height, pngBase64 } = reply.screenshot
    const filePath = path.join(os.tmpdir(), `sb-game-screenshot-${id}-${Date.now()}.png`)
    await fsPromises.writeFile(filePath, Buffer.from(pngBase64, 'base64'))

    return { path: filePath, width, height }
  }

  /** Resolves the oldest pending `debugScreenshot` request for `gameId`, if any. */
  handleDebugScreenshot(gameId: string, payload: GameDebugScreenshotReply) {
    this.resolvePendingDebugReply(this.pendingDebugScreenshots, gameId, payload, 'debug screenshot')
  }

  /**
   * Registers a pending debug reply for `gameId` in `map`, returning a promise that resolves when
   * a matching reply arrives (via {@link resolvePendingDebugReply}) or rejects after `timeoutMs`
   * with `timeoutMessage`, or on game teardown (via {@link rejectPendingDebugQueries}).
   */
  private enqueuePendingDebugReply<T>(
    map: Map<string, PendingDebugReply<T>[]>,
    gameId: string,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: PendingDebugReply<T> = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removePendingDebugReply(map, gameId, entry)
          reject(new Error(timeoutMessage))
        }, timeoutMs),
      }

      const queue = map.get(gameId) ?? []
      queue.push(entry)
      map.set(gameId, queue)
    })
  }

  /** Resolves the oldest pending entry for `gameId` in `map`, if any. */
  private resolvePendingDebugReply<T>(
    map: Map<string, PendingDebugReply<T>[]>,
    gameId: string,
    payload: T,
    logLabel: string,
  ) {
    const queue = map.get(gameId)
    const entry = queue?.shift()
    if (!entry) {
      log.verbose(`Got ${logLabel} for ${gameId} but none was pending`)
      return
    }
    if (queue!.length === 0) {
      map.delete(gameId)
    }

    clearTimeout(entry.timer)
    entry.resolve(payload)
  }

  private removePendingDebugReply<T>(
    map: Map<string, PendingDebugReply<T>[]>,
    gameId: string,
    entry: PendingDebugReply<T>,
  ) {
    const queue = map.get(gameId)
    if (!queue) {
      return
    }
    const index = queue.indexOf(entry)
    if (index !== -1) {
      queue.splice(index, 1)
    }
    if (queue.length === 0) {
      map.delete(gameId)
    }
  }

  /** Rejects and clears any pending debug queries or screenshots for `gameId`. */
  private rejectPendingDebugQueries(gameId: string, reason: string) {
    for (const map of [this.pendingDebugQueries, this.pendingDebugScreenshots]) {
      const queue = map.get(gameId)
      if (!queue) {
        continue
      }
      map.delete(gameId)
      for (const entry of queue) {
        clearTimeout(entry.timer)
        entry.reject(new Error(reason))
      }
    }
  }

  handleGameResult(
    gameId: string,
    result: Record<SbUserId, GameClientPlayerResult>,
    time: number,
    tempReplayPath?: string,
  ) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Game results: ${JSON.stringify({ result, time })}`)

    this.activeGame = {
      ...this.activeGame,
      result: { result, time },
      tempReplayPath,
    }
    this.setStatus(GameStatus.HasResult)

    this.emit('gameResult', { gameId, result, time })
  }

  handleGameFinished(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.setStatus(GameStatus.Finished)
    this.emit('gameCommand', gameId, 'cleanup_and_quit')
  }

  handleReplaySaved(gameId: string, path: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Replay saved to: ${path}`)
    this.emit('replaySaved', gameId, path)
  }

  handleReplayUploaded(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Replay uploaded successfully for game ${gameId}`)
    this.activeGame = {
      ...this.activeGame,
      replayUploaded: true,
    }
  }

  handleGameExit(id: string, exitCode: number) {
    if (!this.activeGame || this.activeGame.id !== id) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)

    Promise.resolve()
      .then(() => this.scrSettings.syncWithGameSettingsFile())
      .catch(err => {
        log.error(`Error syncing settings with game settings file: ${err?.stack ?? err}`)
      })

    let status = this.activeGame.status?.state ?? GameStatus.Unknown
    if (status < GameStatus.Finished) {
      if (status >= GameStatus.Playing) {
        this.setStatus(GameStatus.Unknown)
      } else {
        this.setStatus(
          GameStatus.Error,
          new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`),
        )
      }
    }

    status = this.activeGame.status?.state ?? GameStatus.Unknown

    // Check if we need to retry uploading the replay
    if (
      status >= GameStatus.Playing &&
      this.activeGame.config?.setup.resultCode &&
      this.activeGame.tempReplayPath &&
      !this.activeGame.replayUploaded
    ) {
      const config = this.activeGame.config!
      this.emit('resendReplay', {
        gameId: this.activeGame.id,
        userId: config.localUser.id,
        resultCode: config.setup.resultCode!,
        replayPath: this.activeGame.tempReplayPath,
      })
    }

    this.activeGame = null
    this.rejectPendingDebugQueries(id, 'Game exited')
  }

  handleGameExitWaitError(id: string, err: Error) {
    log.error(`Error while waiting for game ${id} to exit: ${String(err.stack ?? err)}`)
  }

  private setStatus(state: GameStatus, extra: any = null) {
    if (this.activeGame) {
      this.activeGame.status = { state, extra }
      this.emit('gameStatus', this.getStatus()!)
      log.verbose(`Game status updated to '${statusToString(state)}' [${JSON.stringify(extra)}]`)
    }
  }
}

const injectPath32 = path.resolve(app.getAppPath(), '../game/dist/shieldbattery.dll')
const injectPath64 = path.resolve(app.getAppPath(), '../game/dist/shieldbattery_64.dll')

async function doLaunch(
  gameId: string,
  serverPort: number,
  localSettings: LocalSettingsManager,
  scrSettings: ScrSettingsManager,
) {
  const settings = await localSettings.get()
  const injectPath = settings.launch32Bit ? injectPath32 : injectPath64
  try {
    await fsPromises.access(injectPath)
  } catch (err) {
    throw new Error(`Could not access/find shieldbattery dll at ${injectPath}`, { cause: err })
  }

  let { starcraftPath } = settings
  if (!starcraftPath) {
    throw new Error('No Starcraft path set')
  }
  const checkResult = await checkStarcraftPath(starcraftPath)
  if (!checkResult.path || !checkResult.version) {
    throw new Error(`StarCraft path ${starcraftPath} not valid: ` + JSON.stringify(checkResult))
  }

  // Ensure that our local settings file is up-to-date with the current settings
  await scrSettings.writeGameSettingsFile()

  const userDataPath = app.getPath('userData')
  let appPath = settings.launch32Bit
    ? path.join(starcraftPath, 'x86', 'StarCraft.exe')
    : path.join(starcraftPath, 'x86_64', 'StarCraft.exe')
  try {
    // Attempt to resolve the real path, just to ensure our capitalization matches Windows' for the
    // compat settings registry key
    ;[appPath, starcraftPath] = await Promise.all([
      fsPromises.realpath(appPath),
      fsPromises.realpath(starcraftPath),
    ])
  } catch (err) {
    log.warn(`Failed to resolve real path for StarCraft executable: ${getErrorStack(err)}`)
    // If we can't resolve the real path, we just use the original path we had
  }

  log.debug(`Attempting to launch "${appPath}" with StarCraft path: "${starcraftPath}"`)

  const legacyCursorSizingArg = settings.legacyCursorSizing ? '-legacy-cursor-sizing' : ''
  // The DLL writes its log to `<name>.<slot>.log`; tell it the SB_SESSION-namespaced base so
  // concurrent dev instances don't share a log file. Prod (no SB_SESSION) → plain `game`.
  const logNameArg = `-log-name=${gameLogBaseName()}`
  const rallyPointPortArg =
    Number.isInteger(RALLY_POINT_PORT) && RALLY_POINT_PORT > 0 && RALLY_POINT_PORT <= 0xffff
      ? `-rally-point-port=${RALLY_POINT_PORT}`
      : ''
  if (rallyPointPortArg) {
    log.debug(`Pinning the game's netcode UDP port to ${RALLY_POINT_PORT} (SB_RALLY_POINT_PORT)`)
  }
  // NOTE(tec27): SC:R uses -launch as an argument to skip bnet launcher.
  const args =
    `"${appPath}" ${gameId} ${serverPort} "${userDataPath}" ` +
    `-launch ${legacyCursorSizingArg} ${logNameArg} ${rallyPointPortArg}`

  // NOTE(tec27): We dynamically import this so that it doesn't crash the process on startup if
  // an antivirus decides to delete the native module
  const { launchProcess } = await import('./native/process/index')

  // People sometimes turn on compatibility settings for the game process for misguided reasons,
  // which then cause issues that they blame on us. So, we turn them off by overwriting the registry
  // key with a blank string, launch the game, and then restore whatever value they had set. This is
  // best effort, if it fails we just continue trying to launch
  const registry = new WindowsRegistry()
  let compatValue: string | undefined
  try {
    compatValue = (await registry.read(
      HKCU,
      'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
      appPath,
    )) as string | undefined
    if (compatValue !== undefined && typeof compatValue !== 'string') {
      throw new Error(
        'Got unexpected type for compatibility settings: ' + JSON.stringify(compatValue),
      )
    }
  } catch (err) {
    log.warn(`Failed to read compatibility settings from registry: ${getErrorStack(err)}`)
    compatValue = undefined
  }

  try {
    if (compatValue) {
      log.debug(`Found compatibility settings for StarCraft: "${compatValue}"`)
      log.debug(`Overriding compatibility settings before launch...`)
      try {
        await registry.write(
          HKCU,
          'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
          appPath,
          REG_SZ,
          '',
        )
      } catch (err) {
        log.warn(`Failed to write blank compatibility settings to registry: ${getErrorStack(err)}`)
      }
    }

    const proc = await launchProcess({
      appPath,
      args: args as any,
      currentDir: starcraftPath,
      dllPath: injectPath,
      dllFunc: 'OnInject',
      logCallback: ((msg: string) => log.verbose(`[Inject] ${msg}`)) as any,
    })
    log.verbose('Process launched')
    return proc
  } finally {
    if (compatValue) {
      log.debug(`Restoring compatibility settings after launch...`)
      try {
        await registry.write(
          HKCU,
          'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
          appPath,
          REG_SZ,
          compatValue,
        )
      } catch (err) {
        log.warn(`Failed to restore compatibility settings to registry: ${getErrorStack(err)}`)
      }
    }
  }
}
