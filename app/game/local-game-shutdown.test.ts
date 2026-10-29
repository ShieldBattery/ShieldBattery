import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'
import {
  CleanupFailureChoice,
  promptForLocalGameCleanup,
  waitForLocalGameOnQuit,
} from './local-game-shutdown'

function fixture() {
  const app = Object.assign(new EventEmitter(), {
    quit: vi.fn(() => app.emit('before-quit', event)),
  })
  const event = { preventDefault: vi.fn() }
  const manager = { isActive: vi.fn(() => true), stop: vi.fn<() => Promise<void>>() }
  const onError = vi.fn()
  const choose = vi.fn<() => Promise<CleanupFailureChoice>>().mockResolvedValue('cancel')
  waitForLocalGameOnQuit(app as never, manager, onError, choose)
  return { app, event, manager, onError, choose }
}

test('normal quit waits once for local teardown before allowing app exit', async () => {
  const f = fixture()
  let finish!: () => void
  f.manager.stop.mockReturnValue(
    new Promise(resolve => {
      finish = resolve
    }),
  )
  f.app.emit('before-quit', f.event)
  f.app.emit('before-quit', f.event)
  await Promise.resolve()
  expect(f.event.preventDefault).toHaveBeenCalledTimes(2)
  expect(f.manager.stop).toHaveBeenCalledOnce()
  expect(f.app.quit).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => expect(f.app.quit).toHaveBeenCalledOnce())
  expect(f.event.preventDefault).toHaveBeenCalledTimes(2)
})

test('cancel quit retains the app and a later quit retries cleanup', async () => {
  const f = fixture()
  const error = new Error('Client did not exit')
  f.manager.stop.mockRejectedValueOnce(error).mockResolvedValue(undefined)
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.choose).toHaveBeenCalledOnce())
  expect(f.app.quit).not.toHaveBeenCalled()
  expect(f.onError).toHaveBeenCalledExactlyOnceWith(error)
  expect(f.manager.stop).toHaveBeenCalledOnce()
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.app.quit).toHaveBeenCalledOnce())
  expect(f.manager.stop).toHaveBeenCalledTimes(2)
})

test('retry cleanup quits only after the retried cleanup succeeds', async () => {
  const f = fixture()
  let finish!: () => void
  f.manager.stop.mockRejectedValueOnce(new Error('Client did not exit')).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    }),
  )
  f.choose.mockResolvedValue('retry')
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.manager.stop).toHaveBeenCalledTimes(2))
  expect(f.app.quit).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => expect(f.app.quit).toHaveBeenCalledOnce())
  expect(f.choose).toHaveBeenCalledOnce()
})

test('repeated failures require another explicit choice and never force app exit', async () => {
  const f = fixture()
  f.manager.stop.mockRejectedValue(new Error('Client did not exit'))
  f.choose.mockResolvedValueOnce('retry').mockResolvedValueOnce('cancel')
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.choose).toHaveBeenCalledTimes(2))
  expect(f.manager.stop).toHaveBeenCalledTimes(2)
  expect(f.app.quit).not.toHaveBeenCalled()
})

test('quit events while a dialog is open share one cleanup and one dialog', async () => {
  const f = fixture()
  let cancel!: (choice: CleanupFailureChoice) => void
  f.manager.stop.mockRejectedValue(new Error('Client did not exit'))
  f.choose.mockReturnValue(
    new Promise(resolve => {
      cancel = resolve
    }),
  )
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.choose).toHaveBeenCalledOnce())
  f.app.emit('before-quit', f.event)
  f.app.emit('before-quit', f.event)
  expect(f.manager.stop).toHaveBeenCalledOnce()
  expect(f.choose).toHaveBeenCalledOnce()
  cancel('cancel')
})

test('dialog failure retains ownership and permits a later quit attempt', async () => {
  const f = fixture()
  f.manager.stop
    .mockRejectedValueOnce(new Error('Client did not exit'))
    .mockResolvedValue(undefined)
  f.choose.mockRejectedValue(new Error('Dialog failed'))
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.onError).toHaveBeenCalledTimes(2))
  expect(f.app.quit).not.toHaveBeenCalled()
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.app.quit).toHaveBeenCalledOnce())
})

test.each([0, 1, -1])('native dialog response %s maps to a safe cleanup choice', async response => {
  const showMessageBox = vi.fn().mockResolvedValue({ response })
  expect(await promptForLocalGameCleanup({ showMessageBox } as never)).toBe(
    response === 0 ? 'retry' : 'cancel',
  )
  expect(showMessageBox).toHaveBeenCalledWith(
    expect.objectContaining({
      buttons: ['Retry cleanup', 'Cancel quit'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }),
  )
})

test('cleanup prompt restores and focuses a hidden or minimized parent', async () => {
  const showMessageBox = vi.fn().mockResolvedValue({ response: 1 })
  const parent = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
  await promptForLocalGameCleanup({ showMessageBox } as never, parent as never)
  expect(parent.restore).toHaveBeenCalledOnce()
  expect(parent.show).toHaveBeenCalledOnce()
  expect(parent.focus).toHaveBeenCalledOnce()
  expect(showMessageBox).toHaveBeenCalledWith(parent, expect.any(Object))
})

test('cleanup prompt works after its parent window has closed', async () => {
  const showMessageBox = vi.fn().mockResolvedValue({ response: 1 })
  await promptForLocalGameCleanup({ showMessageBox } as never, { isDestroyed: () => true } as never)
  expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ cancelId: 1 }))
})

test('quit without a local game proceeds immediately', () => {
  const f = fixture()
  f.manager.isActive.mockReturnValue(false)
  f.app.emit('before-quit', f.event)
  expect(f.event.preventDefault).not.toHaveBeenCalled()
  expect(f.manager.stop).not.toHaveBeenCalled()
})
