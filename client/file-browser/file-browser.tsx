import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { useVirtuosoScrollFix } from '../dom/virtuoso-scroll-fix'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { JsonLocalStorageValue } from '../local-storage'
import { IconButton } from '../material/button'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { shadow4dp } from '../material/shadows'
import { LoadingDotsArea } from '../progress/dots'
import { usePrevious, useStableCallback } from '../state-hooks'
import { blue800, colorError, colorTextFaint } from '../styles/colors'
import { Headline5, subtitle1 } from '../styles/typography'
import { PathBreadcrumbs } from './file-browser-breadcrumbs'
import { ENTRY_HEIGHT, FileEntry, FolderEntry, UpOneDir } from './file-browser-entries'
import {
  FileBrowserEntry,
  FileBrowserEntryType,
  FileBrowserFileEntry,
  FileBrowserFileEntryConfig,
  FileBrowserFolderEntry,
  FileBrowserRootFolder,
  FileBrowserRootFolderId,
  FileBrowserType,
  FileBrowserUpEntry,
} from './file-browser-types'
import readFolder from './get-files'

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
const SPACE = 'Space'

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

const FilesContent = styled.div`
  flex-grow: 1;
  flex-shrink: 1;
`

const VertPadding = styled.div<{ context?: unknown }>`
  width: 100%;
  height: 8px;
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

const sortByName = (a: FileBrowserEntry, b: FileBrowserEntry) => a.name.localeCompare(b.name)

interface FileBrowserProps {
  browserType: FileBrowserType
  rootFolders: {
    default: FileBrowserRootFolder
  } & {
    [key in Exclude<FileBrowserRootFolderId, 'default'>]?: FileBrowserRootFolder
  }
  title: string
  titleButton?: React.ReactElement
  fileEntryConfig: FileBrowserFileEntryConfig
  sortFunc?: (a: FileBrowserEntry, b: FileBrowserEntry) => number
}

export function FileBrowser({
  browserType,
  rootFolders,
  title = 'Files',
  titleButton,
  fileEntryConfig,
  sortFunc = sortByName,
}: FileBrowserProps) {
  const { t } = useTranslation()
  const [scrollerRef] = useVirtuosoScrollFix()

  const [fileBrowserPath, setFileBrowserPath] = useState('')
  const [upOneDir, setUpOneDir] = useState<FileBrowserUpEntry>()
  const [folders, setFolders] = useState<FileBrowserFolderEntry[]>([])
  const [files, setFiles] = useState<FileBrowserFileEntry[]>([])
  const [expandedFileEntry, setExpandedFileEntry] = useState<string>()

  const [dimensionsRef, containerRect] = useObservedDimensions()
  const [isLoadingFiles, setIsLoadingFiles] = useState(true)
  const [loadFilesError, setLoadFilesError] = useState<Error>()
  const prevIsLoadingFiles = usePrevious(isLoadingFiles)

  const listRef = useRef<VirtuosoHandle>(null)

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
    if (isLoadingFiles || loadFilesError) {
      return []
    }

    const entries: FileBrowserEntry[] = []
    const filteredFiles = files.filter(f => fileEntryConfig.allowedExtensions.includes(f.extension))

    return upOneDir
      ? entries.concat(upOneDir, folders, filteredFiles)
      : entries.concat(folders, filteredFiles)
  }, [fileEntryConfig, files, folders, isLoadingFiles, loadFilesError, upOneDir])

  const focusedIndex = useMemo(() => {
    const hasFocusedIndex = focusedPath && entries.map(i => i.path).includes(focusedPath)
    return hasFocusedIndex ? entries.findIndex(f => f.path === focusedPath) : -1
  }, [entries, focusedPath])

  const rootFolderPath = rootFolder.path
  useEffect(() => {
    // This effect should only change the initial path, to effectively initialize the file browser.
    // All subsequent path changes should be done through user action.
    if (fileBrowserPath) {
      return
    }

    const initialPath =
      focusedPath && focusedPath.toLowerCase().startsWith(rootFolderPath.toLowerCase())
        ? getDir(focusedPath)
        : rootFolderPath

    setFileBrowserPath(initialPath)
  }, [fileBrowserPath, focusedPath, rootFolderPath])

  useEffect(() => {
    // This effect should only scroll to the focused entry when files are freshly loaded. All other
    // scrolling should be done through user action (e.g. keyboard navigation).
    if (prevIsLoadingFiles && !isLoadingFiles && entries.length > 0) {
      if (focusedIndex > -1) {
        listRef.current?.scrollToIndex({ index: focusedIndex, align: 'center' })
      } else {
        // Focus first entry if nothing else is focused. Will be 'Up one directory' entry in all
        // non-root folders. In the root folder it will either be the first folder or a file.
        setFocusedPath(entries[0].path)
      }
    }
  }, [prevIsLoadingFiles, isLoadingFiles, entries, focusedIndex])

  const getFiles = useStableCallback(async () => {
    if (!fileBrowserPath) {
      return
    }

    setIsLoadingFiles(true)
    setLoadFilesError(undefined)

    try {
      const result = await readFolder(fileBrowserPath)

      const isRootFolder = fileBrowserPath === rootFolder.path
      let upOneDir: FileBrowserUpEntry | undefined
      if (!isRootFolder) {
        upOneDir = {
          type: FileBrowserEntryType.Up,
          name: t('fileBrowser.upOneDirectory', 'Up one directory'),
          path: `${fileBrowserPath}\\..`,
        }
      }

      const folders: FileBrowserFolderEntry[] = result
        .filter((e): e is FileBrowserFolderEntry => e.type === FileBrowserEntryType.Folder)
        .sort(sortFunc)
      const files: FileBrowserFileEntry[] = result
        .filter((e): e is FileBrowserFileEntry => e.type === FileBrowserEntryType.File)
        .sort(sortFunc)

      setUpOneDir(upOneDir)
      setFolders(folders)
      setFiles(files)
    } catch (err) {
      setLoadFilesError(err as Error)
    } finally {
      setIsLoadingFiles(false)
    }
  })

  useEffect(() => {
    getFiles()
  }, [fileBrowserPath, getFiles])

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

  const onRootFolderChange = useStableCallback((rootId: FileBrowserRootFolderId) => {
    const rootFolder = rootFolders[rootId]!
    setRootFolder(rootFolder)
    setFileBrowserPath(path =>
      path.toLowerCase().startsWith(rootFolder.path.toLowerCase()) ? path : rootFolder.path,
    )
  })

  const onBreadcrumbNavigate = useStableCallback((path: string) => {
    const pathWithoutRoot = path.slice(rootFolder.name.length + 1)
    setFileBrowserPath(pathWithoutRoot ? rootFolder.path + '\\' + pathWithoutRoot : rootFolder.path)
  })

  const onUpLevelClick = useStableCallback(() => {
    if (!fileBrowserPath) {
      return
    }

    const prevPath = getDir(fileBrowserPath)
    setFileBrowserPath(prevPath)
  })

  const onFolderClick = useStableCallback((folder: FileBrowserFolderEntry) => {
    setFileBrowserPath(folder.path)
  })

  const onFileClick = useStableCallback((file: FileBrowserFileEntry, isKeyboardEvent?: boolean) => {
    setFocusedPath(file.path)

    // In case the file entry has an expansion panel component associated with it we open or close
    // it, otherwise we select the file entry.
    // Also, when executing this callback from a keyboard event (e.g. by pressing Enter), we always
    // select the file entry.
    if (!isKeyboardEvent && fileEntryConfig.ExpansionPanelComponent) {
      const isExpanded = expandedFileEntry === file.path
      setExpandedFileEntry(!isExpanded ? file.path : undefined)
    } else {
      fileEntryConfig.onSelect(file)
    }
  })

  const moveFocusedIndexBy = useStableCallback((delta: number) => {
    if (focusedIndex < 0) {
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

    if (newIndex === 0) {
      listRef.current?.scrollToIndex({ index: 0, align: 'end' })
    } else {
      listRef.current?.scrollIntoView({ index: newIndex })
    }
  })

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (entries.length < 1) {
        return false
      }

      switch (event.code) {
        case ENTER || ENTER_NUMPAD: {
          if (focusedPath === `${fileBrowserPath}\\..`) {
            onUpLevelClick()
            return true
          }
          const focusedFolderEntry = folders.find(f => f.path === focusedPath)
          if (focusedFolderEntry) {
            onFolderClick(focusedFolderEntry)
            return true
          }
          const focusedFileEntry = files.find(f => f.path === focusedPath)
          if (focusedFileEntry) {
            onFileClick(focusedFileEntry, true)
            return true
          }
          return true
        }
        case SPACE:
          const focusedFileEntry = files.find(f => f.path === focusedPath)
          if (focusedFileEntry && fileEntryConfig.ExpansionPanelComponent) {
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
          if (!containerRect) {
            return true
          }
          const ENTRIES_SHOWN = Math.floor(containerRect.height / ENTRY_HEIGHT)
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
            listRef.current?.scrollToIndex({ index: 0, align: 'end' })
          } else if (event.code === END) {
            listRef.current?.scrollToIndex({ index: entries.length, align: 'start' })
          }
          return true
        case BACKSPACE:
          const isRootFolder = fileBrowserPath === rootFolder.path
          if (!isRootFolder) {
            onUpLevelClick()
          }
          return true
      }

      return false
    },
  })

  const renderRow = useStableCallback((index: number) => {
    const entry = entries?.[index]
    if (!entry) {
      return <span></span>
    }

    const isFocused = entry.path === focusedPath
    if (entry.type === FileBrowserEntryType.Up) {
      return (
        <UpOneDir
          upOneDir={entry}
          onClick={onUpLevelClick}
          isFocused={isFocused}
          key={'up-one-dir'}
        />
      )
    } else if (entry.type === FileBrowserEntryType.Folder) {
      return (
        <FolderEntry
          folder={entry}
          onClick={onFolderClick}
          isFocused={isFocused}
          key={entry.path}
        />
      )
    } else if (entry.type === FileBrowserEntryType.File) {
      return (
        <FileEntry
          file={entry}
          fileEntryConfig={fileEntryConfig}
          isFocused={isFocused}
          isExpanded={expandedFileEntry === entry.path}
          onClick={onFileClick}
          key={entry.path}
        />
      )
    } else {
      return assertUnreachable(entry)
    }
  })

  let emptyContent
  if (isLoadingFiles) {
    emptyContent = <LoadingDotsArea />
  } else if (loadFilesError) {
    emptyContent = <ErrorText>{loadFilesError.message}</ErrorText>
  } else {
    emptyContent = <EmptyText>{t('fileBrowser.noFiles', 'Nothing to see here')}</EmptyText>
  }

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
          <RootFolderSelect
            value={rootFolder.id}
            label={t('fileBrowser.rootFolder', 'Root folder')}
            onChange={onRootFolderChange}>
            {rootFolderOptions}
          </RootFolderSelect>
        ) : null}
        <BreadcrumbsAndActions>
          <StyledPathBreadcrumbs path={displayedPath} onNavigate={onBreadcrumbNavigate} />
          <IconButton
            icon={<MaterialIcon icon='refresh' />}
            onClick={getFiles}
            title={t('common.actions.refresh', 'Refresh')}
          />
        </BreadcrumbsAndActions>
      </TopBar>
      <FilesContent ref={dimensionsRef}>
        {entries.length > 0 ? (
          <Virtuoso
            ref={listRef}
            scrollerRef={scrollerRef}
            components={{ Header: VertPadding, Footer: VertPadding }}
            data={entries}
            itemContent={renderRow}
          />
        ) : (
          emptyContent
        )}
      </FilesContent>
    </Root>
  )
}
