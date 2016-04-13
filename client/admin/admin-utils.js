export function isAdmin(authState) {
  for (const perm of Object.keys(authState.permissions)) {
    if (authState.permissions[perm]) return true
  }
  return false
}

export function checkPermissions(authState, ...permissionsToCheck) {
  const perms = authState.permissions
  return permissionsToCheck.every(p => perms[p])
}
