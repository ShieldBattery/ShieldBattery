import { Map, Record, is } from 'immutable'
import log from '../logging/logger'
import { getCurrentMatchmakingTime, getMatchmakingSchedule } from '../models/matchmaking-times'
import { MatchmakingType } from '../../../common/matchmaking'

class StatusRecord extends Record({
  type: null as MatchmakingType | null,
  enabled: false,
  startDate: null as Date | null,
  nextStartDate: null as Date | null,
  nextEndDate: null as Date | null,
}) {}

export default class MatchmakingStatus {
  // TODO(2Pac): Update this once nydus gets typings
  nydus: any
  statusByType: Map<MatchmakingType, StatusRecord>
  timerByType: Map<MatchmakingType, ReturnType<typeof setTimeout>>

  constructor() {
    this.nydus = null
    this.statusByType = Map()
    this.timerByType = Map()
  }

  isEnabled(type: MatchmakingType): boolean {
    return !!this.statusByType.get(type)?.enabled
  }

  initialize(nydus: any) {
    this.nydus = nydus
    for (const type of Object.values(MatchmakingType)) {
      this.maybePublish(type)
    }
  }

  subscribe(socket: any) {
    this.nydus.subscribeClient(socket, '/matchmakingStatus')

    for (const type of Object.values(MatchmakingType)) {
      const status = this.statusByType.get(type)
      if (status) {
        this.nydus.publish('/matchmakingStatus', status)
      }
    }
  }

  /**
   * Publishes the current matchmaking status to subscribed users, if the status or the schedule
   * has changed since the last cached value.
   *
   * If a change has occurred, a timeout will be set up for the next scheduled change to publish
   * that as well.
   */
  async maybePublish(type: MatchmakingType) {
    try {
      const current = await getCurrentMatchmakingTime(type)
      const schedule = await getMatchmakingSchedule(type, current?.startDate, !current?.enabled)

      const oldStatus = this.statusByType.get(type)
      const status = new StatusRecord({
        type,
        enabled: !!current?.enabled,
        startDate: current?.startDate,
        nextStartDate: schedule[0]?.startDate,
        nextEndDate: schedule[1]?.startDate,
      })

      // If the status hasn't changed, no need to notify the users
      if (is(oldStatus, status)) return

      this.statusByType = this.statusByType.set(type, status)
      this.nydus.publish('/matchmakingStatus', status)

      // If the `nextStartDate` hasn't changed, no need to update the timer
      if (oldStatus?.nextStartDate === status.nextStartDate) return

      const oldTimer = this.timerByType.get(type)
      if (oldTimer) {
        clearTimeout(oldTimer)
      }

      if (status.nextStartDate) {
        const timer = setTimeout(() => this.maybePublish(type), +status.nextStartDate - Date.now())
        this.timerByType = this.timerByType.set(type, timer)
      } else {
        this.timerByType = this.timerByType.delete(type)
      }
    } catch (err) {
      log.error({ err }, 'error publishing matchmaking status')
    }
  }
}
