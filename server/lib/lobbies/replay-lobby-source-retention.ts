import { singleton } from 'tsyringe'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { ReplaySessionSources } from '../replays/replay-session-sources'
import { LobbyService } from './lobby-service'

/**
 * How often the uploaded replays that replay lobbies are watching have their expiry pushed back
 * out. Far shorter than an upload's lifetime, so an upload survives several missed runs.
 */
const JOB_RUN_INTERVAL_MS = 60 * 60 * 1000

/**
 * Keeps every uploaded replay a live replay lobby is watching from expiring, so its viewers can
 * still download it however long the lobby lasts.
 */
@singleton()
export class ReplayLobbySourceRetentionJob {
  constructor(
    jobScheduler: JobScheduler,
    lobbyService: LobbyService,
    replaySessionSources: ReplaySessionSources,
  ) {
    jobScheduler.scheduleImmediateJob(
      'lib/lobbies#replayLobbySourceRetention',
      JOB_RUN_INTERVAL_MS,
      async () => {
        const sourceIds = lobbyService.getWatchedReplayUploadIds()
        if (!sourceIds.length) {
          return
        }

        const retained = await replaySessionSources.retainUploads(sourceIds)
        for (const sourceId of sourceIds) {
          if (!retained.has(sourceId)) {
            logger.warn({ sourceId }, 'an uploaded replay a replay lobby is watching has expired')
          }
        }
      },
    )
  }
}
