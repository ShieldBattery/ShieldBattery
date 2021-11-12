import { List } from 'immutable'
import React from 'react'
import { Team } from '../../../common/lobbies'
import { Slot } from '../../../common/lobbies/slot'
import { FightingSpirit } from '../../maps/devonly/maps-for-testing'
import { TabItem, Tabs } from '../../material/tabs'
import ActiveLobby from '../active-lobby'
import { LobbyInfo } from '../lobby-reducer'

const TAB_MELEE = 0
const TAB_TVB = 1

export default class ActiveTest extends React.Component {
  state = {
    activeTab: 0,
  }

  render() {
    const { activeTab } = this.state
    const meleeLobby = new LobbyInfo({
      map: FightingSpirit,
      gameType: 'melee',
      teams: new List([
        new Team({
          slots: new List([
            new Slot({ type: 'human', name: 'tec27', id: 'a', race: 'p' }),
            new Slot({ type: 'human', name: 'dronebabo', id: 'b', race: 'r' }),
            new Slot({ type: 'human', name: 'grnp', id: 'c', race: 'z' }),
            new Slot({ type: 'human', name: 'Heyoka', id: 'd', race: 't' }),
            new Slot({ type: 'computer', name: 'robit', id: 'e', race: 'r' }),
          ]),
        }),
      ]),
      host: 'a',
    })
    const tvbLobby = new LobbyInfo({
      map: FightingSpirit,
      gameType: 'topVBottom',
      teams: new List([
        new Team({
          slots: new List([
            new Slot({ type: 'human', name: 'tec27', id: 'a', race: 'p' }),
            new Slot({ type: 'human', name: 'dronebabo', id: 'b', race: 'r' }),
            new Slot({ type: 'human', name: 'grnp', id: 'c', race: 'z' }),
          ]),
        }),
        new Team({
          slots: new List([
            new Slot({ type: 'human', name: 'pachi', id: 'd', race: 'p' }),
            new Slot({ type: 'human', name: 'Heyoka', id: 'e', race: 't' }),
            new Slot({ type: 'computer', name: 'robit', id: 'f', race: 'r' }),
          ]),
        }),
      ]),
      host: 'a',
    })

    let lobby
    switch (activeTab) {
      case TAB_MELEE:
        lobby = meleeLobby
        break
      case TAB_TVB:
        lobby = tvbLobby
        break
      default:
        throw new Error('Invalid tab value')
    }

    return (
      <>
        <Tabs activeTab={activeTab} onChange={this.onTabChange}>
          <TabItem text='Melee' value={0} />
          <TabItem text='TvB' value={1} />
        </Tabs>
        <ActiveLobby lobby={lobby} />
      </>
    )
  }

  onTabChange = value => {
    this.setState({ activeTab: value })
  }
}
