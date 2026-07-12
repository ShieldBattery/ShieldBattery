import type {
  Display,
  IpcMainEvent,
  IpcMainInvokeEvent,
  IpcRendererEvent,
  WebContents,
} from 'electron'
import type { ReplayHeader } from 'jssuh'
import { Promisable } from 'type-fest'
import { GameServerRegion, GameServerRegionLatencies } from './game-server-regions'
import { GameDebugScreenshot, GameDebugState } from './games/game-debug'
import { GameLaunchConfig } from './games/game-launch-config'
import { ReportedGameStatus } from './games/game-status'
import { NetcodeV2ServerSetup } from './games/netcode-v2'
import { GameClientPlayerResult, SubmitGameResultsRequest } from './games/results'
import { MapExtension } from './maps'
import { ReplayShieldBatteryData } from './replays'
import { LocalSettings, ScrSettings } from './settings/local-settings'
import { ShieldBatteryFileResult } from './shieldbattery-file'
import { SbUserId } from './users/sb-user-id'

const IS_RENDERER = typeof process === 'undefined' || !process || process.type === 'renderer'
const ipcRenderer =
  IS_ELECTRON && IS_RENDERER ? window.SHIELDBATTERY_ELECTRON_API!.ipcRenderer : null
const ipcMain = IS_ELECTRON && !IS_RENDERER ? require('electron').ipcMain : null

/**
 * Equivalent to a node.js fs.Dirent object, but with relevant functions converted to be raw values,
 * so that it can be passed across IPC.
 */
export interface FsDirent {
  isFile: boolean
  isDirectory: boolean
  name: string
}

/**
 * Equivalent to a node.js fs.Stats object, but with relevant functions converted to be raw values,
 * so that it can be passed across IPC.
 */
export interface FsStats {
  isFile: boolean
  isDirectory: boolean
  size: number
  blksize: number
  blocks: number
  atimeMs: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
  atime: Date
  mtime: Date
  ctime: Date
  birthtime: Date
}

/**
 * The result of running the Twitch OAuth flow in the desktop app, which opens the authorize URL in
 * the user's real browser and captures the redirect via a loopback server (see `runTwitchOauthFlow`).
 */
export interface TwitchOauthFlowResult {
  /** The authorization code, present on success. */
  code?: string
  /** The state that was issued, echoed back for validation. */
  state?: string
  /** An OAuth error code (e.g. `access_denied`) if the user declined or the flow failed. */
  error?: string
  /** A human-readable description of `error`, if one was provided. */
  errorDescription?: string
}

