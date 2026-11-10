import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { useMutation } from 'urql'
import { Link } from 'wouter'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { FragmentType, graphql, useFragment } from '../gql'
import {
  MapPageFiles_FamilyFragmentFragment,
  MapPageFiles_FileFragmentFragment,
} from '../gql/graphql'
import { dateTimeFormat, numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RoomChip, SectionLabel } from '../lobbies/room/room-parts'
import { IconButton, TextButton } from '../material/button'
import { Card } from '../material/card'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { openMapFamilyActionDialog } from './action-creators'
import {
  duplicateFileNames,
  orderFamilyFiles,
  urlForMapFile,
  visibleFamilyFiles,
} from './map-family-files'

export const MapPageFiles_FileFragment = graphql(/* GraphQL */ `
  fragment MapPageFiles_FileFragment on SbMap {
    id
    name
    listed
    firstSeenAt
    stats {
      id
      games28d
      gamesTotal
    }
  }
`)

export const MapPageFiles_FamilyFragment = graphql(/* GraphQL */ `
  fragment MapPageFiles_FamilyFragment on MapFamily {
    id
    name
    listed
    current {
      id
      name
    }
    defaultMap {
      id
    }
    defaultSetBy @include(if: $canManageMaps) {
      id
      name
    }
    files {
      id
      ...MapPageFiles_FileFragment
    }
  }
`)

const SetDefaultMutation = graphql(/* GraphQL */ `
  mutation MapFamilySetDefault($fileId: SbMapId!) {
    mapFamilySetDefault(fileId: $fileId) {
      id
      name
      current {
        id
        name
      }
      defaultMap {
        id
      }
      defaultSetAt
      defaultSetBy {
        id
        name
      }
    }
  }
`)

const ClearDefaultMutation = graphql(/* GraphQL */ `
  mutation MapFamilyClearDefault($familyId: UUID!) {
    mapFamilyClearDefault(familyId: $familyId) {
      id
      name
      current {
        id
        name
      }
      defaultMap {
        id
      }
      defaultSetAt
      defaultSetBy {
        id
        name
      }
    }
  }
`)

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })
const uploadedDateFormat = dateTimeFormat({ year: 'numeric', month: 'short' })

const FilesCard = styled(Card)`
  padding: 16px 8px 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Row = styled.div<{ $selected: boolean }>`
  min-height: 40px;

  display: flex;
  align-items: center;
  gap: 0;

  border-radius: 6px;
  background-color: ${props => (props.$selected ? 'var(--theme-container-high)' : 'transparent')};
`

const rowBody = css`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 40px;
  padding: 4px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 6px;
  color: inherit;
  text-decoration: none;
`

const RowContent = styled.div`
  ${rowBody};
`

const RowLink = styled(Link)`
  ${rowBody};

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    text-decoration: none;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }
`

const FileName = styled.span<{ $link: boolean }>`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
  color: ${props => (props.$link ? 'var(--theme-amber)' : 'var(--theme-on-surface)')};
`

/** A tooltip around a chip, which must keep the chip's full size when the row is tight. */
const ChipTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

/**
 * The button's 48px hit area is mostly empty around its 24px icon, so it overlaps the row's
 * padding and takes only 24px from the row.
 */
const MenuTooltip = styled(Tooltip)`
  flex-shrink: 0;
  margin-inline: -12px;
`

const RowChip = styled(RoomChip)`
  flex-shrink: 0;
  padding: 2px 8px;
`

const DefaultChip = styled(RowChip)`
  display: flex;
  align-items: center;
  gap: 2px;

  background-color: rgb(from var(--theme-positive) r g b / 0.16);
  color: var(--theme-positive);
`

const RowMeta = styled.div`
  ${bodySmall};
  margin-left: auto;
  flex-shrink: 0;

  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const ShowAllButton = styled(TextButton)`
  align-self: flex-start;
  /** Lines the label up with the rows' text, past the button's own padding. */
  margin-left: -12px;
`

type FileData = MapPageFiles_FileFragmentFragment
type FamilyData = MapPageFiles_FamilyFragmentFragment

/**
 * The files that make up a map: the default (the file players get) first, then the rest by how
 * much they're played. Selecting one shows it on the page, and staff can change which files the
 * map holds and which is its default. Players only see it when the map has more than one file.
 */
