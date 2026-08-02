import { Component } from 'react'
import { FightingSpirit } from '../../maps/devonly/maps-for-testing'
import LobbyComponent from '../lobby'

const SLOTS = [
  { type: 'human', name: 'tec27', id: 'a', race: 'p' },
  { type: 'human', name: '2Pacalypse-', id: 'b', race: 't' },
  { type: 'human', name: 'dronebabo', id: 'c', race: 'z' },
  { type: 'human', name: 'pachi', id: 'd', race: 'r' },
  { type: 'human', name: 'Heyoka', id: 'e', race: 'r' },
  { type: 'human', name: 'Legionnaire', id: 'f', race: 'p' },
  { type: 'human', name: 'boesthius', id: 'g', race: 't' },
  { type: 'human', name: 'harem', id: 'h', race: 'z' },
]

const LOBBIES = Array.from({ length: 7 }, (_, i) => i + 2).map(numSlots => {
  return {
    name: `My ${numSlots}-slot Lobby`,
    map: FightingSpirit,
    gameType: 'melee',
    gameSubType: 0,
    teams: [
      {
        slots: SLOTS.slice(0, numSlots),
      },
    ],
    host: SLOTS[0],
  }
})

const USER = { id: 27, name: 'tec27' }

export default class LobbyTest extends Component {
  renderLobby(lobby) {
    const containerStyle = {
      width: 400,
      height: 360,
      border: '1px solid rgba(255,255,255,0.12)',
      margin: '4px',
      overflow: 'hidden',
    }
    const scaledStyle = {
      width: 800,
      height: 720,
      transformOrigin: '0 0',
      transform: 'scale(0.5)',
    }
    return (
      <div key={lobby.name} style={containerStyle}>
        <div key={lobby.name} style={scaledStyle}>
          <LobbyComponent
            lobby={lobby}
            user={USER}
            chat={[]}
            loadingState={{ isCountingDown: false, countdownTimer: -1, isLoading: false }}
            onSendChatMessage={() => null}
          />
        </div>
      </div>
    )
  }

  render() {
    const style = {
      display: 'flex',
      flexFlow: 'row wrap',
      justifyContent: 'space-around',
      padding: 8,
    }
    return <div style={style}>{LOBBIES.map(this.renderLobby)}</div>
  }
}
