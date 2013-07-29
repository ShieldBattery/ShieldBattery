var app = angular.module('shieldbattery',
    [ require('./auth')
    , require('./status')
    ])

app.config(function($locationProvider) {
  $locationProvider.html5Mode('true').hashPrefix('!')
})
