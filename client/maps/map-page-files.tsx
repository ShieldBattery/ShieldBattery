import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Link } from 'wouter'
import { urlForMapCompare } from '../../common/map-url'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { FragmentType, graphql, useFragment } from '../gql'
import {
  MapPageFiles_FamilyFragmentFragment,
  MapPageFiles_FileFragmentFragment,
} from '../gql/graphql'
import { TransInterpolation } from '../i18n/i18next'
import { dateTimeFormat, numberFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { RoomChip, SectionLabel } from '../lobbies/room/room-parts'
import { IconButton, TextButton } from '../material/button'
import { Callout } from '../material/callout'
import { Card } from '../material/card'
import { LinkButton } from '../material/link-button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { openMapFamilyActionDialog } from './action-creators'
import { orderFamilyFiles, urlForMapFile, visibleFamilyFiles } from './map-family-files'
import { useMapHostAction } from './map-host-action'

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
    file {
      id
      width
      height
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

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })
const uploadedDateFormat = dateTimeFormat({ year: 'numeric', month: 'short', day: 'numeric' })

const FilesCard = styled(Card)`
  padding: 16px 12px 12px 20px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Rows = styled.div`
  /* Lines the selected row's highlight up with the card's padding. */
  margin-left: -8px;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Row = styled.div<{ $selected: boolean }>`
  min-height: 48px;
  padding: 4px 0 4px 8px;

  display: flex;
  align-items: center;
  gap: 4px;

  border-radius: 6px;
  background-color: ${props => (props.$selected ? 'var(--theme-container-high)' : 'transparent')};
`

const RowText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const RowTitle = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

const FileName = styled.span`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

const FileLink = styled(Link)`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
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

const RowSubtitle = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/** Holds the compare button's place on the default's row, so every row's buttons line up. */
const CompareSpacer = styled.div`
  width: 48px;
  flex-shrink: 0;
`

const RowActions = styled.div`
  flex-shrink: 0;

  display: flex;
  align-items: center;
`

const HostButton = styled(TextButton)`
  min-width: 0;
  padding-inline: 12px;
`

const ShowAllButton = styled(TextButton)`
  align-self: flex-start;
  /** Lines the label up with the rows, past the button's own padding. */
  margin-left: -16px;
`

type FileData = MapPageFiles_FileFragmentFragment

