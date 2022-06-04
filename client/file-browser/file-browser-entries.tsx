import React from 'react'
import styled, { css } from 'styled-components'
import { longTimestamp } from '../i18n/date-formats'
import Folder from '../icons/material/ic_folder_black_24px.svg'
import UpDirectory from '../icons/material/ic_subdirectory_arrow_left_black_24px.svg'
import { IconButton, TextButton } from '../material/button'
import { Tooltip } from '../material/tooltip'
import { useStableCallback } from '../state-hooks'
import { AnimatedExpandIcon } from '../styles/animated-expand-icon'
import { amberA400, blue700, colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { Caption, Subtitle1 } from '../styles/typography'
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
  background-color: ${props =>
    props.$focused ? 'rgba(255, 255, 255, 0.24) !important' : 'transparent'};

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
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

  background: ${colorTextSecondary};
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
        <UpDirectory />
      </EntryIcon>
      <Subtitle1>{upOneDir.name}</Subtitle1>
    </EntryContainer>
  )
}

const FolderEntryContainer = styled(EntryContainer)`
  & ${EntryIcon} {
    background: ${amberA400};
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
        <Folder />
      </EntryIcon>
      <InfoContainer>
        <Subtitle1>{folder.name}</Subtitle1>
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

const StyledTooltip = styled(Tooltip)<{ $focused: boolean }>`
  ${props =>
    !props.$focused
      ? css`
          display: none;
        `
      : ''}
`

const FileEntryContainer = styled(EntryContainer)<{ $clickable: boolean }>`
  ${props =>
    !props.$clickable
      ? css`
          cursor: auto !important;
        `
      : ''}

  & ${EntryIcon} {
    background: ${blue700};
    color: ${colorTextPrimary};
  }

  &:hover ${SelectButton} {
    display: inline-table;
  }
  &:hover ${StyledTooltip} {
    display: flex;
  }
`

const ExpandText = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
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
    onExpandClick,
  }: FileBrowserEntryProps & {
    file: FileBrowserFileEntry
    fileEntryConfig: FileBrowserFileEntryConfig
    isFocused: boolean
    isExpanded?: boolean
    onClick: (entry: FileBrowserFileEntry) => void
    onExpandClick?: (entry: FileBrowserFileEntry) => void
  }) => {
    const { icon, ExpansionPanelComponent, onSelect, onSelectTitle } = fileEntryConfig

    const handleExpandClick = useStableCallback((event: React.MouseEvent) => {
      event.stopPropagation()
      onExpandClick?.(file)
    })

    return (
      <>
        <FileEntryContainer
          $clickable={!ExpansionPanelComponent}
          $focused={isFocused}
          onClick={() => onClick(file)}>
          <EntryIcon>{icon}</EntryIcon>
          <InfoContainer>
            <Subtitle1>{file.name}</Subtitle1>
            <Caption>{longTimestamp.format(file.date)}</Caption>
          </InfoContainer>
          {ExpansionPanelComponent ? (
            <>
              <SelectButton
                $focused={isFocused}
                label={onSelectTitle}
                onClick={() => onSelect(file)}
              />
              <StyledTooltip
                $focused={isFocused}
                text={
                  <ExpandText>
                    <span>Expand</span>
                    <span>(Space)</span>
                  </ExpandText>
                }
                position='bottom'>
                <IconButton
                  icon={<AnimatedExpandIcon $flipped={isExpanded} $reversed={true} />}
                  onClick={handleExpandClick}
                />
              </StyledTooltip>
            </>
          ) : null}
        </FileEntryContainer>
        {isExpanded && !!ExpansionPanelComponent && <ExpansionPanelComponent file={file} />}
      </>
    )
  },
)
