import { cleanup, render } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { LiveGames_FeedFragment } from '../games/live-game-entry'
import { FragmentType } from '../gql'
import { LiveStreams_FeedFragment } from '../twitch/live-stream-entry'
import { LiveGamesFeed, LiveStreamsFeed } from './home'

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

afterEach(() => {
  cleanup()
})

// Graphcache hands back a feed whose resolver errored as null, which the generated types (taken
// from the non-null schema) can't express.
const failedLiveGames = { liveGames: null } as unknown as FragmentType<
  typeof LiveGames_FeedFragment
>
const failedLiveStreams = { liveStreams: null } as unknown as FragmentType<
  typeof LiveStreams_FeedFragment
>

describe('client/home/home', () => {
  test('LiveGamesFeed renders nothing when the feed failed to load', () => {
    const { container } = render(<LiveGamesFeed query={failedLiveGames} />)
    expect(container.innerHTML).toBe('')
  })

  test('LiveStreamsFeed renders nothing when the feed failed to load', () => {
    const { container } = render(<LiveStreamsFeed query={failedLiveStreams} />)
    expect(container.innerHTML).toBe('')
  })
})
