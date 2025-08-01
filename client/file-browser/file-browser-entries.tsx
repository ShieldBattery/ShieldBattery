import * as React from 'react'
import styled, { css } from 'styled-components'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { useStableCallback } from '../react/state-hooks'
import { BodyLarge, BodySmall } from '../styles/typography'
import {
  FileBrowserFileEntry,
  FileBrowserFileEntryConfig,
  FileBrowserFolderEntry,
  FileBrowserUpEntry,
} from './file-browser-types'

export const ENTRY_HEIGHT = 60

const EntryContainer = styled.div<{ $focused: boolean }>`
  width: 100%;
  height: ${ENTRY_HEIGHT}px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  background-color: ${props => (props.$focused ? 'var(--color-blue30) !important' : 'transparent')};

  &:hover {
    background-color: var(--color-blue20);
    cursor: pointer;
  }
`

const EntryIcon = styled.div`
  width: 40px;
  height: 40px;
  margin-right: 16px;
  padding: 8px;
  flex-grow: 0;
  flex-shrink: 0;

  background: var(--theme-on-surface-variant);
  border-radius: 50%;
  color: rgba(0, 0, 0, 0.54);
`

const InfoContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`

interface FileBrowserEntryProps {
  isFocused: boolean
}

export function UpOneDir({
  upOneDir,
  isFocused,
  onClick,
}: FileBrowserEntryProps & {
  upOneDir: FileBrowserUpEntry
  onClick: (entry: FileBrowserUpEntry) => void
}) {
  return (
    <EntryContainer $focused={isFocused} onClick={() => onClick(upOneDir)}>
      <EntryIcon>
        <MaterialIcon icon='subdirectory_arrow_left' />
      </EntryIcon>
      <BodyLarge>{upOneDir.name}</BodyLarge>
    </EntryContainer>
  )
}

const FolderEntryContainer = styled(EntryContainer)`
  & ${EntryIcon} {
    background: var(--theme-amber);
  }
`

export function FolderEntry({
  folder,
  isFocused,
  onClick,
}: FileBrowserEntryProps & {
  folder: FileBrowserFolderEntry
  onClick: (entry: FileBrowserFolderEntry) => void
}) {
  return (
    <FolderEntryContainer $focused={isFocused} onClick={() => onClick(folder)}>
      <EntryIcon>
        <MaterialIcon icon='folder' invertColor={true} />
      </EntryIcon>
      <InfoContainer>
        <BodyLarge>{folder.name}</BodyLarge>
      </InfoContainer>
    </FolderEntryContainer>
  )
}

const SelectButton = styled(TextButton)<{ $focused: boolean }>`
  margin: 0 8px;

  ${props =>
    !props.$focused
      ? css`
          display: none;
        `
      : ''}
`

const FileEntryContainer = styled(EntryContainer)`
  & ${EntryIcon} {
    background: var(--color-blue60);
    color: var(--theme-on-surface);
  }

  &:hover ${SelectButton} {
    display: inline-table;
  }
`

// NOTE(2Pac): This component is currently pushing the boundaries of what a generic component should
// do. In case we need to add more custom functionality to it, we should probably split this into
// multiple components, e.g. `<SimpleFileEntry />`, `<ExpandedFileEntry />` etc., *or*, allow file
// browsers to define completely custom components for their files.
export const FileEntry = React.memo(
  ({
    file,
    fileEntryConfig,
    isFocused,
    isExpanded,
    onClick,
    onFocusedPathChange,
  }: FileBrowserEntryProps & {
    file: FileBrowserFileEntry
    fileEntryConfig: FileBrowserFileEntryConfig
    isFocused: boolean
    isExpanded?: boolean
    onClick: (entry: FileBrowserFileEntry) => void
    onFocusedPathChange: (path: string) => void
  }) => {
    const { icon, ExpansionPanelComponent, onSelect, onSelectTitle } = fileEntryConfig

    const onSelectClick = useStableCallback((event: React.MouseEvent) => {
      event.stopPropagation()
      onFocusedPathChange(file.path)
      onSelect(file)
    })

    return (
      <>
        <FileEntryContainer $focused={isFocused} onClick={() => onClick(file)}>
          <EntryIcon>{icon}</EntryIcon>
          <InfoContainer>
            <BodyLarge>{file.name}</BodyLarge>
            <BodySmall>{longTimestamp.format(file.date)}</BodySmall>
          </InfoContainer>
          {ExpansionPanelComponent ? (
            <SelectButton $focused={isFocused} label={onSelectTitle} onClick={onSelectClick} />
          ) : null}
        </FileEntryContainer>
        {isExpanded && !!ExpansionPanelComponent && <ExpansionPanelComponent file={file} />}
      </>
    )
  },
)
