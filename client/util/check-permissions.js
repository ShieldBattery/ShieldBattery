module.exports = function(permissions) {
  if (!angular.isArray(permissions)) {
    permissions = [ permissions ]
  }

  return function(authService) {
    return authService.checkPermissions(permissions)
  }
}
