import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FixedSizeList } from 'react-window'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { longTimestamp } from '../i18n/date-formats'
import ChevronRight from '../icons/material/ic_chevron_right_black_24px.svg'
import Folder from '../icons/material/ic_folder_black_24px.svg'
import Refresh from '../icons/material/ic_refresh_black_24px.svg'
import UpDirectory from '../icons/material/ic_subdirectory_arrow_left_black_24px.svg'
import { useKeyListener } from '../keyboard/key-listener'
import { JsonLocalStorageValue } from '../local-storage'
import { IconButton } from '../material/button'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { shadow4dp } from '../material/shadows'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  amberA400,
  blue700,
  blue800,
  colorDividers,
  colorError,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { Caption, Headline5, headline6, subtitle1, Subtitle1 } from '../styles/typography'
import { changePath, clearFiles, getFiles } from './action-creators'
import {
  FileBrowserEntry,
  FileBrowserEntryConfig,
  FileBrowserEntryType,
  FileBrowserFileEntry,
  FileBrowserFolderEntry,
  FileBrowserRootFolder,
  FileBrowserRootFolderId,
  FileBrowserType,
  FileBrowserUpEntry,
} from './file-browser-types'

const FOCUSED_KEY = 'FocusedPath'
const ROOT_ID = 'RootId'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'
const UP = 'ArrowUp'
const DOWN = 'ArrowDown'
const PAGEUP = 'PageUp'
const PAGEDOWN = 'PageDown'
const HOME = 'Home'
const END = 'End'
const BACKSPACE = 'Backspace'

const VERT_PADDING = 8
const ENTRY_HEIGHT = 60

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
  style: React.CSSProperties
}

