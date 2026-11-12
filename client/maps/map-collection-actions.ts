import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CombinedError, useMutation, UseQueryState } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { urlForMapCollection } from '../../common/map-url'
import { MapCollectionId, SbMapId } from '../../common/maps'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { graphql } from '../gql'
import { push } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CollectionChange, collectionErrorText } from './map-collection-text'
import { errorCode } from './map-owner-actions'

/** Selects what a collection's views show about its title, description and visibility. */
export const MapCollectionUpdateMutation = graphql(/* GraphQL */ `
  mutation MapCollectionUpdate($id: UUID!, $title: String, $description: String, $public: Boolean) {
    mapCollectionUpdate(id: $id, title: $title, description: $description, public: $public) {
      id
      title
      description
      public
      updatedAt
      hidden {
        id
        note
        hiddenAt
      }
    }
  }
`)

/** Selects what the views of a collection show about its maps, so they update from the result. */
const MapCollectionAddMapMutation = graphql(/* GraphQL */ `
  mutation MapCollectionAddMap($collectionId: UUID!, $mapId: SbMapId!) {
    mapCollectionAddMap(collectionId: $collectionId, mapId: $mapId) {
      id
      mapCount
      updatedAt
      ...MapCollectionMosaic_CollectionFragment
    }
  }
`)

/** Selects what the views of a collection show about its maps, so they update from the result. */
const MapCollectionRemoveMapMutation = graphql(/* GraphQL */ `
  mutation MapCollectionRemoveMap($collectionId: UUID!, $mapId: SbMapId!) {
    mapCollectionRemoveMap(collectionId: $collectionId, mapId: $mapId) {
      id
      mapCount
      updatedAt
      ...MapCollectionMosaic_CollectionFragment
    }
  }
`)

const MapCollectionSaveMutation = graphql(/* GraphQL */ `
  mutation MapCollectionSave($id: UUID!) {
    mapCollectionSave(id: $id) {
      id
      isSaved
      saveCount
    }
  }
`)

const MapCollectionUnsaveMutation = graphql(/* GraphQL */ `
  mutation MapCollectionUnsave($id: UUID!) {
    mapCollectionUnsave(id: $id) {
      id
      isSaved
      saveCount
    }
  }
`)

/** Selects what a collection's views show about it being hidden, so they update from the result. */
const MapCollectionUnhideMutation = graphql(/* GraphQL */ `
  mutation MapCollectionUnhide($id: UUID!) {
    mapCollectionUnhide(id: $id) {
      id
      public
      hidden {
        id
        note
        hiddenAt
      }
    }
  }
`)

/**
 * What a failed collection change tells the user: the server's reason when it sent one, otherwise
 * that something went wrong.
 */
export function collectionChangeErrorText(
  error: CombinedError | undefined,
  change: CollectionChange,
  t: TFunction,
): string {
  return collectionErrorText(error ? errorCode(error) : undefined, change, t)
}

/**
 * The data of a query's latest result that isn't stale, or until there is one, of its latest result.
 * Invalidating a list a query reads makes its next result partial (the list's parent reads as null)
 * while it loads again; this keeps showing what was there before instead.
 */
export function useLastSettledData<Data>(result: UseQueryState<Data, any>): Data | undefined {
  const [settled, setSettled] = useState<Data>()
  if (result.data && !result.stale && result.data !== settled) {
    setSettled(result.data)
  }
  return result.data && !result.stale ? result.data : (settled ?? result.data)
}

/** Returns a function that copies the link to a collection's page, saying how that went. */
export function useCopyCollectionLink(): (id: MapCollectionId, title?: string) => void {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  return (id, title) => {
    const url = new URL(makeServerUrl(urlForMapCollection(id, title)), location.origin).toString()
    navigator.clipboard
      .writeText(url)
      .then(() => snackbarController.showSnackbar(t('maps.page.linkCopied', 'Link copied')))
      .catch(() =>
        snackbarController.showSnackbar(t('maps.page.linkCopyError', "Couldn't copy the link")),
      )
  }
}

