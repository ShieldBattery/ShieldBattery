import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import { DEFAULT_ACCOUNT_SETTINGS } from '../../common/settings/account-settings'
import { asMockedFunction } from '../../common/testing/mocks'
import { DialogType } from '../dialogs/dialog-type'
import { DispatchFunction } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { RootState } from '../root-reducer'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import {
  canceledMatchAtom,
  currentSearchInfoAtom,
  FoundMatch,
  foundMatchAtom,
  handledLobbyViolationPenaltyGamesAtom,
} from './matchmaking-atoms'
import { eventToAction } from './socket-handlers'

vi.mock('../audio/audio-manager', () => ({
  audioManager: { playSound: vi.fn() },
  AvailableSound: {
    EnteredQueue: 'enteredQueue',
    MatchFound: 'matchFound',
    MessageAlert: 'messageAlert',
  },
}))

vi.mock('../snackbars/snackbar-controller-registry', () => ({
  externalShowSnackbar: vi.fn(),
}))

const { ipcSend } = vi.hoisted(() => ({ ipcSend: vi.fn() }))

vi.mock('../../common/ipc', () => ({
  TypedIpcRenderer: class {
    send = ipcSend
    invoke = vi.fn()
    on = vi.fn()
  },
}))

vi.mock('../logging/logger', () => ({
  default: {
    verbose: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../i18n/i18next', () => ({
  default: { t: (_key: string, defaultValue: string) => defaultValue },
}))

vi.mock('./action-creators', () => ({
  closeAcceptMatchDialog: vi.fn(() => ({ type: '@dialogs/close' })),
  openAcceptMatchDialog: vi.fn(() => ({ type: '@dialogs/open' })),
  getCurrentMapPool: vi.fn(() => ({ type: '@matchmaking/getCurrentMapPool' })),
}))

const showSnackbarMock = asMockedFunction(externalShowSnackbar)

function makeMatch(): FoundMatch {
  return {
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers: 2,
    acceptStart: 0,
    acceptTimeTotalMillis: 30000,
    acceptedPlayers: 0,
    hasAccepted: false,
  }
}

function makeSearchInfo() {
  return {
    searchedTypes: new Map([[MatchmakingType.Match1v1, 'p' as const]]),
    startTime: 0,
  }
}

/** Runs a thunk-or-value handler result, collecting anything it dispatches. */
function runHandler(
  result: unknown,
  dialogHistory: Array<{ type: DialogType }>,
  flashTaskbar = true,
) {
  const dispatched: unknown[] = []
  const dispatch = ((action: unknown) => {
    dispatched.push(action)
  }) as DispatchFunction<any>
  const getState = (() => ({
    dialog: { history: dialogHistory },
    settings: { account: { ...DEFAULT_ACCOUNT_SETTINGS, flashTaskbar } },
  })) as unknown as () => RootState

  if (typeof result === 'function') {
    ;(result as (d: DispatchFunction<any>, g: () => RootState) => void)(dispatch, getState)
  }

  return dispatched
}

function runDraftStarted(dialogHistory: Array<{ type: DialogType }> = [], flashTaskbar = true) {
  const event = {
    type: 'draftStarted',
    draftState: { isCompleted: false } as any,
    mapInfo: { id: 'map-1' } as any,
  }
  return runHandler(
    eventToAction.draftStarted(MatchmakingType.Match1v1, event as any),
    dialogHistory,
    flashTaskbar,
  )
}

function runMatchFound(flashTaskbar = true) {
  const event = {
    type: 'matchFound',
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers: 2,
    acceptedPlayers: 0,
    acceptTimeLeftMillis: 30000,
    acceptTimeTotalMillis: 30000,
    hasAccepted: false,
  }
  return runHandler(
    eventToAction.matchFound(MatchmakingType.Match1v1, event as any),
    [],
    flashTaskbar,
  )
}

function runRequeue(dialogHistory: Array<{ type: DialogType }> = []) {
  return runHandler(
    eventToAction.requeue(MatchmakingType.Match1v1, { type: 'requeue' } as any),
    dialogHistory,
  )
}

function runQueueStatus(dialogHistory: Array<{ type: DialogType }> = []) {
  return runHandler(
    eventToAction.queueStatus(MatchmakingType.Match1v1, { type: 'queueStatus' } as any),
    dialogHistory,
  )
}

describe('client/matchmaking/socket-handlers/matchFound', () => {
  beforeEach(() => {
    ipcSend.mockClear()
    jotaiStore.set(foundMatchAtom, undefined)
  })

  test('asks for attention when taskbar flashing is allowed', () => {
    runMatchFound()

    expect(ipcSend).toHaveBeenCalledExactlyOnceWith('userAttentionRequired')
    expect(jotaiStore.get(foundMatchAtom)).toBeDefined()
  })

  test('does not ask for attention when taskbar flashing is off', () => {
    runMatchFound(false)

    expect(ipcSend).not.toHaveBeenCalled()
    expect(jotaiStore.get(foundMatchAtom)).toBeDefined()
  })
})

describe('client/matchmaking/socket-handlers/draftStarted', () => {
  beforeEach(() => {
    showSnackbarMock.mockClear()
    ipcSend.mockClear()
    jotaiStore.set(foundMatchAtom, undefined)
    jotaiStore.set(currentSearchInfoAtom, undefined)
  })

  test('clears the found match once the accept phase is over', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())

    runDraftStarted()

    expect(jotaiStore.get(foundMatchAtom)).toBeUndefined()
  })

  test('leaves the ongoing search info alone', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    const searchInfo = makeSearchInfo()
    jotaiStore.set(currentSearchInfoAtom, searchInfo)

    runDraftStarted()

    expect(jotaiStore.get(currentSearchInfoAtom)).toBe(searchInfo)
  })

  test('asks for attention only when taskbar flashing is allowed', () => {
    runDraftStarted()
    expect(ipcSend).toHaveBeenCalledExactlyOnceWith('userAttentionRequired')

    ipcSend.mockClear()
    runDraftStarted([], false)
    expect(ipcSend).not.toHaveBeenCalled()
  })
})

