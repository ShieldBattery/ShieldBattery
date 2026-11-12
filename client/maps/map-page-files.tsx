import { ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { useMutation } from 'urql'
import { Link } from 'wouter'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { filterColorCodes, SbMapId } from '../../common/maps'
import { matchmakingTypeToLabel } from '../../common/matchmaking'
import { RestrictionKind } from '../../common/users/restrictions'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useSelfUser } from '../auth/auth-utils'
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
import { push } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { openMapFamilyActionDialog, openMapFileUnlinkDialog } from './action-creators'
import {
  duplicateFileNames,
  orderFamilyFiles,
  urlForMapFile,
  visibleFamilyFiles,
} from './map-family-files'
import { MapFamilySetDefaultMutation } from './map-make-recommended'
import { errorCode } from './map-owner-actions'
import { fileChangeErrorText } from './map-publish'

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
    owner {
      id
    }
    files {
      id
      ...MapPageFiles_FileFragment
    }
    ladderFiles {
      id
      matchmakingType
      map {
        id
      }
    }
  }
`)

const FilesUnlinkMutation = graphql(/* GraphQL */ `
  mutation MapPageFilesUnlink($fileId: SbMapId!) {
    mapFileUnlink(fileId: $fileId) {
      id
      file {
        id
        family {
          id
          name
        }
      }
      family {
        id
        name
        current {
          id
        }
      }
      previousFamily {
        id
      }
    }
  }
`)

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })
const uploadedDateFormat = dateTimeFormat({ year: 'numeric', month: 'short' })

const FilesCard = styled(Card)`
  padding: 16px 6px 12px;

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

  border-radius: 6px;
  background-color: ${props => (props.$selected ? 'var(--theme-container-high)' : 'transparent')};

  ${props =>
    props.$selected
      ? ''
      : css`
          &:hover {
            background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
          }
        `}

  &:has(a:focus-visible) {
    outline: 2px solid var(--theme-primary);
    outline-offset: -2px;
  }
`

/**
 * The row's text and chips. It carries the row's inner padding, so the link covers the whole row
 * (up to the menu button) for clicking.
 */
const rowBody = css<{ $withMenu: boolean }>`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 40px;
  padding: 4px ${props => (props.$withMenu ? '4px' : '12px')} 4px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  color: inherit;
  text-decoration: none;
`

const RowContent = styled.div<{ $withMenu: boolean }>`
  ${rowBody};
