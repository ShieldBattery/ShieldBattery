import { ReportedGameStatus } from '../../common/games/game-status'

export type ActiveGameActions = ActiveGameStatus

export type ActiveGameStatus = {
  type: '@active-game/status'
  error?: false
  payload: ReportedGameStatus
}