function UpOneDir({
  upOneDir,
  isFocused,
  onClick,
  style,
}: FileBrowserEntryProps & {
  upOneDir: FileBrowserUpEntry
  onClick: (entry: FileBrowserUpEntry) => void
}) {
  return (
    <EntryContainer style={style} $focused={isFocused} onClick={() => onClick(upOneDir)}>
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

function FolderEntry({
  folder,
  isFocused,
  onClick,
  style,
}: FileBrowserEntryProps & {
  folder: FileBrowserFolderEntry
  onClick: (entry: FileBrowserFolderEntry) => void
}) {
  return (
    <FolderEntryContainer style={style} $focused={isFocused} onClick={() => onClick(folder)}>
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

function FileEntry({
  file,
  icon,
  isFocused,
  onClick,
  style,
}: FileBrowserEntryProps & {
  file: FileBrowserFileEntry
  icon: React.ReactElement
  onClick: (entry: FileBrowserFileEntry) => void
}) {
  return (
    <FileEntryContainer style={style} $focused={isFocused} onClick={() => onClick(file)}>
      <EntryIcon>{icon}</EntryIcon>
      <InfoContainer>
        <Subtitle1>{file.name}</Subtitle1>
        <Caption>{longTimestamp.format(file.date)}</Caption>
      </InfoContainer>
    </FileEntryContainer>
  )
}

const BreadcrumbPiece = styled.span<{ $active: boolean }>`
  ${headline6};
  padding: 8px;
  flex-grow: 0;
  flex-shrink: 0;

  font-weight: normal;
  color: ${props => (props.$active ? colorTextPrimary : colorTextSecondary)};
  cursor: ${props => (props.$active ? 'auto' : 'pointer')};
`

const BreadcrumbSeparator = styled(ChevronRight)`
  display: inline-block;
  flex-grow: 0;
  flex-shrink: 0;
  color: ${colorTextFaint};
`

interface PathBreadcrumbsProps {
  className?: string
  path: string
  onNavigate: (navPath: string) => void
}

const PathBreadcrumbs = React.memo<PathBreadcrumbsProps>(
  ({ className, onNavigate, path }) => {
    const pieces = path.split(/[\\\/]/g)
    if (pieces[pieces.length - 1] === '') {
      // Remove the last entry if it's empty (due to a trailing slash)
      pieces.pop()
    }
    const { elems } = pieces.reduce<{ elems: React.ReactNode[]; curPath: string }>(
      (r, piece, i) => {
        if (piece.length === 0) {
          return r
        }
        const isLast = i === pieces.length - 1
        r.curPath += (i === 0 ? '' : '\\') + piece
        // Save the value at the current time so the function doesn't always use the last value
        const navPath = r.curPath
        r.elems.push(
          <BreadcrumbPiece
            key={i}
            $active={isLast}
            onClick={isLast ? undefined : () => onNavigate(navPath)}>
            {piece}
          </BreadcrumbPiece>,
        )
        r.elems.push(<BreadcrumbSeparator key={i + '|'} />)

        return r
      },
      { elems: [], curPath: '' },
    )

    return <div className={className}>{elems}</div>
  },
  (prevProps, nextProps) => prevProps.path === nextProps.path,
)

const Root = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  &:focus {
    outline: none;
  }
`

const TopBar = styled.div`
  ${shadow4dp};
  background: ${blue800};
`

const TitleContainer = styled.div`
  width: 100%;
  height: 64px;
  padding: 0 16px;
  display: flex;
  align-items: center;
`

const RootFolderSelect = styled(Select)`
  padding: 0 16px;
`

const BreadcrumbsAndActions = styled.div`
  width: 100%;
  height: 48px;
  padding-right: 16px;

  display: flex;
  align-items: center;
  justify-content: space-between;
`

const StyledPathBreadcrumbs = styled(PathBreadcrumbs)`
  display: flex;
  align-items: center;
  padding: 0 8px;
`

const ExternalError = styled.div`
  padding: 8px;
  color: ${colorError};
  border-bottom: 1px solid ${colorDividers};
`

const FilesContent = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
`

const ErrorText = styled.div`
  ${subtitle1};
  padding: 16px;

  color: ${colorError};
  text-align: center;
`

const EmptyText = styled.div`
  ${subtitle1};
  padding: 16px;

  color: ${colorTextFaint};
  text-align: center;
`

function getDir(filePath: string) {
  const lastSlash = filePath.lastIndexOf('\\')
  if (lastSlash !== -1) {
    return filePath.substring(0, lastSlash)
  } else {
    return ''
  }
}

interface FileBrowserProps {
  browserType: FileBrowserType
  rootFolders: {
    default: FileBrowserRootFolder
  } & {
    [key in Exclude<FileBrowserRootFolderId, 'default'>]?: FileBrowserRootFolder
  }
  title: string
  titleButton?: React.ReactElement
  fileTypes: {
    [key in string]?: FileBrowserEntryConfig
  }
  error?: Error
}

export function FileBrowser({
  browserType,
  rootFolders,
  title = 'Files',
  titleButton,
  fileTypes,
  error,
}: FileBrowserProps) {
  const dispatch = useAppDispatch()
  const fileBrowser = useAppSelector(s => s.fileBrowser[browserType])
  const fileBrowserPath = fileBrowser?.path
  const [dimensionsRef, containerRect] = useObservedDimensions()
  const [loadFilesError, setLoadFilesError] = useState<Error>()

  const listRef = useRef<FixedSizeList>(null)
  const listOuterRef = useRef<HTMLElement>(null)

  const [initialFocusedPath, initialRootFolderId] = useMemo(
    () => [
      new JsonLocalStorageValue<string>(browserType + FOCUSED_KEY),
      new JsonLocalStorageValue<FileBrowserRootFolderId>(browserType + ROOT_ID),
    ],
    [browserType],
  )
  const [focusedPath, setFocusedPath] = useState(initialFocusedPath.getValue())
  const [rootFolder, setRootFolder] = useState(
    rootFolders[initialRootFolderId.getValue() || 'default']!,
  )

  // Focus *something* when file browser is opened, because if we don't, whatever was focused before
  // the file browser was opened will still have focus and will mess with our keyboard events.
  const focusBrowser = useCallback((elem: HTMLDivElement | null) => {
    Promise.resolve().then(() => elem?.focus())
  }, [])

  const entries = useMemo(() => {
    if (!fileBrowser || !fileBrowser.folders || !fileBrowser.files) {
      return undefined
    }

    const { upOneDir, files, folders } = fileBrowser
    const entries: FileBrowserEntry[] = []
    const filteredFiles = files.filter(f => fileTypes[f.extension])
    return upOneDir
      ? entries.concat(upOneDir, folders, filteredFiles)
      : entries.concat(folders, filteredFiles)
  }, [fileBrowser, fileTypes])

  const focusedIndex = useMemo(() => {
    const hasFocusedIndex = focusedPath && entries && entries.map(i => i.path).includes(focusedPath)
    return hasFocusedIndex ? entries.findIndex(f => f.path === focusedPath) : -1
  }, [entries, focusedPath])

  useEffect(() => {
    // This effect should only change the initial path, to effectively initialize the file browser.
    // All subsequent path changes should be done through user action.
    if (fileBrowserPath) {
      return
    }

    const initialPath =
      focusedPath && focusedPath.toLowerCase().startsWith(rootFolder.path.toLowerCase())
        ? getDir(focusedPath)
        : rootFolder.path

    dispatch(changePath(browserType, initialPath))
  }, [browserType, dispatch, fileBrowserPath, focusedPath, rootFolder.path])

  useEffect(() => {
    if (!entries || entries.length < 1) {
      return
    }

    if (focusedIndex > -1) {
      listRef.current?.scrollToItem(focusedIndex)
    } else {
      // Focus first entry if nothing else is focused. Will be 'Up one directory' entry in all
      // non-root folders. In the root folder it will either be the first folder or a file.
      setFocusedPath(entries[0].path)
    }
  }, [entries, focusedIndex])

  useEffect(() => {
    if (!fileBrowserPath) {
      return
    }

    dispatch(
      getFiles(browserType, fileBrowserPath, rootFolder.path, {
        onSuccess: () => setLoadFilesError(undefined),
        onError: err => setLoadFilesError(err),
      }),
    )
  }, [browserType, dispatch, fileBrowserPath, rootFolder.path])

  useEffect(() => {
    // TODO(2Pac): Test if this is an expensive operation to do each time the focused path changes;
    // for example, when user is scrolling with UP/DOWN keyboard arrows through a huge file list.
    if (focusedPath) {
      initialFocusedPath.setValue(focusedPath)
    }
  }, [focusedPath, initialFocusedPath])

  useEffect(() => {
    initialRootFolderId.setValue(rootFolder.id)
  }, [initialRootFolderId, rootFolder.id])

  useEffect(() => {
    return () => dispatch(clearFiles(browserType))
  }, [browserType, dispatch])

  const onRootFolderChange = useCallback(
    (rootId: FileBrowserRootFolderId) => {
      setRootFolder(rootFolders[rootId]!)
    },
    [rootFolders],
  )

  const onBreadcrumbNavigate = useCallback(
    (path: string) => {
      const pathWithoutRoot = path.slice(rootFolder.name.length + 1)
      dispatch(
        changePath(
          browserType,
          pathWithoutRoot ? rootFolder.path + '\\' + pathWithoutRoot : rootFolder.path,
        ),
      )
    },
    [browserType, dispatch, rootFolder.name, rootFolder.path],
  )

  const onUpLevelClick = useCallback(() => {
    if (!fileBrowserPath) {
      return
    }

    const prevPath = getDir(fileBrowserPath)
    dispatch(changePath(browserType, prevPath))
  }, [browserType, dispatch, fileBrowserPath])

  const onFolderClick = useCallback(
    (folder: FileBrowserFolderEntry) => {
      dispatch(changePath(browserType, folder.path))
    },
    [browserType, dispatch],
  )

  const onFileClick = useCallback(
    (file: FileBrowserFileEntry) => {
      const entryConfig = fileTypes[file.extension]
      if (!entryConfig) {
        return
      }
      setFocusedPath(file.path)
      entryConfig.onSelect(file)
    },
    [fileTypes],
  )

  const onRefreshClick = useCallback(() => {
    if (!fileBrowserPath) {
      return
    }

    dispatch(
      getFiles(browserType, fileBrowserPath, rootFolder.path, {
        onSuccess: () => setLoadFilesError(undefined),
        onError: err => setLoadFilesError(err),
      }),
    )
  }, [browserType, dispatch, fileBrowserPath, rootFolder.path])

  const moveFocusedIndexBy = useCallback(
    (delta: number) => {
      if (!entries || focusedIndex < 0) {
        return
      }

      let newIndex = focusedIndex + delta
      if (newIndex < 0) {
        newIndex = 0
      } else if (newIndex > entries.length - 1) {
        newIndex = entries.length - 1
      }

      if (newIndex === focusedIndex) {
        return
      }

      const newFocusedEntry = entries[newIndex]
      if (newFocusedEntry.path !== focusedPath) {
        setFocusedPath(newFocusedEntry.path)
      }

      listRef.current?.scrollToItem(newIndex)
    },
    [entries, focusedIndex, focusedPath],
  )

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (!fileBrowser || !fileBrowser.folders || !fileBrowser.files || !entries) {
        return false
      }

      switch (event.code) {
        case ENTER || ENTER_NUMPAD:
          if (focusedPath === `${fileBrowser.path}\\..`) {
            onUpLevelClick()
            return true
          }
          const focusedFolderEntry = fileBrowser.folders.find(f => f.path === focusedPath)
          if (focusedFolderEntry) {
            onFolderClick(focusedFolderEntry)
            return true
          }
          const focusedFileEntry = fileBrowser.files.find(f => f.path === focusedPath)
          if (focusedFileEntry) {
            onFileClick(focusedFileEntry)
            return true
          }
          return true
        case UP:
          moveFocusedIndexBy(-1)
          return true
        case DOWN:
          moveFocusedIndexBy(1)
          return true
        case PAGEUP:
        case PAGEDOWN:
          if (!listOuterRef.current) {
            return true
          }
          const ENTRIES_SHOWN = Math.floor(listOuterRef.current.clientHeight / ENTRY_HEIGHT)
          // This tries to mimick the way "page up" and "page down" keys work in Windows file
          // explorer
          const delta = event.code === PAGEUP ? -ENTRIES_SHOWN + 1 : ENTRIES_SHOWN - 1
          moveFocusedIndexBy(delta)
          return true
        case HOME:
        case END:
          const newFocusedEntry = event.code === HOME ? entries[0] : entries[entries.length - 1]
          if (!newFocusedEntry || newFocusedEntry.path === focusedPath) {
            return true
          }

          setFocusedPath(newFocusedEntry.path)
          if (event.code === HOME) {
            listRef.current?.scrollTo(0)
          } else if (event.code === END) {
            // TODO(2Pac): Figure out why react-window won't scroll to the bottom of a page when the
            // inner list has padding on top/bottom
            listRef.current?.scrollTo(listOuterRef.current?.scrollHeight ?? 0)
          }
          return true
        case BACKSPACE:
          const isRootFolder = fileBrowser?.path === rootFolder.path
          if (!isRootFolder) {
            onUpLevelClick()
          }
          return true
      }

      return false
    },
  })

  const noRowsRenderer = useCallback(() => {
    if (loadFilesError) {
      return <ErrorText>{loadFilesError.message}</ErrorText>
    } else if (!entries) {
      return <LoadingDotsArea />
    } else {
      return <EmptyText>Nothing to see here</EmptyText>
    }
  }, [entries, loadFilesError])

  const renderRow = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const entry = entries?.[index]
      if (!entry) {
        return <span style={style}></span>
      }

      const styleWithPadding = {
        ...style,
        top: style.top !== undefined ? `${Number(style.top) + VERT_PADDING}px` : style.top,
      }
      const isFocused = entry.path === focusedPath
      if (entry.type === FileBrowserEntryType.Up) {
        return (
          <UpOneDir
            style={styleWithPadding}
            upOneDir={entry}
            onClick={onUpLevelClick}
            isFocused={isFocused}
            key={'up-one-dir'}
          />
        )
      } else if (entry.type === FileBrowserEntryType.Folder) {
        return (
          <FolderEntry
            style={styleWithPadding}
            folder={entry}
            onClick={onFolderClick}
            isFocused={isFocused}
            key={entry.path}
          />
        )
      } else if (entry.type === FileBrowserEntryType.File) {
        const entryConfig = fileTypes[entry.extension]
        return (
          <FileEntry
            style={styleWithPadding}
            file={entry}
            onClick={onFileClick}
            icon={entryConfig ? entryConfig.icon : <span></span>}
            isFocused={isFocused}
            key={entry.path}
          />
        )
      } else {
        return assertUnreachable(entry)
      }
    },
    [entries, fileTypes, focusedPath, onFileClick, onFolderClick, onUpLevelClick],
  )

  const displayedPath = fileBrowserPath
    ? `${rootFolder.name}\\${fileBrowserPath.slice(rootFolder.path.length + 1)}`
    : ''
  const rootFolderOptions = Object.values(rootFolders).map(f => (
    <SelectOption key={f.id} value={f.id} text={f.name} />
  ))

  return (
    <Root ref={focusBrowser} tabIndex={-1}>
      <TopBar>
        <TitleContainer>
          {titleButton ? titleButton : null}
          <Headline5>{title}</Headline5>
        </TitleContainer>
        {Object.values(rootFolders).length > 1 ? (
          <RootFolderSelect value={rootFolder.id} label='Root folder' onChange={onRootFolderChange}>
            {rootFolderOptions}
          </RootFolderSelect>
        ) : null}
        <BreadcrumbsAndActions>
          <StyledPathBreadcrumbs path={displayedPath} onNavigate={onBreadcrumbNavigate} />
          <IconButton icon={<Refresh />} onClick={onRefreshClick} title={'Refresh'} />
        </BreadcrumbsAndActions>
      </TopBar>
      {error ? <ExternalError>{error}</ExternalError> : null}
      <FilesContent ref={dimensionsRef}>
        {entries && entries.length > 0 ? (
          <FixedSizeList
            ref={listRef}
            outerRef={listOuterRef}
            width='100%'
            height={containerRect?.height ?? 0}
            itemCount={entries.length}
            itemSize={ENTRY_HEIGHT}
            innerElementType={innerElementWithMargin}>
            {renderRow}
          </FixedSizeList>
        ) : (
          noRowsRenderer()
        )}
      </FilesContent>
    </Root>
  )
}

const innerElementWithMargin = React.forwardRef<HTMLDivElement, { style: React.CSSProperties }>(
  ({ style, ...rest }, ref) => (
    <div
      ref={ref}
      style={{
        ...style,
        height:
          style.height !== undefined
            ? `${Number(style.height) + VERT_PADDING * 2}px`
            : style.height,
      }}
      {...rest}
    />
  ),
)