/** RPCs that can be invoked by the renderer process to run code in the main process. */
interface IpcInvokeables {
  /**
   * Clears the current game config (e.g. cancels a game launch) provided the current game is
   * `gameId`.
   */
  activeGameClearConfig: (gameId: string) => void
  /**
   * Queries the active game process's debug state (debug game builds only). Only registered in
   * development (`isDev`); on a build that doesn't support it the query is never acknowledged, so
   * this rejects on a timeout rather than hanging forever.
   */
  activeGameDebugQueryState: (gameId?: string) => GameDebugState
  /**
   * Captures a screenshot from the active game process's debug build (debug game builds only).
   * Only registered in development (`isDev`); on a build that doesn't support it the request is
   * never acknowledged, so this rejects on a timeout rather than hanging forever.
   */
  activeGameDebugScreenshot: (gameId?: string) => GameDebugScreenshot
  /**
   * Tells the active game process to force a synced leave of a rally-point2 slot (debug game
   * builds only). Only registered in development (`isDev`). Fire-and-forget: there's no reply, so
   * callers should verify the effect via {@link IpcInvokeables.activeGameDebugQueryState} (the
   * slot's `required` flag becomes `false`).
   */
  activeGameForceLeave: (gameId: string, slot: number) => void
  /**
   * Tells the active game process to deliberately desync this client's simulation from its peers by
   * perturbing the local player's minerals (debug game builds only). Only registered in development
   * (`isDev`). Fire-and-forget: there's no reply, the effect is observed in-game / via the netcode
   * behavior it triggers.
   */
  activeGameForceDesync: (gameId: string) => void
  /**
   * Tells the active game process to send an in-game chat message over its netcode v2 session, as
   * this client (debug game builds only). Only registered in development (`isDev`). Sends to
   * everyone (`ChatTarget::All`) — there's currently no way to pick a narrower scope from here.
   * Fire-and-forget: there's no reply; verify via a peer's rendered chat, or this client's own via
   * {@link IpcInvokeables.activeGameDebugQueryState}'s `turnState.chatLog`.
   */
  activeGameSendChat: (gameId: string, text: string) => void
  /**
   * Tells the active game process to submit a manual drop request for a disconnected rally-point2
   * slot over its netcode v2 session (debug game builds only), the same request the in-game
   * disconnect overlay's Drop button makes. Only registered in development (`isDev`).
   * Fire-and-forget: there's no reply, and the relay honors it only once the slot has been down past
   * its floor. Verify via {@link IpcInvokeables.activeGameDebugQueryState}'s
   * `turnState.disconnect.rows` (the row's `dropRequested`, then the slot's `required` going `false`
   * once the synced leave applies).
   */
  activeGameRequestDrop: (gameId: string, slot: number) => void
  /**
   * Toggles the active game process's in-game network-stats (`/netstat`) overlay (debug game builds
   * only), the same toggle the `/netstat` chat command makes. Only registered in development
   * (`isDev`). Fire-and-forget: there's no reply; verify via
   * {@link IpcInvokeables.activeGameDebugQueryState}'s `turnState.netStats` (the `visible` flag and
   * the per-slot stats under `rows`).
   */
  activeGameToggleNetStats: (gameId: string) => void
  /**
   * Tells the active game process to quit abruptly (a hard stop that skips BW cleanup / settings
   * save; the only teardown that works mid-game). Only registered in development (`isDev`).
   * Fire-and-forget: there's no reply.
   */
  activeGameForceQuit: (gameId: string) => void
  /**
   * Generates the per-session Ed25519 keypair for a netcode v2 game and returns the base64 raw
   * public key (to be submitted to the server), or null if `gameId` is not the active game. The
   * private key stays in the main process until it's handed to the game process at launch.
   */
  activeGameGenNetcodeV2Keys: (gameId: string) => string | null
  activeGameSetConfig: (config: GameLaunchConfig | Record<string, never>) => string | null
  /**
   * Delivers the server's netcode v2 session handoff (token/relays/roster); the main process
   * merges in the locally-held private key and forwards it to the game process.
   */
  activeGameSetNetcodeV2Setup: (gameId: string, setup: NetcodeV2ServerSetup) => void

  bugReportCollectFiles: () => Promise<Uint8Array<ArrayBuffer>>

  // TODO(tec27): Support the non-filetypes version if we need it, overloads don't seem to work
  // well with the current approach for typing these invokes =/
  fsReadDir: (dirPath: string, options: { withFileTypes: true }) => Promise<FsDirent[]>
  // TODO(tec27): Add types for options + returning a string if encoding is specified?
  fsReadFile: (filePath: string) => Promise<ArrayBuffer>
  fsStat: (filePath: string) => Promise<FsStats>
  fsUnlink: (filePath: string) => Promise<void>

  /**
   * Returns the current region -> latency table. Empty before the region latency manager's first
   * sweep completes (unless a previous run's measurements were persisted to disk, in which case
   * those are returned as a stale hint until the first sweep replaces them).
   */
  gameServerRegionsGetLatencies: () => GameServerRegionLatencies

  logMessage: (level: string, message: string) => void

  mapStoreDownloadMap: (hash: string, format: MapExtension, mapUrl: string) => Promise<boolean>

  pathsGetDocumentsPath: () => Promise<string>

  replayParseMetadata: (
    replayPath: string,
  ) => Promise<{ headerData?: ReplayHeader; shieldBatteryData?: ReplayShieldBatteryData }>

  /**
   * Checks if a replay with the given ID exists in the cache with the correct hash.
   * Returns the file path if it exists and has correct hash, null otherwise.
   */
  replayStoreGetPath: (id: string, expectedHash: string) => Promise<string | null>

  /**
   * Stores replay data in the cache. Verifies the hash matches before storing.
   * Returns the file path where the replay was stored.
   */
  replayStoreStoreReplay: (id: string, expectedHash: string, data: ArrayBuffer) => Promise<string>

