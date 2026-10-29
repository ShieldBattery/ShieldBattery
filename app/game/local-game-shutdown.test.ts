import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'
import { waitForLocalGameOnQuit } from './local-game-shutdown'

function fixture() {
  const app = Object.assign(new EventEmitter(), {
    quit: vi.fn(() => app.emit('before-quit', event)),
  })
  const event = { preventDefault: vi.fn() }
  const manager = { isActive: vi.fn(() => true), stop: vi.fn<() => Promise<void>>() }
  const onError = vi.fn()
  waitForLocalGameOnQuit(app as never, manager, onError)
  return { app, event, manager, onError }
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

test('teardown failure retains the app and a later quit retries cleanup', async () => {
  const f = fixture()
  const error = new Error('Client did not exit')
  f.manager.stop.mockRejectedValueOnce(error).mockResolvedValue(undefined)
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.onError).toHaveBeenCalledOnce())
  expect(f.app.quit).not.toHaveBeenCalled()
  expect(f.onError).toHaveBeenCalledExactlyOnceWith(error)
  expect(f.manager.stop).toHaveBeenCalledOnce()
  f.app.emit('before-quit', f.event)
  await vi.waitFor(() => expect(f.app.quit).toHaveBeenCalledOnce())
  expect(f.manager.stop).toHaveBeenCalledTimes(2)
})

test('quit without a local game proceeds immediately', () => {
  const f = fixture()
  f.manager.isActive.mockReturnValue(false)
  f.app.emit('before-quit', f.event)
  expect(f.event.preventDefault).not.toHaveBeenCalled()
  expect(f.manager.stop).not.toHaveBeenCalled()
})