export function MapFilesCard({
  family: familyRef,
  selected: selectedRef,
}: {
  family: FragmentType<typeof MapPageFiles_FamilyFragment>
  /** The file the page shows, which may not be among the files the viewer can see. */
  selected: FragmentType<typeof MapPageFiles_FileFragment>
}) {
  const { t } = useTranslation()
  const family = useFragment(MapPageFiles_FamilyFragment, familyRef)
  const familyFiles = useFragment(MapPageFiles_FileFragment, family.files)
  const selected = useFragment(MapPageFiles_FileFragment, selectedRef)
  const canManageMaps = useHasAnyPermission('manageMaps')
  const [expanded, setExpanded] = useState(false)

  const files = familyFiles.some(f => f.id === selected.id)
    ? familyFiles
    : [...familyFiles, selected]
  if (files.length < 2 && !canManageMaps) {
    return null
  }

  const ordered = orderFamilyFiles(
    files.map(f => ({ ...f, gamesTotal: f.stats?.gamesTotal ?? 0 })),
    family.current.id,
  )
  const { rows, hiddenCount } = visibleFamilyFiles(ordered, selected.id, expanded)
  const duplicateNames = duplicateFileNames(files)

  return (
    <FilesCard>
      <SectionLabel>{t('maps.files.title', 'Files')}</SectionLabel>
      <Rows>
        {rows.map(file => (
          <FileRow
            key={file.id}
            file={file}
            family={family}
            files={files}
            duplicateNames={duplicateNames}
            selectedId={selected.id}
            canManageMaps={canManageMaps}
          />
        ))}
      </Rows>
      {hiddenCount || expanded ? (
        <ShowAllButton
          label={
            expanded
              ? t('maps.files.showFewer', 'Show fewer')
              : t('maps.files.showAll', {
                  defaultValue: 'Show all {{count}}',
                  count: files.length,
                })
          }
          iconEnd={<MaterialIcon icon={expanded ? 'expand_less' : 'expand_more'} />}
          onClick={() => setExpanded(!expanded)}
        />
      ) : null}
    </FilesCard>
  )
}

function FileRow({
  file,
  family,
  files,
  duplicateNames,
  selectedId,
  canManageMaps,
}: {
  file: FileData
  family: FamilyData
  files: ReadonlyArray<FileData>
  duplicateNames: ReadonlySet<string>
  selectedId: SbMapId
  canManageMaps: boolean
}) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  const uploadedDate = useFormat(uploadedDateFormat)

  const name = filterColorCodes(file.name)
  const isSelected = file.id === selectedId
  const isDefault = file.id === family.current.id
  const isPicked = family.defaultMap?.id === file.id
  const games = file.stats?.gamesTotal ?? 0

  const meta = [
    t('maps.files.games', {
      defaultValue: '{{formattedCount}} games',
      defaultValue_one: '{{formattedCount}} game',
      count: games,
      formattedCount: numbers.format(games),
    }),
  ]
  if (duplicateNames.has(name)) {
    meta.unshift(uploadedDate.format(new Date(file.firstSeenAt)))
  }

  let defaultChip = (
    <DefaultChip>
      <MaterialIcon icon='star' size={14} filled={true} />
      {t('maps.files.default', 'Default')}
    </DefaultChip>
  )
  if (canManageMaps) {
    // Admin-only details, so they aren't translated
    defaultChip = (
      <ChipTooltip
        text={isPicked ? `Picked by ${family.defaultSetBy?.name ?? 'staff'}` : 'Most played'}
        position='top'>
        {defaultChip}
      </ChipTooltip>
    )
  }

  let unlistedChip = <RowChip>{t('maps.page.unlisted', 'Unlisted')}</RowChip>
  if (canManageMaps && isPicked && !isDefault) {
    unlistedChip = (
      <ChipTooltip text='Picked as default, but unused while unlisted' position='top'>
        {unlistedChip}
      </ChipTooltip>
    )
  }

  const content = (
    <>
      <FileName $link={!isSelected}>{name}</FileName>
      {isDefault ? defaultChip : null}
      {!file.listed ? unlistedChip : null}
      <RowMeta>{meta.join(' · ')}</RowMeta>
    </>
  )

  return (
    <Row $selected={isSelected} aria-current={isSelected ? 'true' : undefined}>
      {isSelected ? (
        <RowContent>{content}</RowContent>
      ) : (
        <RowLink href={urlForMapFile(family, file.id)}>{content}</RowLink>
      )}
      {canManageMaps ? (
        <FileStaffMenu
          file={file}
          family={family}
          files={files}
          duplicateNames={duplicateNames}
          selectedId={selectedId}
        />
      ) : null}
    </Row>
  )
}

