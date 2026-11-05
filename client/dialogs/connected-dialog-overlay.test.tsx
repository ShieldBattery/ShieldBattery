import { act, fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { createStore as createJotaiStore, Provider as JotaiProvider } from 'jotai'
import keycode from 'keycode'
import { LazyMotion } from 'motion/react'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import createStore from '../create-store'
import { KeyListenerBoundary } from '../keyboard/key-listener'
import { foundMatchAtom } from '../matchmaking/matchmaking-atoms'
import { Popover, PopoverOpenState } from '../material/popover'
import { domMax } from '../motion-features'
import {
  closeDialogById,
  openDialog as openDialogAction,
  openSimpleDialog,
} from './action-creators'
import {
  ConnectedDialogOverlay,
  EXIT_DEADLINE_MS,
  mergeExitingDialogs,
} from './connected-dialog-overlay'
import { DialogType } from './dialog-type'

// Animation frames never arrive, the way they don't for a window that's occluded or whose frame
// clock has stalled, so no enter or exit animation can ever finish. motion's frame loop captures
// `requestAnimationFrame` when it's first imported, which is why this has to run before the imports.
vi.hoisted(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

// The dialog registry lazy-loads this. Importing it cold takes longer than a query's timeout on a
// busy machine, so it's loaded ahead of the tests that render it.
beforeAll(async () => {
  await import('../matchmaking/accept-match-dialog')
}, 30000)

let visibilityState: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibilityState,
})

