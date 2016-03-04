export function isAdmin(authState) {
  const perms = authState.permissions.toArray()
  if (!perms) return false

  for (let i = 0; i < perms.length; i++) {
    if (perms[i]) return true
  }

  return false
}

export function checkPermissions(authState, permissionsToCheck) {
  const perms = authState.permissions
  if (typeof permissionsToCheck === 'string') {
    return perms[permissionsToCheck]
  }

  if (Array.isArray(permissionsToCheck)) {
    for (let i = 0; i < permissionsToCheck.length; i++) {
      if (!perms[permissionsToCheck[i]]) return false
    }

    return true
  }

  throw new Error('Invalid argument of permissions to check')
}
