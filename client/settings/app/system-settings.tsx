import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  GameServerRegion,
  GameServerRegionId,
  GameServerRegionLatencies,
} from '../../../common/game-server-regions'
import { TypedIpcRenderer } from '../../../common/ipc'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import {
  gameServerRegionLatenciesAtom,
  gameServerRegionsAtom,
} from '../../game-server-regions/game-server-regions-atoms'
import { getRegionDisplayName } from '../../game-server-regions/region-names'
import { pickAutoRegion } from '../../game-server-regions/region-resolution'
import { MaterialIcon } from '../../icons/material/material-icon'
import { isInLobby } from '../../lobbies/lobby-reducer'
import logger from '../../logging/logger'
import { isMatchmakingAtom, matchLaunchingAtom } from '../../matchmaking/matchmaking-atoms'
import { IconButton, OutlinedButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
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

const IndentedCheckBox = styled(CheckBox)`
  margin-left: 28px;
`

const RegionLockedText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

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

/**
 * Sentinel model value for the "Auto" option -- `GameServerRegionId`s are opaque server-provided
 * strings, so an empty string can't collide with a real region id.
 */
const AUTO_REGION_VALUE = ''

function getAutoOptionLabel(
  regions: ReadonlyArray<GameServerRegion>,
  latencies: GameServerRegionLatencies,
  t: TFunction,
): string {
  const resolved = pickAutoRegion(latencies)
  if (!resolved || resolved.rttMs === null) {
    return t('settings.app.system.serverRegion.autoPlain', 'Auto (recommended)')
  }

  const region = regions.find(r => r.id === resolved.region)
  return t('settings.app.system.serverRegion.autoResolved', 'Auto — {{region}} ({{rtt}}ms)', {
    region: region ? getRegionDisplayName(region, t) : resolved.region,
    rtt: Math.round(resolved.rttMs),
  })
}

function getRegionOptionLabel(
  region: GameServerRegion,
  latencies: GameServerRegionLatencies,
  t: TFunction,
): string {
  const rttMs = latencies[region.id]?.rttMs
  const displayName = getRegionDisplayName(region, t)
  return rttMs === undefined
    ? displayName
    : t('settings.app.system.serverRegion.regionWithPing', '{{region}} ({{rtt}}ms)', {
        region: displayName,
        rtt: Math.round(rttMs),
      })
}

interface AppSystemSettingsModel {
  quickOpenReplays: boolean

  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean

  gameServerRegion: string
}

export function AppSystemSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const regions = useAtomValue(gameServerRegionsAtom)
  const latencies = useAtomValue(gameServerRegionLatenciesAtom)
  const isMatchmaking = useAtomValue(isMatchmakingAtom)
  const isMatchLaunching = useAtomValue(matchLaunchingAtom)
  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  // The region a game homes on is chosen when queueing/joining, so changing it mid-activity would
  // have no effect on the game about to launch; lock it while the user is in one of those.
  const regionLocked = isMatchmaking || isMatchLaunching || inLobby

  const { bindCheckable, bindCustom, getInputValue, submit, form } =
    useForm<AppSystemSettingsModel>(
      {
        quickOpenReplays: localSettings.quickOpenReplays,
        runAppAtSystemStart: localSettings.runAppAtSystemStart,
        runAppAtSystemStartMinimized: localSettings.runAppAtSystemStartMinimized,
        gameServerRegion:
          localSettings.gameServerRegion !== undefined &&
          regions.some(r => r.id === localSettings.gameServerRegion)
            ? localSettings.gameServerRegion
            : AUTO_REGION_VALUE,
      },
      {},
    )

  useFormCallbacks(form, {
    onValidatedChange: model => {
      dispatch(
        mergeLocalSettings(
          {
            quickOpenReplays: model.quickOpenReplays,
            runAppAtSystemStart: model.runAppAtSystemStart,
            runAppAtSystemStartMinimized: model.runAppAtSystemStartMinimized,
            gameServerRegion:
              model.gameServerRegion === AUTO_REGION_VALUE
                ? undefined
                : (model.gameServerRegion as GameServerRegionId),
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )
    },
  })

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

  // The replay folders live outside the form model: they persist immediately on add/remove rather
  // than being bound to a field that saves on change.
  //
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
          title: t('settings.app.system.addReplayFolderTitle', 'Select a replay folder'),
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

  const removeFolderLabel = t('settings.app.system.removeReplayFolder', 'Remove folder')

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.filesOverline', 'Files')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('quickOpenReplays')}
            label={t(
              'settings.app.system.replayQuickOpen',
              'Launch replays opened with ShieldBattery immediately without previewing',
            )}
            inputProps={{ tabIndex: 0 }}
          />
        </SectionContainer>

        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.replayFoldersTitle', 'Replay folders')}
          </SettingsSectionHeader>
          <SettingsSectionDescription>
            {t(
              'settings.app.system.replayFoldersDescription',
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
            label={t('settings.app.system.addReplayFolder', 'Add folder')}
            iconStart={<MaterialIcon icon='add' />}
            onClick={onAddFolderClick}
          />
        </SectionContainer>
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.startupOverline', 'Startup')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('runAppAtSystemStart')}
            label={t('settings.app.system.runOnStartup', 'Run ShieldBattery on system startup')}
            inputProps={{ tabIndex: 0 }}
          />
          <IndentedCheckBox
            {...bindCheckable('runAppAtSystemStartMinimized')}
            label={t('settings.app.system.startMinimized', 'Start minimized')}
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('runAppAtSystemStart')}
          />
        </SectionContainer>
        {regions.length > 0 ? (
          <SectionContainer>
            <SettingsSectionHeader>
              {t('settings.app.system.networkOverline', 'Network')}
            </SettingsSectionHeader>
            <Select
              {...bindCustom('gameServerRegion')}
              label={t('settings.app.system.serverRegion.label', 'Server region')}
              disabled={regionLocked}
              tabIndex={0}>
              <SelectOption
                value={AUTO_REGION_VALUE}
                text={getAutoOptionLabel(regions, latencies, t)}
              />
              {regions.map(region => (
                <SelectOption
                  key={region.id}
                  value={region.id}
                  text={getRegionOptionLabel(region, latencies, t)}
                />
              ))}
            </Select>
            {regionLocked ? (
              <RegionLockedText>
                {t(
                  'settings.app.system.serverRegion.locked',
                  'Locked while in a lobby or matchmaking.',
                )}
              </RegionLockedText>
            ) : null}
          </SectionContainer>
        ) : null}
      </FormContainer>
    </form>
  )
}
