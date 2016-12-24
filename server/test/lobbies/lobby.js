import chai, { expect } from 'chai'
import chaiImmutable from 'chai-immutable'

chai.use(chaiImmutable)

import * as Lobbies from '../../lib/lobbies/lobby'
import * as Players from '../../lib/lobbies/player'

const BOXER_LOBBY = Lobbies.create(
    '5v3 Comp Stomp Pros Only', 'Big Game Hunters.scm', 'melee', 0, 4, 'Slayers`Boxer')

describe('Lobbies - melee', () => {
  it('should add the host in the first slot on creation', () => {
    const l = BOXER_LOBBY
    expect(l.players).to.have.size(1)
    expect(l.filledSlots).to.equal(1)
    expect(Lobbies.hasOpposingSides(l)).to.be.false
    const player = l.players.get(l.hostId)
    expect(player).to.have.keys('name', 'race', 'id', 'isComputer', 'slot', 'controlledBy')
    expect(player.name).to.equal('Slayers`Boxer')
    expect(player.id).to.equal(l.hostId)
    expect(player.slot).to.equal(0)
  })

  it('should support summarized JSON serialization', () => {
    // stringifying and then parsing ensures that the structure has no circular references
    const json = JSON.stringify(Lobbies.toSummaryJson(BOXER_LOBBY))
    const parsed = JSON.parse(json)

    const id = BOXER_LOBBY.hostId
    expect(parsed).to.eql({
      name: '5v3 Comp Stomp Pros Only',
      map: 'Big Game Hunters.scm',
      gameType: 'melee',
      gameSubType: 0,
      numSlots: 4,
      host: { name: 'Slayers`Boxer', id },
      filledSlots: 1,
    })
  })

  it('should find empty slots', () => {
    let emptySlot = Lobbies.findEmptySlot(BOXER_LOBBY)
    expect(emptySlot).to.eql(1)

    const fullLobby = Lobbies.create('Full', 'Lost Temple.scm', 'melee', 0, 1, 'pachi')
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
    expect(lobby.filledSlots).to.equal(2)
    expect(Lobbies.hasOpposingSides(lobby)).to.be.true

    expect(() => Lobbies.addPlayer(lobby, pachi)).to.throw(Error)
    pachi = pachi.set('slot', -1)
    expect(() => Lobbies.addPlayer(lobby, pachi)).to.throw(Error)
    pachi = pachi.set('slot', lobby.numSlots)
    expect(() => Lobbies.addPlayer(lobby, pachi)).to.throw(Error)
    pachi = pachi.set('slot', 2)

    lobby = Lobbies.addPlayer(lobby, pachi)
    expect(lobby).to.not.equal(orig)
    expect(lobby.players.get(pachi.id)).to.equal(pachi)
    expect(lobby.filledSlots).to.equal(3)
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
    expect(lobby.filledSlots).to.equal(1)

    lobby = Lobbies.removePlayerById(lobby, lobby.hostId)

    expect(lobby).to.be.null
  })

  it('should support setting the race of a player', () => {
    const computer = Players.createComputer('t', 1)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, computer)

    lobby = Lobbies.setRace(lobby, computer.id, 'z')

    expect(lobby.players.get(computer.id).race).to.equal('z')
  })

  it('should support finding players by name', () => {
    const computer = Players.createComputer('p', 1)
    const lobby = Lobbies.addPlayer(BOXER_LOBBY, computer)

    let player = Lobbies.findPlayerByName(lobby, 'asdf')
    expect(player).to.be.undefined

    player = Lobbies.findPlayerByName(lobby, computer.name)
    expect(player).to.be.undefined

    player = Lobbies.findPlayerByName(lobby, 'Slayers`Boxer')
    expect(player).to.not.be.undefined
    expect(player.name).to.equal('Slayers`Boxer')
  })

  it('should support finding players by slot number', () => {
    const computer = Players.createComputer('p', 1)
    const lobby = Lobbies.addPlayer(BOXER_LOBBY, computer)

    let player = Lobbies.findPlayerBySlot(lobby, 10)
    expect(player).to.be.undefined

    player = Lobbies.findPlayerBySlot(lobby, 1)
    expect(player).to.not.be.undefined
    expect(player.race).to.equal('p')
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

  it('should support moving players between slots', () => {
    const babo = Players.createHuman('dronebabo', 'z', 2)
    let lobby = Lobbies.addPlayer(BOXER_LOBBY, babo)
    lobby = Lobbies.movePlayerToSlot(lobby, babo.id, 3)

    expect(lobby.players).to.have.size(2)
    expect(lobby.filledSlots).to.equal(2)
    expect(lobby.players.get(babo.id).slot).to.equal(3)
  })
})

const TEAM_LOBBY = Lobbies.create(
    '2v6 BGH', 'Big Game Hunters.scm', 'topVBottom', 2, 8, 'Slayers`Boxer')

describe('Lobbies - Top vs bottom', () => {
  it('should add the host in the first slot on creation', () => {
    const l = TEAM_LOBBY
    expect(l.players).to.have.size(1)
    expect(l.filledSlots).to.equal(1)
    const player = l.players.get(l.hostId)
    expect(player).to.have.keys('name', 'race', 'id', 'isComputer', 'slot', 'controlledBy')
    expect(player.name).to.equal('Slayers`Boxer')
    expect(player.id).to.equal(l.hostId)
    expect(player.slot).to.equal(0)
  })

  it('should balance teams when adding new players', () => {
    expect(Lobbies.hasOpposingSides(TEAM_LOBBY)).to.be.false
    let emptySlot = Lobbies.findEmptySlot(TEAM_LOBBY)
    expect(emptySlot).to.equal(2)

    const babo = Players.createHuman('dronebabo', 'z', 2)
    let l = Lobbies.addPlayer(TEAM_LOBBY, babo)
    expect(Lobbies.hasOpposingSides(l)).to.be.true
    emptySlot = Lobbies.findEmptySlot(l)
    expect(emptySlot).to.equal(1)

    const pachi = Players.createHuman('pachi', 't', 1)
    l = Lobbies.addPlayer(l, pachi)
    const computer = Players.createComputer('p', 3)
    l = Lobbies.addPlayer(l, computer)
    emptySlot = Lobbies.findEmptySlot(l)
    expect(emptySlot).to.equal(4)
  })

  it('should support moving players between slots', () => {
    const babo = Players.createHuman('dronebabo', 'z', 2)
    let lobby = Lobbies.addPlayer(TEAM_LOBBY, babo)
    lobby = Lobbies.movePlayerToSlot(lobby, babo.id, 3)

    expect(lobby.players).to.have.size(2)
    expect(lobby.filledSlots).to.equal(2)
    expect(lobby.players.get(babo.id).slot).to.equal(3)
  })
})

const TEAM_MELEE_2 = Lobbies.create(
  '2v2v2v2 Team Melee', 'Lost Temple.scm', 'teamMelee', 2, 8, 'Slayers`Boxer')
const TEAM_MELEE_3 = Lobbies.create(
  '3v3v2 Team Melee', 'Lost Temple.scm', 'teamMelee', 3, 8, 'Slayers`Boxer')
const TEAM_MELEE_4 = Lobbies.create(
  '4v4 Team Melee', 'Blue Storm.scx', 'teamMelee', 4, 8, 'Slayers`Boxer')

describe('Lobbies - Team melee', () => {
  it('should fill all the host\'s team slots on creation', () => {
    const l2 = TEAM_MELEE_2
    expect(l2.players).to.have.size(4)
    expect(l2.filledSlots).to.equal(1)
    expect(Lobbies.hasOpposingSides(l2)).to.be.false
    let playersBySlot = l2.players.mapKeys((id, player) => player.slot)
    let host = playersBySlot.get(0)
    expect(host.name).to.equal('Slayers`Boxer')
    let controlledOpen = playersBySlot.get(1)
    expect(controlledOpen.controlledBy).to.equal(host.id)
    expect(controlledOpen.race).to.equal(host.race)
    controlledOpen = playersBySlot.get(2)
    expect(controlledOpen.controlledBy).to.equal(host.id)
    controlledOpen = playersBySlot.get(3)
    expect(controlledOpen.controlledBy).to.equal(host.id)

    const l4 = TEAM_MELEE_4
    expect(l4.players).to.have.size(2)
    expect(l4.filledSlots).to.equal(1)
    expect(Lobbies.hasOpposingSides(l4)).to.be.false
    playersBySlot = l4.players.mapKeys((id, player) => player.slot)
    host = playersBySlot.get(0)
    expect(host.name).to.equal('Slayers`Boxer')
    controlledOpen = playersBySlot.get(1)
    expect(controlledOpen.controlledBy).to.equal(host.id)
  })

  it('should fill team slots when a player is added to an empty team', () => {
    const babo = Players.createHuman('dronebabo', 'z', 2)
    const l = Lobbies.addPlayer(TEAM_MELEE_4, babo)
    expect(l.players).to.have.size(4)
    expect(l.filledSlots).to.equal(2)
    expect(Lobbies.hasOpposingSides(l)).to.be.true
    const playersBySlot = l.players.mapKeys((id, player) => player.slot)
    expect(playersBySlot.get(2)).to.equal(babo)
    expect(playersBySlot.get(3).controlledBy).to.equal(babo.id)
  })

  it('should allow players to fill slots that were previously controlled opens', () => {
    const babo = Players.createHuman('dronebabo', 'z', 1)
    const l = Lobbies.addPlayer(TEAM_MELEE_4, babo)
    expect(l.players).to.have.size(2)
    expect(l.filledSlots).to.equal(2)
    const playersBySlot = l.players.mapKeys((id, player) => player.slot)
    expect(playersBySlot.get(1)).to.equal(babo)
  })

  it('should fill team slots with computers when a computer is added to an empty team', () => {
    const comp = Players.createComputer('z', 2)
    const l = Lobbies.addPlayer(TEAM_MELEE_4, comp)
    expect(l.players).to.have.size(4)
    expect(l.filledSlots).to.equal(3)
    expect(Lobbies.hasOpposingSides(l)).to.be.true
    const playersBySlot = l.players.mapKeys((id, player) => player.slot)
    expect(playersBySlot.get(2)).to.equal(comp)
    expect(playersBySlot.get(3).isComputer).to.be.true
  })

  it('should not allow computers to be added in controlled open slots', () => {
    const comp = Players.createComputer('z', 1)
    expect(() => Lobbies.addPlayer(TEAM_MELEE_4, comp)).to.throw(Error)
  })

  it('should balance teams when adding new players', () => {
    expect(Lobbies.findEmptySlot(TEAM_MELEE_4)).to.equal(2)

    const babo = Players.createHuman('dronebabo', 'z', 2)
    let l = Lobbies.addPlayer(TEAM_MELEE_4, babo)
    expect(Lobbies.findEmptySlot(l)).to.equal(4)

    const computer = Players.createComputer('p', 4)
    l = Lobbies.addPlayer(l, computer)
    const pachi = Players.createHuman('pachi', 't', 6)
    l = Lobbies.addPlayer(l, pachi)
    expect(Lobbies.findEmptySlot(l)).to.equal(1)

    l = Lobbies.addPlayer(l, Players.createHuman('trozz', 'p', 1))
    expect(Lobbies.findEmptySlot(l)).to.equal(3)
    l = Lobbies.addPlayer(l, Players.createHuman('IntoTheTest', 'p', 3))
    expect(Lobbies.findEmptySlot(l)).to.equal(7)
  })

  it('should remove the controlled open slots when the last player on a team leaves', () => {
    const babo = Players.createHuman('dronebabo', 'z', 2)
    let l = Lobbies.addPlayer(TEAM_MELEE_4, babo)
    l = Lobbies.removePlayerById(l, babo.id)

    expect(l.players).to.have.size(2)
    expect(l.filledSlots).to.equal(1)
    expect(l.players.get(l.hostId).name).to.equal('Slayers`Boxer')

    expect(Lobbies.removePlayerById(l, l.hostId)).to.be.null
  })

  it('should remove all the computers in a team whenever one of the computers is removed', () => {
    const comp = Players.createComputer('z', 2)
    let l = Lobbies.addPlayer(TEAM_MELEE_4, comp)
    l = Lobbies.removePlayerById(l, comp.id)

    expect(l.players).to.have.size(2)
    expect(l.filledSlots).to.equal(1)
    expect(l.players.get(l.hostId).name).to.equal('Slayers`Boxer')
  })

  it('should reassign slot control if the controller leaves', () => {
    const babo = Players.createHuman('dronebabo', 'z', 2)
    let l = Lobbies.addPlayer(TEAM_MELEE_2, babo)
    l = Lobbies.removePlayerById(l, l.hostId)

    expect(l.filledSlots).to.equal(1)
    expect(l.players).to.have.size(4)
    expect(l.hostId).to.equal(babo.id)
    const playersBySlot = l.players.mapKeys((id, player) => player.slot)
    expect(playersBySlot.get(0).controlledBy).to.equal(babo.id)
    // Ensure the player in the leaving player's slot got a new ID
    expect(playersBySlot.get(0).id).to.not.equal(TEAM_MELEE_2.hostId)
    expect(playersBySlot.get(1).controlledBy).to.equal(babo.id)
    expect(playersBySlot.get(2)).to.equal(babo)
    expect(playersBySlot.get(3).controlledBy).to.equal(babo.id)
  })

  it('should deal with the "leftover" team in team melee mode 3', () => {
    const comp = Players.createComputer('z', 6)
    let l = Lobbies.addPlayer(TEAM_MELEE_3, comp)

    expect(l.filledSlots).to.equal(3)
    expect(l.players).to.have.size(5)

    l = Lobbies.removePlayerById(TEAM_MELEE_3, comp.id)
    expect(l.filledSlots).to.equal(1)
    expect(l.players).to.have.size(3)
  })

  it('should support moving players between slots', () => {
    const babo = Players.createHuman('dronebabo', 'z', 2)
    let lobby = Lobbies.addPlayer(TEAM_MELEE_3, babo)
    lobby = Lobbies.movePlayerToSlot(lobby, babo.id, 3)

    expect(lobby.players).to.have.size(6)
    expect(lobby.filledSlots).to.equal(2)
    expect(lobby.players.get(babo.id).slot).to.equal(3)
    let playersBySlot = lobby.players.mapKeys((id, player) => player.slot)
    expect(playersBySlot.get(4).controlledBy).to.equal(babo.id)

    const pachi = Players.createHuman('pachi', 't', 4)
    lobby = Lobbies.addPlayer(lobby, pachi)
    playersBySlot = lobby.players.mapKeys((id, player) => player.slot)
    lobby = Lobbies.setRace(lobby, playersBySlot.get(5).id, 'z')
    lobby = Lobbies.movePlayerToSlot(lobby, babo.id, 6)

    expect(lobby.players).to.have.size(8)
    expect(lobby.filledSlots).to.equal(3)
    expect(lobby.players.get(babo.id).slot).to.equal(6)
    playersBySlot = lobby.players.mapKeys((id, player) => player.slot)
    expect(playersBySlot.get(3).controlledBy).to.equal(pachi.id)
    expect(playersBySlot.get(7).controlledBy).to.equal(babo.id)

    lobby = Lobbies.removePlayerById(lobby, lobby.hostId)
    expect(lobby.hostId).to.equal(babo.id)
    playersBySlot = lobby.players.mapKeys((id, player) => player.slot)
    expect(playersBySlot.get(5).race).to.equal('z')

    lobby = Lobbies.movePlayerToSlot(lobby, pachi.id, 7)
    expect(lobby.players).to.have.size(2)
    expect(lobby.filledSlots).to.equal(2)
  })
})
