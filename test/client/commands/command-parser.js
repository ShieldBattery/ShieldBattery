import { expect } from 'chai'

import parseCommand from '../../../client/commands/command-parser'

const command = {
  name: 'command',
  parser,
}

function parser(str) {
  if (str === 'invalidArgs') {
    return {
      type: 'invalidArguments',
      payload: {
        commandName: 'command',
        errorText: 'Invalid arguments',
      },
    }
  } else {
    return {
      type: 'validCommand',
      payload: {
        commandName: 'command',
        arg: str,
      },
    }
  }
}

const commands = new Map()
commands.set(command.name, command)

describe('commands', () => {
  it('should return null if not a command', () => {
    const command = parseCommand(commands, 'this is not a command')
    expect(command).to.equal(null)
  })

  it('should return error if unknown command', () => {
    const command = parseCommand(commands, '/unknownCommand')
    expect(command.type).to.equal('unknownCommand')
    expect(command.payload.commandName).to.equal('unknownCommand')
    expect(command.payload.errorText).to.equal('Unknown command')
  })

  it('should return error if invalid arguments', () => {
    const command = parseCommand(commands, '/command invalidArgs')
    expect(command.type).to.equal('invalidArguments')
    expect(command.payload.commandName).to.equal('command')
    expect(command.payload.errorText).to.equal('Invalid arguments')
  })

  it('should return correctly if a valid command', () => {
    const command = parseCommand(commands, '/command validArgument')
    expect(command.type).to.equal('validCommand')
    expect(command.payload.commandName).to.equal('command')
    expect(command.payload.arg).to.equal('validArgument')
  })
})