describe('client/matchmaking/socket-handlers/requeue', () => {
  beforeEach(() => {
    showSnackbarMock.mockClear()
    jotaiStore.set(foundMatchAtom, undefined)
    jotaiStore.set(currentSearchInfoAtom, undefined)
    jotaiStore.set(canceledMatchAtom, undefined)
  })

  test('shows the returning-to-queue snackbar when the accept dialog is gone', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())

    runRequeue()

    expect(showSnackbarMock).toHaveBeenCalledTimes(1)
    expect(jotaiStore.get(foundMatchAtom)).toBeUndefined()
  })

  test('stays quiet while the accept dialog is still up to say it itself', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())

    runRequeue([{ type: DialogType.AcceptMatch }])

    expect(showSnackbarMock).not.toHaveBeenCalled()
    expect(jotaiStore.get(foundMatchAtom)).toBeUndefined()
  })

  test('stays quiet when neither a found match nor a canceled match explains the requeue', () => {
    runRequeue()

    expect(showSnackbarMock).not.toHaveBeenCalled()
    expect(jotaiStore.get(foundMatchAtom)).toBeUndefined()
  })
})

describe('client/matchmaking/socket-handlers/canceled match', () => {
  beforeEach(() => {
    showSnackbarMock.mockClear()
    jotaiStore.set(foundMatchAtom, undefined)
    jotaiStore.set(currentSearchInfoAtom, undefined)
    jotaiStore.set(canceledMatchAtom, undefined)
    jotaiStore.set(handledLobbyViolationPenaltyGamesAtom, new Set())
  })

  function openedDialogs(dispatched: unknown[]) {
    return dispatched.filter((a: any) => a.type === '@dialogs/open').map((a: any) => a.payload)
  }

  test('explains a canceled draft once the player is requeued', () => {
    runHandler(
      eventToAction.draftCancel(MatchmakingType.Match2v2, {
        type: 'draftCancel',
        reason: 'playerLeft',
      }),
      [],
    )
    const dispatched = runRequeue()

    expect(openedDialogs(dispatched)).toEqual([
      { type: DialogType.MatchCanceled, initData: { phase: 'draft', reason: 'playerLeft' } },
    ])
    expect(showSnackbarMock).not.toHaveBeenCalled()
    expect(jotaiStore.get(canceledMatchAtom)).toBeUndefined()
  })

  test('explains a canceled game load once the player is requeued', () => {
    const cancelDispatched = runHandler(
      eventToAction.cancelLoading(MatchmakingType.Match1v1, {
        type: 'cancelLoading',
        reason: 'loadTimeout',
      }),
      [],
    )
    const dispatched = runRequeue()

    expect(cancelDispatched).toContainEqual({
      type: '@dialogs/close',
      payload: { dialogType: DialogType.LaunchingGame },
    })
    expect(openedDialogs(dispatched)).toEqual([
      { type: DialogType.MatchCanceled, initData: { phase: 'load', reason: 'loadTimeout' } },
    ])
    expect(showSnackbarMock).not.toHaveBeenCalled()
  })

  test('shows the offender a pending-penalty anomaly dialog after queue removal', () => {
    runHandler(
      eventToAction.cancelLoading(MatchmakingType.Match1v1, {
        type: 'cancelLoading',
        reason: 'gameAnomaly',
        penalty: 'pending',
      }),
      [],
    )
    const dispatched = runQueueStatus()

    expect(openedDialogs(dispatched)).toEqual([
      {
        type: DialogType.MatchCanceled,
        initData: {
          phase: 'load',
          reason: 'gameAnomaly',
          penalty: 'pending',
          requeued: false,
        },
      },
    ])
    expect(showSnackbarMock).not.toHaveBeenCalled()
    expect(jotaiStore.get(canceledMatchAtom)).toBeUndefined()

    // A duplicate status update cannot reopen the dialog after the retained state is consumed.
    expect(openedDialogs(runQueueStatus())).toEqual([])
  })

  test('shows a late penalty once without disrupting a later search', () => {
    const first = runHandler(
      eventToAction.lobbyViolationPenalty(MatchmakingType.Match1v1, {
        type: 'lobbyViolationPenalty',
        gameId: 'late-game',
        penalty: 'lossAndBan',
        queueRemoved: true,
      }),
      [],
    )

    expect(openedDialogs(first)).toEqual([
      {
        type: DialogType.MatchCanceled,
        initData: {
          phase: 'load',
          reason: 'gameAnomaly',
          penalty: 'lossAndBan',
          queueRemoved: true,
          requeued: false,
        },
      },
    ])

    const laterSearch = makeSearchInfo()
    jotaiStore.set(currentSearchInfoAtom, laterSearch)
    const duplicate = runHandler(
      eventToAction.lobbyViolationPenalty(MatchmakingType.Match1v1, {
        type: 'lobbyViolationPenalty',
        gameId: 'late-game',
        queueRemoved: true,
        penalty: 'lossAndBan',
      }),
      [],
    )

    expect(openedDialogs(duplicate)).toEqual([])
    expect(jotaiStore.get(currentSearchInfoAtom)).toBe(laterSearch)
  })
  test('preserves a current search when a late warning did not remove it', () => {
    const search = makeSearchInfo()
    jotaiStore.set(currentSearchInfoAtom, search)

    const dispatched = runHandler(
      eventToAction.lobbyViolationPenalty(MatchmakingType.Match1v1, {
        type: 'lobbyViolationPenalty',
        gameId: 'warning-game',
        penalty: 'lossAndWarning',
        queueRemoved: false,
      }),
      [],
    )

    expect(openedDialogs(dispatched)).toEqual([
      {
        type: DialogType.MatchCanceled,
        initData: {
          phase: 'load',
          reason: 'gameAnomaly',
          penalty: 'lossAndWarning',
          queueRemoved: false,
          requeued: false,
        },
      },
    ])
    expect(jotaiStore.get(currentSearchInfoAtom)).toBe(search)
  })

  test('shows a requeued player the innocent anomaly dialog', () => {
    runHandler(
      eventToAction.cancelLoading(MatchmakingType.Match2v2, {
        type: 'cancelLoading',
        reason: 'gameAnomaly',
      }),
      [],
    )
    const dispatched = runRequeue()

    expect(openedDialogs(dispatched)).toEqual([
      { type: DialogType.MatchCanceled, initData: { phase: 'load', reason: 'gameAnomaly' } },
    ])
    expect(showSnackbarMock).not.toHaveBeenCalled()
  })

  test('shows the innocent anomaly dialog without a requeue claim if the player leaves the queue', () => {
    runHandler(
      eventToAction.cancelLoading(MatchmakingType.Match2v2, {
        type: 'cancelLoading',
        reason: 'gameAnomaly',
      }),
      [],
    )
    const dispatched = runQueueStatus()

    expect(openedDialogs(dispatched)).toEqual([
      {
        type: DialogType.MatchCanceled,
        initData: { phase: 'load', reason: 'gameAnomaly', requeued: false },
      },
    ])
    expect(showSnackbarMock).not.toHaveBeenCalled()
    expect(jotaiStore.get(canceledMatchAtom)).toBeUndefined()
  })

  test('keeps the existing generic notification for non-anomaly load failures', () => {
    runHandler(
      eventToAction.cancelLoading(MatchmakingType.Match1v1, {
        type: 'cancelLoading',
        reason: 'playerFailedToLoad',
      }),
      [],
    )
    const dispatched = runQueueStatus()

    expect(openedDialogs(dispatched)).toEqual([])
    expect(showSnackbarMock).toHaveBeenCalledTimes(1)
    expect(showSnackbarMock.mock.calls[0][0]).toBe('The game has failed to load.')
    expect(jotaiStore.get(canceledMatchAtom)).toBeUndefined()

    // A later requeue from a different match isn't explained by the stale cancel.
    expect(openedDialogs(runRequeue())).toEqual([])
  })
})
