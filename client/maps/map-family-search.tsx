import { TFunction } from 'i18next'
import { ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import {
  MAP_PAGE_FILE_PARAM,
  mapFileIdFromSegment,
  mapIdFromRouteSegment,
} from '../../common/map-url'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapFamilySearch_FamilyFragmentFragment } from '../gql/graphql'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { RadioButton, RadioGroup } from '../material/radio'
import { TextField } from '../material/text-field'
import { bodyMedium, bodySmall, singleLine, titleSmall } from '../styles/typography'
import { MapFileImage, MapFileImage_FileFragment } from './map-image'

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
      file {
        id
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
      file {
        id
        name
        file {
          id
          ...MapFileImage_FileFragment
        }
      }
    }
  }
`)

/** A map that can be picked in a map search. */
export interface MapFamilyCandidate {
  familyId: string
  family: FragmentType<typeof MapFamilySearch_FamilyFragment>
  /** The file of the map that a pasted link or id named, when it named one rather than the map. */
  file?: {
    id: SbMapId
    name: string
    file: FragmentType<typeof MapFileImage_FileFragment>
  }
  /** Shown at the end of the map's row, e.g. why it's suggested. */
  note?: string
}

const countFormat = numberFormat()

/**
 * Requests results without suspending: the search shows its own state. Module-level so the query
 * sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const FILE_PARAM_PATTERN = new RegExp(`[?&]${MAP_PAGE_FILE_PARAM}=([^&#]+)`)

/**
 * The maps found by a search, or by a pasted map link or id (which also finds unlisted maps). A
 * pasted link to a map page that selects one of the map's files finds the map with that file.
 */
export function useCandidateSearch(value: string): {
  results: MapFamilyCandidate[]
  fetching: boolean
} {
  const trimmed = value.trim()
  const urlSegment = /\/maps\/([^/?#]+)/.exec(trimmed)?.[1] ?? trimmed
  const fileParam = FILE_PARAM_PATTERN.exec(trimmed)?.[1]
  const pastedId = trimmed
    ? ((fileParam ? mapFileIdFromSegment(fileParam) : undefined) ??
      mapIdFromRouteSegment(urlSegment))
    : undefined

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
    const lookup = byId?.mapFamily
    return {
      results: lookup
        ? [{ familyId: lookup.family.id, family: lookup.family, file: lookup.file ?? undefined }]
        : [],
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

/**
 * The map with an id as a candidate to pick, once it has loaded (undefined when there's no id or
 * no such map).
 */
export function useFamilyCandidate(familyId: string | undefined): MapFamilyCandidate | undefined {
  const [{ data }] = useQuery({
    query: MapFamilySearchByIdQuery,
    variables: { id: familyId ?? '' },
    pause: !familyId,
    context: NO_SUSPENSE_CONTEXT,
  })
  const family = data?.mapFamily?.family
  return familyId && family ? { familyId: family.id, family } : undefined
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

type CandidateRowSize = 'default' | 'large'

const CandidateRow = styled.div<{ $size: CandidateRowSize }>`
  width: 100%;
  min-width: 0;
  padding-block: ${props => (props.$size === 'large' ? 0 : '4px')};

  display: flex;
  align-items: center;
  gap: 12px;
`

const CandidateImage = styled.div<{ $size: CandidateRowSize }>`
  width: ${props => (props.$size === 'large' ? 48 : 40)}px;
  height: ${props => (props.$size === 'large' ? 48 : 40)}px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
`

const CandidateText = styled.div`
  flex: 1 1 auto;
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

const CandidateNote = styled.div`
  ${bodySmall};
  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

/** About four and a half candidate rows, so a long list scrolls and shows there's more. */
const CandidateList = styled.div`
  max-height: 216px;
  /* Keeps the rows' end notes clear of the scrollbar. */
  padding-right: 8px;
  overflow-y: auto;
`

/**
 * The facts a map search shows about a candidate map: how many files it has, how much it's played
 * and whether it's unlisted.
 */
export function familyCandidateMeta(
  family: MapFamilySearch_FamilyFragmentFragment,
  t: TFunction,
  numbers: Intl.NumberFormat,
): string {
  const games = family.stats?.gamesTotal ?? 0
  const meta = [
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
  ]
  if (!family.current.listed) {
    meta.push(t('maps.page.unlisted', 'Unlisted'))
  }
  return meta.join(' · ')
}

/**
 * A map file's row in a map search: its image, name and facts, and a note and `trailing` content
 * at the end.
 */
export function MapCandidateRow({
  file,
  name,
  meta,
  note,
  trailing,
  size = 'default',
}: {
  file: FragmentType<typeof MapFileImage_FileFragment>
  /** The display name, with color codes already stripped. */
  name: string
  meta: string
  note?: string
  /** Shown after the note, e.g. an icon. */
  trailing?: ReactNode
  /** `large` shows a bigger image, for lists with room for it. */
  size?: CandidateRowSize
}) {
  return (
    <CandidateRow $size={size}>
      <CandidateImage $size={size}>
        <MapFileImage
          file={file}
          name={name}
          size={size === 'large' ? 96 : 64}
          forceAspectRatio={1}
        />
      </CandidateImage>
      <CandidateText>
        <CandidateName>{name}</CandidateName>
        <CandidateMeta>{meta}</CandidateMeta>
      </CandidateText>
      {note ? <CandidateNote>{note}</CandidateNote> : null}
      {trailing}
    </CandidateRow>
  )
}

/** A candidate map's row in a map search, showing its current file. */
export function MapFamilyCandidateRow({
  candidate,
  size,
}: {
  candidate: MapFamilyCandidate
  size?: CandidateRowSize
}) {
  const { t } = useTranslation()
  const numbers = useFormat(countFormat)
  const family = useFragment(MapFamilySearch_FamilyFragment, candidate.family)

  return (
    <MapCandidateRow
      file={family.current.file}
      name={filterColorCodes(family.name)}
      meta={familyCandidateMeta(family, t, numbers)}
      note={candidate.note}
      size={size}
    />
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
        <CandidateList>
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
                label={<MapFamilyCandidateRow candidate={c} />}
                disabled={disabled}
              />
            ))}
          </RadioGroup>
        </CandidateList>
      ) : null}
      {search.trim() && !fetching && !results.length ? (
        <MutedText>{t('maps.familySearch.noResults', 'No maps found.')}</MutedText>
      ) : null}
    </Root>
  )
}
