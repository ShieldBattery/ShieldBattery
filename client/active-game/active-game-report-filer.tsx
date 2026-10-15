import { useEffect } from 'react'
import { Client, useClient } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import {
  InGameReportReason,
  InGameReportRequest,
  InGameReportResult,
  TypedIpcRenderer,
} from '../../common/ipc'
import { ReportGameMutation } from '../games/report-game-mutation'
import { GameReportReason } from '../gql/graphql'
import logger from '../logging/logger'

const ipcRenderer = new TypedIpcRenderer()

const REPORT_REASONS: Readonly<Record<InGameReportReason, GameReportReason>> = {
  cheating: GameReportReason.Cheating,
  abandoning: GameReportReason.Abandoning,
  griefing: GameReportReason.Griefing,
  abusiveChat: GameReportReason.AbusiveChat,
}

/** The GraphQL client reports are filed with, while an `ActiveGameReportFiler` is mounted. */
let filingClient: Client | undefined

// Registered once for the life of the page rather than per mount: listeners cross the preload's
// context bridge as fresh proxies, so `removeListener` can never find one to remove, and a listener
// added on every mount would file each report once per mount.
ipcRenderer.on('activeGameReportPlayer', (_event, gameId, request) => {
  const result = filingClient
    ? fileReport(filingClient, gameId, request)
    : Promise.resolve<InGameReportResult['result']>('error')
  result
    .then(result =>
      ipcRenderer.invoke('activeGameReportResult', gameId, {
        userId: request.userId,
        result,
      }),
    )
    .catch(swallowNonBuiltins)
})

/**
 * Files the reports the local user makes from in game as soon as they're made, and tells the game
 * how each one went.
 */
export function ActiveGameReportFiler() {
  const client = useClient()

  useEffect(() => {
    filingClient = client
    return () => {
      if (filingClient === client) {
        filingClient = undefined
      }
    }
  }, [client])

  return null
}

async function fileReport(
  client: Client,
  gameId: string,
  { userId, reason, gameSeconds }: InGameReportRequest,
): Promise<InGameReportResult['result']> {
  try {
    const result = await client
      .mutation(ReportGameMutation, {
        input: {
          gameId,
          reportedUserId: userId,
          reason: REPORT_REASONS[reason],
          gameTimeSeconds: gameSeconds,
        },
      })
      .toPromise()
    if (!result.error) {
      return 'reported'
    }

    const code = result.error.graphQLErrors?.[0]?.extensions?.code
    switch (code) {
      case 'ALREADY_REPORTED':
        return 'reported'
      case 'RATE_LIMITED':
        return 'rateLimited'
      case 'RESTRICTED':
        return 'restricted'
      default:
        logger.error(
          `Error filing in-game report of user ${userId} in game ${gameId}: ${result.error.message}`,
        )
        return 'error'
    }
  } catch (err) {
    logger.error(
      `Error filing in-game report of user ${userId} in game ${gameId}: ${getErrorStack(err)}`,
    )
    return 'error'
  }
}
