import {
  Activity,
  clearRichPresence,
  createClient,
  destroyClient,
  DiscordClient,
  loadSdk,
  LogSeverity,
  registerLaunchCommand,
  runCallbacks,
  sdkVersion,
  setApplicationId,
  updateRichPresence,
} from '@shieldbattery/danimoth'
import { readdir } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { DiscordActivity, parseDiscordJoinSecret } from '../common/discord-presence'
import { getErrorStack } from '../common/errors'
import { SbLobbyId } from '../common/lobbies/sb-lobby-id'
import { hasDiscordIpcPipe } from './discord-ipc-pipe'
import logger from './logger'

/**
 * Returns whether the Discord desktop app is running on this computer. Listing the pipe namespace
 * doesn't open any pipe, so Discord never sees a connection from this.
 */
export async function isDiscordRunning(): Promise<boolean> {
  try {
    return hasDiscordIpcPipe(await readdir('//./pipe/'))
  } catch (err) {
    logger.warning(`Error listing named pipes to find Discord: ${getErrorStack(err)}`)
    return false
  }
}

/** How often the SDK gets to run its callbacks, which is when joins from Discord arrive. */
const RUN_CALLBACKS_INTERVAL_MS = 200
/** How often to look for the Discord desktop app, so a restarted one gets the activity again. */
const DISCORD_CHECK_INTERVAL_MS = 15 * 1000
/**
 * The least time between two activity updates. Discord rate-limits them, and lobby activity can
 * change several times a second while players come and go, so updates in between are folded into
 * the next one.
 */
const MIN_UPDATE_INTERVAL_MS = 4 * 1000

const SDK_LOG_LEVELS: Record<LogSeverity | 'unknown', string> = {
  verbose: 'verbose',
  info: 'info',
  warning: 'warning',
  error: 'error',
  unknown: 'info',
}

export interface DiscordPresenceOptions {
  /** The path of the Discord Social SDK's `discord_partner_sdk.dll`. */
  sdkPath: string
  /** The Discord application this channel publishes as. */
  applicationId: string
  /**
   * The command Discord runs to start the app when the user joins from Discord while it's closed,
   * or `undefined` to leave whatever is registered alone.
   */
  launchCommand: string | undefined
  /** Called when the user joins a lobby from Discord. */
  onJoinLobby: (lobbyId: SbLobbyId) => void
}

/**
 * Publishes the renderer's activity as Discord Rich Presence through the Discord desktop app, and
 * hands joins from Discord back to the app. Never connects to Discord with a user's token: the SDK
 * talks to the desktop app on the same computer, which shows the activity on whichever account is
 * signed in there.
 *
 * Presence is best effort. Without the SDK library, or without the Discord desktop app running,
 * everything here does nothing beyond logging.
 */
export class DiscordPresence {
  private client: DiscordClient | undefined
  private runCallbacksTimer: ReturnType<typeof setInterval> | undefined
  private discordCheckTimer: ReturnType<typeof setInterval> | undefined
  private discordWasRunning = false

