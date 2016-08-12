import { expect } from 'chai'

import registerCommandHandlers from '../../../client/commands/command-handlers'
import parseCommand from '../../../client/commands/command-parser'

registerCommandHandlers()

describe('commands', () => {
  it('should return null if not a command', () => {
    const command = parseCommand('this is not a command')
    expect(command).to.equal(null)
  })

  it('should return error if unknown command', () => {
    const command = parseCommand('/unknownCommand')
    expect(command.error).to.equal(true)
    expect(command.payload.errorText).to.equal('Unknown command')
  })

  describe('whisper', () => {
    it('should return error if username not entered', () => {
      const command = parseCommand('/whisper')
      expect(command.payload.commandName).to.equal('whisper')
      expect(command.error).to.equal(true)
      expect(command.payload.errorText).to.equal('No username entered')
    })

    it('should return error if message not entered', () => {
      const command = parseCommand('/whisper pachi')
      expect(command.payload.commandName).to.equal('whisper')
      expect(command.error).to.equal(true)
      expect(command.payload.errorText).to.equal('No message entered')
    })

    // Note that this doesn't test if the user exists on the server
    it('should return correct target and text if entered', () => {
      const command = parseCommand('/whisper pachi how you doin?')
      expect(command.payload.commandName).to.equal('whisper')
      expect(command.payload.target).to.equal('pachi')
      expect(command.payload.text).to.equal('how you doin?')
    })
  })
})