/** What a default-changing mutation returns, as far as the snackbar needs. */
interface DefaultChangeResult {
  data?: { current: { id: SbMapId; name: string } } | null
  error?: { graphQLErrors: ReadonlyArray<{ message: string }>; message: string }
}

/** The staff's actions on one file of a map. Admin-only, so not translated. */
function FileStaffMenu({
  file,
  family,
  files,
  duplicateNames,
  selectedId,
}: {
  file: FileData
  family: FamilyData
  files: ReadonlyArray<FileData>
  duplicateNames: ReadonlySet<string>
  selectedId: SbMapId
}) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const uploadedDate = useFormat(uploadedDateFormat)
  const [, setDefault] = useMutation(SetDefaultMutation)
  const [, clearDefault] = useMutation(ClearDefaultMutation)
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const isPicked = family.defaultMap?.id === file.id
  // Only a listed file can be the default of a map with listed files
  const canBeDefault = file.listed || !family.listed

  /** Names a file by its display name, plus its upload date when another file has that name. */
  const labelOf = (current: { id: SbMapId; name: string }) => {
    const name = filterColorCodes(current.name)
    const found = files.find(f => f.id === current.id)
    return found && duplicateNames.has(name)
      ? `${name} (${uploadedDate.format(new Date(found.firstSeenAt))})`
      : name
  }

  const changeDefault = (request: Promise<DefaultChangeResult>, suffix: string) => {
    request
      .then(result => {
        if (result.error || !result.data) {
          throw new Error(result.error?.graphQLErrors[0]?.message ?? result.error?.message)
        }
        snackbarController.showSnackbar(`Default is now ${labelOf(result.data.current)}${suffix}`)
      })
      .catch((err: Error) => {
        snackbarController.showSnackbar(`Couldn't change the default: ${err.message}`)
      })
  }

  const items: Array<{
    text: string
    secondaryText?: string
    disabled?: boolean
    onClick: () => void
  }> = []
  const openAction = (action: 'split' | 'move') =>
    dispatch(
      openMapFamilyActionDialog({ action, familyId: family.id, fileId: file.id, selectedId }),
    )
  if (isPicked) {
    items.push({
      text: 'Clear default',
      onClick: () =>
        changeDefault(
          clearDefault({ familyId: family.id }).then(r => ({
            data: r.data?.mapFamilyClearDefault,
            error: r.error,
          })),
          ' (most played)',
        ),
    })
  } else {
    items.push({
      text: 'Make default',
      secondaryText: canBeDefault ? undefined : 'Unlisted files can’t be the default',
      disabled: !canBeDefault,
      onClick: () =>
        changeDefault(
          setDefault({ fileId: file.id }).then(r => ({
            data: r.data?.mapFamilySetDefault,
            error: r.error,
          })),
          '',
        ),
    })
  }
  if (files.length > 1) {
    items.push({ text: 'Split into its own map', onClick: () => openAction('split') })
  }
  items.push({ text: 'Move to another map…', onClick: () => openAction('move') })

  return (
    <>
      <MenuTooltip text='File actions' position='top' tabIndex={-1}>
        <IconButton
          ref={anchorRef}
          icon={<MaterialIcon icon='more_vert' />}
          ariaLabel='File actions'
          ariaHasPopup='menu'
          ariaExpanded={open}
          onClick={openMenu}
        />
      </MenuTooltip>
      <Popover
        open={open}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList>
          {items.map(item => (
            <MenuItem
              key={item.text}
              text={item.text}
              secondaryText={item.secondaryText}
              disabled={item.disabled}
              onClick={() => {
                closeMenu()
                item.onClick()
              }}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  )
}
