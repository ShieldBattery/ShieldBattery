import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { Link } from 'wouter'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { urlForMapCollection } from '../../common/map-url'
import { makeMapCollectionId } from '../../common/maps'
import { MapFeatureDialogData } from '../dialogs/dialog-type'
import { graphql, useFragment } from '../gql'
import { AdminMapFeaturesQuery } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { RoomChip } from '../lobbies/room/room-parts'
import { IconButton, OutlinedButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, labelLarge, singleLine, titleLarge } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { openMapFeatureDialog, openMapFeatureRemoveDialog } from './action-creators'
import { urlForMapFile } from './map-family-files'
import {
  featureErrorText,
  featurePickName,
  MapFeaturePick_FeatureFragment,
  MapFeatureRemoveMutation,
} from './map-feature-actions'
import { formatWeekRange, weekStartOf } from './map-feature-weeks'
import { errorCode } from './map-owner-actions'

// An admin-only page, so it isn't translated.

/** How many picks each page of the schedule loads. */
const PAGE_SIZE = 30

const AdminMapFeaturesQueryDocument = graphql(/* GraphQL */ `
  query AdminMapFeatures($after: String, $first: Int!) {
    mapFeatures(after: $after, first: $first) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          shown
          createdBy {
            id
          }
          ...MapFeaturePick_FeatureFragment
        }
      }
    }
  }
`)

const Content = styled.div`
  max-width: 1080px;
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

const Table = styled.div`
  width: 100%;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const TableRow = styled.div`
  ${bodyMedium};
  min-height: 48px;

  display: flex;
  align-items: center;

  &:nth-child(even) {
    background-color: rgba(255, 255, 255, 0.04);
  }
`

const TableHeader = styled(TableRow)`
  ${labelLarge};
`

const Cell = styled.div<{ $width?: number }>`
  ${singleLine};
  flex: ${props => (props.$width ? `0 0 ${props.$width}px` : '1 1 0')};
  min-width: 0;
  padding: 8px 12px;
`

const WeekCell = styled(Cell)`
  display: flex;
  align-items: center;
  gap: 8px;
`

const MarkerChip = styled(RoomChip)`
  flex-shrink: 0;
  padding-block: 2px;
`

const ActionsCell = styled(Cell)`
  padding-block: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  overflow: visible;
`

const BlurbText = styled.span`
  ${singleLine};
  display: block;
`

const MutedText = styled.span`
  color: var(--theme-on-surface-variant);
`

const EmptyText = styled.div`
  ${bodyLarge};
  padding: 16px;
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  padding: 16px;
  color: var(--theme-error);
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`

/**
 * The schedule of the staff picks leading the Discover page: every week with a pick, the weeks to
 * come first, then this week, then the past. Each pick is edited or removed from its row's menu.
 */
export function AdminMapFeatures() {
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  return (
    <Content>
      <HeadlineRow>
        <PageHeadline>Featured maps</PageHeadline>
      </HeadlineRow>
      <Table>
        <TableHeader>
          <Cell $width={260}>Week</Cell>
          <Cell $width={220}>Pick</Cell>
          <Cell>Blurb</Cell>
          <Cell $width={140}>Picked by</Cell>
          <Cell $width={64} />
        </TableHeader>
        {pageCursors.map((cursor, i) => (
          <FeaturesPage
            key={cursor ?? 'first'}
            after={cursor}
            isLastPage={i === pageCursors.length - 1}
            onLoadMore={endCursor =>
              setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
            }
          />
        ))}
      </Table>
    </Content>
  )
}

