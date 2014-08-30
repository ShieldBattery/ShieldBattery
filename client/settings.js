module.exports = 'shieldbattery.settings'

var angular = require('angular')

var mod = angular.module('shieldbattery.settings', [ require('./sockets') ])

mod.config(function($routeProvider) {
  $routeProvider.when('/settings',
    { templateUrl: '/partials/settings', controller: 'SettingsCtrl' })
})

mod.controller('SettingsCtrl', function($scope, psiSocket) {
  $scope.loading = true

  $scope.displayModes = [ { name: 'Full Screen', value: 0 }
                        , { name: 'Borderless Window', value: 1 }
                        , { name: 'Window', value: 2 }
                        ]
  var resArray = [ { width: 640, height: 480 }
                 , { width: 800, height: 600 }
                 , { width: 1024, height: 768 }
                 , { width: 1152, height: 864 }
                 , { width: 1280, height: 960 }
                 , { width: 1400, height: 1050 }
                 , { width: 1600, height: 1200 }
                 , { width: 2048, height: 1536 }
                 , { width: 3200, height: 2400 }
                 , { width: 4000, height: 3000 }
                 , { width: 6400, height: 4800 }
                 ]
  $scope.mouseSensitivity = { value: 0
                            , max: 4
                            , min: 0
                            }
  $scope.resolutions = []
  $scope.displayMode = {}
  $scope.resolution = {}
  $scope.maintainAspectRatio = true
  $scope.bwPort = null
  $scope.res = {}
  $scope.settings = {}
  $scope.resDisabled = false
  $scope.btnDisabled = false

  psiSocket.call('/getResolution', function(err, res) {
    if (err) {
      console.log('Error retrieving resolution')
      console.dir(err)
      return
    }

    $scope.res.width = res.width
    $scope.res.height = res.height
    initializeSettings()
  })

  psiSocket.subscribeScope($scope, '/settings')
  $scope.$on('/psi/settings', function($event, err, settings) {
    if (err) {
      console.log('error subscribing to settings:', err)
    } else {
      onSettings(settings)
    }
  })

  function onSettings(settings) {
    for (var key in settings) {
      $scope.settings[key] = settings[key]
    }
    initializeSettings()
  }

  function filterResolutions() {
    var filteredRes = resArray.filter(function(r) {
      return r.width <= $scope.res.width && r.height <= $scope.res.height
    })

    $scope.resolutions = filteredRes.map(function(r) {
      return { name: r.width + 'x' + r.height
             , width: r.width
             , height: r.height
             }
    })
  }

  function initializeSettings() {
    if (!$scope.settings || !$scope.res) return

    $scope.loading = false

    $scope.displayMode = $scope.displayModes[$scope.settings.displayMode] ||
      $scope.displayModes[0]

    if ($scope.displayMode.value === 0) {
      $scope.resolutions = [ { name: $scope.res.width + 'x' + $scope.res.height
                             , width: $scope.res.width
                             , height: $scope.res.height
                             } ]
      $scope.resolution = $scope.resolutions[0]
      $scope.resDisabled = true
    } else {
      filterResolutions()
      var resName = $scope.settings.width + 'x' + $scope.settings.height
          , index = -1

      for(var i = 0; i < $scope.resolutions.length; i++) {
        if ($scope.resolutions[i].name == resName) {
          index = i
          break
        }
      }

      $scope.resolution = $scope.resolutions[index] ||
        $scope.resolutions[$scope.resolutions.length - 1]
      $scope.resDisabled = false
    }

    $scope.maintainAspectRatio = $scope.settings.maintainAspectRatio != undefined ?
        !!$scope.settings.maintainAspectRatio : true
    $scope.mouseSensitivity.value = $scope.settings.mouseSensitivity || 0
    $scope.bwPort = $scope.settings.bwPort
  }

  $scope.onDisplayModeChange = function() {
    $scope.settings.width = $scope.resolution.width
    $scope.settings.height = $scope.resolution.height
    $scope.settings.displayMode = $scope.displayMode.value
    $scope.settings.maintainAspectRatio = $scope.maintainAspectRatio
    initializeSettings()
  }

  $scope.saveSettings = function() {
    if (!$scope.settingsForm.$valid) return

    var newSettings = { bwPort: $scope.bwPort
                      , width: $scope.resolution.width
                      , height: $scope.resolution.height
                      , displayMode: $scope.displayMode.value
                      , mouseSensitivity: $scope.mouseSensitivity.value
                      , maintainAspectRatio: $scope.maintainAspectRatio
                      }
    psiSocket.publish('/settings', newSettings, false)
  }
})