function setVisibility(state: DocumentVisibilityState) {
  act(() => {
    visibilityState = state
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

afterEach(() => {
  visibilityState = 'visible'
  vi.useRealTimers()
})

/**
 * Lets the exit deadline pass on fake timers, which only the test's own clock moves: a real-time
 * wait for it can overrun whatever bound it's given on a busy machine.
 */
function passExitDeadline() {
  act(() => {
    vi.advanceTimersByTime(EXIT_DEADLINE_MS)
  })
}

function renderOverlay(extra?: React.ReactNode, jotaiStore = createJotaiStore()) {
  const store = createStore()
  render(
    <ReduxProvider store={store}>
      <JotaiProvider store={jotaiStore}>
        <KeyListenerBoundary>
          <LazyMotion features={domMax}>
            {extra}
            <ConnectedDialogOverlay />
          </LazyMotion>
        </KeyListenerBoundary>
      </JotaiProvider>
    </ReduxProvider>,
  )
  return store
}

function openDialog(store: ReturnType<typeof createStore>) {
  act(() => {
    store.dispatch(openSimpleDialog('Results', 'Some content'))
  })
  return store.getState().dialog.history.at(-1)!.id
}

/** Opens the accept-match dialog for a found match, waiting for its lazy content to load. */
async function renderAcceptMatchDialog() {
  const jotaiStore = createJotaiStore()
  jotaiStore.set(foundMatchAtom, {
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers: 2,
    acceptStart: performance.now(),
    acceptTimeTotalMillis: 60000,
    acceptedPlayers: 0,
    hasAccepted: false,
  })
  const store = renderOverlay(undefined, jotaiStore)
  act(() => {
    store.dispatch(openDialogAction({ type: DialogType.AcceptMatch }))
  })
  await screen.findByText('Ready up', undefined, { timeout: 4000 })
  return store
}

describe('ConnectedDialogOverlay', () => {
  test('a scrim click closes a dialog', async () => {
    const store = renderOverlay()
    openDialog(store)
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByTestId('dialog-scrim'))

    expect(store.getState().dialog.history).toHaveLength(0)
  })

  test('a scrim click leaves the accept-match dialog open', async () => {
    const store = await renderAcceptMatchDialog()

    fireEvent.click(screen.getByTestId('dialog-scrim'))

    expect(store.getState().dialog.history).toHaveLength(1)
  })

  test('the close button closes the accept-match dialog', async () => {
    const store = await renderAcceptMatchDialog()

    fireEvent.click(screen.getByTitle('Close dialog'))

    expect(store.getState().dialog.history).toHaveLength(0)
  })

  test('Escape closes the accept-match dialog', async () => {
    const store = await renderAcceptMatchDialog()

    fireEvent.keyDown(document, { keyCode: keycode('esc') })

    expect(store.getState().dialog.history).toHaveLength(0)
  })

  test('the close button closes the dialog while a popover is open elsewhere', async () => {
    const onDismiss = vi.fn()
    const store = renderOverlay(
      <Popover
        open={true as PopoverOpenState}
        onDismiss={onDismiss}
        anchorX={0}
        anchorY={0}
        originX='left'
        originY='top'>
        <div>Menu</div>
      </Popover>,
    )
    openDialog(store)

    fireEvent.click(await screen.findByTitle('Close dialog'))

    expect(onDismiss).toHaveBeenCalled()
    expect(store.getState().dialog.history).toHaveLength(0)
  })

  test('a closed dialog is removed even if its exit animation never finishes', async () => {
    const store = renderOverlay()
    const id = openDialog(store)
    await screen.findByRole('dialog')

    vi.useFakeTimers()
    act(() => {
      store.dispatch(closeDialogById(id))
    })
    passExitDeadline()

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('a dialog closed while the document is hidden is removed right away', async () => {
    const store = renderOverlay()
    const id = openDialog(store)
    await screen.findByRole('dialog')

    setVisibility('hidden')
    act(() => {
      store.dispatch(closeDialogById(id))
    })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('a dialog shown and closed while hidden is removed when the document becomes visible', async () => {
    const store = renderOverlay()
    setVisibility('hidden')
    const id = openDialog(store)
    await screen.findByRole('dialog')

    vi.useFakeTimers()
    act(() => {
      store.dispatch(closeDialogById(id))
    })
    setVisibility('visible')
    passExitDeadline()

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('an exiting dialog is dropped when the document becomes hidden', async () => {
    const store = renderOverlay()
    const id = openDialog(store)
    await screen.findByRole('dialog')

    act(() => {
      store.dispatch(closeDialogById(id))
    })
    expect(screen.queryByRole('dialog')).not.toBeNull()
    setVisibility('hidden')

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('closing one dialog leaves the others open and mounted', async () => {
    const store = renderOverlay()
    const firstId = openDialog(store)
    act(() => {
      store.dispatch(
        openDialogAction({
          type: DialogType.Markdown,
          initData: { title: 'Second', markdownContent: 'Other content' },
        }),
      )
    })
    // The markdown renderer is lazy, so this dialog suspends once and React holds back revealing it
    // for its ~300 ms fallback throttle, on top of loading the renderer the first time. That real-time
    // wait can outlast the default 1 s query timeout on a busy machine.
    await screen.findByText('Other content', undefined, { timeout: 4000 })
    const firstSurface = screen.getByText('Some content').closest('[role=dialog]')

    vi.useFakeTimers()
    act(() => {
      store.dispatch(closeDialogById(store.getState().dialog.history.at(-1)!.id))
    })
    passExitDeadline()
    expect(screen.queryByText('Other content')).toBeNull()

    expect(store.getState().dialog.history.map(d => d.id)).toEqual([firstId])
    expect(screen.getByText('Some content').closest('[role=dialog]')).toBe(firstSurface)
  })
})

describe('mergeExitingDialogs', () => {
  const ids = (dialogs: ReadonlyArray<{ id: string }>) => dialogs.map(d => d.id)
  const d = (id: string) => ({ id })

  test('keeps an exiting dialog where it was in the stack', () => {
    expect(ids(mergeExitingDialogs([d('a'), d('b'), d('c')], [d('a'), d('c')]))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  test('keeps a replaced dialog beneath the one replacing it', () => {
    expect(ids(mergeExitingDialogs([d('a'), d('b')], [d('a'), d('c')]))).toEqual(['a', 'b', 'c'])
  })

  test('keeps several exiting dialogs in order', () => {
    expect(ids(mergeExitingDialogs([d('a'), d('b'), d('c'), d('e')], [d('c')]))).toEqual([
      'a',
      'b',
      'c',
      'e',
    ])
  })

  test('takes present dialogs from the current history', () => {
    const current = { id: 'a', version: 2 }
    expect(mergeExitingDialogs([{ id: 'a', version: 1 }], [current])[0]).toBe(current)
  })
})
