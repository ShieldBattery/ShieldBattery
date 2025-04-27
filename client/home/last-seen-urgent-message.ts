import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppSelector } from '../redux-hooks'

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
  const curId = useAppSelector(s => s.news.urgentMessageId)

  return !!curId && curId !== lastSeenUrgentMessage
}
