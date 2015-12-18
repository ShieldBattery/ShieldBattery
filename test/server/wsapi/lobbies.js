import chai, { expect } from 'chai'
import chaiImmutable from 'chai-immutable'

chai.use(chaiImmutable)

import { Lobbies, Players } from '../../../server/wsapi/lobbies.js'

const BOXER_LOBBY = Lobbies.create(
    '5v3 Comp Stomp Pros Only', 'Big Game Hunters.scm', 4, 'Slayers`Boxer')

describe('Lobbies', () => {
  it('should add the host in the first slot on creation', () => {
    const l = BOXER_LOBBY
    expect(l.players).to.have.size(1)
    const player = l.players.get(l.hostId)
    expect(player).to.have.keys('name', 'race', 'id', 'isComputer', 'slot')
    expect(player.name).to.equal('Slayers`Boxer')
    expect(player.id).to.equal(l.hostId)
    expect(player.slot).to.equal(0)
  })

  it('should support summarized JSON serialization', () => {
    const json = Lobbies.toSummaryJson(BOXER_LOBBY)
    const parsed = JSON.parse(json)

    const id = BOXER_LOBBY.hostId
    expect(parsed).to.eql({
      name: '5v3 Comp Stomp Pros Only',
      map: 'Big Game Hunters.scm',
      numSlots: 4,
      host: { name: 'Slayers`Boxer', id },
      filledSlots: 1,
    })
  })

  it('should find empty slots', () => {
    let emptySlot = Lobbies.findEmptySlot(BOXER_LOBBY)
    expect(emptySlot).to.eql(1)

    const fullLobby = Lobbies.create('Full', 'Lost Temple.scm', 1, 'pachi')
    emptySlot = Lobbies.findEmptySlot(fullLobby)
    expect(emptySlot).to.equal(-1)
  })

  it('should support adding players', () => {
    const babo = Players.createHuman('dronebabo', 'z', 1)
    let pachi = Players.createHuman('pachi', 'p', 1)

    const orig = BOXER_LOBBY
    let lobby = orig

    lobby = Lobbies.addPlayer(lobby, babo)
    expect(lobby).to.not.equal(orig)
    expect(lobby.players.get(babo.id)).to.equal(babo)

    expect(() => Lobbies.addPlayer(lobby, pachi)).to.throw(Error)
    pachi = pachi.set('slot', -1)
    expect(() => Lobbies.addPlayer(lobby, pachi)).to.throw(Error)
    pachi = pachi.set('slot', lobby.numSlots)
    expect(() => Lobbies.addPlayer(lobby, pachi)).to.throw(Error)
    pachi = pachi.set('slot', 2)

    lobby = Lobbies.addPlayer(lobby, pachi)
    expect(lobby).to.not.equal(orig)
    expect(lobby.players.get(pachi.id)).to.equal(pachi)
  })

  it('should support removing players by id', () => {
    const orig = BOXER_LOBBY
    let lobby = Lobbies.removePlayerById(orig, 'asdf')

    expect(lobby).to.equal(orig)

    const babo = Players.createHuman('dronebabo', 'z', 1)
    lobby = Lobbies.addPlayer(lobby, babo)
    const beforeRemoval = lobby
    lobby = Lobbies.removePlayerById(lobby, babo.id)

    expect(lobby).to.not.equal(beforeRemoval)
    expect(lobby.players.size).to.equal(1)

    lobby = Lobbies.removePlayerById(lobby, lobby.hostId)

    expect(lobby).to.be.null
  })

  it('should support removing players by name', () => {
    const orig = BOXER_LOBBY
    let lobby = Lobbies.removePlayerByName(orig, 'asdf')
    expect(lobby).to.equal(orig)

    lobby = Lobbies.removePlayerByName(orig, 'Slayers`Boxer')
    expect(lobby).to.be.null
  })

  it('should close the lobby if only computers are left', () => {
    const computer = Players.createComputer('p', 1)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, computer)

    lobby = Lobbies.removePlayerById(lobby, lobby.hostId)

    expect(lobby).to.be.null
  })

  it('should support transferring host status to the next oldest player on host removal', () => {
    const computer = Players.createComputer('p', 1)
    const babo = Players.createHuman('dronebabo', 'z', 3)
    const pachi = Players.createHuman('pachi', 't', 2)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, computer)
    // Add the later slotted player first, to ensure it uses "age"
    lobby = Lobbies.addPlayer(lobby, babo)
    lobby = Lobbies.addPlayer(lobby, pachi)

    lobby = Lobbies.removePlayerById(lobby, lobby.hostId)

    expect(lobby.hostId).to.equal(babo.id)
  })
})