`

const RowLink = styled(Link)<{ $withMenu: boolean }>`
  ${rowBody};

  &:hover {
    text-decoration: none;
  }

  &:focus-visible {
    outline: none;
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

const MenuTooltip = styled(Tooltip)`
  flex-shrink: 0;
`

/**
 * Sized to the row's height, so it keeps the row one line and its hover and focus backgrounds stay
 * clear of the row's text.
 */
const MenuButton = styled(IconButton)`
  width: 40px;
  min-height: 40px;
`

/** Stands in for the menu button on rows without one. */
const MenuSpacer = styled.div`
  width: 40px;
  flex-shrink: 0;
`

const RowChip = styled(RoomChip)`
  flex-shrink: 0;
  padding: 2px 6px;
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
  margin-left: -4px;
`

const FilesLabel = styled(SectionLabel)`
  /** Lines the label up with the rows' text. */
  padding-inline: 12px;
`

type FileData = MapPageFiles_FileFragmentFragment
type FamilyData = MapPageFiles_FamilyFragmentFragment

/**
 * The files that make up a map: the recommended file (the one players get) first, then the rest by
 * how much they're played. Selecting one shows it on the page. A map has one recommended file and
 * it changes by making another file recommended, so the recommended file's own menu has no
 * recommendation action. Staff can change which files the map holds, and the map's owner can take
 * files out of it while they aren't restricted from publishing. A file with no actions has no menu
 * button; its row still reserves the button's width when another visible row has one, so the rows'
 * text lines up. A file that a current ladder pool plays other than the recommended one carries a
 * chip for that pool. Players only see the card when the map has more than one file.
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
  const selfUser = useSelfUser()
  const restrictedFromPublishing = useAppSelector(
    s => !!s.auth.self?.restrictions.has(RestrictionKind.MapPublishing),
  )
  const [expanded, setExpanded] = useState(false)
  const ownerControls =
    !canManageMaps &&
    !restrictedFromPublishing &&
    !!selfUser &&
    !!family.owner &&
    family.owner.id === selfUser.id

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
  const reserveMenuSpace = rows.some(
    f => fileActionKinds(f, family, files.length, canManageMaps, ownerControls).length > 0,
  )

  return (
    <FilesCard>
      <FilesLabel>{t('maps.files.title', 'Files')}</FilesLabel>
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
            ownerControls={ownerControls}
            reserveMenuSpace={reserveMenuSpace}
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
  ownerControls,
  reserveMenuSpace,
}: {
  file: FileData
  family: FamilyData
  files: ReadonlyArray<FileData>
  duplicateNames: ReadonlySet<string>
  selectedId: SbMapId
  canManageMaps: boolean
  /** Whether the viewer can change the map as its owner. */
  ownerControls: boolean
  /** Whether any visible row has a menu button, so rows without one keep its width free. */
  reserveMenuSpace: boolean
}) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  const uploadedDate = useFormat(uploadedDateFormat)

  const name = filterColorCodes(file.name)
  const isSelected = file.id === selectedId
  const isDefault = file.id === family.current.id
  const isPicked = family.defaultMap?.id === file.id
  const games = file.stats?.gamesTotal ?? 0
  // The ladder playing the recommended file goes without saying, so only another file is marked
  const ladderTypes = isDefault
    ? []
    : family.ladderFiles.filter(f => f.map.id === file.id).map(f => f.matchmakingType)

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
      {t('maps.files.recommended', 'Recommended')}
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
      <ChipTooltip text='Picked as recommended, but unused while unlisted' position='top'>
        {unlistedChip}
      </ChipTooltip>
    )
  }

  const content = (
    <>
      <FileName $link={!isSelected}>{name}</FileName>
      {isDefault ? defaultChip : null}
      {!file.listed ? unlistedChip : null}
      {ladderTypes.map(type => {
        const label = matchmakingTypeToLabel(type, t)
        return (
          <ChipTooltip
            key={type}
            text={t(
              'maps.thumbnail.mapPoolChipTooltip',
              'In the current {{mode}} ladder map pool',
              {
                mode: label,
              },
            )}
            position='top'>
            <RowChip>{label}</RowChip>
          </ChipTooltip>
        )
      })}
      <RowMeta>{meta.join(' · ')}</RowMeta>
    </>
  )

  const actions = fileActionKinds(file, family, files.length, canManageMaps, ownerControls)
  let menu: ReactNode = null
  if (actions.length > 0) {
    menu = (
      <FileMenu
        file={file}
        family={family}
        files={files}
        duplicateNames={duplicateNames}
        selectedId={selectedId}
        staff={canManageMaps}
        actions={actions}
      />
    )
  } else if (reserveMenuSpace) {
    menu = <MenuSpacer />
  }
  return (
    <Row $selected={isSelected} aria-current={isSelected ? 'true' : undefined}>
      {isSelected ? (
        <RowContent $withMenu={reserveMenuSpace}>{content}</RowContent>
      ) : (
        <RowLink $withMenu={reserveMenuSpace} href={urlForMapFile(family, file.id)}>
          {content}
        </RowLink>
      )}
      {menu}
    </Row>
  )
}

type FileActionKind = 'makeRecommended' | 'split' | 'move' | 'unlink'

/**
 * The actions a file's menu offers, in order. The map's current file is already the recommended
 * one, so it has no recommendation action.
 */
function fileActionKinds(
  file: FileData,
  family: FamilyData,
  fileCount: number,
  staff: boolean,
  ownerControls: boolean,
): FileActionKind[] {
  const kinds: FileActionKind[] = []
  if (!staff && !ownerControls) {
    return kinds
  }
  if (file.id !== family.current.id) {
    kinds.push('makeRecommended')
  }
  if (staff) {
    if (fileCount > 1) {
      kinds.push('split')
    }
    kinds.push('move')
  } else if (fileCount > 1) {
    kinds.push('unlink')
  }
  return kinds
}

/**
 * The menu of actions on one file of a map, for staff or for the map's owner. Staff move files
 * between maps with their own tools, which aren't translated; the owner takes a file out of the
 * map.
 */
