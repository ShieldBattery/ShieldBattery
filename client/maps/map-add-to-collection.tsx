import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { SbMapId } from '../../common/maps'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { graphql } from '../gql'
import { MapCollectionKind } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { IconButton } from '../material/button'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TextField } from '../material/text-field'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import {
  collectionChangeErrorText,
  useAddMapToCollection,
  useLastSettledData,
  useRemoveMapFromCollection,
} from './map-collection-actions'
import { addableCollections, inKeptOrder } from './map-collection-lists'
import {
  collectionErrorText,
  collectionTitle,
  isValidCollectionTitle,
  MAX_COLLECTION_TITLE_LENGTH,
} from './map-collection-text'

const MapAddToCollectionQuery = graphql(/* GraphQL */ `
  query MapAddToCollection($fileId: SbMapId!, $staff: Boolean!) {
    map(id: $fileId) {
      id
      family {
        id
        viewerCollectionIds
      }
    }
    currentUser {
      id
      mapCollections {
        id
        kind
        title
        canEdit
      }
    }
    staffCollections: mapCollections(section: STAFF, first: 100) @include(if: $staff) {
      edges {
        node {
          id
          kind
          title
          canEdit
        }
      }
    }
  }
`)

const MapAddToCollectionCreateMutation = graphql(/* GraphQL */ `
  mutation MapAddToCollectionCreate($title: String!, $addMapId: SbMapId!) {
    mapCollectionCreate(title: $title, addMapId: $addMapId) {
      id
      kind
      title
      canEdit
    }
  }
`)

/**
 * Requests results without suspending: the menu renders its own loading state. Module-level so the
 * query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/** A collection as the menu lists it. */
interface MenuCollection {
  id: string
  kind: MapCollectionKind
  title?: string | null
  canEdit: boolean
}

/**
 * A button opening a menu of the viewer's collections that the map a file is in can be added to,
 * each checked while it holds the map. Choosing one adds the map or takes it out, and the menu stays
 * open. Its last row makes a new collection holding the map.
 */
export function AddToCollectionButton({ fileId }: { fileId: SbMapId }) {
  const { t } = useTranslation()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const label = t('maps.collections.addToCollection', 'Add to collection')

  return (
    <>
      {/* The menu opens where the tooltip shows, so the tooltip would cover its first item */}
      <Tooltip text={label} position='bottom' tabIndex={-1} disabled={open}>
        <IconButton
          ref={anchorRef}
          icon={<MaterialIcon icon='add' />}
          ariaLabel={label}
          ariaHasPopup='menu'
          ariaExpanded={open}
          onClick={openMenu}
        />
      </Tooltip>
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'
        // The title field takes focus when it shows
        focusOnMount={false}>
        <AddToCollectionMenu fileId={fileId} />
      </Popover>
    </>
  )
}

const StatusRow = styled.div`
  min-width: 240px;
  padding: 8px 12px;
`

const NewCollectionField = styled.div`
  width: 280px;
  padding: 4px 12px;
`

