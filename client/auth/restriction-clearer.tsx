import { useEffect } from 'react'
import { ClientRestrictionInfo } from '../../common/users/restrictions'
import { useRefreshToken } from '../network/refresh-token'
import { useAppDispatch, useAppSelector } from '../redux-hooks'

const MAX_TIMEOUT = 1000 * 60 * 60 * 12 // 12 hours

export function RestrictionClearer() {
  const dispatch = useAppDispatch()
  const restrictions = useAppSelector(s => s.auth.self?.restrictions)
  const [refreshToken, refresh] = useRefreshToken()

  useEffect(() => {
    if (!restrictions || restrictions.size === 0) {
      return () => {}
    }

    const restrictionsArray = Array.from(restrictions.values())
    restrictionsArray.sort((a, b) => a.endTime - b.endTime)
    let nextToClear: ClientRestrictionInfo | undefined = restrictionsArray[0]
    if (nextToClear.endTime - Date.now() > MAX_TIMEOUT) {
      // If the next restriction to clear is too far in the future, just set a long timeout to
      // check again
      nextToClear = undefined
    }

    const timeout = setTimeout(
      () => {
        if (nextToClear) {
          // TODO(tec27): Maybe we should ask the server for updated restrictions instead?
          // Although it doesn't particularly help deal with the case where the user's clock is
          // very off (they'd receive a timestamp that is still not accurate to their local clock).
          // I guess potentially we could have the server send a number of seconds until the
          // restriction expires (seems okay if their client updates a few seconds late)
          dispatch({
            type: '@auth/clearRestriction',
            payload: { restriction: nextToClear },
          })
        } else {
          refresh()
        }
      },
      nextToClear ? nextToClear.endTime - Date.now() : MAX_TIMEOUT,
    )

    return () => {
      clearTimeout(timeout)
    }
  }, [restrictions, refresh, refreshToken, dispatch])

  return null
}
