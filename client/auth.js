module.exports = 'shieldbattery.auth'

var EventEmitter = require('events').EventEmitter
  , inherits = require('inherits')
  , angular = require('angular')
require('angular-cookies')

var mod = angular.module('shieldbattery.auth', [ require('./sockets'), 'ngCookies' ])

// break circular dependency of interceptor -> authService -> $http -> interceptor
var invalidatedSessionEmitter = new EventEmitter()
mod.factory('unauthorizedErrorInterceptor', function($q, $timeout) {
  return {
    responseError: function(response) {
      if (response.status == 401) {
        $timeout(function() {
          invalidatedSessionEmitter.emit('invalidated')
        }, 0)
      }

      return $q.reject(response)
    }
  }
})

mod.config(function($httpProvider, $routeProvider) {
  $routeProvider.when('/login', { templateUrl: '/partials/login', controller: 'LoginCtrl' })
    .when('/user/new', { templateUrl: '/partials/newuser', controller: 'NewUserCtrl' })

  $httpProvider.interceptors.push('unauthorizedErrorInterceptor')
})

mod.run(function($cookies, $location, returningUserChecker, authService) {
  authService.initCurrentUser()

  if (returningUserChecker.isFirstTimeUser) {
    $location.path('/splash')
  } else if (!authService.isLoggedIn) {
    authService.redirectToLogin()
  }
})

mod.directive('sbUniqueUser', function($timeout, authService) {
  function linkFunc(scope, elem, attrs, ctrl) {
    var timeout = null
    var validate = function(value) {
      if (timeout) $timeout.cancel(timeout)
      if (value == null) {
        timeout = null
        ctrl.$setValidity('uniqueUser', true)
        return value
      }

      timeout = $timeout(function() {
        authService.checkUsernameAvailability(value)
          .success(function() { ctrl.$setValidity('uniqueUser', true) })
          .error(function(data, status) {
            if (status == 404) {
              ctrl.$setValidity('uniqueUser', false)
            }
          })
      }, 200)

      return value
    }
    ctrl.$formatters.push(validate)
    ctrl.$parsers.push(validate)
  }

  return { require: 'ngModel', link: linkFunc }
})

mod.directive('sbMustMatch', function() {
  function linkFunc(scope, elem, attrs, ctrl) {
    var validate = function(value) {
      ctrl.$setValidity('mustMatch', value == scope[attrs.sbMustMatch])
      return value
    }
    ctrl.$formatters.push(validate)
    ctrl.$parsers.push(validate)

    scope.$watch(attrs.sbMustMatch, function(newValue) {
      ctrl.$setValidity('mustMatch', ctrl.$modelValue == newValue);
    })
  }

  return { require: 'ngModel', link: linkFunc }
})

mod.factory('returningUserChecker', function($cookies, authService) {
  return new ReturningUserChecker($cookies, authService)
})

function ReturningUserChecker($cookies, authService) {
  this.$cookies = $cookies
  this.authService = authService

  Object.defineProperty(this, 'isFirstTimeUser',
      { enumerable: true
      , get: function() { return !(this.authService.isLoggedIn || this.$cookies.returning) }
      })
}

mod.factory('authService', function($location, $http, $q, siteSocket) {
  return new AuthService($location, $http, $q, siteSocket)
})

inherits(AuthService, EventEmitter)
function AuthService($location, $http, $q, siteSocket) {
  EventEmitter.call(this)
  this.$location = $location
  this.$http = $http
  this.$q = $q
  this.siteSocket = siteSocket

  Object.defineProperty(this, 'isLoggedIn',
      { enumerable: true
      , get: function() { return !!this.user }
      })
  this.user = null
  this.permissions = null

  var self = this
  invalidatedSessionEmitter.on('invalidated', function() {
    self.invalidateSession()
    self.redirectToLogin()
  })
}

AuthService.prototype.redirectToLogin = function() {
  this.$location.path('/login')
}

AuthService.prototype.createUser = function(username, email, password, cb) {
  // TODO(tec27): look into $resource for this?
  var req = this.$http.post('/api/1/users',
      { username: username
      , email: email
      , password: password
      })
    , self = this
  req.success(function(result) {
    self.user = result.user
    self.permissions = result.permissions
    self.siteSocket.connect()
    cb(null, self.user, self.permissions)
    self.emit('userChanged', result.user)
  }).error(function(err) {
    cb(err)
  })
}

AuthService.prototype.checkUsernameAvailability = function(username) {
  return this.$http.get('/api/1/usernameAvailability/' + encodeURIComponent(username) +
      '?t=' + Date.now())
}

AuthService.prototype.initCurrentUser = function() {
  // get the current user from the page body (if its not there, assume not logged in)
  if (window._sbSession) {
    var session = window._sbSession
    this.user = session.user
    this.permissions = session.permissions
    this.siteSocket.connect()
    this.emit('userChanged', this.user)
    window._sbSession = null
  }
}

AuthService.prototype.logIn = function(username, password, remember) {
  return this.$http
    .post('/api/1/sessions', { username: username, password: password, remember: !!remember })
    .success(result => {
      this.user = result.user
      this.permissions = result.permissions
      this.siteSocket.connect()
      this.emit('userChanged', result.user)
    })
}

AuthService.prototype.logOut = function() {
  return this.$http
    .delete('/api/1/sessions')
    .success(() => this.invalidateSession())
}

AuthService.prototype.invalidateSession = function() {
  this.user = null
  this.permissions = null
  this.siteSocket.disconnect()
  this.emit('userChanged', null)
}

AuthService.prototype.checkPermissions = function(permissionsArray) {
  let deferred = this.$q.defer()

  for (let permission of permissionsArray) {
    if (!this.permissions[permission]) {
      deferred.reject('Not enough permissions')
      return deferred.promise
    }
  }

  deferred.resolve()
  return deferred.promise
}

mod.controller('LoginCtrl', function($scope, $location, authService) {
  // TODO(tec27): save return url and return to that instead
  if (authService.isLoggedIn) return $location.path('/')

  $scope.btnDisabled = false
  $scope.responseError = null

  $scope.logIn = function(username, password, remember) {
    $scope.responseError = null
    if (!$scope.loginForm.$valid) return

    $scope.btnDisabled = true
    authService.logIn(username,  password, remember)
      .success(function(user) {
        $scope.btnDisabled = false
        $location.path('/')
      }).error(function(err) {
        $scope.btnDisabled = false
        $scope.responseError = err
      })
  }
})

mod.controller('NewUserCtrl', function($scope, $location, authService) {
  if (authService.isLoggedIn) return $location.path('/')

  $scope.btnDisabled = false
  $scope.responseError = null

  $scope.createUser = function(username, email, password, confirmPassword) {
    $scope.responseError = null
    if (!$scope.newUserForm.$valid) return

    $scope.btnDisabled = true
    authService.createUser(username, email, password, function(err, user, permissions) {
      if (err) {
        $scope.btnDisabled = false
        $scope.responseError = err
        return
      }

      $location.path('/')
    })
  }
})
