import { expect } from 'chai'

import { Lobby } from '../../../server/wsapi/lobbies.js'

describe('Lobby', () => {
  it('should support JSON serialization', () => {
    const lobby = new Lobby('5v3 Comp Stomp Pros Only', 'Big Game Hunters.scm', 8, 'Slayers`Boxer')
    const json = JSON.stringify(lobby)
    const parsed = JSON.parse(json)

    expect(parsed).to.have.deep.property('host.id')
    const id = parsed.host.id
    expect(parsed).to.eql({
      name: '5v3 Comp Stomp Pros Only',
      map: 'Big Game Hunters.scm',
      numSlots: 8,
      host: { name: 'Slayers`Boxer', id },
      filledSlots: 1,
    })
  })
})
