import { Component } from 'react'
import { Trans, withTranslation } from 'react-i18next'
import styled from 'styled-components'
import { gameTypeToLabel } from '../../common/games/game-type'
import { getPlayerSlots } from '../../common/lobbies'
import { MapInfoImage } from '../maps/map-image'
import { elevationPlus1 } from '../material/shadows'
import { HeadlineMedium, headlineMedium, titleMedium } from '../styles/typography'
import PlayerCard from './player-card'

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
  "Denying 'WarCraft in Space' accusations",
  'Installing structure thrusters',
  'Merging another Overmind',
  'Planting field of flowers',
  'Reaver dropping in the mineral line',
  'Re-educating criminals',
  'Researching Apial Sensors (since nobody else will)',
  'Uploading replays to the Khala',
  '*Wilhelm scream*',
  'Manning the turrets',
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
  'Randomizing scarab pathing',
  'Randomizing scarab misfire',
  'Constructing ramp unit vortex',
  'Filling drones with helium',
  "Adding in-game cheat 'Power overwhelming'",
  "Adding in-game cheat 'Show me the money'",
  "Adding in-game cheat 'Operation CWAL'",
  "Adding in-game cheat 'The Gathering'",
  "Adding in-game cheat 'Game over man'",
  "Adding in-game cheat 'Staying Alive'",
  "Adding in-game cheat 'There is no cow level'",
  "Adding in-game cheat 'Whats mine is mine'",
  "Adding in-game cheat 'Breathe deep'",
  "Adding in-game cheat 'Something for nothing'",
  "Adding in-game cheat 'Black Sheep Wall'",
  "Adding in-game cheat 'Medieval man'",
  "Adding in-game cheat 'Modify the phase variance'",
  "Adding in-game cheat 'War aint what it used to be'",
  "Adding in-game cheat 'Food for thought'",
  "Adding in-game cheat 'Ophelia'",
  "Adding in-game cheat 'Radio Free Zerg'",
  'Investigating warp-gate manipulation',
  'Researching protoss energy shield generation',
  'Decoding the psionic matrix',
  "Strengthening the protoss's belief in the Khala",
  'Our belief in the Khala will never be broken',
  'The overmind shall always be watching',
  'Looking at the tank',
  'Calculating miss chance',
  'Randomizing start locations',
  'Desyncing replays',
  'Learning Peruvian rush tactics',
  'Adding in lag (for Julia)',
  'Terrifying dragoons, creating mass panic',
  'Readying hold-position micro',
  'Preparing moving shot',
  'Calculating magic box distances',
  'Laying down fog of war',
  'Refining nice skills toi have',
  'Enhancing micro options',
  'Buffing siege tanks',
  'Adding cliff-able natural expansions',
  'Unlocking carrier micro',
  'Adding turret tracking',
  'Implementing overkill',
  'Opening Liquipedia connection',
  'Checking for new builds on Liquipedia',
  'Lickypiddy best piddy',
  'Posting balance whines on TeamLiquid',
  "Planting trees on Demon's Forest",
  'Giving SCVs more health',
  "Singing a karaoke rendition of 'Floating Engineering Bay'",
  'Adjusting neural transmissions',
  'Buckling up',
  'Preparing for some chop',
  'Wondering what this button does',
  'Contemplating the brilliance of The Stove',
  'Renewing starcraftgamers.net domain',
  'Listening to a Manifesto7 RWA',
  'We vtec players have been loaded for years',
  'Teaming up with WGTour to add leagues to Battle.net',
  'Hosting Ascension grand finals',
  'Implementing darktiger anti-hack',
  'Bringing Liquiscoop back from the dead',
  'Adding proleague results to Fantasy Proleague',
  'Bunker rushing Yellow',
  'Learning how to wear headphones',
  'Spinning the tank',
  'Building carriers (a useful skill toi have)',
  "Spawning October Zerg's natural enemy",
  'Fixing the power outage',
  'Incorrectly attributing a build order to Bisu',
  'Placing 1st in Courage',
  'Waiting for Fantasy to gg',
  'Becoming bonjwa',
  'Searching for the golden mouse',
  'Working not to let you DOWN DOWN DOWN',
  'Plugging in the space heater',
  'Revolutionizing PvZ',
  'Fantasizing about mech play',
  'Inventing SK Terran',
  'Scout-ing Hwasin',
  'Lurker-dropping Bisu',
  'Mind-controlling Dreams',
  'Creating the ultimate macro machine',
  'Grrrabbing victory',
  'Strategically placing lurkers',
  'Moving workers from ramp',
  '4-pooling on Troy',
  'Hydra all-inning Bisu out of OSL',
  'Learning 2-port wraith from the master',
  'Adding green dinosaur as a critter',
  'Utilizing queens for maximum ownage',
  'Storms! Storms! Storms!',
  '*Death stare*',
  '*Doom zoom*',
  'Fine-tuning the AI',
  'Building a bot to perfectly emulate SlayerS`BoxeR`',
]

