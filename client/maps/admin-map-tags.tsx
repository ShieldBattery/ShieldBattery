import { ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { assertUnreachable } from '../../common/assert-unreachable'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { graphql } from '../gql'
import { AdminMapTagsQuery, MapKind, MapTagAutoRule } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyMedium, labelMedium, titleLarge, titleMedium } from '../styles/typography'
import { openMapTagDeleteDialog, openMapTagEditDialog } from './action-creators'
import { MoveDirection } from './map-collection-order'
import { errorCode } from './map-owner-actions'
import {
  MapRow,
  MapRowChip,
  MapRowChipTooltip,
  MapRowControlButton,
  MapRowControls,
  MapRowListGroup,
  MapRowName,
  MapRowNameLine,
  MapRowPlaceholder,
  MapRowSubList,
} from './map-row-parts'
import { tagIdForName } from './map-tags'

// An admin-only page, so it isn't translated.

const AdminMapTagsQueryDocument = graphql(/* GraphQL */ `
  query AdminMapTags {
    mapTags {
      id
      kind
      name
      names {
        locale
        name
      }
      autoRule
      usageCount
    }
  }
`)

const MapTagsSetOrderMutation = graphql(/* GraphQL */ `
  mutation AdminMapTagsSetOrder($kind: MapKind!, $ids: [String!]!) {
    mapTagsSetOrder(kind: $kind, ids: $ids) {
      id
      kind
      name
      names {
        locale
        name
      }
      autoRule
      usageCount
    }
  }
`)

const MapTagDeleteMutation = graphql(/* GraphQL */ `
  mutation AdminMapTagDelete($id: String!) {
    mapTagDelete(id: $id)
  }
`)

/** Requests results without suspending: the page renders its own loading state. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

type AdminTag = AdminMapTagsQuery['mapTags'][number]

/** The sections of the page, one per kind of map, in the order they show. */
const SECTIONS: ReadonlyArray<{ kind: MapKind; title: string }> = [
  { kind: MapKind.Melee, title: 'Melee' },
  { kind: MapKind.Ums, title: 'UMS' },
]

/**
 * `tags` in the order of the ids `order`, when given (a reorder that's being saved). Tags it
 * doesn't name keep their order after the ones it does.
 */
export function orderedTags<T extends { id: string }>(
  tags: ReadonlyArray<T>,
  order: ReadonlyArray<string> | undefined,
): T[] {
  if (!order) {
    return [...tags]
  }
  const rank = (id: string) => {
    const index = order.indexOf(id)
    return index === -1 ? order.length : index
  }
  return tags.toSorted((a, b) => rank(a.id) - rank(b.id))
}

/**
 * The kind of the tag `id` and the ids of that kind's tags in order, once the tag swaps places with
 * the next one of its kind in `direction`. Undefined when there's none that way.
 */
export function movedTagOrder(
  tags: ReadonlyArray<{ id: string; kind: MapKind }>,
  id: string,
  direction: MoveDirection,
): { kind: MapKind; ids: string[] } | undefined {
  const moved = tags.find(tag => tag.id === id)
  if (!moved) {
    return undefined
  }
  const ids = tags.filter(tag => tag.kind === moved.kind).map(tag => tag.id)
  const index = ids.indexOf(id)
  const neighborIndex = index + direction
  if (neighborIndex < 0 || neighborIndex >= ids.length) {
    return undefined
  }
  ids[index] = ids[neighborIndex]
  ids[neighborIndex] = id
  return { kind: moved.kind, ids }
}

/** The rules the tags other than `exceptId` have, each with the English name of the tag that has it. */
export function takenAutoRules(
  tags: ReadonlyArray<{ id: string; name: string; autoRule: MapTagAutoRule | null }>,
  exceptId: string | undefined,
): Partial<Record<MapTagAutoRule, string>> {
  const taken: Partial<Record<MapTagAutoRule, string>> = {}
  for (const tag of tags) {
    if (tag.autoRule && tag.id !== exceptId) {
      taken[tag.autoRule] = tag.name
    }
  }
  return taken
}

/** What the chip on a tag with the rule `rule` tells staff. */
function autoRuleText(rule: MapTagAutoRule): string {
  switch (rule) {
    case MapTagAutoRule.RichMinerals:
      return 'Given automatically to melee maps with rich minerals (over 5,000 per field)'
    case MapTagAutoRule.LadderPool:
      return 'Given automatically to melee maps with a file in a ladder pool'
    default:
      return assertUnreachable(rule)
  }
}

