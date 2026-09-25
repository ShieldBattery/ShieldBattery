import { ReadonlyDeep } from 'type-fest'
import { isUserAvailability, UserAvailability } from '../users/availability'

/**
 * Settings that are a property of the account rather than the machine: stored on the server,
 * delivered to every session on connect and pushed live to all of them whenever one changes a
 * value. Anything tied to a particular install (paths, audio devices, window geometry, launch
 * options) belongs in `LocalSettings` instead and never syncs.
 *
 * Every key must have a default in `DEFAULT_ACCOUNT_SETTINGS`: the server stores only the keys a
 * user has changed and merges them over the defaults on every read, which is what lets a new key
 * apply to existing accounts without a migration.
 */
export interface AccountSettings {
  /**
   * While this client is in a game, channel messages (mentions included) play no alert sound and
   * don't ask the main process for attention (transient tray icon / taskbar flash); unread and
   * mention marks still record so the true state shows after the game.
   */
  quietChannelsWhileInGame: boolean
  /**
   * While this client is in a game, an incoming whisper plays no alert sound and doesn't ask the
   * main process for attention; the conversation still records as unread so it shows after the
   * game.
   */
  quietWhispersWhileInGame: boolean
  /**
   * Whispers sent and received are echoed as a line into whatever chat is on screen, so they can
   * be read and answered without switching to the conversation. Off is for people who stream
   * their screen.
   */
  showWhispersEverywhere: boolean
  /**
   * How available the user has said they are. Unlike the other keys this is visible to other users:
   * friends and everyone sharing a chat channel see it while the user is online.
   */
  availability: UserAvailability
  /** A short message shown alongside `availability` to the same users. Empty if none is set. */
  statusMessage: string
  /** How text messages are laid out in every chat surface that shares the message list. */
  chatDisplayMode: ChatDisplayMode
}

/**
 * How chat renders text messages. `classic` is one dense IRC-style line per message with the
 * author's name on every line. `cozy` groups consecutive messages from one author under a header
 * with their avatar, name and time, with the following messages showing only their text.
 */
export type ChatDisplayMode = 'classic' | 'cozy'

export const ALL_CHAT_DISPLAY_MODES: ReadonlyArray<ChatDisplayMode> = ['classic', 'cozy']

export function isChatDisplayMode(value: unknown): value is ChatDisplayMode {
  return ALL_CHAT_DISPLAY_MODES.includes(value as ChatDisplayMode)
}

export const DEFAULT_ACCOUNT_SETTINGS: ReadonlyDeep<AccountSettings> = {
  quietChannelsWhileInGame: true,
  quietWhispersWhileInGame: true,
  showWhispersEverywhere: true,
  availability: UserAvailability.Online,
  statusMessage: '',
  chatDisplayMode: 'classic',
}

export const ALL_ACCOUNT_SETTINGS_KEYS: ReadonlyArray<keyof AccountSettings> = Object.keys(
  DEFAULT_ACCOUNT_SETTINGS,
) as Array<keyof AccountSettings>

/**
 * Builds a complete `AccountSettings` from a possibly partial, possibly untrusted stored copy (a DB
 * row or a local cache written by an older version). Only known keys whose value has the same type
 * as the default are kept; everything else falls back to the default.
 */
export function fillAccountSettingsDefaults(stored: unknown): AccountSettings {
  const result: AccountSettings = { ...DEFAULT_ACCOUNT_SETTINGS }
  if (typeof stored !== 'object' || stored === null) {
    return result
  }

  const partial = stored as Record<string, unknown>
  for (const key of ALL_ACCOUNT_SETTINGS_KEYS) {
    const value = partial[key]
    if (typeof value === typeof DEFAULT_ACCOUNT_SETTINGS[key]) {
      // Cast needed because TS can't tell that `value` has the type of `result[key]`
      // after the runtime check above.
      ;(result[key] as unknown) = value
    }
  }
  if (!isUserAvailability(result.availability)) {
    result.availability = DEFAULT_ACCOUNT_SETTINGS.availability
  }
  if (!isChatDisplayMode(result.chatDisplayMode)) {
    result.chatDisplayMode = DEFAULT_ACCOUNT_SETTINGS.chatDisplayMode
  }

  return result
}

/** Body of a request to change account settings. Only the keys present are changed. */
export type UpdateAccountSettingsRequest = Partial<AccountSettings>

export interface AccountSettingsResponse {
  settings: AccountSettings
}

/**
 * Sent on `/account-settings/:userId` with the user's complete settings, both as the initial data
 * when a session subscribes and whenever any session changes a setting.
 */
export interface AccountSettingsUpdateEvent {
  action: 'update'
  settings: AccountSettings
}

export type AccountSettingsEvent = AccountSettingsUpdateEvent
