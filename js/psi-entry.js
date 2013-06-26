var psi = require('psi')

console.log('Psi entry-point running!')

psi.launchProcess(
    { appPath: 'C:\\Program Files (x86)\\Starcraft\\Starcraft.exe'
    , launchSuspended: false
    , currentDir: 'C:\\Program Files (x86)\\Starcraft'
    }, function(err, proc) {
      if (err) return console.log('Error launching process: ' + err)

      console.dir(proc)
    })

setTimeout(function() {}, 10000)