/** What a failed change of the list tells staff, given the error code the server sent. */
function listErrorText(code: unknown, action: 'move' | 'delete'): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This tag was already deleted.'
    case 'FORBIDDEN':
      return "You don't have permission to manage map tags."
    case 'BAD_REQUEST':
      return action === 'move'
        ? 'The list was changed meanwhile. Try again.'
        : "Couldn't delete the tag. Please try again later."
    default:
      return action === 'move'
        ? "Couldn't save the order. Please try again later."
        : "Couldn't delete the tag. Please try again later."
  }
}

const Content = styled.div`
  max-width: 720px;
  margin: 0 16px;
  padding-bottom: 32px;
`

const HeadlineRow = styled.div`
  height: 48px;
  margin-block: 8px;

  display: flex;
  align-items: center;
`

const PageHeadline = styled.div`
  ${titleLarge};
`

const SectionHeader = styled.div`
  margin-top: 16px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  &:first-child {
    margin-top: 0;
  }
`

const SectionTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`

const TagRow = styled(MapRow)`
  min-height: 48px;
  padding-block: 4px;
`

const IdText = styled.span`
  ${bodyMedium};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const UsageCount = styled.div`
  ${labelMedium};
  grid-column: count;
  margin-inline-start: 16px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  text-align: end;
  white-space: nowrap;
`

const EmptyText = styled.div`
  ${bodyMedium};
  padding: 8px 12px;
  color: var(--theme-on-surface-variant);
`

/**
 * The list of tags maps can be given, a section per kind of map, in the order they're offered.
 * Staff add, rename, translate, reorder and delete them here.
 */
