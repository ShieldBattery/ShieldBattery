import { nothing } from 'immer'
import { atom, Setter } from 'jotai'
import { atomWithImmer } from 'jotai-immer'
import { ClientDraftState, DraftChatMessage } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { JotaiStore } from '../jotai-store'
import { updateOnConnect } from '../network/network-atoms'

export const draftStateAtom = atomWithImmer<ClientDraftState | undefined>(undefined)
export const draftPickTimeStartAtom = atom<number | undefined>(undefined)
export const draftChatMessagesAtom = atomWithImmer<DraftChatMessage[]>([])

export const isInDraftAtom = atom(get => !!get(draftStateAtom))

updateOnConnect((_get, set) => {
  resetDraftState(set)
})

export function resetDraftState(storeOrSetter: JotaiStore | Setter) {
  const setter = 'set' in storeOrSetter ? storeOrSetter.set.bind(storeOrSetter) : storeOrSetter

  setter(draftStateAtom, nothing as any)
  setter(draftPickTimeStartAtom, undefined)
  setter(draftChatMessagesAtom, [])
}

export function completeDraft(store: JotaiStore) {
  const draftState = store.get(draftStateAtom)
  if (draftState) {
    store.set(draftStateAtom, draftState => {
      if (!draftState) return

      draftState.isCompleted = true
      draftState.currentPicker = undefined
    })
    store.set(draftPickTimeStartAtom, undefined)
  }
}

export function addDraftChatMessage(store: JotaiStore, message: DraftChatMessage) {
  const currentMessages = store.get(draftChatMessagesAtom)
  store.set(draftChatMessagesAtom, [...currentMessages, message])
}

export const updateCurrentPickerAtom = atom(
  null,
  (get, set, currentPicker: { team: number; slot: number } | undefined) => {
    const draftState = get(draftStateAtom)
    if (draftState) {
      set(draftStateAtom, draftState => {
        if (!draftState) return
        draftState.currentPicker = currentPicker
      })
      set(draftPickTimeStartAtom, window.performance.now())
    }
  },
)

export const updateProvisionalPickAtom = atom(
  null,
  (get, set, { teamId, index, race }: { teamId: number; index: number; race: RaceChar }) => {
    set(draftStateAtom, draftState => {
      if (!draftState) return

      const { myTeamIndex, ownTeam } = draftState

      if (teamId !== myTeamIndex) {
        // NOTE(tec27): Opponent provisional picks are not visible, so we won't receive updates for
        // them
        return
      }

      const player = ownTeam.players[index]
      if (player && !player.hasLocked) {
        player.provisionalRace = race
      }
    })
  },
)

export const updateLockedPickAtom = atom(
  null,
  (get, set, { teamId, index, race }: { teamId: number; index: number; race: RaceChar }) => {
    let didLock = false

    set(draftStateAtom, draftState => {
      if (!draftState) return

      const { myTeamIndex, ownTeam, opponentTeam } = draftState

      if (teamId === myTeamIndex) {
        const player = ownTeam.players[index]
        if (player) {
          ownTeam.players[index] = {
            ...player,
            hasLocked: true,
            finalRace: race,
          }
          draftState.currentPicker = undefined
          didLock = true
        }
      } else {
        const player = opponentTeam.players[index]
        if (player) {
          opponentTeam.players[index] = {
            ...player,
            hasLocked: true,
            finalRace: race,
          }
          draftState.currentPicker = undefined
          didLock = true
        }
      }
    })

    if (didLock) {
      set(draftPickTimeStartAtom, undefined)
    }
  },
)
