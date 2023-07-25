import { useMemo } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../../common/users/permissions'
import { useSelfPermissions } from '../auth/auth-utils'

function isAdminFromPermissions(permissions?: ReadonlyDeep<SbPermissions>) {
  return permissions && Object.values(permissions).some(p => p === true)
}

/**
 * A React hook that returns whether or not the current user has any admin powers.
 */
export function useIsAdmin() {
  const permissions = useSelfPermissions()
  const isAdmin = useMemo(() => isAdminFromPermissions(permissions), [permissions])

  return isAdmin
}

/** A React hook that returns whether the current user has any of the specified permissions. */
export function useHasAnyPermission(...permissionsToCheck: Array<keyof SbPermissions>): boolean {
  const permissions = useSelfPermissions()
  const hasPermission = useMemo(() => {
    if (!permissions && permissionsToCheck.length > 0) {
      return false
    } else if (!permissions) {
      return true
    }

    return permissionsToCheck.some(p => permissions[p])
  }, [permissions, permissionsToCheck])

  return hasPermission
}
