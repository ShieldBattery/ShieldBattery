import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { QUOTE_UNITS, QuoteUnit } from '../../../../common/unit-quotes'
import { TransInterpolation } from '../../../i18n/i18next'
import { ALL_COMMAND_SURFACES, defineCommand } from '../command-schema'
import { LocalStrong } from '../local-strong'
import { sendOutcome } from './send-outcome'

/** The line a unit name the catalogue doesn't know answers with, listing the ones it does. */
function unknownUnitLine(name: string, t: TFunction): React.ReactNode {
  const units = QUOTE_UNITS.join(', ')
  return (
    <Trans t={t} i18nKey='chat.commands.quote.unknownUnit'>
      No unit named <LocalStrong>{{ name } as TransInterpolation}</LocalStrong>. Units:{' '}
      {{ units } as TransInterpolation}
    </Trans>
  )
}

export const quoteCommand = defineCommand({
  name: 'quote',
  description: t =>
    t(
      'chat.commands.quote.description',
      'Quotes a random Brood War unit line, from one unit if you name it.',
    ),
  surfaces: ALL_COMMAND_SURFACES,
  // A word rather than an enum of the units, so usage strings read `[unit]` instead of spelling
  // out the whole catalogue; the palette still offers exactly the units there are.
  args: [
    {
      kind: 'word',
      name: 'unit',
      optional: true,
      exhaustive: true,
      suggest: () => QUOTE_UNITS.map(value => ({ value })),
    },
  ],

  run({ args, context, dispatch, t, emit }) {
    let unit: QuoteUnit | undefined
    if (args.unit !== undefined) {
      const typed = args.unit.toLowerCase()
      unit = QUOTE_UNITS.find(candidate => candidate === typed)
      if (!unit) {
        emit({ kind: 'error', content: unknownUnitLine(args.unit, t) })
        return
      }
    }

    sendOutcome(unit === undefined ? { kind: 'quote' } : { kind: 'quote', unit }, {
      context,
      dispatch,
      t,
      emit,
    })
  },
})
