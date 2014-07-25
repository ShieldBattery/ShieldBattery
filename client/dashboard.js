module.exports = 'shieldbattery.dashboard'

var angular = require('angular')

var mod = angular.module('shieldbattery.dashboard', [ require('./sockets')
                                                    , require('./server-status')
                                                    ])

mod.config(function($routeProvider) {
  $routeProvider.when('/', { templateUrl: '/partials/dashboard', controller: 'DashboardCtrl' })
})

mod.controller('DashboardCtrl', function($scope, siteSocket, serverStatus) {
  $scope.siteSocket = siteSocket
  $scope.serverStatus = serverStatus
})
