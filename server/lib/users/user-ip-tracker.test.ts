import { beforeEach, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import log from '../logging/logger'
import { FakeClock, StopCriteria } from '../time/testing/fake-clock'
import { USER_IP_WRITE_INTERVAL_MS, UserIpTracker } from './user-ip-tracker'
import { upsertUserIpSightings } from './user-ips'

vi.mock('./user-ips', () => ({ upsertUserIpSightings: vi.fn() }))
vi.mock('../logging/logger', () => ({ default: { error: vi.fn() } }))

const START_TIME = 1_000_000
const USER_1 = makeSbUserId(1)
const USER_2 = makeSbUserId(2)

let clock: FakeClock
let tracker: UserIpTracker

function runNextWrite() {
  return clock.runTimeoutsUntil({ criteria: StopCriteria.NumTasks, numTasks: 1 })
}

beforeEach(() => {
  vi.resetAllMocks()
  asMockedFunction(upsertUserIpSightings).mockResolvedValue()

  clock = new FakeClock()
  clock.autoRunTimeouts = false
  clock.setCurrentTime(START_TIME)
  tracker = new UserIpTracker(clock)
})

test('writes the first sighting of a user at an address immediately', () => {
  tracker.record(USER_1, '1.2.3.4')
  tracker.record(USER_2, '1.2.3.4')
  tracker.record(USER_1, '5.6.7.8')

  expect(asMockedFunction(upsertUserIpSightings).mock.calls).toEqual([
    [[{ userId: USER_1, ipAddress: '1.2.3.4', count: 1, lastSeen: new Date(START_TIME) }]],
    [[{ userId: USER_2, ipAddress: '1.2.3.4', count: 1, lastSeen: new Date(START_TIME) }]],
    [[{ userId: USER_1, ipAddress: '5.6.7.8', count: 1, lastSeen: new Date(START_TIME) }]],
  ])
})

test('writes repeat sightings together once the interval passes', async () => {
  tracker.record(USER_1, '1.2.3.4')
  tracker.record(USER_2, '5.6.7.8')
  asMockedFunction(upsertUserIpSightings).mockClear()

  clock.setCurrentTime(START_TIME + 1000)
  tracker.record(USER_1, '1.2.3.4')
  tracker.record(USER_2, '5.6.7.8')
  clock.setCurrentTime(START_TIME + 2000)
  tracker.record(USER_1, '1.2.3.4')
  expect(upsertUserIpSightings).not.toHaveBeenCalled()

  await runNextWrite()

  expect(clock.now()).toBe(START_TIME + USER_IP_WRITE_INTERVAL_MS)
  expect(asMockedFunction(upsertUserIpSightings).mock.calls).toEqual([
    [
      [
        { userId: USER_1, ipAddress: '1.2.3.4', count: 2, lastSeen: new Date(START_TIME + 2000) },
        { userId: USER_2, ipAddress: '5.6.7.8', count: 1, lastSeen: new Date(START_TIME + 1000) },
      ],
    ],
  ])
})

test('counts each repeat sighting in only one write', async () => {
  tracker.record(USER_1, '1.2.3.4')
  tracker.record(USER_1, '1.2.3.4')
  await runNextWrite()
  asMockedFunction(upsertUserIpSightings).mockClear()

  tracker.record(USER_1, '1.2.3.4')
  await runNextWrite()

  expect(asMockedFunction(upsertUserIpSightings).mock.calls).toEqual([
    [
      [
        {
          userId: USER_1,
          ipAddress: '1.2.3.4',
          count: 1,
          lastSeen: new Date(START_TIME + USER_IP_WRITE_INTERVAL_MS),
        },
      ],
    ],
  ])
})

test('treats a sighting after a quiet interval as a first one', async () => {
  tracker.record(USER_1, '1.2.3.4')
  await runNextWrite()
  asMockedFunction(upsertUserIpSightings).mockClear()

  tracker.record(USER_1, '1.2.3.4')

  expect(asMockedFunction(upsertUserIpSightings).mock.calls).toEqual([
    [
      [
        {
          userId: USER_1,
          ipAddress: '1.2.3.4',
          count: 1,
          lastSeen: new Date(START_TIME + USER_IP_WRITE_INTERVAL_MS),
        },
      ],
    ],
  ])
})

test('stops its timer once every address has gone quiet', async () => {
  tracker.record(USER_1, '1.2.3.4')
  tracker.record(USER_1, '1.2.3.4')

  // The first write carries the repeat sighting, the second finds nothing new and forgets the
  // address.
  await runNextWrite()
  await runNextWrite()
  asMockedFunction(upsertUserIpSightings).mockClear()
  await clock.runTimeoutsUntil({ criteria: StopCriteria.EmptyQueue })

  expect(clock.now()).toBe(START_TIME + 2 * USER_IP_WRITE_INTERVAL_MS)
  expect(upsertUserIpSightings).not.toHaveBeenCalled()
})

test('keeps recording after a write fails', async () => {
  asMockedFunction(upsertUserIpSightings).mockRejectedValueOnce(new Error('db is down'))
  tracker.record(USER_1, '1.2.3.4')
  tracker.record(USER_1, '1.2.3.4')
  await runNextWrite()

  expect(log.error).toHaveBeenCalledTimes(1)
  expect(asMockedFunction(upsertUserIpSightings).mock.calls[1]).toEqual([
    [
      {
        userId: USER_1,
        ipAddress: '1.2.3.4',
        count: 1,
        lastSeen: new Date(START_TIME),
      },
    ],
  ])
})
