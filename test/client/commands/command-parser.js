import { expect } from 'chai'

import parseCommand from '../../../client/commands/command-parser'
import commands from './command-registry'
import {
  INVALID_ARGUMENTS,
  UNKNOWN_COMMAND,
  WHISPER,
} from '../../../client/commands/action-types'

describe('commands', () => {
  it('should return null if not a command', () => {
    const command = parseCommand(commands, 'this is not a command')
    expect(command).to.equal(null)
  })

  it('should return error if unknown command', () => {
    const command = parseCommand(commands, '/unknownCommand')
    expect(command.type).to.equal(UNKNOWN_COMMAND)
    expect(command.payload.commandName).to.equal('unknownCommand')
    expect(command.payload.errorText).to.equal('Unknown command')
  })

  describe('whisper', () => {
    it('should return error if username not entered', () => {
      const command = parseCommand(commands, '/whisper')
      expect(command.type).to.equal(INVALID_ARGUMENTS)
      expect(command.payload.commandName).to.equal('whisper')
      expect(command.payload.errorText).to.equal('No username entered')
    })

    it('should return error if username not entered with spaces after command name', () => {
      const command = parseCommand(commands, '/whisper    ')
      expect(command.type).to.equal(INVALID_ARGUMENTS)
      expect(command.payload.commandName).to.equal('whisper')
      expect(command.payload.errorText).to.equal('No username entered')
    })

    it('should return error if message not entered', () => {
      const command = parseCommand(commands, '/whisper pachi')
      expect(command.type).to.equal(INVALID_ARGUMENTS)
      expect(command.payload.commandName).to.equal('whisper')
      expect(command.payload.errorText).to.equal('No message entered')
    })

    it('should return error if message not entered with spaces after target name', () => {
      const command = parseCommand(commands, '/whisper pachi    ')
      expect(command.type).to.equal(INVALID_ARGUMENTS)
      expect(command.payload.commandName).to.equal('whisper')
      expect(command.payload.errorText).to.equal('No message entered')
    })

    // Note that this doesn't test if the message was successfully sent
    it('should return correct target and message if entered', () => {
      const command = parseCommand(commands, '/whisper pachi how you doin?')
      expect(command.type).to.equal(WHISPER)
      expect(command.payload.target).to.equal('pachi')
      expect(command.payload.message).to.equal('how you doin?')
    })

    it('should return correct target and message if there are spaces after target name', () => {
      const command = parseCommand(commands, '/whisper pachi    how you doin?')
      expect(command.type).to.equal(WHISPER)
      expect(command.payload.target).to.equal('pachi')
      expect(command.payload.message).to.equal('   how you doin?')
    })

    it('should trim whitespace from the right end of a message', () => {
      const command = parseCommand(commands, '/whisper pachi how you doin?    ')
      expect(command.type).to.equal(WHISPER)
      expect(command.payload.target).to.equal('pachi')
      expect(command.payload.message).to.equal('how you doin?')
    })
  })
})