function FileMenu({
  file,
  family,
  files,
  duplicateNames,
  selectedId,
  staff,
  actions,
}: {
  file: FileData
  family: FamilyData
  files: ReadonlyArray<FileData>
  duplicateNames: ReadonlySet<string>
  selectedId: SbMapId
  staff: boolean
  actions: ReadonlyArray<FileActionKind>
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const uploadedDate = useFormat(uploadedDateFormat)
  const [, setDefault] = useMutation(MapFamilySetDefaultMutation)
  const [, unlinkFile] = useMutation(FilesUnlinkMutation)
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [open, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  // Only a listed file can be the recommended file of a map with listed files
  const canBeDefault = file.listed || !family.listed

  /** Names a file by its display name, plus its upload date when another file has that name. */
  const labelOf = (current: { id: SbMapId; name: string }) => {
    const name = filterColorCodes(current.name)
    const found = files.find(f => f.id === current.id)
    return found && duplicateNames.has(name)
      ? `${name} (${uploadedDate.format(new Date(found.firstSeenAt))})`
      : name
  }

  const makeRecommended = () => {
    setDefault({ fileId: file.id })
      .then(result => {
        if (result.error || !result.data) {
          throw new Error(result.error?.graphQLErrors[0]?.message ?? result.error?.message)
        }
        snackbarController.showSnackbar(
          t('maps.files.recommendedChanged', 'Recommended file is now {{fileName}}', {
            fileName: labelOf(result.data.mapFamilySetDefault.current),
          }),
        )
      })
      .catch((err: Error) => {
        snackbarController.showSnackbar(
          staff
            ? `Couldn't change the recommended file: ${err.message}`
            : t('maps.files.recommendError', "Couldn't change the recommended file"),
        )
      })
  }

  const onUnlink = () => {
    unlinkFile({ fileId: file.id })
      .then(result => {
        if (result.error || !result.data) {
          snackbarController.showSnackbar(
            fileChangeErrorText(
              result.error ? errorCode(result.error) : undefined,
              t('maps.publish.unlinkError', "Couldn't remove the file from this map"),
              t,
            ),
          )
          return
        }
        snackbarController.showSnackbar(
          t('maps.publish.unlinked', 'Removed from {{mapName}}', {
            mapName: filterColorCodes(family.name),
          }),
        )
        // The page follows the file it shows into its new map
        if (file.id === selectedId) {
          push(urlForMapFile(result.data.mapFileUnlink.family, file.id))
        }
      })
      .catch(swallowNonBuiltins)
  }

  const openAction = (action: 'split' | 'move') =>
    dispatch(
      openMapFamilyActionDialog({ action, familyId: family.id, fileId: file.id, selectedId }),
    )
  const items = actions.map(kind => {
    switch (kind) {
      case 'makeRecommended':
        return {
          text: t('maps.files.makeRecommended', 'Make recommended'),
          secondaryText: canBeDefault
            ? undefined
            : t('maps.files.unlistedCantBeRecommended', 'Unlisted files can’t be recommended'),
          disabled: !canBeDefault,
          onClick: makeRecommended,
        }
      // Admin-only, so not translated
      case 'split':
        return { text: 'Split into its own map', onClick: () => openAction('split') }
      case 'move':
        return { text: 'Move to another map', onClick: () => openAction('move') }
      default:
        return {
          text: t('maps.publish.unlinkMenuItem', 'Remove from this map'),
          onClick: () =>
            dispatch(
              openMapFileUnlinkDialog({
                fileName: file.name,
                mapName: family.name,
                onConfirm: onUnlink,
              }),
            ),
        }
    }
  })
  const menuLabel = staff ? 'File actions' : t('maps.files.fileActions', 'File actions')

  return (
    <>
      <MenuTooltip text={menuLabel} position='top' tabIndex={-1}>
        <MenuButton
          ref={anchorRef}
          icon={<MaterialIcon icon='more_vert' />}
          ariaLabel={menuLabel}
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
        <MenuList dense={true}>
          {items.map(item => (
            <MenuItem
              key={item.text}
              text={item.text}
              dense={true}
              secondaryText={'secondaryText' in item ? item.secondaryText : undefined}
              disabled={'disabled' in item ? item.disabled : undefined}
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
