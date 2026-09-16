import {
  ROLL_DEFAULT_MAX,
  ROLL_MAX_MAX,
  ROLL_MIN_MAX,
  RolledOutcomeRequest,
} from '../../../../common/rolled-outcomes'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'
import { sendOutcome } from './send-outcome'

export const rollCommand = defineCommand({
  name: 'roll',
  description: t =>
    t('chat.commands.roll.description', {
      defaultValue:
        "Rolls a number from 1 to {{max}}, or up to the number you give. The server rolls it, so it can't be faked.",
      max: ROLL_DEFAULT_MAX,
    }),
  group: 'fun',
  surfaces: ALL_COMMAND_SURFACES,
  args: [
    {
      kind: 'number',
      name: 'max',
      optional: true,
      integer: true,
      min: ROLL_MIN_MAX,
      max: ROLL_MAX_MAX,
    },
  ],

  run({ args, context, dispatch, t, emit }) {
    const request: RolledOutcomeRequest =
      args.max === undefined ? { kind: 'roll' } : { kind: 'roll', max: args.max }
    sendOutcome(request, { context, dispatch, t, emit })
  },
})

export const flipCommand = defineCommand({
  name: 'flip',
  description: t => t('chat.commands.flip.description', 'Flips a coin, settled by the server.'),
  group: 'fun',
  surfaces: ALL_COMMAND_SURFACES,
  args: [],

  run({ context, dispatch, t, emit }) {
    sendOutcome({ kind: 'flip' }, { context, dispatch, t, emit })
  },
})

export const eightBallCommand = defineCommand({
  name: '8ball',
  description: t =>
    t(
      'chat.commands.eightBall.description',
      'Asks the magic 8-ball a question, answered by the server.',
    ),
  group: 'fun',
  surfaces: ALL_COMMAND_SURFACES,
  args: [{ kind: 'rest', name: 'question' }],

  run({ args, context, dispatch, t, emit }) {
    sendOutcome({ kind: 'eightBall', question: args.question }, { context, dispatch, t, emit })
  },
})
