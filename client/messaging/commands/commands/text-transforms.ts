import { ALL_COMMAND_SURFACES, defineCommand, TextTransform } from '../command-schema'

export const shrugCommand = defineCommand({
  name: 'shrug',
  description: t => t('chat.commands.shrug.description', 'Appends ¯\\_(ツ)_/¯ to your message.'),
  group: 'fun',
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'rest', name: 'text', optional: true }],

  run({ args }): TextTransform {
    return { text: args.text ? `${args.text} ¯\\_(ツ)_/¯` : '¯\\_(ツ)_/¯' }
  },
})

export const tableflipCommand = defineCommand({
  name: 'tableflip',
  description: t => t('chat.commands.tableflip.description', 'Flips a table: (╯°□°)╯︵ ┻━┻'),
  group: 'fun',
  surfaces: ALL_COMMAND_SURFACES,
  args: [],

  run(): TextTransform {
    return { text: '(╯°□°)╯︵ ┻━┻' }
  },
})

export const unflipCommand = defineCommand({
  name: 'unflip',
  description: t => t('chat.commands.unflip.description', 'Puts the table back: ┬─┬ ノ( ゜-゜ノ)'),
  group: 'fun',
  surfaces: ALL_COMMAND_SURFACES,
  args: [],

  run(): TextTransform {
    return { text: '┬─┬ ノ( ゜-゜ノ)' }
  },
})
