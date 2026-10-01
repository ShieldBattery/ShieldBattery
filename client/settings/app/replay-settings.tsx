import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../../common/ipc'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { IconButton, OutlinedButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodySmall, singleLine, titleSmall } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'
import {
  FormContainer,
  SectionContainer,
  SettingsSectionDescription,
  SettingsSectionHeader,
} from '../settings-content'
import { ReplayNameTemplateEditor } from './replay-name-template-editor'

const ipcRenderer = new TypedIpcRenderer()

/**
 * Removes duplicate folders case-insensitively (Windows paths compare case-insensitively), keeping
 * the first occurrence's original casing.
 */
function dedupeFolders(folders: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const folder of folders) {
    const key = folder.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(folder)
    }
  }
  return result
}

/**
 * The final path segment (folder name) of an absolute path, used as the row's prominent label with
 * the full path shown beneath it. Handles both `\` (Windows) and `/` separators and any trailing
 * separator; falls back to the whole (trimmed) path for something without a separator (e.g. a drive
 * root).
 */
function folderDisplayName(folder: string): string {
  const trimmed = folder.replace(/[/\\]+$/, '')
  return trimmed.replace(/^.*[/\\]/, '') || trimmed
}

const FolderList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const FolderRow = styled.div`
  min-height: 56px;
  padding: 8px 8px 8px 12px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 8px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

const FolderIconTile = styled.div`
  flex-shrink: 0;
  width: 40px;
  height: 40px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
`

const FolderText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
`

const FolderName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const FolderPath = styled.div`
  ${bodySmall};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`

const AddFolderButton = styled(OutlinedButton)`
  align-self: flex-start;
  margin-top: 12px;
`

export function AppReplaySettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)

  // The renderer can't compute the OS documents directory, so the main process resolves the default
  // replay folder for display (and as the picker's starting location when nothing is configured).
  const [defaultFolder, setDefaultFolder] = useState<string | undefined>(undefined)
  useEffect(() => {
    let active = true
    ipcRenderer
      .invoke('settingsGetDefaultReplayFolder')!
      .then(folder => {
        if (active) {
          setDefaultFolder(folder)
        }
      })
      .catch(err => {
        logger.error(`Failed to get the default replay folder: ${err?.stack ?? err}`)
      })
    return () => {
      active = false
    }
  }, [])

  // A user who has never configured folders has `replayLibraryFolders === undefined`; the
  // fallback shows the resolved default folder as the sole, removable entry. Removing it saves
  // `[]` (nothing indexed); adding a folder appends to whichever list is currently showing.
  const configuredFolders =
    localSettings.replayLibraryFolders ?? (defaultFolder !== undefined ? [defaultFolder] : [])

  const saveFolders = (folders: ReadonlyArray<string>) => {
    dispatch(
      mergeLocalSettings(
        { replayLibraryFolders: dedupeFolders(folders) },
        { onSuccess: () => {}, onError: () => {} },
      ),
    )
  }

  const onAddFolderClick = () => {
    Promise.resolve()
      .then(async () => {
        const selection = await ipcRenderer.invoke('settingsBrowseForFolder', {
          title: t('settings.app.replays.addFolderTitle', 'Select a replay folder'),
          defaultPath: configuredFolders[0] ?? defaultFolder,
        })!
        if (selection.canceled || selection.filePaths.length === 0) {
          return
        }
        saveFolders([...configuredFolders, selection.filePaths[0]])
      })
      .catch(err => {
        logger.error(`Failed to browse for a replay folder: ${err?.stack ?? err}`)
      })
  }

  const onRemoveFolder = (folder: string) => {
    // Removing every folder saves `[]`, which persists: nothing is indexed until the user adds a
    // folder again.
    saveFolders(configuredFolders.filter(f => f !== folder))
  }

  const onQuickOpenChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(
      mergeLocalSettings(
        { quickOpenReplays: event.target.checked },
        { onSuccess: () => {}, onError: () => {} },
      ),
    )
  }

  const removeFolderLabel = t('settings.app.replays.removeFolder', 'Remove folder')

  return (
    <FormContainer>
      <SectionContainer>
        <SettingsSectionHeader>
          {t('settings.app.replays.foldersTitle', 'Replay folders')}
        </SettingsSectionHeader>
        <SettingsSectionDescription>
          {t(
            'settings.app.replays.foldersDescription',
            'Folders indexed by your replay library. The default StarCraft replay folder is ' +
              'added automatically. Removing a folder removes its replays from the library, ' +
              'including their bookmarks and playlist entries.',
          )}
        </SettingsSectionDescription>

        <FolderList>
          {configuredFolders.map(folder => (
            <FolderRow key={folder}>
              <FolderIconTile>
                <MaterialIcon icon='folder' />
              </FolderIconTile>
              <FolderText>
                <FolderName title={folder}>{folderDisplayName(folder)}</FolderName>
                <FolderPath title={folder}>{folder}</FolderPath>
              </FolderText>
              <Tooltip text={removeFolderLabel}>
                <IconButton
                  icon={<MaterialIcon icon='delete' />}
                  ariaLabel={removeFolderLabel}
                  onClick={() => onRemoveFolder(folder)}
                />
              </Tooltip>
            </FolderRow>
          ))}
        </FolderList>

        <AddFolderButton
          label={t('settings.app.replays.addFolder', 'Add folder')}
          iconStart={<MaterialIcon icon='add' />}
          onClick={onAddFolderClick}
        />
      </SectionContainer>
      <SectionContainer>
        <ReplayNameTemplateEditor />
      </SectionContainer>
      <SectionContainer>
        <SettingsSectionHeader>
          {t('settings.app.replays.openingTitle', 'Opening replays')}
        </SettingsSectionHeader>
        <CheckBox
          checked={localSettings.quickOpenReplays}
          onChange={onQuickOpenChange}
          label={t(
            'settings.app.replays.quickOpen',
            'Launch replays opened with ShieldBattery immediately without previewing',
          )}
          inputProps={{ tabIndex: 0 }}
        />
      </SectionContainer>
    </FormContainer>
  )
}
