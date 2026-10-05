import { cleanup, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import {
  BasicChannelInfo,
  DEFAULT_CHANNEL_PREFERENCES,
  makeSbChannelId,
  SbChannelId,
} from '../../common/chat'
import createStore from '../create-store'
import { channelFromMessageLink, ChannelLinkCard } from './channel-link-card'

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

afterEach(() => {
  cleanup()
})

const CHANNEL_ID = makeSbChannelId(7)
const MESSAGE_ID = '9b2e8d0e-5f3a-4a2b-8c1d-6f5e4d3c2b1a'

function channelInfo(overrides: Partial<BasicChannelInfo> = {}): BasicChannelInfo {
  return {
    id: CHANNEL_ID,
    name: 'ShieldBattery',
    private: false,
    official: false,
    closed: false,
    ...overrides,
  }
}

/**
 * Renders the card against a store holding what the batched channel info request would have
 * returned, so the card has nothing left to request.
 */
function renderCard(
  {
    info,
    deleted = false,
    withheld = false,
    joined = false,
  }: { info?: BasicChannelInfo; deleted?: boolean; withheld?: boolean; joined?: boolean },
  channelId: SbChannelId = CHANNEL_ID,
) {
  const store = createStore()
  store.dispatch({
    type: '@chat/getBatchChannelInfo',
    payload: {
      channelInfos: info ? [info] : [],
      detailedChannelInfos: info ? [{ id: info.id, userCount: 3 }] : [],
      joinedChannelInfos: [],
      deletedChannels: deleted ? [channelId] : [],
      privateChannels: withheld ? [channelId] : [],
    },
  })
  if (joined && info) {
    store.dispatch({
      type: '@chat/getJoinedChannels',
      payload: [
        {
          channelInfo: info,
          detailedChannelInfo: { id: info.id, userCount: 3 },
          joinedChannelInfo: { id: info.id, membersCanInvite: false },
          selfPreferences: { ...DEFAULT_CHANNEL_PREFERENCES },
          selfPermissions: { kick: false, ban: false, editPermissions: false },
          moderatorIds: [],
        },
      ],
    })
  }

  return render(
    <ReduxProvider store={store}>
      <div data-testid='container'>
        <ChannelLinkCard channelId={channelId} />
      </div>
    </ReduxProvider>,
  )
}

describe('client/chat/channel-link-card', () => {
  describe('channelFromMessageLink', () => {
    test('a channel link resolves to its channel, whatever its name segment says', () => {
      expect(channelFromMessageLink('https://shieldbattery.net/chat/7/ShieldBattery')).toBe(
        CHANNEL_ID,
      )
      expect(channelFromMessageLink('https://shieldbattery.net/chat/7/_')).toBe(CHANNEL_ID)
    })

    test('a channel message link resolves to no channel', () => {
      expect(
        channelFromMessageLink(`https://shieldbattery.net/chat/7/ShieldBattery?m=${MESSAGE_ID}`),
      ).toBeUndefined()
    })

    test('other ShieldBattery chat paths resolve to no channel', () => {
      expect(channelFromMessageLink('https://shieldbattery.net/chat/7')).toBeUndefined()
      expect(channelFromMessageLink('https://shieldbattery.net/chat/list')).toBeUndefined()
      expect(channelFromMessageLink('https://shieldbattery.net/chat/new/thing')).toBeUndefined()
      expect(
        channelFromMessageLink('https://shieldbattery.net/chat/7/ShieldBattery/extra'),
      ).toBeUndefined()
    })

    test('a channel-shaped path on a foreign origin resolves to no channel', () => {
      expect(channelFromMessageLink('https://example.com/chat/7/ShieldBattery')).toBeUndefined()
    })
  })

  describe('ChannelLinkCard', () => {
    test('a public channel the viewer is not in offers Join', () => {
      renderCard({ info: channelInfo() })

      expect(screen.getByText('#ShieldBattery')).toBeTruthy()
      expect(screen.getByTestId('channel-link-card-join-button')).toBeTruthy()
      expect(screen.queryByTestId('channel-link-card-open-button')).toBeNull()
    })

    test('a channel the viewer is in offers View', () => {
      renderCard({ info: channelInfo(), joined: true })

      expect(screen.getByTestId('channel-link-card-open-button')).toBeTruthy()
      expect(screen.queryByTestId('channel-link-card-join-button')).toBeNull()
    })

    test('a private channel the viewer is in gets a card', () => {
      renderCard({ info: channelInfo({ private: true }), joined: true })

      expect(screen.getByText('#ShieldBattery')).toBeTruthy()
      expect(screen.getByTestId('channel-link-card-open-button')).toBeTruthy()
    })

    test('a deleted channel renders nothing', () => {
      renderCard({ deleted: true })
      expect(screen.getByTestId('container').childElementCount).toBe(0)
    })

    test('a closed channel renders nothing', () => {
      renderCard({ info: channelInfo({ closed: true }) })
      expect(screen.getByTestId('container').childElementCount).toBe(0)
    })

    test('a private channel withheld from the viewer renders nothing', () => {
      renderCard({ withheld: true })
      expect(screen.getByTestId('container').childElementCount).toBe(0)
    })

    test('a private channel the viewer can see but is not in renders nothing', () => {
      renderCard({ info: channelInfo({ private: true }) })
      expect(screen.getByTestId('container').childElementCount).toBe(0)
    })
  })
})
