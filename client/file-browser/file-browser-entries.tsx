import React from 'react'
import styled from 'styled-components'
import { longTimestamp } from '../i18n/date-formats'
import Folder from '../icons/material/ic_folder_black_24px.svg'
import UpDirectory from '../icons/material/ic_subdirectory_arrow_left_black_24px.svg'
import { amberA400, blue700, colorTextPrimary, colorTextSecondary } from '../styles/colors'
import { Caption, Subtitle1 } from '../styles/typography'
import {
  FileBrowserFileEntry,
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
  background-color: ${props => (props.$focused ? 'rgba(255, 255, 255, 0.24)' : 'transparent')};

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

const FileEntryContainer = styled(EntryContainer)`
  & ${EntryIcon} {
    background: ${blue700};
    color: ${colorTextPrimary};
  }
`

export function FileEntry({
  file,
  icon,
  isFocused,
  onClick,
}: FileBrowserEntryProps & {
  file: FileBrowserFileEntry
  icon: React.ReactElement
  onClick: (entry: FileBrowserFileEntry) => void
}) {
  return (
    <FileEntryContainer $focused={isFocused} onClick={() => onClick(file)}>
      <EntryIcon>{icon}</EntryIcon>
      <InfoContainer>
        <Subtitle1>{file.name}</Subtitle1>
        <Caption>{longTimestamp.format(file.date)}</Caption>
      </InfoContainer>
    </FileEntryContainer>
  )
}
