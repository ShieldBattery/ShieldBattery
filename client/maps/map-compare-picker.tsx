import { ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { useSelfUser } from '../auth/auth-utils'
import { FragmentType, graphql, useFragment } from '../gql'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { SectionLabel } from '../lobbies/room/room-parts'
import { buttonReset } from '../material/button-reset'
import { TextField } from '../material/text-field'
import { bodyMedium } from '../styles/typography'
import { orderFamilyFiles, useFamilyFileLabel } from './map-family-files'
import {
  familyCandidateMeta,
  MapCandidateRow,
  MapFamilyCandidate,
  MapFamilyCandidateRow,
  MapFamilySearch_FamilyFragment,
  useCandidateSearch,
} from './map-family-search'

/** What the compare page shows about one map file, to name it and to offer it as a pick. */
export const MapComparePicker_FileFragment = graphql(/* GraphQL */ `
  fragment MapComparePicker_FileFragment on SbMap {
    id
    name
    listed
    firstSeenAt
    stats {
      id
      gamesTotal
    }
    file {
      id
      ...MapFileImage_FileFragment
    }
  }
`)

/** The map a compared file is in, with the map's files, to switch between them. */
export const MapComparePicker_FamilyFragment = graphql(/* GraphQL */ `
  fragment MapComparePicker_FamilyFragment on MapFamily {
    id
    name
    current {
      id
    }
    files {
      id
      ...MapComparePicker_FileFragment
    }
  }
`)

const MapComparePickerStarredQuery = graphql(/* GraphQL */ `
  query MapComparePickerStarred {
    currentUser {
      id
      favoriteMaps(sort: NEWEST, first: 8) {
        nodes {
          id
          family {
            id
            ...MapFamilySearch_FamilyFragment
          }
        }
      }
    }
  }
`)

/**
 * Requests results without suspending: the picker shows its own state. Module-level so the query
 * sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const countFormat = numberFormat()

const Root = styled.div`
  flex: 1 1 auto;
  min-height: 0;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const List = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const GroupLabel = styled(SectionLabel)`
  /** Lines the label up with the rows' text. */
  padding: 4px 12px;
`

/** A group's rows: one column when narrow, more when there's room. */
const Rows = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 2px 8px;
`

const RowButton = styled.button`
  ${buttonReset};
  width: 100%;
  min-width: 0;
  padding: 6px 12px;

  display: block;

  border-radius: 8px;
  color: inherit;
  text-align: start;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }
`

/** A row that can't be picked, because it shows a file that's already on one of the sides. */
const StaticRow = styled.div<{ $dimmed?: boolean }>`
  min-width: 0;
  padding: 6px 12px;
  opacity: ${props => (props.$dimmed ? 0.6 : 1)};
`

const MutedText = styled.div`
  ${bodyMedium};
  padding-inline: 12px;
  color: var(--theme-on-surface-variant);
`

/** A file shown on one side of the compare page, and its map. */
export interface ComparePickerSide {
  file: FragmentType<typeof MapComparePicker_FileFragment>
  family: FragmentType<typeof MapComparePicker_FamilyFragment>
}

/**
 * Picks the map file for one side of the compare page. Clicking a row picks it at once. With an
 * empty search it lists the files of this side's map, then the files of the other side's map (when
 * it's a different map), then the viewer's starred maps; a search finds maps by name, or by a
 * pasted map link or id. A found map picks its recommended file, unless the pasted link named one
 * of its files. In a map's files, the file this side shows is marked as the current one and the file
 * on the other side is dimmed; neither can be picked, and neither is offered among starred or found
 * maps.
 */
export function MapComparePicker({
  own,
  other,
  onPick,
  autoFocus = false,
  className,
}: {
  /** The file this side shows, if it shows one. */
  own?: ComparePickerSide
  /** The file on the other side, if it shows one. */
  other?: ComparePickerSide
  onPick: (fileId: SbMapId) => void
  autoFocus?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const ownFile = useFragment(MapComparePicker_FileFragment, own?.file)
  const otherFile = useFragment(MapComparePicker_FileFragment, other?.file)
  const ownFamily = useFragment(MapComparePicker_FamilyFragment, own?.family)
  const otherFamily = useFragment(MapComparePicker_FamilyFragment, other?.family)
  const inputRef = useRef<HTMLInputElement>(null)
  const excluded = new Set<SbMapId>()
  if (ownFile) {
    excluded.add(ownFile.id)
  }
  if (otherFile) {
    excluded.add(otherFile.id)
  }

  useEffect(() => {
    if (!autoFocus) {
      return undefined
    }
    // A popover keeps its content `visibility: hidden` until it has measured where to go, and
    // hidden elements can't take focus, so keep trying until the field accepts it.
    let frame = 0
    let attempts = 0
    const tryFocus = () => {
      const input = inputRef.current
      if (!input) {
        return
      }
      input.focus()
      if (document.activeElement !== input && ++attempts < 30) {
        frame = requestAnimationFrame(tryFocus)
      }
    }
    tryFocus()
    return () => cancelAnimationFrame(frame)
  }, [autoFocus])

  return (
    <Root className={className}>
      <TextField
        ref={inputRef}
        label={t('maps.familySearch.search', 'Search maps, or paste a map link')}
        dense={true}
        allowErrors={false}
        hasClearButton={true}
        leadingIcons={[<MaterialIcon icon='search' key='search' />]}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <List>
        {search.trim() ? (
          <SearchResults search={search} excluded={excluded} onPick={onPick} />
        ) : (
          <>
            {own ? (
              <FilesGroup
                family={own.family}
                ownFileId={ownFile?.id}
                otherFileId={otherFile?.id}
                onPick={onPick}
              />
            ) : null}
            {other && otherFamily?.id !== ownFamily?.id ? (
              <FilesGroup
                family={other.family}
                ownFileId={ownFile?.id}
                otherFileId={otherFile?.id}
                onPick={onPick}
              />
            ) : null}
            <StarredGroup excluded={excluded} onPick={onPick} />
          </>
        )}
      </List>
    </Root>
  )
}

/**
 * All of a map's files. The file this side shows and the one on the other side can't be picked;
 * the group is left out when every file is one of them.
 */
function FilesGroup({
  family: familyRef,
  ownFileId,
  otherFileId,
  onPick,
}: {
  family: FragmentType<typeof MapComparePicker_FamilyFragment>
  ownFileId?: SbMapId
  otherFileId?: SbMapId
  onPick: (fileId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const numbers = useFormat(countFormat)
  const family = useFragment(MapComparePicker_FamilyFragment, familyRef)
  const files = useFragment(MapComparePicker_FileFragment, family.files)
  const fileLabel = useFamilyFileLabel(files)

  const ordered = orderFamilyFiles(
    files.map(f => ({ ...f, gamesTotal: f.stats?.gamesTotal ?? 0 })),
    family.current.id,
  )
  if (!ordered.some(f => f.id !== ownFileId && f.id !== otherFileId)) {
    return null
  }

  return (
    <Group>
      <GroupLabel>
        {t('maps.compare.filesOf', {
          defaultValue: 'Files of {{mapName}}',
          mapName: filterColorCodes(family.name),
        })}
      </GroupLabel>
      <Rows>
        {ordered.map(file => {
          const meta = [
            t('maps.files.games', {
              defaultValue: '{{formattedCount}} games',
              defaultValue_one: '{{formattedCount}} game',
              count: file.gamesTotal,
              formattedCount: numbers.format(file.gamesTotal),
            }),
          ]
          if (file.id === family.current.id) {
            meta.unshift(t('maps.files.recommended', 'Recommended'))
          }
          if (!file.listed) {
            meta.push(t('maps.page.unlisted', 'Unlisted'))
          }
          const row = (note?: string, trailing?: ReactNode) => (
            <MapCandidateRow
              file={file.file}
              name={fileLabel(file)}
              meta={meta.join(' · ')}
              note={note}
              trailing={trailing}
              size='large'
            />
          )

          if (file.id === ownFileId) {
            return (
              <StaticRow key={file.id} aria-current='true'>
                {row(undefined, <MaterialIcon icon='check' />)}
              </StaticRow>
            )
          } else if (file.id === otherFileId) {
            return (
              <StaticRow key={file.id} $dimmed={true}>
                {row(t('maps.compare.onOtherSide', 'On the other side'))}
              </StaticRow>
            )
          } else {
            return (
              <RowButton key={file.id} type='button' onClick={() => onPick(file.id)}>
                {row()}
              </RowButton>
            )
          }
        })}
      </Rows>
    </Group>
  )
}

function StarredGroup({
  excluded,
  onPick,
}: {
  excluded: ReadonlySet<SbMapId>
  onPick: (fileId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const [{ data }] = useQuery({
    query: MapComparePickerStarredQuery,
    pause: !selfUser,
    context: NO_SUSPENSE_CONTEXT,
  })
  const candidates: MapFamilyCandidate[] = selfUser
    ? (data?.currentUser?.favoriteMaps.nodes ?? []).map(node => ({
        familyId: node.family.id,
        family: node.family,
      }))
    : []

  return (
    <CandidateGroup
      label={t('maps.collections.starred', 'Starred')}
      candidates={candidates}
      excluded={excluded}
      onPick={onPick}
    />
  )
}

function SearchResults({
  search,
  excluded,
  onPick,
}: {
  search: string
  excluded: ReadonlySet<SbMapId>
  onPick: (fileId: SbMapId) => void
}) {
  const { t } = useTranslation()
  const { results, fetching } = useCandidateSearch(search)

  return (
    <CandidateGroup
      candidates={results}
      excluded={excluded}
      onPick={onPick}
      empty={
        fetching ? null : (
          <MutedText>{t('maps.familySearch.noResults', 'No maps found.')}</MutedText>
        )
      }
    />
  )
}

/**
 * Rows of candidate maps, each picking the file it names (its recommended file, unless a pasted
 * link named another). Candidates whose file is excluded are left out; with none left, the group
 * shows `empty`.
 */
function CandidateGroup({
  label,
  candidates,
  excluded,
  onPick,
  empty = null,
}: {
  label?: string
  candidates: ReadonlyArray<MapFamilyCandidate>
  excluded: ReadonlySet<SbMapId>
  onPick: (fileId: SbMapId) => void
  empty?: ReactNode
}) {
  const { t } = useTranslation()
  const numbers = useFormat(countFormat)
  const families = useFragment(
    MapFamilySearch_FamilyFragment,
    candidates.map(c => c.family),
  )

  const rows = candidates
    .map((candidate, i) => ({
      candidate,
      family: families[i],
      fileId: candidate.file?.id ?? families[i].current.id,
    }))
    .filter(row => !excluded.has(row.fileId))
  if (!rows.length) {
    return empty
  }

  return (
    <Group>
      {label ? <GroupLabel>{label}</GroupLabel> : null}
      <Rows>
        {rows.map(({ candidate, family, fileId }) => (
          <RowButton key={candidate.familyId} type='button' onClick={() => onPick(fileId)}>
            {candidate.file && candidate.file.id !== family.current.id ? (
              <MapCandidateRow
                file={candidate.file.file}
                name={filterColorCodes(candidate.file.name)}
                meta={familyCandidateMeta(family, t, numbers)}
                size='large'
              />
            ) : (
              <MapFamilyCandidateRow candidate={candidate} size='large' />
            )}
          </RowButton>
        ))}
      </Rows>
    </Group>
  )
}
