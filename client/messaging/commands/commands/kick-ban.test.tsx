import i18next, { TFunction } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { makeSbChannelId } from '../../../../common/chat'
import { makeSbUserId } from '../../../../common/users/sb-user-id'
import { jotaiStore } from '../../../jotai-store'
import { userAliasesAtom } from '../../../users/user-aliases'
import { ChannelCommandContext } from '../command-context'
import { runChatCommandWith } from '../run-chat-command'
import { banCommand, kickCommand } from './kick-ban'

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const members = ['Self', 'Original', 'Boxer'].map((name, i) => ({
  id: makeSbUserId(i + 1),
  name,
  online: true,
}))
const context: ChannelCommandContext = {
  surface: 'channel',
  channelId: makeSbChannelId(1),
  selfUserId: members[0].id,
  members,
  canKick: true,
  canBan: true,
  canEditChannel: true,
}
const t = ((_key: string, options: any) =>
  typeof options === 'string' ? options : (options?.defaultValue ?? _key)) as TFunction

afterEach(() => jotaiStore.set(userAliasesAtom, new Map()))

for (const command of [kickCommand, banCommand]) {
  test(`${command.name} prefers an original name over another account's alias`, () => {
    jotaiStore.set(userAliasesAtom, new Map([[members[1].id, 'Boxer']]))
    const dispatch = vi.fn()
    runChatCommandWith([command], `/${command.name} Boxer`, { context, dispatch, t, emit: vi.fn() })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          initData: expect.objectContaining({ userId: members[2].id }),
        }),
      }),
    )
  })
  test(`${command.name} lists original names for a shared alias without taking action`, () => {
    jotaiStore.set(
      userAliasesAtom,
      new Map([
        [members[1].id, 'Shared'],
        [members[2].id, 'Shared'],
      ]),
    )
    const dispatch = vi.fn()
    const emit = vi.fn()
    runChatCommandWith([command], `/${command.name} Shared`, { context, dispatch, t, emit })
    expect(dispatch).not.toHaveBeenCalled()
    const text = renderToStaticMarkup(emit.mock.calls[0][0].content)
    expect(text).toContain('Original, Boxer')
  })
}
