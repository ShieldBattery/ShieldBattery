import { useTranslation } from 'react-i18next'
import { useMutation } from 'urql'
import { SbMapId } from '../../common/maps'
import { graphql } from '../gql'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

/** Selects what the views of a file show about its listing, so they update from the result. */
const UnpublishMutation = graphql(/* GraphQL */ `
  mutation MapUnpublish($fileId: SbMapId!) {
    mapUnpublish(fileId: $fileId) {
      id
      listed
      publishedAt
      publisher {
        id
        name
      }
    }
  }
`)

/**
 * Returns a function that takes a file the current user published out of the listings, telling
 * them how it went with a snackbar.
 */
export function useUnpublishMap() {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [, unpublish] = useMutation(UnpublishMutation)
  const showError = () =>
    snackbarController.showSnackbar(t('maps.publish.unpublishError', "Couldn't unpublish the map"))

  return (fileId: SbMapId) => {
    unpublish({ fileId })
      .then(result => {
        if (result.error || !result.data) {
          showError()
        } else {
          snackbarController.showSnackbar(t('maps.publish.unpublished', 'Unpublished'))
        }
      })
      .catch(() => showError())
  }
}
