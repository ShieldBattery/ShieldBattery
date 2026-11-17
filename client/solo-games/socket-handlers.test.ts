import { NydusClient, RouteInfo } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ReportedGameStatus } from '../../common/games/game-status'
import { SoloGameEvent, SoloGameLaunchFailure } from '../../common/solo-games'
import { asMockedFunction } from '../../common/testing/mocks'
import { closeDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { DispatchFunction, registerDispatch } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { RootState } from '../root-reducer'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import registerModule, { eventToAction } from './socket-handlers'
import { soloLaunchPendingAtom } from './solo-game-atoms'

vi.mock('../snackbars/snackbar-controller-registry', () => ({
  externalShowSnackbar: vi.fn(),
}))

vi.mock('../logging/logger', () => ({
  default: { verbose: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('../i18n/i18next', () => ({
  default: { t: (_key: string, defaultValue: string) => defaultValue },
}))

const showSnackbarMock = asMockedFunction(externalShowSnackbar)

const CLOSE_LAUNCHING = closeDialog(DialogType.LaunchingGame)

/** Runs a thunk-or-value handler result, collecting anything it dispatches. */
function runHandler(result: unknown, gameStatus?: ReportedGameStatus) {
  const dispatched: unknown[] = []
  const dispatch = ((action: unknown) => {
    dispatched.push(action)
  }) as DispatchFunction<any>
  const getState = (() => ({
    gameClient: { status: gameStatus, watchOnly: {} },
  })) as unknown as () => RootState

  if (typeof result === 'function') {
    ;(result as (d: DispatchFunction<any>, g: () => RootState) => void)(dispatch, getState)
  }
  return dispatched
}

beforeEach(() => {
  vi.clearAllMocks()
  jotaiStore.set(soloLaunchPendingAtom, true)
})

describe('gameStarted', () => {
  test('closes the launching dialog without a notice', () => {
    const dispatched = runHandler(eventToAction.gameStarted({ type: 'gameStarted', gameId: 'g' }))

    expect(dispatched).toEqual([CLOSE_LAUNCHING])
    expect(jotaiStore.get(soloLaunchPendingAtom)).toBe(false)
    expect(showSnackbarMock).not.toHaveBeenCalled()
  })
})

describe('launchFailed', () => {
  test.each(Object.values(SoloGameLaunchFailure))(
    'closes the launching dialog and says why for %s',
    reason => {
      const dispatched = runHandler(eventToAction.launchFailed({ type: 'launchFailed', reason }))

      expect(dispatched).toEqual([CLOSE_LAUNCHING])
      expect(jotaiStore.get(soloLaunchPendingAtom)).toBe(false)
      expect(showSnackbarMock).toHaveBeenCalledTimes(1)
      expect(showSnackbarMock.mock.calls[0][0]).toBeTruthy()
      expect(showSnackbarMock.mock.calls[0][2]?.action).toBeDefined()
    },
  )

  test('leaves a load failure the app already explained to its own dialog', () => {
    const status: ReportedGameStatus = {
      id: 'g',
      state: 'error',
      launchErrorKind: 'verification',
    } as ReportedGameStatus
    const dispatched = runHandler(
      eventToAction.launchFailed({
        type: 'launchFailed',
        reason: SoloGameLaunchFailure.ClientFailed,
      }),
      status,
    )

    expect(dispatched).toEqual([CLOSE_LAUNCHING])
    expect(showSnackbarMock).not.toHaveBeenCalled()
  })
})

describe('registerModule', () => {
  function register() {
    const registerRoute = vi.fn()
    const listeners = new Map<string, () => void>()
    const siteSocket = {
      registerRoute,
      on: (event: string, listener: () => void) => {
        listeners.set(event, listener)
        return siteSocket
      },
    }
    registerModule({ siteSocket: siteSocket as unknown as NydusClient })
    return { registerRoute, listeners }
  }

  test('routes events on the solo games path', () => {
    const dispatched = vi.fn()
    registerDispatch(dispatched)
    const { registerRoute } = register()

    const [path, receive] = registerRoute.mock.calls[0]
    expect(path).toBe('/solo-games/:userId')
    const event: SoloGameEvent = { type: 'gameStarted', gameId: 'g' }
    receive({} as RouteInfo, event)

    expect(dispatched).toHaveBeenCalledTimes(1)
  })

  test('closes the launching dialog of a pending launch when the connection drops', () => {
    const dispatched = vi.fn()
    registerDispatch(dispatched)
    const { listeners } = register()

    listeners.get('disconnect')!()

    expect(dispatched).toHaveBeenCalledWith(CLOSE_LAUNCHING)
    expect(jotaiStore.get(soloLaunchPendingAtom)).toBe(false)
  })

  test('leaves the dialogs alone on a disconnect without a pending launch', () => {
    const dispatched = vi.fn()
    registerDispatch(dispatched)
    const { listeners } = register()
    jotaiStore.set(soloLaunchPendingAtom, false)

    listeners.get('disconnect')!()

    expect(dispatched).not.toHaveBeenCalled()
  })
})
