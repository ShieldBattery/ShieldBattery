import { List, Range } from 'immutable'
import { Component } from 'react'
import { Lobby, Team } from '../../../common/lobbies'
import { Slot } from '../../../common/lobbies/slot'
import { FightingSpirit } from '../../maps/devonly/maps-for-testing'
import LobbyComponent from '../lobby'
import { LobbyLoadingState } from '../lobby-reducer'

const SLOTS = new List([
  new Slot({ type: 'human', name: 'tec27', id: 'a', race: 'p' }),
  new Slot({ type: 'human', name: '2Pacalypse-', id: 'b', race: 't' }),
  new Slot({ type: 'human', name: 'dronebabo', id: 'c', race: 'z' }),
  new Slot({ type: 'human', name: 'pachi', id: 'd', race: 'r' }),
  new Slot({ type: 'human', name: 'Heyoka', id: 'e', race: 'r' }),
  new Slot({ type: 'human', name: 'Legionnaire', id: 'f', race: 'p' }),
  new Slot({ type: 'human', name: 'boesthius', id: 'g', race: 't' }),
  new Slot({ type: 'human', name: 'harem', id: 'h', race: 'z' }),
])

const LOBBIES = Range(2, 9).map(numSlots => {
  return new Lobby({
    name: `My ${numSlots}-slot Lobby`,
    map: FightingSpirit,
    gameType: 'melee',
    gameSubType: 0,
    teams: new List([
      new Team({
        slots: SLOTS.take(numSlots),
      }),
    ]),
    host: SLOTS.get(0),
  })
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
            chat={new List()}
            loadingState={new LobbyLoadingState()}
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
