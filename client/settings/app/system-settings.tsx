import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  GameServerRegion,
  GameServerRegionId,
  GameServerRegionLatencies,
} from '../../../common/game-server-regions'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import {
  gameServerRegionLatenciesAtom,
  gameServerRegionsAtom,
} from '../../game-server-regions/game-server-regions-atoms'
import { pickAutoRegion } from '../../game-server-regions/region-resolution'
import { isMatchmakingAtom, matchLaunchingAtom } from '../../matchmaking/matchmaking-atoms'
import { CheckBox } from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodySmall } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionContainer, SectionOverline } from '../settings-content'

const IndentedCheckBox = styled(CheckBox)`
  margin-left: 28px;
`

const NetworkOverline = styled(SectionOverline)`
  margin-bottom: 8px;
`

const RegionLockedText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
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
    region: region?.displayName ?? resolved.region,
    rtt: Math.round(resolved.rttMs),
  })
}

function getRegionOptionLabel(
  region: GameServerRegion,
  latencies: GameServerRegionLatencies,
  t: TFunction,
): string {
  const rttMs = latencies[region.id]?.rttMs
  return rttMs === undefined
    ? region.displayName
    : t('settings.app.system.serverRegion.regionWithPing', '{{region}} ({{rtt}}ms)', {
        region: region.displayName,
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
  const inLobby = useAppSelector(s => s.lobby.inLobby)
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

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <SectionContainer>
          <SectionOverline>{t('settings.app.system.filesOverline', 'Files')}</SectionOverline>
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
          <SectionOverline>{t('settings.app.system.startupOverline', 'Startup')}</SectionOverline>
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
            <NetworkOverline>{t('settings.app.system.networkOverline', 'Network')}</NetworkOverline>
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
