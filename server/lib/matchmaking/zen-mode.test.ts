import { describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getManyAccountSettings } from '../settings/account-settings-model'
import { captureZenMatchSnapshot } from './zen-mode'

vi.mock('../settings/account-settings-model', () => ({ getManyAccountSettings: vi.fn() }))

describe('captureZenMatchSnapshot', () => {
  test('uses one batch, defaults missing settings, and assigns unique names', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => makeSbUserId(i + 1))
    vi.mocked(getManyAccountSettings).mockResolvedValue(
      new Map([[ids[0], { zenMuteChat: true, zenAnonymizePlayers: true }]]),
    )
    const snapshot = await captureZenMatchSnapshot(ids)
    expect(getManyAccountSettings).toHaveBeenCalledWith(ids)
    expect(new Set(snapshot.players.map(p => p.nameIndex)).size).toBe(6)
    expect(snapshot.settings.get(ids[0])).toEqual({ anonymizePlayers: true, muteChat: true })
    expect(snapshot.settings.get(ids[1])).toEqual({ anonymizePlayers: false, muteChat: false })
    expect(snapshot.players[0].muteChat).toBe(true)
  })
})