/**
 * The files that make up a map: the default (the file players get) first, then the rest by how
 * much they're played. Each can be viewed, hosted and compared with the default, and staff can
 * change which files the map holds and which is its default. Players only see it when the map has
 * more than one file.
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

  return (
    <FilesCard>
      <SectionLabel>{t('maps.files.title', 'Files')}</SectionLabel>
      <Rows>
        {rows.map(file => (
          <FileRow
            key={file.id}
            file={file}
            family={family}
            fileCount={files.length}
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

type FamilyData = MapPageFiles_FamilyFragmentFragment

function FileRow({
  file,
  family,
  fileCount,
  selectedId,
  canManageMaps,
}: {
  file: FileData
  family: FamilyData
  fileCount: number
  selectedId: SbMapId
  canManageMaps: boolean
}) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  const uploadedDate = useFormat(uploadedDateFormat)
  const { isLobbyHost, play } = useMapHostAction()

  const name = filterColorCodes(file.name)
  const isSelected = file.id === selectedId
  const isDefault = file.id === family.current.id
  const games = file.stats?.gamesTotal ?? 0

  const subtitle = [
    t('maps.files.games', {
      defaultValue: '{{formattedCount}} games',
      defaultValue_one: '{{formattedCount}} game',
      count: games,
      formattedCount: numbers.format(games),
    }),
    `${file.file.width}×${file.file.height}`,
    t('maps.files.uploaded', {
      defaultValue: 'Uploaded {{date}}',
      date: uploadedDate.format(new Date(file.firstSeenAt)),
    }),
  ]
  // Admin-only details, so they aren't translated
  if (canManageMaps && isDefault) {
    subtitle.unshift(
      family.defaultMap?.id === file.id
        ? `Picked by ${family.defaultSetBy?.name ?? 'staff'}`
        : 'Most played',
    )
  } else if (canManageMaps && family.defaultMap?.id === file.id) {
    subtitle.unshift('Picked, but unused while unlisted')
  }

  const compareLabel = t('maps.files.compareWithDefault', 'Compare with default')
  const playLabel = isLobbyHost ? t('maps.files.useInLobby', 'Use') : t('maps.files.host', 'Host')
  const playTooltip = isLobbyHost
    ? t('maps.page.useInMyLobby', 'Use in my lobby')
    : t('maps.page.hostLobby', 'Host a lobby')

  return (
    <Row $selected={isSelected} aria-current={isSelected ? 'true' : undefined}>
      <RowText>
        <RowTitle>
          {isSelected ? (
            <FileName>{name}</FileName>
          ) : (
            <FileLink href={urlForMapFile(family, file.id)}>{name}</FileLink>
          )}
          {isDefault ? (
            <DefaultChip>
              <MaterialIcon icon='star' size={14} filled={true} />
              {t('maps.files.default', 'Default')}
            </DefaultChip>
          ) : null}
          {!file.listed ? <RowChip>{t('maps.page.unlisted', 'Unlisted')}</RowChip> : null}
        </RowTitle>
        <RowSubtitle>{subtitle.join(' · ')}</RowSubtitle>
      </RowText>
      <RowActions>
        <Tooltip text={playTooltip} position='top' tabIndex={-1}>
          <HostButton label={playLabel} onClick={() => play(file.id)} />
        </Tooltip>
        {isDefault ? (
          <CompareSpacer />
        ) : (
          <Tooltip text={compareLabel} position='top' tabIndex={-1}>
            <LinkButton href={urlForMapCompare(family.current.id, file.id)}>
              <IconButton
                styledAs='div'
                icon={<MaterialIcon icon='compare' />}
                ariaLabel={compareLabel}
              />
            </LinkButton>
          </Tooltip>
        )}
        {canManageMaps ? (
          <FileStaffMenu
            file={file}
            family={family}
            fileCount={fileCount}
            selectedId={selectedId}
          />
        ) : null}
      </RowActions>
    </Row>
  )
}

/** The staff's actions on one file of a map. Admin-only, so not translated. */
function FileStaffMenu({
  file,
  family,
  fileCount,
  selectedId,
}: {
  file: FileData
  family: FamilyData
  fileCount: number
  selectedId: SbMapId
}) {
  const dispatch = useAppDispatch()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const isPicked = family.defaultMap?.id === file.id
  // Only a listed file can be the default of a map with listed files
  const canBeDefault = file.listed || !family.listed

  const items: Array<{
    text: string
    secondaryText?: string
    disabled?: boolean
    onClick: () => void
  }> = []
  const openAction = (action: 'makeDefault' | 'clearDefault' | 'split' | 'move') =>
    dispatch(
      openMapFamilyActionDialog({ action, familyId: family.id, fileId: file.id, selectedId }),
    )
  if (isPicked) {
    items.push({ text: 'Clear default', onClick: () => openAction('clearDefault') })
  } else {
    items.push({
      text: 'Make default',
      secondaryText: canBeDefault ? undefined : 'Unlisted files can’t be the default',
      disabled: !canBeDefault,
      onClick: () => openAction('makeDefault'),
    })
  }
  if (fileCount > 1) {
    items.push({ text: 'Split into its own map', onClick: () => openAction('split') })
  }
  items.push({ text: 'Move to another map…', onClick: () => openAction('move') })

  return (
    <>
      <Tooltip text='File actions' position='top' tabIndex={-1}>
        <IconButton
          ref={anchorRef}
          icon={<MaterialIcon icon='more_vert' />}
          ariaLabel='File actions'
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

const NoticeLink = styled(Link)`
  ${titleSmall};
  overflow-wrap: anywhere;
`

/** Tells the viewer that the file they're looking at isn't the one players get. */
export function MapNotDefaultNotice({
  family: familyRef,
  selectedId,
}: {
  family: FragmentType<typeof MapPageFiles_FamilyFragment>
  selectedId: SbMapId
}) {
  const { t } = useTranslation()
  const family = useFragment(MapPageFiles_FamilyFragment, familyRef)
  if (family.current.id === selectedId) {
    return null
  }

  const name = filterColorCodes(family.current.name)
  return (
    <Callout variant='inline' icon='info'>
      <Trans t={t} i18nKey='maps.files.notDefaultNotice'>
        Not the default. Players get{' '}
        <NoticeLink href={urlForMapFile(family, family.current.id)}>
          {{ name } as TransInterpolation}
        </NoticeLink>
        .
      </Trans>
    </Callout>
  )
}
