import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { SbMapId } from '../../common/maps'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { graphql } from '../gql'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

const MapAddFavoriteMutation = graphql(/* GraphQL */ `
  mutation MapAddFavorite($id: SbMapId!) {
    mapAddFavorite(id: $id) {
      id
      isFavorited
      favoriteCount
      family {
        id
        files {
          id
          isFavorited
          favoriteCount
        }
      }
    }
  }
`)

const MapRemoveFavoriteMutation = graphql(/* GraphQL */ `
  mutation MapRemoveFavorite($id: SbMapId!) {
    mapRemoveFavorite(id: $id) {
      id
      isFavorited
      favoriteCount
      family {
        id
        files {
          id
          isFavorited
          favoriteCount
        }
      }
    }
  }
`)

/**
 * Returns a function that favorites a map, or unfavorites it if it already is, and whether a
 * change is in flight. A favorite is of the map a file is in, so every file of that map changes
 * with it. Logged-out viewers are sent to log in instead. The result is confirmed (or the failure
 * reported) with a snackbar.
 */
export function useToggleMapFavorite(): [
  toggle: (map: { id: SbMapId; isFavorited: boolean }) => void,
  pending: boolean,
] {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const [, addFavorite] = useMutation(MapAddFavoriteMutation)
  const [, removeFavorite] = useMutation(MapRemoveFavoriteMutation)
  const [pending, setPending] = useState(false)

  const toggle = ({ id, isFavorited }: { id: SbMapId; isFavorited: boolean }) => {
    if (!selfUser) {
      redirectToLogin(push)
      return
    }
    if (pending) {
      return
    }

    setPending(true)
    const request = isFavorited ? removeFavorite({ id }) : addFavorite({ id })
    request
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(
            isFavorited
              ? t('maps.server.starred.removeError', "Couldn't remove the map from Starred")
              : t('maps.server.starred.addError', "Couldn't add the map to Starred"),
          )
          return
        }
        // Keeps the map thumbnails elsewhere in the app, which read favorites from Redux, in sync.
        let changed: { family: { files: ReadonlyArray<{ id: SbMapId }> } } | undefined
        if (result.data && 'mapAddFavorite' in result.data) {
          changed = result.data.mapAddFavorite
        } else if (result.data && 'mapRemoveFavorite' in result.data) {
          changed = result.data.mapRemoveFavorite
        }
        const fileIds = new Set([id, ...(changed?.family.files.map(f => f.id) ?? [])])
        for (const fileId of fileIds) {
          if (isFavorited) {
            dispatch({ type: '@maps/removeFromFavorites', payload: fileId })
          } else {
            dispatch({ type: '@maps/addToFavorites', payload: fileId })
          }
        }
        snackbarController.showSnackbar(
          isFavorited
            ? t('maps.server.starred.removed', 'Removed from Starred')
            : t('maps.server.starred.added', 'Added to Starred'),
        )
      })
      .finally(() => setPending(false))
      .catch(swallowNonBuiltins)
  }

  return [toggle, pending]
}
