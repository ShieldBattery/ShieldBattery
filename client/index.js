var app = angular.module('shieldbattery',
    [ 'ngAnimate'
    , 'ngRoute'
    , require('./auth')
    , require('./dashboard')
    , require('./errors')
    , require('./initializer')
    , require('./lobby')
    , require('./server-status')
    , require('./sockets')
    , require('./settings')
    , require('./status')
    ])

app.config(function($locationProvider, $routeProvider) {
  $locationProvider.html5Mode('true').hashPrefix('!')

  // define a catch-all route so that pages that aren't specified elsewhere will still fire route
  // change events
  $routeProvider.otherwise({ templateUrl: '/partials/pageNotFound', controller: 'NotFoundCtrl' })
})

app.controller('NotFoundCtrl', function($scope) {
  // TODO(tec27): implement
})