const LoadingMessageContent = styled.div`
  ${titleMedium};
  margin-top: 24px;
  color: var(--theme-on-surface-variant);
`

const MESSAGE_TIME_MIN = 3000
const MESSAGE_TIME_MAX = 5500
class LoadingMessage extends Component {
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
    this._timer = setTimeout(
      () => {
        this.setState({ messageIndex: this._pickMessageIndex() })
        this._resetTimer()
      },
      Math.floor(Math.random() * (MESSAGE_TIME_MAX - MESSAGE_TIME_MIN)) + MESSAGE_TIME_MIN,
    )
  }

  componentDidMount() {
    this._resetTimer()
  }

  componentWillUnmount() {
    clearTimeout(this._timer)
  }

  render() {
    const message = LOADING_MESSAGES[this.state.messageIndex]
    return <LoadingMessageContent>{message}&hellip;</LoadingMessageContent>
  }
}

const Content = styled.div`
  margin-top: 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
`

const GameTypeMapBridge = styled.div`
  ${headlineMedium};
  color: var(--theme-on-surface-variant);
  line-height: 40px;
`

const MapImageContainer = styled.div`
  ${elevationPlus1};
  width: 256px;
  height: auto;
  border-radius: 4px;
  margin-top: 16px;
  overflow: hidden;
`

const Players = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
  margin-top: 8px;
`

const StyledPlayerCard = styled(PlayerCard)`
  max-width: 320px;
  margin: 8px;
`

@withTranslation()
export default class LoadingScreen extends Component {
  render() {
    const { lobby, gameStatus, user, t } = this.props

    const isReady = p => {
      if (p.type === 'computer' || p.name === user.name) return true
      if (gameStatus?.state === 'starting' || gameStatus?.state === 'playing') return true
      if (gameStatus?.state !== 'awaitingPlayers') return false

      return gameStatus?.extra ? !gameStatus.extra.includes(p.name) : true
    }

    // TODO(2Pac): Group the players in two columns in Top vs Bottom game types, each column
    // representing the one team. Also, perhaps display observers separately in their own group.
    const playerElems = getPlayerSlots(lobby).map(p => (
      <StyledPlayerCard
        key={p.id}
        player={p}
        isComputer={p.type === 'computer'}
        isReady={isReady(p)}
      />
    ))

    return (
      <Content>
        <div>
          <Trans t={t} i18nKey='lobbies.loading.content'>
            <HeadlineMedium as='span'>
              {{ gameType: gameTypeToLabel(lobby.gameType, t) }}
            </HeadlineMedium>
            <GameTypeMapBridge as='span'> on </GameTypeMapBridge>
            <HeadlineMedium as='span'>{{ mapName: lobby.map.name }}</HeadlineMedium>
          </Trans>
        </div>
        <MapImageContainer>
          <MapInfoImage map={lobby.map} />
        </MapImageContainer>
        <Players>{playerElems}</Players>
        <LoadingMessage />
      </Content>
    )
  }
}
