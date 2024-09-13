import { ActiveGameActions } from './active-game/actions.js'
import { ActivityOverlayActions } from './activities/actions.js'
import { AuthActions } from './auth/actions.js'
import { ChatActions } from './chat/actions.js'
import { DialogActions } from './dialogs/actions.js'
import { GamesActions } from './games/actions.js'
import { LadderActions } from './ladder/actions.js'
import { LeaguesActions } from './leagues/actions.js'
import { LoadingActions } from './loading/actions.js'
import { MapsActions } from './maps/actions.js'
import { MatchmakingActions } from './matchmaking/actions.js'
import { NetworkActions } from './network/actions.js'
import { NotificationActions } from './notifications/actions.js'
import { PartyActions } from './parties/actions.js'
import { SettingsActions } from './settings/actions.js'
import { UserActions } from './users/actions.js'
import { WhisperActions } from './whispers/actions.js'

type AllActions =
  | ActiveGameActions
  | ActivityOverlayActions
  | AuthActions
  | ChatActions
  | DialogActions
  | GamesActions
  | LadderActions
  | LeaguesActions
  | LoadingActions
  | MapsActions
  | MatchmakingActions
  | NetworkActions
  | NotificationActions
  | PartyActions
  | SettingsActions
  | UserActions
  | WhisperActions

export type ReduxAction = Extract<AllActions, { type: string }>

export type PromisifiedAction<T extends ReduxAction> = {
  [key in keyof T]: key extends 'payload' ? Promise<T[key]> : T[key]
}

type NonStringTypes = Exclude<AllActions, { type: string }>

// NOTE(tec27): If you encounter TypeScript errors here, it means you've added a Redux action that
// has a non-string `type` value. Change it to a string and the error should go away.
type TestNoNonStringTypes<T extends never> = Record<string, T>
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const testObj: TestNoNonStringTypes<NonStringTypes> = {}
