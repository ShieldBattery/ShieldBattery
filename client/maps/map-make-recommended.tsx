import { useTranslation } from 'react-i18next'
import { useMutation } from 'urql'
import { SbMapId } from '../../common/maps'
import { graphql } from '../gql'
import { CheckBox } from '../material/check-box'
import { RecommendedOutcome } from './map-add-file'

/** Selects what the views of a map show about its default, so they update from the result. */
export const MapFamilySetDefaultMutation = graphql(/* GraphQL */ `
  mutation MapFamilySetDefault($fileId: SbMapId!) {
    mapFamilySetDefault(fileId: $fileId) {
      id
      name
      current {
        id
        name
      }
      defaultMap {
        id
      }
      defaultSetAt
      defaultSetBy {
        id
        name
      }
    }
  }
`)

/**
 * Returns a function that makes a file that just joined a map the viewer owns that map's
 * recommended file when `wanted`, resolving to what came of it. It never rejects.
 */
export function useMakeRecommended() {
  const [, setDefault] = useMutation(MapFamilySetDefaultMutation)
  return async (fileId: SbMapId, wanted: boolean): Promise<RecommendedOutcome> => {
    if (!wanted) {
      return 'skipped'
    }
    try {
      const result = await setDefault({ fileId })
      return result.error || !result.data ? 'failed' : 'made'
    } catch {
      return 'failed'
    }
  }
}

/** Asks whether a file being added to a map the viewer owns becomes its recommended file. */
export function MakeRecommendedCheckBox({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <CheckBox
      label={t('maps.owner.makeRecommended', 'Make it the recommended file')}
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
    />
  )
}
