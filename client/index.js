var angular = require('angular')
require('angular-animate')
require('angular-route')

var app = angular.module('shieldbattery',
    [ 'ngAnimate'
    , 'ngRoute'
    , require('./admin')
    , require('./auth')
    , require('./dashboard')
    , require('./errors')
    , require('./initializer')
    , require('./lobby')
    , require('./logger')
    , require('./server-status')
    , require('./sockets')
    , require('./settings')
    , require('./splash')
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
