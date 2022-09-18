import { FakeClock } from '../time/testing/fake-clock'
import { LazyScheduler } from './lazy-scheduler'

const DELAY_MILLIS = 1000

describe('server/lib/matchmaking/lazy-scheduler', () => {
  let clock: FakeClock
  let scheduler: LazyScheduler
  let handledErrorPromise: Promise<void>
  let resolveHandledErrorPromise: () => void

  beforeEach(() => {
    clock = new FakeClock()
    scheduler = new LazyScheduler(clock)
    scheduler.setDelay(DELAY_MILLIS)
    handledErrorPromise = new Promise((resolve, reject) => {
      resolveHandledErrorPromise = resolve

      scheduler.setErrorHandler(err => {
        reject(err)
        return false
      })
    })
  })

  afterEach(async () => {
    resolveHandledErrorPromise()
    await handledErrorPromise
  })

  test('should run until the method returns false', async () => {
    const delays: number[] = []

    const runsTarget = 5
    let runs = 0
    scheduler.setMethod(delay => {
      runs++
      delays.push(delay)
      return runs < runsTarget
    })

    scheduler.scheduleIfNeeded()
    await clock.allTimeoutsCompleted()

    expect(delays).toMatchInlineSnapshot(`
      [
        1000,
        1000,
        1000,
        1000,
        1000,
      ]
    `)
  })

  test('should handle skipped executions', async () => {
    const delays: number[] = []

    scheduler.setMethod(delay => {
      delays.push(delay)
      return false
    })

    scheduler.scheduleIfNeeded()
    await clock.allTimeoutsCompleted()

    clock.setCurrentTime(clock.now() + 1500)

    scheduler.scheduleIfNeeded()
    await clock.allTimeoutsCompleted()

    expect(delays).toMatchInlineSnapshot(`
      [
        1000,
        2000,
      ]
    `)
  })

  test('should handle long-running executions', async () => {
    const delays: number[] = []

    scheduler.setMethod(delay => {
      delays.push(delay)
      clock.setCurrentTime(clock.now() + 1500)
      return false
    })

    scheduler.scheduleIfNeeded()
    await clock.allTimeoutsCompleted()

    scheduler.scheduleIfNeeded()
    await clock.allTimeoutsCompleted()

    expect(delays).toMatchInlineSnapshot(`
      [
        1000,
        2000,
      ]
    `)
  })
})
