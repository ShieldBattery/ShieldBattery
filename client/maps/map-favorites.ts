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
    }
  }
`)

const MapRemoveFavoriteMutation = graphql(/* GraphQL */ `
  mutation MapRemoveFavorite($id: SbMapId!) {
    mapRemoveFavorite(id: $id) {
      id
      isFavorited
      favoriteCount
    }
  }
`)

/**
 * Returns a function that favorites a map, or unfavorites it if it already is, and whether a
 * change is in flight. Logged-out viewers are sent to log in instead. The result is confirmed (or
 * the failure reported) with a snackbar.
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
              ? t(
                  'maps.server.favorites.removedError',
                  'An error occurred while removing from favorites',
                )
              : t(
                  'maps.server.favorites.addedError',
                  'An error occurred while adding to favorites',
                ),
          )
          return
        }
        // Keeps the map thumbnails elsewhere in the app, which read favorites from Redux, in sync.
        if (isFavorited) {
          dispatch({ type: '@maps/removeFromFavorites', payload: id })
        } else {
          dispatch({ type: '@maps/addToFavorites', payload: id })
        }
        snackbarController.showSnackbar(
          isFavorited
            ? t('maps.server.favorites.removed', 'Removed from favorites')
            : t('maps.server.favorites.added', 'Added to favorites'),
        )
      })
      .finally(() => setPending(false))
      .catch(swallowNonBuiltins)
  }

  return [toggle, pending]
}