function FeaturesPage({
  after,
  isLastPage,
  onLoadMore,
}: {
  after: string | null
  isLastPage: boolean
  onLoadMore: (endCursor: string) => void
}) {
  const [{ data, fetching, error }] = useQuery({
    query: AdminMapFeaturesQueryDocument,
    variables: { after: after ?? undefined, first: PAGE_SIZE },
    requestPolicy: 'cache-and-network',
  })
  const connection = data?.mapFeatures
  const features = connection?.edges.map(e => e.node) ?? []
  const endCursor = connection?.pageInfo.endCursor

  return (
    <>
      {features.map(feature => (
        <FeatureRow key={feature.id} feature={feature} />
      ))}
      {!after && data && !features.length ? <EmptyText>No weeks have a pick.</EmptyText> : null}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>Error: {error.message}</ErrorText> : null}
      {isLastPage && connection?.pageInfo.hasNextPage && endCursor ? (
        <LoadMoreRow>
          <OutlinedButton label='Show more' onClick={() => onLoadMore(endCursor)} />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

type FeatureNode = AdminMapFeaturesQuery['mapFeatures']['edges'][number]['node']

function FeatureRow({ feature: featureNode }: { feature: FeatureNode }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const feature = useFragment(MapFeaturePick_FeatureFragment, featureNode)
  const [, removeFeature] = useMutation(MapFeatureRemoveMutation)
  // When the row first rendered is recent enough to tell the current week by
  const [thisWeek] = useState(() => weekStartOf(Date.now()).getTime())

  const week = new Date(feature.week)
  const weekText = formatWeekRange(week)
  const isThisWeek = week.getTime() === thisWeek
  const isPast = week.getTime() < thisWeek
  const name = featurePickName(feature, t)

  let pickUrl: string | undefined
  let target: MapFeatureDialogData['target'] | undefined
  if (feature.map) {
    pickUrl = urlForMapFile(feature.map.family, feature.map.id)
    target = { mapId: feature.map.id, familyId: feature.map.family.id, name }
  } else if (feature.collection) {
    pickUrl = urlForMapCollection(
      makeMapCollectionId(feature.collection.id),
      feature.collection.title ?? undefined,
    )
    target = { collectionId: feature.collection.id, name }
  }

  const onRemove = () => {
    removeFeature({ week: feature.week })
      .then(result => {
        snackbarController.showSnackbar(
          result.error
            ? featureErrorText(errorCode(result.error))
            : `Removed the pick for ${weekText}`,
        )
      })
      .catch(swallowNonBuiltins)
  }

  const menuItems: Array<[text: string, handler: () => void]> = []
  // A week that's over can't get a pick anymore, so only its pick's removal is left
  if (target && !isPast) {
    const data: MapFeatureDialogData = { target, week: feature.week, blurb: feature.blurb }
    menuItems.push(['Edit', () => dispatch(openMapFeatureDialog(data))])
  }
  menuItems.push([
    'Remove',
    () => dispatch(openMapFeatureRemoveDialog({ weekText, name, onConfirm: onRemove })),
  ])

  return (
    <TableRow>
      <WeekCell $width={260}>
        <span>{weekText}</span>
        {isThisWeek ? <MarkerChip>This week</MarkerChip> : null}
      </WeekCell>
      <WeekCell $width={220}>
        {pickUrl ? <Link href={pickUrl}>{name}</Link> : <MutedText>{name}</MutedText>}
        {featureNode.shown ? null : (
          <Tooltip
            text="The map is no longer listed, or the collection isn't public, so the automatic pick shows instead"
            position='bottom'>
            <MarkerChip>Not shown</MarkerChip>
          </Tooltip>
        )}
      </WeekCell>
      <Cell>
        {feature.blurb ? (
          <Tooltip text={feature.blurb} position='bottom'>
            <BlurbText>{feature.blurb}</BlurbText>
          </Tooltip>
        ) : (
          <MutedText>No blurb</MutedText>
        )}
      </Cell>
      <Cell $width={140}>
        {featureNode.createdBy ? (
          <ConnectedUsername userId={featureNode.createdBy.id} />
        ) : (
          <MutedText>Unknown user</MutedText>
        )}
      </Cell>
      <ActionsCell $width={64}>
        <FeatureMenu items={menuItems} />
      </ActionsCell>
    </TableRow>
  )
}

function FeatureMenu({ items }: { items: ReadonlyArray<[text: string, handler: () => void]> }) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <>
      <Tooltip text='Pick actions' position='left' tabIndex={-1}>
        <IconButton
          ref={anchorRef}
          icon={<MaterialIcon icon='more_vert' />}
          ariaLabel='Pick actions'
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
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          {items.map(([text, handler]) => (
            <MenuItem
              key={text}
              text={text}
              dense={true}
              onClick={() => {
                closeMenu()
                handler()
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  )
}
