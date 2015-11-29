import { expect } from 'chai'

import { Lobby } from '../../../server/wsapi/lobbies.js'

describe('Lobby', () => {
  let lobby
  beforeEach(() => {
    lobby = new Lobby('5v3 Comp Stomp Pros Only', 'Big Game Hunters.scm', 3, 'Slayers`Boxer')
  })

  it('should add the host in the first slot', () => {
    expect(lobby.slots[0]).to.have.property('name', 'Slayers`Boxer')
    expect(lobby.players.get(lobby.slots[0].id)).to.eql(lobby.slots[0])
  })

  it('should support JSON serialization', () => {
    const json = JSON.stringify(lobby)
    const parsed = JSON.parse(json)

    const id = lobby.hostId
    expect(parsed).to.eql({
      name: '5v3 Comp Stomp Pros Only',
      map: 'Big Game Hunters.scm',
      numSlots: 3,
      host: { name: 'Slayers`Boxer', id },
      filledSlots: 1,
    })
  })

  it('should support adding players', () => {
    let { player, slot } = lobby.addPlayer('dronebabo')
    expect(player.name).to.equal('dronebabo')
    expect(slot).to.equal(1)
    expect(lobby.players.size).to.equal(2)
    expect(lobby.slots[1]).to.equal(player)
    expect(lobby.players.get(player.id)).to.equal(player)

    ;({ player, slot } = lobby.addPlayer('pachi'))
    expect(player.name).to.equal('pachi')
    expect(slot).to.equal(2)
    expect(lobby.players.size).to.equal(3)
    expect(lobby.slots[2]).to.equal(player)
    expect(lobby.players.get(player.id)).to.equal(player)

    expect(() => lobby.addPlayer('exception')).to.throw(Error)
  })

  it('should support removing players', () => {
    const { player } = lobby.addPlayer('dronebabo')

    let shouldClose = lobby.removePlayer(player.id)
    expect(shouldClose).to.be.false
    expect(lobby.players.size).to.equal(1)
    expect(lobby.slots[1]).to.not.exist

    expect(() => lobby.removePlayer(player.id)).to.throw(Error)

    shouldClose = lobby.removePlayer(lobby.hostId)
    expect(shouldClose).to.be.true
    expect(lobby.players.size).to.equal(0)
    expect(lobby.slots[0]).to.not.exist
  })
})
