var bindings = require('bindings')('bw')
  , bw = bindings()

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
    if (!bw.createGame(gameSettings)) console.log('Error creating game!')
    else console.log('created!')

    bw.initGameNetwork();
  },
  function addAiStep() {
    console.log('adding AI in slot 1...')
    if (!bw.addComputer(1)) console.log('Error adding AI!')
    else console.log('added!')
  },
  function startCountdownStep() {
    console.log('starting game countdown...')
    if(!bw.startGameCountdown()) console.log('Error starting countdown!')
    else console.log('started!')
  },
  function launchGameStep() {
    console.log('launching game...')
    bw.runGameLoop(function() {
      console.log('game completed')
      setTimeout(function() { }, 10000)
    })
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
        setTimeout(function() { console.log('event loop still running baby!') }, 10000)
        return;
      }
    }

    // TODO(tec27): when processing lobby turns we should probably be checking the lobby dirty
    // flag and refreshing our local caches if its true (and setting it back to false ;)
    // TODO(tec27): deal with return value here to know what data messages were processed
    bw.processLobbyTurn()
    curInterval++
  } catch(e) {
    console.log('got error: ')
    console.dir(e)
  }
}, 250);

