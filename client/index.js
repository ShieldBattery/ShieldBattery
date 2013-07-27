var app = angular.module('shieldbattery', [])

app.config(function($locationProvider) {
  $locationProvider.html5Mode('true').hashPrefix('!')
})