  securityGetClientIds: () => Promise<[number, string][]>

  settingsLocalGet: () => Promise<Partial<LocalSettings>>
  settingsScrGet: () => Promise<Partial<ScrSettings>>
  settingsLocalMerge: (settings: Readonly<Partial<LocalSettings>>) => void
  settingsScrMerge: (settings: Readonly<Partial<ScrSettings>>) => void

  settingsAutoPickStarcraftPath: () => Promise<boolean>
  settingsCheckStarcraftPath: (path: string) => Promise<{ path: boolean; version: boolean }>
  settingsBrowseForStarcraft: (
    defaultPath: string,
  ) => Promise<{ canceled: boolean; filePaths: string[] }>
  settingsGetPrimaryResolution: () => Promise<{ width: number; height: number }>
  settingsGetMonitorInfo: () => Promise<{ primary: Display; monitors: Display[] }>
  settingsOverwriteBlizzardFile: () => void

  shieldbatteryCheckFiles: () => Promise<ShieldBatteryFileResult[]>

  /**
   * Runs the Twitch OAuth authorization flow in a dedicated desktop window (the renderer can't open
   * a controllable popup that redirects back to us), resolving with the code/state -- or an error
   * -- captured from the redirect to our callback URL.
   */
  twitchOauthFlow: (authorizeUrl: string) => Promise<TwitchOauthFlowResult>
  /** Settles an in-flight `twitchOauthFlow` early, as if the user had declined. */
  twitchOauthFlowCancel: () => void

  windowGetStatus: () => Promise<{ focused: boolean; maximized: boolean }>
}

/** Events that can be sent from the renderer process to the main process. */
interface IpcRendererSendables {
  chatNewMessage: (data: { urgent: boolean }) => void

  gameServerRegionsSetList: (regions: GameServerRegion[]) => void

  networkSiteConnected: () => void

  updaterGetState: () => void
  updaterQuitAndInstall: () => void

  userAttentionRequired: () => void

  windowClose: (shouldDisplayCloseHint: boolean) => void
  windowMaximize: () => void
  windowMinimize: () => void
}

/** Events that can be sent from the main process to a renderer process. */
interface IpcMainSendables {
  activeGameReplaySaved: (gameId: string, replayPath: string) => void
  activeGameResult: (data: {
    gameId: string
    result: Record<string, GameClientPlayerResult>
    time: number
  }) => void
  /**
   * Used if sending results from the game fails for some reason. We pass this off to the
   * renderer process to do because this usually indicates some issue with e.g. the TLS stack of
   * this system, so using the network stack outside the renderer also tends to fail.
   */
  activeGameResendResults: (gameId: string, requestBody: SubmitGameResultsRequest) => void
  /**
   * Used if uploading a replay from the game fails for some reason. We pass this off to the
   * renderer process to do because this usually indicates some issue with e.g. the TLS stack of
   * this system, so using the network stack outside the renderer also tends to fail.
   */
  activeGameResendReplay: (request: {
    gameId: string
    userId: SbUserId
    resultCode: string
    replayPath: string
  }) => void
  activeGameStatus: (status: ReportedGameStatus) => void

  /** Sent after each region latency sweep completes, with the full region -> latency table. */
  gameServerRegionsLatenciesUpdated: (latencies: GameServerRegionLatencies) => void

  replaysOpen: (replayPaths: string[]) => void

  settingsLocalChanged: (settings: Readonly<Partial<LocalSettings>>) => void
  settingsScrChanged: (settings: Readonly<Partial<ScrSettings>>) => void

  updaterDownloadError: () => void
  updaterDownloadProgress: (progressInfo: {
    bytesTransferred: number
    totalBytes: number
    bytesPerSecond: number
  }) => void
  updaterNewVersionDownloaded: () => void
  updaterNewVersionFound: () => void
  updaterUpToDate: () => void

  /** Sent when the window is focused or unfocused. */
  windowFocusChanged: (focused: boolean) => void
  windowMaximizedState: (isMaximized: boolean) => void
}

/**
 * A wrapper around Electron's `ipcMain` that provides strongly typed events and invokes.
 */
