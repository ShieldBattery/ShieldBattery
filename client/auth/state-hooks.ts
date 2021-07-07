import { useAppSelector } from '../redux-hooks'

/** A hook that returns the user that is currently logged in to this client. */
export function useSelfUser() {
  return useAppSelector(s => s.auth.user)
}
