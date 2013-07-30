var app = angular.module('shieldbattery',
    [ require('./auth')
    , require('./initializer')
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