export class TypedIpcMain {
  /**
   * Adds a handler for an `invoke`able IPC. This handler will be called whenever a
   * renderer calls `ipcRenderer.invoke(channel, ...args)`.
   *
   * If `listener` returns a Promise, the eventual result of the promise will be
   * returned as a reply to the remote caller. Otherwise, the return value of the
   * listener will be used as the value of the reply.
   *
   * The `event` that is passed as the first argument to the handler is the same as
   * that passed to a regular event listener. It includes information about which
   * WebContents is the source of the invoke request.
   */
  handle<K extends keyof IpcInvokeables>(
    channel: K,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: Parameters<IpcInvokeables[K]>
    ) => Promisable<ReturnType<IpcInvokeables[K]>>,
  ): void {
    ipcMain?.handle(channel, listener as any)
  }

  /**
   * Handles a single `invoke`able IPC message, then removes the listener. See
   * `ipcMain.handle(channel, listener)`.
   */
  handleOnce<K extends keyof IpcInvokeables>(
    channel: K,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: Parameters<IpcInvokeables[K]>
    ) => Promisable<ReturnType<IpcInvokeables[K]>>,
  ): void {
    ipcMain?.handleOnce(channel, listener as any)
  }

  /**
   * Removes any handler for `channel`, if present.
   */
  removeHandler(channel: keyof IpcInvokeables): void {
    ipcMain?.removeHandler(channel)
  }

  /**
   * Listens to `channel`, when a new message arrives `listener` would be called with
   * `listener(event, args...)`.
   */
  on<K extends keyof IpcRendererSendables>(
    channel: K,
    listener: (
      event: IpcMainEvent,
      ...args: Parameters<IpcRendererSendables[K]>
    ) => ReturnType<IpcRendererSendables[K]>,
  ): this {
    ipcMain?.on(channel, listener as any)
    return this
  }

  /**
   * Adds a one time `listener` function for the event. This `listener` is invoked
   * only the next time a message is sent to `channel`, after which it is removed.
   */
  once<K extends keyof IpcRendererSendables>(
    channel: K,
    listener: (
      event: IpcMainEvent,
      ...args: Parameters<IpcRendererSendables[K]>
    ) => ReturnType<IpcRendererSendables[K]>,
  ): this {
    ipcMain?.once(channel, listener as any)
    return this
  }

  /**
   * Removes listeners of the specified `channel`.
   */
  removeAllListeners(channel: keyof IpcRendererSendables): this {
    ipcMain?.removeAllListeners(channel)
    return this
  }

  /**
   * Removes the specified `listener` from the listener array for the specified
   * `channel`.
   */
  removeListener<K extends keyof IpcRendererSendables>(
    channel: K,
    listener: IpcRendererSendables[K],
  ): this {
    ipcMain?.removeListener(channel, listener)
    return this
  }
}

/**
 * A wrapper around an Electron `WebContents` for sending strongly-typed events to the renderer
 * process. This should be initialized with a particular window's `WebContents`, or `event.sender`
 * if it's for responding to a particular event (in which case `invoke` may be a better approach).
 */
export class TypedIpcSender {
  constructor(private sender?: WebContents) {}

  // NOTE(tec27): This just makes the general usage bit less awkward by avoiding the `new` keyword
  static from(sender?: WebContents) {
    return new TypedIpcSender(sender)
  }

  /**
   * Send an asynchronous message to the renderer process via `channel`, along with
   * arguments. Arguments will be serialized with the Structured Clone Algorithm,
   * just like `postMessage`, so prototype chains will not be included. Sending
   * Functions, Promises, Symbols, WeakMaps, or WeakSets will throw an exception.
   *
   * > **NOTE**: Sending non-standard JavaScript types such as DOM objects or special
   * Electron objects will throw an exception.
   *
   * The renderer process can handle the message by listening to `channel` with the
   * `ipcRenderer` module.
   */
  send<K extends keyof IpcMainSendables>(
    channel: K,
    ...args: Parameters<IpcMainSendables[K]>
  ): void {
    this.sender?.send(channel, ...args)
  }
}