  /** The activity the renderer last asked for. */
  private activity: DiscordActivity | null = null
  /** The activity last handed to the SDK, so an unchanged one isn't sent again. */
  private publishedActivity: DiscordActivity | null = null
  private lastPublishTime = -Infinity
  private publishTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: DiscordPresenceOptions) {}

  /** Whether the SDK loaded, without which nothing here does anything. */
  get isLoaded(): boolean {
    return this.client !== undefined
  }

  /** Loads the SDK and starts listening for joins. Logs and gives up if the SDK isn't there. */
  start(): void {
    try {
      loadSdk(this.options.sdkPath)
    } catch (err) {
      // An expected state in dev builds without the SDK, so the message is enough.
      logger.info(`Discord Rich Presence is off: ${(err as Error).message}`)
      return
    }
    const { major, minor, patch } = sdkVersion()
    logger.info(`Loaded the Discord Social SDK ${major}.${minor}.${patch}`)

    this.client = createClient({
      logSeverity: 'warning',
      onLog: (message, severity) => {
        logger.log(SDK_LOG_LEVELS[severity], `Discord SDK: ${message.trim()}`)
      },
      onActivityJoin: joinSecret => {
        const target = parseDiscordJoinSecret(joinSecret)
        if (target) {
          logger.info(`Joining lobby ${target.lobbyId} from Discord`)
          this.options.onJoinLobby(target.lobbyId)
        } else {
          logger.warning(`Ignoring a join from Discord with an unknown secret: ${joinSecret}`)
        }
      },
    })
    setApplicationId(this.client, this.options.applicationId)
    if (this.options.launchCommand !== undefined) {
      if (
        !registerLaunchCommand(this.client, this.options.applicationId, this.options.launchCommand)
      ) {
        logger.warning('Failed to register the launch command for joins from Discord')
      }
    }

    this.runCallbacksTimer = setInterval(() => runCallbacks(), RUN_CALLBACKS_INTERVAL_MS)
    this.discordCheckTimer = setInterval(() => {
      this.checkForDiscord().catch(logDiscordCheckError)
    }, DISCORD_CHECK_INTERVAL_MS)
    this.checkForDiscord().catch(logDiscordCheckError)
  }

  /** Sets the activity to show, or `null` to show none. */
  setActivity(activity: DiscordActivity | null): void {
    this.activity = activity
    this.schedulePublish()
  }

  /** Clears the activity and lets go of the SDK client. */
  dispose(): void {
    clearTimeout(this.publishTimer)
    clearInterval(this.runCallbacksTimer)
    clearInterval(this.discordCheckTimer)
    if (this.client) {
      clearRichPresence(this.client)
      destroyClient(this.client)
      this.client = undefined
    }
  }

  private async checkForDiscord(): Promise<void> {
    const running = await isDiscordRunning()
    if (running && !this.discordWasRunning) {
      // The Discord desktop app just started (or restarted) and knows nothing of this activity.
      this.publishedActivity = null
      this.schedulePublish()
    }
    this.discordWasRunning = running
  }

  private schedulePublish(): void {
    if (!this.client || this.publishTimer !== undefined) {
      return
    }
    const wait = this.lastPublishTime + MIN_UPDATE_INTERVAL_MS - Date.now()
    this.publishTimer = setTimeout(
      () => {
        this.publishTimer = undefined
        this.publish()
      },
      Math.max(0, wait),
    )
  }

  private publish(): void {
    const client = this.client
    const activity = this.activity
    if (!client || isDeepStrictEqual(activity, this.publishedActivity)) {
      return
    }

    this.publishedActivity = activity
    this.lastPublishTime = Date.now()
    if (!activity) {
      logger.verbose('Clearing the Discord activity')
      clearRichPresence(client)
      return
    }

    logger.verbose(`Setting the Discord activity: ${JSON.stringify(activity)}`)

    const onError = (err: unknown) => {
      // Most often the Discord desktop app isn't running; when it starts, the activity is
      // published again.
      logger.verbose(`Couldn't update the Discord activity: ${getErrorStack(err)}`)
      this.publishedActivity = null
    }
    try {
      updateRichPresence(client, toSdkActivity(activity)).catch(onError)
    } catch (err) {
      // The binding rejects malformed activities synchronously, before they reach the SDK.
      onError(err)
    }
  }
}

function toSdkActivity(activity: DiscordActivity): Activity {
  const { details, state, startTimestamp, party } = activity
  return {
    type: 'playing',
    details,
    state,
    timestamps: startTimestamp !== undefined ? { start: startTimestamp } : undefined,
    ...(party
      ? {
          party: {
            id: party.id,
            currentSize: party.currentSize,
            maxSize: party.maxSize,
            privacy: 'public',
          },
          joinSecret: party.joinSecret,
          supportedPlatforms: ['desktop'],
        }
      : {}),
  }
}

function logDiscordCheckError(err: unknown) {
  logger.error(`Error checking whether Discord is running: ${getErrorStack(err)}`)
}
