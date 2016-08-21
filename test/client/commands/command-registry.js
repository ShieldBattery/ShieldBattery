import whisper from './whisper'
const commands = [
  whisper,
]
// Maps each command alias to the command descriptor object
const aliasCommands = new Map()

for (const command of commands) {
  for (const alias of command.aliases) {
    if (aliasCommands.has(alias)) {
      throw new Error('Two commands can\'t have same alias')
    }
    aliasCommands.set(alias, command)
  }
}

export default aliasCommands
