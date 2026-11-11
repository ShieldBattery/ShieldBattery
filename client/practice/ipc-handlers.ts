import { GameClientResult } from '../../common/games/results'
import { TypedIpcRenderer } from '../../common/ipc'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import {
  botLibraryAtom,
  localGameStatusAtom,
  practiceSessionAtom,
  practiceStoreLoadedAtom,
} from './practice-atoms'
import { loadPracticeStore, updatePracticeRecord } from './practice-store'

/**
 * The visible player's local user ID in every practice game: the supervisor numbers the human as
 * slot 0 and assigns user IDs as slot + 1.
 */
export const PRACTICE_PLAYER_USER_ID = makeSbUserId(1)

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  ipcRenderer
    .on('botLibraryChanged', (_, snapshot) => {
      jotaiStore.set(botLibraryAtom, snapshot)
    })
    .on('botLibraryInstallProgress', (_, progress) => {
      const library = jotaiStore.get(botLibraryAtom)
      if (!library) {
        return
      }
      const installs = library.installs.filter(i => i.botId !== progress.botId)
      installs.push(progress)
      jotaiStore.set(botLibraryAtom, { ...library, installs })
    })
    .on('localGameStatus', (_, status) => {
      jotaiStore.set(localGameStatusAtom, status)
      jotaiStore.set(practiceSessionAtom, session => {
        if (!session || session.record.sessionId !== status.id) {
          return
        }
        session.launching = false
        if (status.state === 'error' && status.error) {
          session.error = status.error
        }
      })
    })
    .on('activeGameResult', (_, { gameId, result, time }) => {
      const session = jotaiStore.get(practiceSessionAtom)
      if (!session || session.record.playerGameId !== gameId) {
        return
      }
      const own = result[PRACTICE_PLAYER_USER_ID]
      let outcome: 'victory' | 'defeat' | 'unknown' = 'unknown'
      if (own?.result === GameClientResult.Victory) {
        outcome = 'victory'
      } else if (own?.result === GameClientResult.Defeat) {
        outcome = 'defeat'
      }
      // Bot i plays as user i + 2 (see the local game manager's seating).
      const winnerIndices = session.record.opponents.flatMap((_, index) =>
        result[makeSbUserId(index + 2)]?.result === GameClientResult.Victory ? [index] : [],
      )
      jotaiStore.set(practiceSessionAtom, draft => {
        if (!draft) {
          return
        }
        draft.record.result = outcome
        draft.record.timeMs = time
        draft.record.winnerIndices = winnerIndices
        draft.playerAssignedRace = own?.race
      })
      updatePracticeRecord(session.record.sessionId, record => {
        record.result = outcome
        record.timeMs = time
        record.winnerIndices = winnerIndices
      })
    })
    .on('activeGameReplaySaved', (_, gameId, replayPath) => {
      const session = jotaiStore.get(practiceSessionAtom)
      if (!session || session.record.playerGameId !== gameId) {
        return
      }
      jotaiStore.set(practiceSessionAtom, draft => {
        if (draft) {
          draft.record.replayPath = replayPath
        }
      })
      updatePracticeRecord(session.record.sessionId, record => {
        record.replayPath = replayPath
      })
    })

  ipcRenderer
    .invoke('botLibraryGet')
    ?.then(snapshot => {
      jotaiStore.set(botLibraryAtom, snapshot)
    })
    .catch(err => {
      logger.error(`Failed to load the bot library: ${err?.stack ?? err}`)
    })
  ipcRenderer
    .invoke('localGameGetStatus')
    ?.then(status => {
      if (status) {
        jotaiStore.set(localGameStatusAtom, status)
      }
    })
    .catch(err => {
      logger.error(`Failed to read local game status: ${err?.stack ?? err}`)
    })
  if (!jotaiStore.get(practiceStoreLoadedAtom)) {
    loadPracticeStore().catch(err => {
      logger.error(`Failed to load practice data: ${err?.stack ?? err}`)
    })
  }
}
