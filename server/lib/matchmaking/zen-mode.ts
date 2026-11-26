import { AnonymizedNameIndex, NUM_ANONYMIZED_NAMES } from '../../../common/matchmaking'
import { multipleRandomItems } from '../../../common/random'
import { fillAccountSettingsDefaults } from '../../../common/settings/account-settings'
import { ZenModeSettings, ZenPlayer } from '../../../common/settings/zen-mode'
import { SbUserId } from '../../../common/users/sb-user-id'
import { getManyAccountSettings } from '../settings/account-settings-model'

export interface ZenMatchSnapshot {
  settings: Map<SbUserId, ZenModeSettings>
  players: ZenPlayer[]
}

/** Captures each player's preferences once, and assigns unique aliases for the whole match. */
export async function captureZenMatchSnapshot(userIds: SbUserId[]): Promise<ZenMatchSnapshot> {
  const stored = await getManyAccountSettings(userIds)
  const names = multipleRandomItems(
    userIds.length,
    Array.from({ length: NUM_ANONYMIZED_NAMES }, (_, i) => i as AnonymizedNameIndex),
  )
  const settings = new Map<SbUserId, ZenModeSettings>()
  const players = userIds.map((userId, index) => {
    const account = fillAccountSettingsDefaults(stored.get(userId))
    const local = { anonymizePlayers: account.zenAnonymizePlayers, muteChat: account.zenMuteChat }
    settings.set(userId, local)
    return { userId, nameIndex: names[index], muteChat: local.muteChat }
  })
  return { settings, players }
}
