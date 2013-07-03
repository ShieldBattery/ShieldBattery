var bindings = require('bindings')('bw')
  , bw = bindings()
  , path = require('path')

module.exports =
    { createAndRunGame: createAndRunGameLolTodoSplitThisUpWtf
    , loadPlugin: loadPlugin
    , initProcess: initProcess
    }

// TODO(tec27): see function name
function createAndRunGameLolTodoSplitThisUpWtf(cb) {
  cb = cb.bind(module.exports)
  bw.isBroodWar = true
  bw.initSprites()
  bw.localPlayerName = 'tec27'
  bw.chooseNetworkProvider()
  bw.isMultiplayer = true

  var gameSettings =
      { mapPath: 'C:\\Program Files (x86)\\StarCraft\\Maps\\BroodWar\\(2)Astral Balance.scm'
      , gameType: 0x10002 // melee
      }

  var steps = [
    function createGameStep() {
      console.log('creating game...')
      if (!bw.createGame(gameSettings)) cb(new Error('Couldn\'t create game'))
      else console.log('created!')

      bw.initGameNetwork();
    },
    function addAiStep() {
      console.log('adding AI in slot 1...')
      if (!bw.addComputer(1)) cb(new Error('Couldn\'t add AI'))
      else console.log('added!')
    },
    function startCountdownStep() {
      console.log('starting game countdown...')
      if(!bw.startGameCountdown()) cb(new Error('Could\'t start countdown'))
      else console.log('started!')
    },
    function launchGameStep() {
      console.log('launching game...')
      bw.runGameLoop(function() {
        console.log('game completed')
      })
      cb(null)
    }
  ]
  var currentStep = -1
    , numIntervals = 20
    , curInterval = 20

  var interval = setInterval(function lobbyLoop() {
    try {
      if (curInterval >= numIntervals) {
        currentStep++
        curInterval = 0
        steps[currentStep]()

        if(currentStep == steps.length - 1) {
          console.log('steps completed!')
          clearInterval(interval)
          return;
        }
      }

      // TODO(tec27): when processing lobby turns we should probably be checking the lobby dirty
      // flag and refreshing our local caches if its true (and setting it back to false ;)
      // TODO(tec27): deal with return value here to know what data messages were processed
      bw.processLobbyTurn()
      curInterval++
    } catch(e) {
      cb(e)
    }
  }, 250);
}

// cb is func(err)
function loadPlugin(pluginPath, cb) {
  pluginPath = path.resolve(pluginPath)
  bw.loadPlugin(pluginPath, cb.bind(module.exports))
}

// cb if func()
function initProcess(cb) {
  bw.initProcess(cb.bind(module.exports))
}
