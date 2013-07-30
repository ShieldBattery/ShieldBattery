module.exports = 'shieldbattery.auth'

var mod = angular.module('shieldbattery.auth', [])
var constants = require('../util/constants.js')

mod.config(function($httpProvider, $routeProvider) {
  $routeProvider.when('/login', { templateUrl: '/partials/login', controller: 'LoginCtrl' })
    .when('/user/new', { templateUrl: '/partials/newuser', controller: 'NewUserCtrl' })

  var interceptor = ['$location', '$q', function($location, $q) {
    function onSuccess(response) {
      return response
    }

    function onError(response) {
      if (response.status == 401) {
        $location.path('/login')
      }

      return $q.reject(response)
    }

    return function(promise) { return promise.then(onSuccess, onError) }
  }]

  $httpProvider.responseInterceptors.push(interceptor)
})

mod.run(function(authService, $rootScope, $q) {
  // on the first route change, we need to load the current login status so that its initialized
  // for the rest of the app (and we can redirect to login as necessary)
  var unreg = $rootScope.$on('$routeChangeStart', function(event, next, current) {
    unreg() // only handle the first route!

    var defer = $q.defer()
    next.resolve = next.resolve || []
    next.resolve.push(function() {
      authService.getCurrentUser().always(function() {
        defer.resolve()
        if (!authService.isLoggedIn) authService.redirectToLogin()
      })
      return defer.promise
    })
  })
})

mod.factory('authService', function($location, $http) {
  return new AuthService($location, $http)
})

function AuthService($location, $http) {
  this.$location = $location
  this.$http = $http

  Object.defineProperty(this, 'isLoggedIn',
      { enumerable: true
      , get: function() { return !!this.user }
      })
  this.user = null
}

AuthService.prototype.redirectToLogin = function() {
  this.$location.path('/login')
}

AuthService.prototype.createUser = function(username, password, cb) {
  // TODO(tec27): look into $resource for this?
  var req = this.$http.post('/api/1/users', { username: username, password: password })
    , self = this
  req.success(function(user) {
    self.user = user
    cb(null, user)
  }).error(function(err) {
    cb(err)
  })
}

AuthService.prototype.getCurrentUser = function() {
  var self = this
  return this.$http
    .get('/api/1/sessions')
    .success(function(user) {
      self.user = user
    }).error(function(err) {
      self.user = null
    })
}

mod.controller('LoginCtrl', function($scope, $location, authService) {
  // TODO(tec27): save return url and return to that instead
  if (authService.isLoggedIn) return $location.path('/')

  // TODO(tec27): implement this
})

mod.controller('NewUserCtrl', function($scope, $location, authService) {
  if (authService.isLoggedIn) return $location.path('/')

  $scope.usernamePattern = constants.USERNAME_PATTERN
  $scope.usernameMinLength = constants.USERNAME_MINLENGTH
  $scope.usernameMaxLength = constants.USERNAME_MAXLENGTH

  $scope.passwordMinLength = constants.PASSWORD_MINLENGTH

  $scope.btnDisabled = false
  $scope.responseError = null

  $scope.createUser = function(username, password, confirmPassword) {
    $scope.responseError = null
    if (!$scope.newUserForm.$valid) return
    if (password != confirmPassword) return // TODO(tec27): this should be a validation

    $scope.btnDisabled = true
    authService.createUser(username, password, function(err, user) {
      if (err) {
        $scope.btnDisabled = false
        console.dir(err)
        $scope.responseError = err
        return
      }

      $location.path('/')
    })
  }
})