/**
 * A wrapper around Electron's `ipcRenderer` that provides strongly typed events and invokes. This
 * is safe to import and use in code that is potentially run on the web too (it will just no-op in
 * that case).
 */
export class TypedIpcRenderer {
  /**
   * Resolves with the response from the main process.
   *
   * Send a message to the main process via `channel` and expect a result
   * asynchronously. Arguments will be serialized with the Structured Clone
   * Algorithm, just like `window.postMessage`, so prototype chains will not be
   * included. Sending Functions, Promises, Symbols, WeakMaps, or WeakSets will throw
   * an exception.
   *
   * > **NOTE:** Sending non-standard JavaScript types such as DOM objects or special
   * Electron objects will throw an exception.
   *
   * Since the main process does not have support for DOM objects such as
   * `ImageBitmap`, `File`, `DOMMatrix` and so on, such objects cannot be sent over
   * Electron's IPC to the main process, as the main process would have no way to
   * decode them. Attempting to send such objects over IPC will result in an error.
   *
   * The main process should listen for `channel` with `ipcMain.handle()`.
   *
   * If you need to transfer a `MessagePort` to the main process, use
   * `ipcRenderer.postMessage`.
   *
   * If you do not need a response to the message, consider using `send`.
   */
  invoke<K extends keyof IpcInvokeables>(
    channel: K,
    ...args: Parameters<IpcInvokeables[K]>
  ): Promise<Awaited<ReturnType<IpcInvokeables[K]>>> | undefined {
    return ipcRenderer?.invoke(channel, ...args)
  }

  /**
   * Send an asynchronous message to the main process via `channel`, along with
   * arguments. Arguments will be serialized with the Structured Clone Algorithm,
   * just like `window.postMessage`, so prototype chains will not be included.
   * Sending Functions, Promises, Symbols, WeakMaps, or WeakSets will throw an
   * exception.
   *
   * > **NOTE:** Sending non-standard JavaScript types such as DOM objects or special
   * Electron objects will throw an exception.
   *
   * Since the main process does not have support for DOM objects such as
   * `ImageBitmap`, `File`, `DOMMatrix` and so on, such objects cannot be sent over
   * Electron's IPC to the main process, as the main process would have no way to
   * decode them. Attempting to send such objects over IPC will result in an error.
   *
   * The main process handles it by listening for `channel` with the `ipcMain`
   * module.
   *
   * If you need to transfer a `MessagePort` to the main process, use
   * `ipcRenderer.postMessage`.
   *
   * If you want to receive a single response from the main process, like the result
   * of a method call, consider using `ipcRenderer.invoke`.
   */
  send<K extends keyof IpcRendererSendables>(
    channel: K,
    ...args: Parameters<IpcRendererSendables[K]>
  ): void {
    ipcRenderer?.send(channel, ...args)
  }

  /**
   * Listens to `channel`, when a new message arrives `listener` would be called with
   * `listener(event, args...)`.
   */
  on<K extends keyof IpcMainSendables>(
    channel: K,
    listener: (
      event: IpcRendererEvent,
      ...args: Parameters<IpcMainSendables[K]>
    ) => ReturnType<IpcMainSendables[K]>,
  ): this {
    ipcRenderer?.on(channel, listener as any)
    return this
  }

  /**
   * Adds a one time `listener` function for the event. This `listener` is invoked
   * only the next time a message is sent to `channel`, after which it is removed.
   */
  once<K extends keyof IpcMainSendables>(
    channel: K,
    listener: (
      event: IpcRendererEvent,
      ...args: Parameters<IpcMainSendables[K]>
    ) => ReturnType<IpcMainSendables[K]>,
  ): this {
    ipcRenderer?.once(channel, listener as any)
    return this
  }

  /**
   * Removes listeners of the specified `channel`.
   */
  removeAllListeners(channel: keyof IpcMainSendables): this {
    ipcRenderer?.removeAllListeners(channel)
    return this
  }

  /**
   * Removes the specified `listener` from the listener array for the specified
   * `channel`.
   */
  removeListener<K extends keyof IpcMainSendables>(
    channel: K,
    listener: IpcMainSendables[K],
  ): this {
    ipcRenderer?.removeListener(channel, listener as any)
    return this
  }
}
