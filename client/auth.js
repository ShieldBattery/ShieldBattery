module.exports = 'shieldbattery.auth'

var mod = angular.module('shieldbattery.auth', [ require('./sockets') ])

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
      authService.getCurrentUser().finally(function() {
        defer.resolve()
        if (!authService.isLoggedIn) authService.redirectToLogin()
      })
      return defer.promise
    })
  })
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

mod.factory('authService', function($location, $http, siteSocket) {
  return new AuthService($location, $http, siteSocket)
})

function AuthService($location, $http, siteSocket) {
  this.$location = $location
  this.$http = $http
  this.siteSocket = siteSocket

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
    self.siteSocket.connect()
    cb(null, user)
  }).error(function(err) {
    cb(err)
  })
}

AuthService.prototype.checkUsernameAvailability = function(username) {
  return this.$http.get('/api/1/usernameAvailability/' + encodeURIComponent(username))
}

AuthService.prototype.getCurrentUser = function() {
  var self = this
  return this.$http
    .get('/api/1/sessions')
    .success(function(user) {
      self.user = user
      self.siteSocket.connect()
    }).error(function(err) {
      self.user = null
    })
}

AuthService.prototype.logIn = function(username, password, remember) {
  var self = this
  return this.$http
    .post('/api/1/sessions', { username: username, password: password, remember: !!remember })
    .success(function(user) {
      self.user = user
      self.siteSocket.connect()
    })
}

AuthService.prototype.logOut = function() {
  var self = this
  return this.$http
    .delete('/api/1/sessions')
    .success(function(user) {
      self.user = null
      self.siteSocket.disconnect()
    })
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

  $scope.createUser = function(username, password, confirmPassword) {
    $scope.responseError = null
    if (!$scope.newUserForm.$valid) return

    $scope.btnDisabled = true
    authService.createUser(username, password, function(err, user) {
      if (err) {
        $scope.btnDisabled = false
        $scope.responseError = err
        return
      }

      $location.path('/')
    })
  }
})
