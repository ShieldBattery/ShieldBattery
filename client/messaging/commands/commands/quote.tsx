import { TFunction } from 'i18next'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { randomItem } from '../../../../common/random'
import { TransInterpolation } from '../../../i18n/i18next'
import { ALL_COMMAND_SURFACES, defineCommand, TextTransform } from '../command-schema'
import { LocalStrong } from '../local-strong'
import { QUOTE_CATALOGUE, QUOTE_UNIT_NAMES } from './quote-catalogue'

/** The line a unit name the catalogue doesn't know answers with, listing the ones it does. */
function unknownUnitLine(name: string, t: TFunction): React.ReactNode {
  const units = QUOTE_UNIT_NAMES.join(', ')
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
      'Says a random Brood War unit line, from one unit if you name it.',
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
      suggest: () => QUOTE_UNIT_NAMES.map(value => ({ value })),
    },
  ],

  run({ args, t, emit }): TextTransform | void {
    let unit
    if (args.unit === undefined) {
      unit = randomItem(QUOTE_CATALOGUE)
    } else {
      const typed = args.unit.toLowerCase()
      unit = QUOTE_CATALOGUE.find(candidate => candidate.name === typed)
      if (!unit) {
        emit({ kind: 'error', content: unknownUnitLine(args.unit, t) })
        return undefined
      }
    }

    // Client-side randomness is fine here: a quote settles nothing.
    return { text: randomItem(unit.lines)(t) }
  },
})
