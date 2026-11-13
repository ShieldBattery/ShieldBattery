import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { Link } from 'wouter'
import { urlForMapCollection } from '../../common/map-url'
import { makeMapCollectionId } from '../../common/maps'
import { useSelfUser } from '../auth/auth-utils'
import { graphql, useFragment } from '../gql'
import { MapPageCollections_CollectionFragmentFragment } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import { SectionLabel } from '../lobbies/room/room-parts'
import { TextButton } from '../material/button'
import { Card } from '../material/card'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { useLastSettledData } from './map-collection-actions'
import { useCollectionSubtitleDate } from './map-collection-card'
import { splitLadderPools } from './map-collection-lists'
import { collectionSubtitle, collectionTitle } from './map-collection-text'

const MapPageCollections_CollectionFragment = graphql(/* GraphQL */ `
  fragment MapPageCollections_CollectionFragment on MapCollection {
    id
    kind
    title
    public
    mapCount
    owner {
      id
      name
    }
    pool {
      id
      matchmakingType
      startDate
      endDate
      isCurrent
    }
  }
`)

const MapPageCollectionsQuery = graphql(/* GraphQL */ `
  query MapPageCollections($familyId: UUID!) {
    mapFamily(id: $familyId) {
      id
      family {
        id
        collections {
          id
          ...MapPageCollections_CollectionFragment
        }
        ladderPools(first: 100) {
          id
          ...MapPageCollections_CollectionFragment
        }
      }
    }
  }
`)

/**
 * Requests results without suspending: the card shows once its collections load. Module-level so
 * the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const CollectionsCard = styled(Card)`
  padding: 16px 6px 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const CardLabel = styled(SectionLabel)`
  /** Lines the label up with the rows' text. */
  padding-inline: 12px;
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const RowLink = styled(Link)`
  min-height: 40px;
  padding: 4px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 6px;
  color: inherit;
  text-decoration: none;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    text-decoration: none;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }
`

const RowTitle = styled.span`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-amber);
`

const RowMeta = styled.span`
  ${bodySmall};
  ${singleLine};
  margin-left: auto;
  flex-shrink: 1;
  min-width: 0;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const PastPoolsButton = styled(TextButton)`
  align-self: flex-start;
  /** Lines the label up with the rows' text, past the button's own padding. */
  margin-left: -4px;
`

/**
 * The collections a map is in: the staff collections and the most saved public ones, then the
 * ladder pools its matchmaking types play now, with the past ladder pools it was in folded into one
 * row that expands in place. Shows nothing when the map is in none of them.
 */
export function MapCollectionsCard({ familyId }: { familyId: string }) {
  const { t } = useTranslation()
  const [showPast, setShowPast] = useState(false)
  const [result] = useQuery({
    query: MapPageCollectionsQuery,
    variables: { familyId },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  // A change to a listed collection makes the list load again, so the last one shows until then
  const data = useLastSettledData(result)
  const family = data?.mapFamily?.family
  const pools = useFragment(MapPageCollections_CollectionFragment, family?.ladderPools ?? [])
  const collections = useFragment(MapPageCollections_CollectionFragment, family?.collections ?? [])
  const { current, past } = splitLadderPools(pools)
  if (!collections.length && !pools.length) {
    return null
  }

  return (
    <CollectionsCard>
      <CardLabel>{t('maps.page.collections', 'Collections')}</CardLabel>
      <Rows>
        {collections.map(c => (
          <CollectionRow key={c.id} collection={c} />
        ))}
        {current.map(c => (
          <CollectionRow key={c.id} collection={c} />
        ))}
        {showPast ? past.map(c => <CollectionRow key={c.id} collection={c} />) : null}
      </Rows>
      {past.length ? (
        <PastPoolsButton
          label={t('maps.page.pastLadderPools', {
            defaultValue: 'In {{count}} past ladder pools',
            defaultValue_one: 'In {{count}} past ladder pool',
            count: past.length,
          })}
          iconEnd={<MaterialIcon icon={showPast ? 'expand_less' : 'expand_more'} />}
          onClick={() => setShowPast(!showPast)}
        />
      ) : null}
    </CollectionsCard>
  )
}

/** A collection on one line: its title, linking to its page, and whose it is or when it's played. */
function CollectionRow({
  collection: c,
}: {
  collection: MapPageCollections_CollectionFragmentFragment
}) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const formatDate = useCollectionSubtitleDate()
  const title = collectionTitle(c, t)

  return (
    <RowLink href={urlForMapCollection(makeMapCollectionId(c.id), c.title ?? undefined)}>
      <RowTitle>{title}</RowTitle>
      <RowMeta>{collectionSubtitle(c, selfUser?.id, formatDate, t)}</RowMeta>
    </RowLink>
  )
}
