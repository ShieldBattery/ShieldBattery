import { List, Record } from 'immutable'

const Command = new Record({
  aliases: new List(),
  minArguments: -1,
  maxArguments: -1,
  usage: null,
  infoText: null,
  example: null,
})

// List of all chat commands and their properties
export const COMMANDS = {
  whisper: new Command({
    aliases: new List([ 'whisper', 'w', 'message', 'msg', 'm' ]),
    minArguments: 2,
    maxArguments: 200,
    usage: '/whisper USERNAME MESSAGE (aliases: /w /message /msg /m)',
    infoText: 'Sends a private MESSAGE to USERNAME',
    example: '/whisper Pachi How are you doing?'
  })
}