/**
 * Returns a function that saves someone else's collection to the viewer's list, or unsaves it if
 * it's saved, and whether a change is in flight. Logged-out viewers are sent to log in instead. A
 * failure is reported with a snackbar; success shows on the button itself.
 */
export function useToggleCollectionSaved(): [
  toggle: (collection: { id: string; isSaved: boolean }) => void,
  pending: boolean,
] {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const [{ fetching: saving }, save] = useMutation(MapCollectionSaveMutation)
  const [{ fetching: unsaving }, unsave] = useMutation(MapCollectionUnsaveMutation)
  const pending = saving || unsaving

  const toggle = ({ id, isSaved }: { id: string; isSaved: boolean }) => {
    if (!selfUser) {
      redirectToLogin(push)
      return
    }
    if (pending) {
      return
    }
    const request = isSaved ? unsave({ id }) : save({ id })
    request
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(collectionChangeErrorText(result.error, 'save', t))
        }
      })
      .catch(swallowNonBuiltins)
  }

  return [toggle, pending]
}

/**
 * Returns a function that makes one of the viewer's collections public or private, confirming the
 * change (or reporting the failure) with a snackbar, and whether a change is in flight.
 */
export function useSetCollectionPublic(): [
  setPublic: (id: string, isPublic: boolean) => void,
  pending: boolean,
] {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [{ fetching }, update] = useMutation(MapCollectionUpdateMutation)

  const setPublic = (id: string, isPublic: boolean) => {
    update({ id, public: isPublic })
      .then(result => {
        if (result.error || !result.data) {
          snackbarController.showSnackbar(collectionChangeErrorText(result.error, 'publish', t))
          return
        }
        snackbarController.showSnackbar(
          result.data.mapCollectionUpdate.public
            ? t('maps.collections.madePublic', 'The collection is public')
            : t('maps.collections.madePrivate', 'The collection is private'),
        )
      })
      .catch(swallowNonBuiltins)
  }

  return [setPublic, fetching]
}

/**
 * Returns a function that adds the map a file is in to a collection, resolving with whether it was
 * added. A failure is reported with a snackbar.
 */
export function useAddMapToCollection(): (
  collectionId: string,
  mapId: SbMapId,
) => Promise<boolean> {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [, addMap] = useMutation(MapCollectionAddMapMutation)

  return (collectionId, mapId) =>
    addMap({ collectionId, mapId })
      .then(result => {
        if (result.error || !result.data) {
          snackbarController.showSnackbar(collectionChangeErrorText(result.error, 'add', t))
          return false
        }
        return true
      })
      .catch(() => {
        snackbarController.showSnackbar(collectionErrorText(undefined, 'add', t))
        return false
      })
}

/**
 * Returns a function that removes the map a file is in from a collection, resolving with whether it
 * was removed. A failure is reported with a snackbar.
 */
export function useRemoveMapFromCollection(): (
  collectionId: string,
  mapId: SbMapId,
) => Promise<boolean> {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const [, removeMap] = useMutation(MapCollectionRemoveMapMutation)

  return (collectionId, mapId) =>
    removeMap({ collectionId, mapId })
      .then(result => {
        if (result.error || !result.data) {
          snackbarController.showSnackbar(collectionChangeErrorText(result.error, 'remove', t))
          return false
        }
        return true
      })
      .catch(() => {
        snackbarController.showSnackbar(collectionErrorText(undefined, 'remove', t))
        return false
      })
}

/**
 * Returns a function that shows a hidden collection again, confirming the change (or reporting the
 * failure) with a snackbar. Only for staff, so not translated.
 */
export function useUnhideCollection(): (id: string) => void {
  const snackbarController = useSnackbarController()
  const [, unhide] = useMutation(MapCollectionUnhideMutation)
  return id => {
    unhide({ id })
      .then(result => {
        snackbarController.showSnackbar(
          result.error
            ? `Couldn't unhide the collection: ${result.error.graphQLErrors[0]?.message ?? result.error.message}`
            : 'The collection is no longer hidden',
        )
      })
      .catch(swallowNonBuiltins)
  }
}
