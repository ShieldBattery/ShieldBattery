import { act, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { Provider as JotaiProvider } from 'jotai'
import { LazyMotion } from 'motion/react'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import createStore from '../create-store'
import { jotaiStore } from '../jotai-store'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { draftStateAtom } from '../matchmaking/draft-atoms'
import { domMax } from '../motion-features'
import { CAN_PIN_WIDTH, SocialSidebar } from './social-sidebar'

// Animation frames never arrive, so an element that's only removed once its exit animation finishes
// stays in the document. motion's frame loop captures `requestAnimationFrame` when it's first
// imported, which is why this has to run before the imports.
vi.hoisted(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})

const WIDE = CAN_PIN_WIDTH + 1
const NARROW = CAN_PIN_WIDTH

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const originalWidth = window.innerWidth

function setWindowWidth(width: number) {
  act(() => {
    window.innerWidth = width
    window.dispatchEvent(new Event('resize'))
  })
}

function setDraft(inDraft: boolean) {
  act(() => {
    jotaiStore.set(draftStateAtom, inDraft ? ({ isCompleted: false } as any) : undefined)
  })
}

const onVisibilityChange = vi.fn()
const onPinnedChange = vi.fn()

beforeEach(() => {
  onVisibilityChange.mockClear()
  onPinnedChange.mockClear()
})

afterEach(() => {
  setDraft(false)
  setWindowWidth(originalWidth)
})

function renderSidebar({ pinned = true }: { pinned?: boolean } = {}) {
  render(
    <JotaiProvider store={jotaiStore}>
      <ReduxProvider store={createStore()}>
        <KeyListenerBoundary>
          <LazyMotion features={domMax}>
            <SocialSidebar
              visible={true}
              pinned={pinned}
              onVisibilityChange={onVisibilityChange}
              onPinnedChange={onPinnedChange}
            />
          </LazyMotion>
        </KeyListenerBoundary>
      </ReduxProvider>
    </JotaiProvider>,
  )
}

function querySidebar() {
  return screen.queryByTestId('social-sidebar')
}

describe('SocialSidebar during a draft', () => {
  test('a pinned sidebar does not float over the draft when the window narrows', () => {
    setWindowWidth(WIDE)
    renderSidebar()
    setDraft(true)

    // Pinned, it's part of the page layout beneath the draft screen.
    expect(querySidebar()).not.toBeNull()

    setWindowWidth(NARROW)

    expect(querySidebar()).toBeNull()
  })

  test.each([
    ['in a narrow window', NARROW, true],
    ['unpinned in a wide window', WIDE, false],
  ])('a sidebar floating %s goes away with its scrim at once', (_, width, pinned) => {
    setWindowWidth(width)
    renderSidebar({ pinned })
    expect(querySidebar()).not.toBeNull()
    expect(screen.queryByTestId('social-sidebar-scrim')).not.toBeNull()

    setDraft(true)

    expect(querySidebar()).toBeNull()
    expect(screen.queryByTestId('social-sidebar-scrim')).toBeNull()
  })

  test('a floating sidebar comes back after the draft, with its open state untouched', () => {
    setWindowWidth(NARROW)
    renderSidebar()

    setDraft(true)
    setDraft(false)

    expect(querySidebar()).not.toBeNull()
    expect(onVisibilityChange).not.toHaveBeenCalled()
    expect(onPinnedChange).not.toHaveBeenCalled()
  })
})
