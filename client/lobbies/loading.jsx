import React from 'react'
import styles from './loading.css'

import Card from '../material/card.jsx'
import Avatar from '../avatars/avatar.jsx'

const LOADING_MESSAGES = [
  'Refining dragoon pathing',
  'Charging the shield battery',
  'Feeding the pet zerglings',
  'Greasing the nydus canal',
  'Unsticking the scarabs',
  'Seeking knowledge of time travel',
  'Colonizing creep',
  'Deworming the nydus canals',
  'Overpowering the SCVs',
  'Researching ensnare',
  'Decriminalizing recreational stimpack use',
  'Celebrating the cerebrates',
  'Crystalizing the khaydarin',
  'Drafting additional pylon requisition forms',
  'Grooving the hydralisk spines',
  'Pneumatizing the carapace',
  'Charging the singularity',
  'Battlecruiser almost operational',
  'Rushing the DTs',
  'Proxying the hatcheries',
  'Forgetting to build the supply depots',
  'Devouring the zerglings',
  'Cancelling the extractor',
  'Glitching the probes through the minerals',
  'Enhancing the zealot legs',
  'Resuscitating Brood War',
  'Releasing the pandabearguys',
  'Feeding the kakarus',
  'Cleaning up blue goo',
  'Despawning additional pylons',
  'Awaiting launch orders',
  'Calling the shots',
  'Overwhelming the power',
  'Removing spider mines',
  'Calibrating adjutant',
  'Feeding cerebrate',
  'Promoting executor',
  'Holding the lurkers',
  'Crushing interceptors',
  'Filling the spawning pools',
  'Stabilizing warp fields',
  'Preparing for arrival of carriers',
  'Fueling up the vultures',
  'Living a life of lively to live',
  'Identifying targets',
  'Running level 1 diagnostic',
  'Completing checklists',
  'Dropping the hammer',
  'Dispensing indiscriminate justice',
  'Asking about propane (and propane accessories)',
  'Assimilating lesser species',
  'Betraying humanity',
  'Clearing command center infestation',
  'Configuring cloaking matrix',
  'Denying \'WarCraft in Space\' accusations',
  'Installing structure thrusters',
  'Merging another Overmind',
  'Planting field of flowers',
  'Reaver dropping in the mineral line',
  'Re-educating criminals',
  'Researching Apial Sensors (since nobody else will)',
  'Uploading replays to the Khala',
  '*Wilhelm scream*',
  'Manning the turrets',
  'Fogging the map',
  'Calling down the thunder',
  'Reaping the whirlwind',
  'Overloading aggression inhibitors',
  'Freeing the lab monkeys',
  'Repairing the gas leak',
  'Learning to shut off infernal contraptions',
  'Sending transmissions',
  'Opening hailing frequencies',
  'Hungering for battle',
  'Dissipating psionic link',
  'Learning to use illusions',
  'Sending a poet',
  'Sensing souls in search of answers',
]

const MESSAGE_TIME_MIN = 3000
const MESSAGE_TIME_MAX = 5500
class LoadingMessage extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      messageIndex: this._pickMessageIndex(),
    }
    this._timer = null
  }

  _pickMessageIndex() {
    return Math.floor(Math.random() * LOADING_MESSAGES.length)
  }

  _resetTimer() {
    this._timer = setTimeout(() => {
      this.setState({ messageIndex: this._pickMessageIndex() })
      this._resetTimer()
    }, Math.floor(Math.random() * (MESSAGE_TIME_MAX - MESSAGE_TIME_MIN)) + MESSAGE_TIME_MIN)
  }

  componentDidMount() {
    this._resetTimer()
  }

  componentWillUnmount() {
    clearTimeout(this._timer)
  }

  render() {
    const message = LOADING_MESSAGES[this.state.messageIndex]
    return <span className={styles.loadingMessage}>{message}&hellip;</span>
  }
}

class LoadingPlayer extends React.Component {
  static propTypes = {
    player: React.PropTypes.object.isRequired,
    isReady: React.PropTypes.bool,
  };

  render() {
    const { player, isReady } = this.props

    return (<Card className={isReady ? styles.readyPlayer : styles.player}>
      <Avatar user={player.name} className={styles.playerAvatar} />
      <span className={styles.playerName}>{player.name}</span>
      <span className={styles.slotRace}>{player.race}</span>
    </Card>)
  }
}

export default class LoadingScreen extends React.Component {
  static propTypes = {
    lobby: React.PropTypes.object.isRequired,
    gameStatus: React.PropTypes.object.isRequired,
    user: React.PropTypes.object.isRequired,
  };

  render() {
    const { lobby, gameStatus, user } = this.props

    const isReady = p => {
      if (p.isComputer || p.name === user.name) return true
      if (gameStatus.state === 'starting' || gameStatus.state === 'playing') return true
      if (gameStatus.state !== 'awaitingPlayers') return false

      return gameStatus.extra ? !gameStatus.extra.includes(p.name) : true
    }

    const playerElems =
        lobby.players.valueSeq()
          .sort((a, b) => a.slot - b.slot)
          .map(p => <LoadingPlayer key={p.id} player={p} isReady={isReady(p)} />)

    return (<div className={styles.content}>
      <div className={styles.typeAndMap}>
        <span className={styles.gameType}>Melee</span>
        <span className={styles.gameTypeMapBridge}> on </span>
        <span className={styles.mapName}>{lobby.map}</span>
      </div>
      <div>
        <img className={styles.mapThumbnail} src='/images/map-placeholder.jpg' />
      </div>
      <div className={styles.players}>{playerElems}</div>
      <LoadingMessage/>
    </div>)
  }
}