function AddToCollectionMenu({ fileId }: { fileId: SbMapId }) {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const canManageMaps = useHasAnyPermission('manageMaps')
  const addMap = useAddMapToCollection()
  const removeMap = useRemoveMapFromCollection()
  const [{ fetching: creating }, create] = useMutation(MapAddToCollectionCreateMutation)
  const [result, reexecute] = useQuery({
    query: MapAddToCollectionQuery,
    variables: { fileId, staff: canManageMaps },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  // Each change makes the lists load again, so the ones last loaded show until then
  const lists = useLastSettledData(result)

  /** What the viewer made each collection hold here, kept until a change fails. */
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set())
  /** Collections made here, shown until the viewer's list loads with them. */
  const [created, setCreated] = useState<ReadonlyArray<MenuCollection>>([])
  /** The order the collections were in when the menu opened, so none move while it's open. */
  const [order, setOrder] = useState<ReadonlyArray<string>>()
  const [naming, setNaming] = useState(false)
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string>()

  if (!lists) {
    return (
      <MenuList dense={true}>
        <StatusRow>
          {result.error ? (
            <LoadErrorRow
              message={t('maps.collections.loadError', "Couldn't load collections")}
              onRetry={() => reexecute({ requestPolicy: 'network-only' })}
            />
          ) : (
            <LoadingDotsArea />
          )}
        </StatusRow>
      </MenuList>
    )
  }

  const ownList = lists.currentUser?.mapCollections ?? []
  const addable = addableCollections<MenuCollection>(
    [...created.filter(c => !ownList.some(o => o.id === c.id)), ...ownList],
    lists.staffCollections?.edges.map(e => e.node) ?? [],
  )
  if (!order) {
    setOrder([...addable.own, ...addable.staff].map(c => c.id))
  }
  const own = inKeptOrder(addable.own, order ?? [])
  const staff = inKeptOrder(addable.staff, order ?? [])

  // Checks written into the cache by each change show at once, before the lists load again
  const held = new Set(
    result.data?.map?.family.viewerCollectionIds ?? lists.map?.family.viewerCollectionIds ?? [],
  )
  const holds = (id: string) => choices.get(id) ?? held.has(id)

  const toggle = (id: string) => {
    if (inFlight.has(id)) {
      return
    }
    const next = !holds(id)
    setChoices(prev => new Map(prev).set(id, next))
    setInFlight(prev => new Set(prev).add(id))
    const change = next ? addMap(id, fileId) : removeMap(id, fileId)
    change
      .then(done => {
        if (!done) {
          setChoices(prev => {
            const without = new Map(prev)
            without.delete(id)
            return without
          })
        }
      })
      .finally(() =>
        setInFlight(prev => {
          const without = new Set(prev)
          without.delete(id)
          return without
        }),
      )
      .catch(swallowNonBuiltins)
  }

  const onCreate = () => {
    if (creating) {
      return
    }
    const trimmed = title.trim()
    if (!isValidCollectionTitle(trimmed)) {
      setTitleError(collectionErrorText('INVALID_TITLE', 'create', t))
      return
    }
    setTitleError(undefined)
    create({ title: trimmed, addMapId: fileId })
      .then(createResult => {
        if (createResult.error || !createResult.data) {
          snackbarController.showSnackbar(
            collectionChangeErrorText(createResult.error, 'create', t),
          )
          return
        }
        const collection = createResult.data.mapCollectionCreate
        setCreated(prev => [collection, ...prev])
        setChoices(prev => new Map(prev).set(collection.id, true))
        setNaming(false)
        setTitle('')
      })
      .catch(swallowNonBuiltins)
  }

  const collectionItem = (collection: MenuCollection) => (
    <SelectableMenuItem
      key={collection.id}
      text={collectionTitle(collection, t)}
      selected={holds(collection.id)}
      dense={true}
      onClick={() => toggle(collection.id)}
    />
  )
  const items = own.map(collectionItem)
  if (staff.length) {
    if (items.length) {
      items.push(<Divider key='staff-divider' $dense={true} />)
    }
    items.push(...staff.map(collectionItem))
  }
  // With nothing to choose from, the menu opens on the title field instead of a lone item
  const showField = naming || !items.length
  if (items.length) {
    items.push(<Divider key='new-divider' $dense={true} />)
  }
  items.push(
    showField ? (
      <NewCollectionField key='new'>
        <TextField
          label={t('maps.collections.newCollection', 'New collection')}
          value={title}
          dense={true}
          maxLength={MAX_COLLECTION_TITLE_LENGTH}
          disabled={creating}
          errorText={titleError}
          inputProps={{ autoFocus: true }}
          onChange={e => setTitle(e.target.value)}
          onEnterKeyDown={onCreate}
        />
      </NewCollectionField>
    ) : (
      <MenuItem
        key='new'
        text={t('maps.collections.newCollection', 'New collection')}
        icon={<MaterialIcon icon='add' />}
        dense={true}
        onClick={() => setNaming(true)}
      />
    ),
  )

  return <MenuList dense={true}>{items}</MenuList>
}
