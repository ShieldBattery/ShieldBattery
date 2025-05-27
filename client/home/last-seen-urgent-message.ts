import { atom, useAtom } from 'jotai'
import { useUserLocalStorageValue } from '../react/state-hooks'

export const urgentMessageId = atom<string | undefined>(undefined)

export function useLastSeenUrgentMessage(): [
  lastSeenId: string | undefined,
  markSeen: (id: string) => void,
] {
  const [lastSeenUrgentMessage, setLastSeenUrgentMessage] = useUserLocalStorageValue<
    string | undefined
  >('news.lastSeenUrgentMessage', undefined)

  return [lastSeenUrgentMessage, setLastSeenUrgentMessage]
}

export function useHasNewUrgentMessage(): boolean {
  const [lastSeenUrgentMessage] = useLastSeenUrgentMessage()
  const [curId] = useAtom(urgentMessageId)

  return !!curId && curId !== lastSeenUrgentMessage
}
