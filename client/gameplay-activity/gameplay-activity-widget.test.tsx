import { act, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { Provider as JotaiProvider } from 'jotai'
import { LazyMotion } from 'motion/react'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import createStore from '../create-store'
import { jotaiStore } from '../jotai-store'
import {
  clearMatchmakingState,
  currentSearchInfoAtom,
  matchLaunchingAtom,
} from '../matchmaking/matchmaking-atoms'
import { domMax } from '../motion-features'
import { siteConnectionAtom } from '../network/network-atoms'
import { GameplayActivityWidget } from './gameplay-activity-widget'

// Animation frames never arrive, the way they don't while the window is minimized, so a widget's
// exit can't finish. motion's frame loop captures `requestAnimationFrame` when it's first imported,
// which is why this has to run before the imports.
vi.hoisted(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  jotaiStore.set(siteConnectionAtom, { status: 'connected', since: 0 })
})

afterEach(() => {
  act(() => {
    clearMatchmakingState(jotaiStore)
    jotaiStore.set(siteConnectionAtom, { status: 'disconnected', since: 0 })
  })
})

function renderWidget() {
  render(
    <JotaiProvider store={jotaiStore}>
      <ReduxProvider store={createStore()}>
        <LazyMotion features={domMax}>
          <GameplayActivityWidget />
        </LazyMotion>
      </ReduxProvider>
    </JotaiProvider>,
  )
}

function startSearch() {
  act(() => {
    jotaiStore.set(currentSearchInfoAtom, { searchedTypes: new Map(), startTime: 0 })
  })
}

function setLaunching(launching: boolean) {
  act(() => {
    jotaiStore.set(matchLaunchingAtom, launching)
  })
}

describe('client/gameplay-activity/gameplay-activity-widget', () => {
  test('a widget returning during its exit is a new element', () => {
    renderWidget()
    startSearch()
    const [first] = screen.getAllByText('Searching for a match…')

    setLaunching(true)
    setLaunching(false)

    const titles = screen.getAllByText('Searching for a match…')
    expect(titles).toContain(first)
    expect(titles).toHaveLength(2)
  })

  test('a widget that stays up keeps its element', () => {
    renderWidget()
    startSearch()
    const [first] = screen.getAllByText('Searching for a match…')

    startSearch()

    expect(screen.getAllByText('Searching for a match…')).toEqual([first])
  })
})
