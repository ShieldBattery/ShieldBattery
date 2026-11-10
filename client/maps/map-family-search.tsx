import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { mapIdFromRouteSegment } from '../../common/map-url'
import { filterColorCodes } from '../../common/maps'
import { FragmentType, graphql, useFragment } from '../gql'
import { dateTimeFormat, numberFormat, useFormat } from '../i18n/locale-formats'
import { RadioButton, RadioGroup } from '../material/radio'
import { TextField } from '../material/text-field'
import { bodyMedium, bodySmall, singleLine, titleSmall } from '../styles/typography'
import { MapFileImage } from './map-image'

/**
 * What a map search shows about a candidate map: its current file's image and facts, and enough
 * about the map to tell apart maps of the same name.
 */
export const MapFamilySearch_FamilyFragment = graphql(/* GraphQL */ `
  fragment MapFamilySearch_FamilyFragment on MapFamily {
    id
    name
    stats {
      id
      gamesTotal
    }
    files {
      id
    }
    current {
      id
      listed
      playerCount
      firstSeenAt
      file {
        id
        width
        height
        ...MapFileImage_FileFragment
      }
    }
  }
`)

const MapFamilySearchQuery = graphql(/* GraphQL */ `
  query MapFamilySearch($search: String!) {
    maps(filter: { search: $search }, first: 6) {
      nodes {
        id
        family {
          id
          ...MapFamilySearch_FamilyFragment
        }
      }
    }
  }
`)

const MapFamilySearchByIdQuery = graphql(/* GraphQL */ `
  query MapFamilySearchById($id: UUID!) {
    mapFamily(id: $id) {
      id
      family {
        id
        ...MapFamilySearch_FamilyFragment
      }
    }
  }
`)

/** A map that can be picked in a map search. */
export interface MapFamilyCandidate {
  familyId: string
  family: FragmentType<typeof MapFamilySearch_FamilyFragment>
  /** Shown under the map's facts, e.g. why it's suggested. */
  note?: string
}

const countFormat = numberFormat()

/**
 * Requests results without suspending: the search shows its own state. Module-level so the query
 * sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/** The maps found by a search, or by a pasted map link or id (which also finds unlisted maps). */
function useCandidateSearch(value: string): {
  results: MapFamilyCandidate[]
  fetching: boolean
} {
  const trimmed = value.trim()
  const urlSegment = /\/maps\/([^/?#]+)/.exec(trimmed)?.[1] ?? trimmed
  const pastedId = trimmed ? mapIdFromRouteSegment(urlSegment) : undefined

  const [{ data: byId, fetching: fetchingById }] = useQuery({
    query: MapFamilySearchByIdQuery,
    variables: { id: pastedId ?? '' },
    pause: !pastedId,
    context: NO_SUSPENSE_CONTEXT,
  })
  const [{ data: bySearch, fetching }] = useQuery({
    query: MapFamilySearchQuery,
    variables: { search: trimmed },
    pause: !trimmed || !!pastedId,
    context: NO_SUSPENSE_CONTEXT,
  })

  if (pastedId) {
    const family = byId?.mapFamily?.family
    return {
      results: family ? [{ familyId: family.id, family }] : [],
      fetching: fetchingById,
    }
  }
  if (!trimmed) {
    return { results: [], fetching: false }
  }
  return {
    results: (bySearch?.maps.nodes ?? []).map(node => ({
      familyId: node.family.id,
      family: node.family,
    })),
    fetching,
  }
}

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const MutedText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const CandidateRow = styled.div`
  min-width: 0;
  padding-block: 4px;

  display: flex;
  align-items: center;
  gap: 12px;
`

const CandidateImage = styled.div`
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
`

const CandidateText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`

const CandidateName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const CandidateMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const uploadedDateFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

function Candidate({ candidate }: { candidate: MapFamilyCandidate }) {
  const { t } = useTranslation()
  const uploadedDate = useFormat(uploadedDateFormat)
  const numbers = useFormat(countFormat)
  const family = useFragment(MapFamilySearch_FamilyFragment, candidate.family)
  const file = family.current
  const name = filterColorCodes(family.name)
  const games = family.stats?.gamesTotal ?? 0
  const history = [
    t('maps.familySearch.files', {
      defaultValue: '{{count}} files',
      defaultValue_one: '{{count}} file',
      count: family.files.length,
    }),
    t('maps.files.games', {
      defaultValue: '{{formattedCount}} games',
      defaultValue_one: '{{formattedCount}} game',
      count: games,
      formattedCount: numbers.format(games),
    }),
    t('maps.files.uploaded', {
      defaultValue: 'Uploaded {{date}}',
      date: uploadedDate.format(new Date(file.firstSeenAt)),
    }),
  ]
  const facts = [
    t('maps.catalog.players', {
      defaultValue: '{{count}} players',
      defaultValue_one: '{{count}} player',
      count: file.playerCount,
    }),
    `${file.file.width}×${file.file.height}`,
  ]
  if (!file.listed) {
    facts.push(t('maps.page.unlisted', 'Unlisted'))
  }

  return (
    <CandidateRow>
      <CandidateImage>
        <MapFileImage file={file.file} name={name} size={64} forceAspectRatio={1} />
      </CandidateImage>
      <CandidateText>
        <CandidateName>{name}</CandidateName>
        <CandidateMeta>{facts.join(' · ')}</CandidateMeta>
        <CandidateMeta>{history.join(' · ')}</CandidateMeta>
        {candidate.note ? <CandidateMeta>{candidate.note}</CandidateMeta> : null}
      </CandidateText>
    </CandidateRow>
  )
}

/**
 * Picks a map: suggestions (if any), then the maps found by searching or by pasting a map's link.
 * The picked map stays in the list while the search changes. `excludeFamilyId` (the map being
 * acted on) is never offered.
 */
export function MapFamilySearch({
  picked,
  onPick,
  excludeFamilyId,
  suggestions = [],
  disabled,
}: {
  picked: MapFamilyCandidate | undefined
  onPick: (candidate: MapFamilyCandidate) => void
  excludeFamilyId: string
  suggestions?: ReadonlyArray<MapFamilyCandidate>
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { results, fetching } = useCandidateSearch(search)

  const candidates: MapFamilyCandidate[] = []
  const shown = new Set<string>([excludeFamilyId])
  for (const c of [...suggestions, ...(picked ? [picked] : []), ...results]) {
    if (!shown.has(c.familyId)) {
      shown.add(c.familyId)
      candidates.push(c)
    }
  }

  return (
    <Root>
      <TextField
        label={t('maps.familySearch.search', 'Search maps, or paste a map link')}
        dense={true}
        allowErrors={false}
        hasClearButton={true}
        disabled={disabled}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {candidates.length ? (
        <RadioGroup
          value={picked?.familyId}
          dense={true}
          onChange={e => {
            const next = candidates.find(c => c.familyId === e.target.value)
            if (next) {
              onPick(next)
            }
          }}>
          {candidates.map(c => (
            <RadioButton
              key={c.familyId}
              value={c.familyId}
              label={<Candidate candidate={c} />}
              disabled={disabled}
            />
          ))}
        </RadioGroup>
      ) : null}
      {search.trim() && !fetching && !results.length ? (
        <MutedText>{t('maps.familySearch.noResults', 'No maps found.')}</MutedText>
      ) : null}
    </Root>
  )
}
