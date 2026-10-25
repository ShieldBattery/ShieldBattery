import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { dispatch } from '../dispatch-registry'
import { addChangeHandler, getUpdateState, UpdateState } from '../download/updater-state'
import {
  dismissConnectionRefused,
  showConnectionRefused,
  UPDATE_FALLBACK_DELAY_MS,
} from './connection-refused-dialog'

vi.mock('../dispatch-registry', () => ({ dispatch: vi.fn() }))
vi.mock('../download/updater-state', () => ({
  addChangeHandler: vi.fn(),
  getUpdateState: vi.fn(),
  removeChangeHandler: vi.fn(),
}))

function dispatchedTypes() {
  return vi.mocked(dispatch).mock.calls.map(([action]) => (action as { type: string }).type)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(getUpdateState).mockReturnValue({
    hasUpdate: false,
    hasDownloadError: false,
    readyToInstall: false,
  })
})

afterEach(() => {
  dismissConnectionRefused()
  vi.clearAllMocks()
  vi.useRealTimers()
})

test('failed verification is explained right away', () => {
  showConnectionRefused('clientVerification')
  expect(dispatchedTypes()).toEqual(['@dialogs/open'])
})

test('an outdated client is left to the update dialog when an update was found', () => {
  vi.mocked(getUpdateState).mockReturnValue({
    hasUpdate: true,
    hasDownloadError: false,
    readyToInstall: false,
  })
  showConnectionRefused('clientUpdate')
  vi.advanceTimersByTime(UPDATE_FALLBACK_DELAY_MS)
  expect(dispatch).not.toHaveBeenCalled()
})

test('an outdated client is told to update if the updater found nothing', () => {
  showConnectionRefused('clientUpdate')
  vi.advanceTimersByTime(UPDATE_FALLBACK_DELAY_MS - 1)
  expect(dispatch).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(dispatchedTypes()).toEqual(['@dialogs/open'])
})

test('an update found after the fallback opened takes over from it', () => {
  showConnectionRefused('clientUpdate')
  vi.advanceTimersByTime(UPDATE_FALLBACK_DELAY_MS)
  const opened = vi.mocked(dispatch).mock.calls[0][0] as { meta: { id: string } }
  const onUpdateState = vi.mocked(addChangeHandler).mock.calls[0][0]

  onUpdateState({ hasUpdate: false } as UpdateState)
  expect(dispatch).toHaveBeenCalledOnce()
  onUpdateState({ hasUpdate: true } as UpdateState)
  expect(vi.mocked(dispatch).mock.calls[1][0]).toEqual({
    type: '@dialogs/close',
    payload: { id: opened.meta.id },
  })
})

test('dismissing closes the dialog that was opened', () => {
  showConnectionRefused('clientVerification')
  const opened = vi.mocked(dispatch).mock.calls[0][0] as { meta: { id: string } }
  dismissConnectionRefused()
  expect(vi.mocked(dispatch).mock.calls[1][0]).toEqual({
    type: '@dialogs/close',
    payload: { id: opened.meta.id },
  })
})

test('dismissing cancels a pending explanation', () => {
  showConnectionRefused('clientUpdate')
  dismissConnectionRefused()
  vi.advanceTimersByTime(UPDATE_FALLBACK_DELAY_MS)
  expect(dispatch).not.toHaveBeenCalled()
})
