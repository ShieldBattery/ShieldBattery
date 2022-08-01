import { ReportedGameStatus } from '../../common/game-status'

export type ActiveGameActions = ActiveGameLaunch | ActiveGameStatus | ActiveGameReplaySaved

export type ActiveGameLaunch =
  | {
      type: '@active-game/launch'
      error?: false
      /** Game ID */
      payload: string | null
    }
  | {
      type: '@active-game/launch'
      error: true
      payload: Error
    }

export type ActiveGameStatus = {
  type: '@active-game/status'
  error?: false
  payload: ReportedGameStatus
}

export type ActiveGameReplaySaved = {
  type: '@active-game/replaySaved'
  error?: false
  payload: {
    gameId: string
    path: string
  }
}
