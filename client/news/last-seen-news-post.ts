import { atom, useAtom } from 'jotai'
import { useUserLocalStorageValue } from '../react/state-hooks'

export const latestNewsPostId = atom<string | undefined>(undefined)

export function useLastSeenNewsPost(): [
  lastSeenId: string | undefined,
  markSeen: (id: string) => void,
] {
  const [lastSeenNewsPost, setLastSeenNewsPost] = useUserLocalStorageValue<string | undefined>(
    'news.lastSeenNewsPost',
    undefined,
  )

  return [lastSeenNewsPost, setLastSeenNewsPost]
}

export function useHasNewNewsPost(): boolean {
  const [lastSeenNewsPost] = useLastSeenNewsPost()
  const [curId] = useAtom(latestNewsPostId)

  return !!curId && curId !== lastSeenNewsPost
}
