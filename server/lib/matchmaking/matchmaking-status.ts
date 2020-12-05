import { Map, Record, is } from 'immutable'
import log from '../logging/logger'
import { getCurrentMatchmakingTime, getMatchmakingSchedule } from '../models/matchmaking-times'
import { MATCHMAKING_TYPES } from '../../../common/constants'

const StatusRecord = new Record({
  type: null,
  enabled: false,
  startDate: null,
  nextStartDate: null,
  nextEndDate: null,
})

export default class MatchmakingStatus {
  constructor() {
    this.nydus = null
    this.statusByType = new Map()
    this.timerByType = new Map()
  }

  isEnabled(type) {
    return this.statusByType.get(type)?.enabled
  }

  initialize(nydus) {
    this.nydus = nydus
    MATCHMAKING_TYPES.forEach(type => this.publish(type))
  }

  subscribe(socket) {
    this.nydus.subscribeClient(socket, '/matchmakingStatus')

    MATCHMAKING_TYPES.forEach(type => {
      const status = this.statusByType.get(type)
      if (status) {
        this.nydus.publish('/matchmakingStatus', status)
      }
    })
  }

  /**
   * This function does the following:
   *  - fetches matchmaking status from the database and caches it; matchmaking status represents
   *    the current matchmaking time and the starting and ending dates of the next status changes.
   *  - notifies the user if the status changed since last time it was called
   *  - invalidates the previous timer and sets up a new one to run the function again, if the next
   *    starting date has changed (by e.g. admin adding/removing matchmaking times)
   */
  publish = async type => {
    try {
      const current = await getCurrentMatchmakingTime(type)
      const schedule = await getMatchmakingSchedule(type, current?.startDate, !current?.enabled)

      const oldStatus = this.statusByType.get(type)
      const status = new StatusRecord({
        type,
        enabled: current?.enabled,
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

      let timer
      if (status.nextStartDate) {
        timer = setTimeout(() => this.publish(type), new Date(status.nextStartDate) - Date.now())
      }
      this.timerByType = this.timerByType.set(type, timer)
    } catch (err) {
      log.error({ err }, 'error getting matchmaking status')
    }
  }
}