export function AdminMapTags() {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [{ data, error }, reexecute] = useQuery({
    query: AdminMapTagsQueryDocument,
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  const [, setOrder] = useMutation(MapTagsSetOrderMutation)
  const [, deleteTag] = useMutation(MapTagDeleteMutation)
  /** The order of the whole list while a move is being saved, shown until the save is done. */
  const [pendingOrder, setPendingOrder] = useState<ReadonlyArray<string>>()
  /** Counts the moves sent, so only the last one's end stops showing its order. */
  const moveCountRef = useRef(0)
  /** The row whose move button gets focus back once it shows in its new place. */
  const pendingFocusRef = useRef<{ id: string; direction: MoveDirection }>(undefined)

  const reload = () => reexecute({ requestPolicy: 'network-only' })
  const tags = data ? orderedTags(data.mapTags, pendingOrder) : undefined

  const onMove = (id: string, direction: MoveDirection) => {
    const moved = tags ? movedTagOrder(tags, id, direction) : undefined
    if (!tags || !moved) {
      return
    }
    const move = ++moveCountRef.current
    pendingFocusRef.current = { id, direction }
    setPendingOrder(orderedTags(tags, moved.ids).map(tag => tag.id))
    setOrder({ kind: moved.kind, ids: moved.ids })
      .then(result => {
        if (move !== moveCountRef.current) {
          return
        }
        setPendingOrder(undefined)
        if (result.error) {
          snackbarController.showSnackbar(listErrorText(errorCode(result.error), 'move'))
          reload()
        }
      })
      .catch(swallowNonBuiltins)
  }

  const onDelete = (tag: AdminTag) => {
    const doDelete = () => {
      deleteTag({ id: tag.id })
        .then(result => {
          if (result.error) {
            snackbarController.showSnackbar(listErrorText(errorCode(result.error), 'delete'))
            reload()
          } else {
            snackbarController.showSnackbar(`Deleted ${tag.name}`)
          }
        })
        .catch(swallowNonBuiltins)
    }
    if (tag.usageCount > 0) {
      dispatch(
        openMapTagDeleteDialog({ name: tag.name, usageCount: tag.usageCount, onConfirm: doDelete }),
      )
    } else {
      doDelete()
    }
  }

  const takePendingFocus = (id: string) => {
    const pending = pendingFocusRef.current
    if (pending?.id !== id) {
      return undefined
    }
    pendingFocusRef.current = undefined
    return pending.direction
  }

  let body: ReactNode
  if (!tags) {
    body = error ? (
      <LoadErrorRow message="Couldn't load the tags" onRetry={reload} />
    ) : (
      <LoadingDotsArea />
    )
  } else {
    body = (
      <MapRowListGroup $columns={['controls', 'count']}>
        {SECTIONS.flatMap(({ kind, title }) => {
          const sectionTags = tags.filter(tag => tag.kind === kind)
          return [
            <SectionHeader key={`${kind}-header`}>
              <SectionTitle>{title}</SectionTitle>
              <TextButton
                label='Add tag'
                iconStart='add'
                onClick={() =>
                  dispatch(
                    openMapTagEditDialog({ kind, takenRules: takenAutoRules(tags, undefined) }),
                  )
                }
              />
            </SectionHeader>,
            sectionTags.length ? (
              <MapRowSubList key={`${kind}-list`}>
                {sectionTags.map((tag, i) => (
                  <TagListRow
                    key={tag.id}
                    tag={tag}
                    index={i}
                    isLast={i === sectionTags.length - 1}
                    takePendingFocus={takePendingFocus}
                    onMove={onMove}
                    onEdit={() =>
                      dispatch(
                        openMapTagEditDialog({
                          kind,
                          tag: {
                            id: tag.id,
                            name: tag.name,
                            names: tag.names,
                            autoRule: tag.autoRule,
                          },
                          takenRules: takenAutoRules(tags, tag.id),
                        }),
                      )
                    }
                    onDelete={() => onDelete(tag)}
                  />
                ))}
              </MapRowSubList>
            ) : (
              <EmptyText key={`${kind}-empty`}>No tags yet.</EmptyText>
            ),
          ]
        })}
      </MapRowListGroup>
    )
  }

  return (
    <Content>
      <HeadlineRow>
        <PageHeadline>Map tags</PageHeadline>
      </HeadlineRow>
      {body}
    </Content>
  )
}

function TagListRow({
  tag,
  index,
  isLast,
  takePendingFocus,
  onMove,
  onEdit,
  onDelete,
}: {
  tag: AdminTag
  /** The row's position in its section. */
  index: number
  /** Whether the row is the last of its section. */
  isLast: boolean
  /**
   * The direction of the move button to focus on the row of `id`, once, if that row's tag was the
   * last one moved and its button still awaits focus in the tag's new place.
   */
  takePendingFocus: (id: string) => MoveDirection | undefined
  onMove: (id: string, direction: MoveDirection) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const upRef = useRef<HTMLButtonElement>(null)
  const downRef = useRef<HTMLButtonElement>(null)

  // A moved row is put back in the DOM, which takes focus away from the button that moved it
  const restoreFocus = useEffectEvent(() => {
    const direction = takePendingFocus(tag.id)
    if (direction === undefined) {
      return
    }
    const [preferred, other] = direction === -1 ? [upRef, downRef] : [downRef, upRef]
    const button = preferred.current?.disabled ? other.current : preferred.current
    button?.focus()
  })
  useEffect(() => {
    restoreFocus()
  }, [index])

  return (
    <TagRow>
      <MapRowPlaceholder>
        <MapRowNameLine>
          <MapRowName>{tag.name}</MapRowName>
          {/* A tag keeps the id it was created with, which is what links to it use */}
          {tag.id !== tagIdForName(tag.name) ? <IdText>{tag.id}</IdText> : null}
          {tag.autoRule ? (
            <MapRowChipTooltip text={autoRuleText(tag.autoRule)} position='top'>
              <MapRowChip>Auto</MapRowChip>
            </MapRowChipTooltip>
          ) : null}
        </MapRowNameLine>
      </MapRowPlaceholder>
      <MapRowControls $slots={4}>
        <Tooltip text='Move up' position='top' tabIndex={-1}>
          <MapRowControlButton
            ref={upRef}
            icon={<MaterialIcon icon='arrow_upward' size={20} />}
            ariaLabel='Move up'
            disabled={index === 0}
            onClick={() => onMove(tag.id, -1)}
          />
        </Tooltip>
        <Tooltip text='Move down' position='top' tabIndex={-1}>
          <MapRowControlButton
            ref={downRef}
            icon={<MaterialIcon icon='arrow_downward' size={20} />}
            ariaLabel='Move down'
            disabled={isLast}
            onClick={() => onMove(tag.id, 1)}
          />
        </Tooltip>
        <Tooltip text='Edit' position='top' tabIndex={-1}>
          <MapRowControlButton
            icon={<MaterialIcon icon='edit' size={20} />}
            ariaLabel='Edit'
            onClick={onEdit}
          />
        </Tooltip>
        <Tooltip text='Delete' position='top' tabIndex={-1}>
          <MapRowControlButton
            icon={<MaterialIcon icon='delete' size={20} />}
            ariaLabel='Delete'
            onClick={onDelete}
          />
        </Tooltip>
      </MapRowControls>
      <UsageCount>
        {tag.usageCount} {tag.usageCount === 1 ? 'map' : 'maps'}
      </UsageCount>
    </TagRow>
  )
}
