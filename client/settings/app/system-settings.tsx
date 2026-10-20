import { TFunction } from 'i18next'
import { useAtomValue } from 'jotai'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  GameServerRegion,
  GameServerRegionId,
  GameServerRegionLatencies,
} from '../../../common/game-server-regions'
import { DEFAULT_LOCAL_SETTINGS } from '../../../common/settings/default-settings'
import { MAX_ROLLBACK_TARGET } from '../../../common/settings/local-settings'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import {
  gameServerRegionLatenciesAtom,
  gameServerRegionsAtom,
} from '../../game-server-regions/game-server-regions-atoms'
import { getRegionDisplayName } from '../../game-server-regions/region-names'
import { pickAutoRegion } from '../../game-server-regions/region-resolution'
import { MaterialIcon } from '../../icons/material/material-icon'
import { isInLobby } from '../../lobbies/lobby-reducer'
import { isMatchmakingAtom, matchLaunchingAtom } from '../../matchmaking/matchmaking-atoms'
import { CheckBox } from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { Slider, sliderPosition } from '../../material/slider'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyMedium, bodySmall, labelMedium, titleSmall } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionContainer, SettingsSectionHeader } from '../settings-content'

const IndentedCheckBox = styled(CheckBox)`
  margin-left: 28px;
`

const RegionLockedText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const RECOMMENDED_ROLLBACK_TARGET = DEFAULT_LOCAL_SETTINGS.rollbackTarget

const RollbackTarget = styled.div`
  margin-top: 16px;
  display: flex;
  flex-direction: column;
`

const RollbackTargetTitle = styled.div`
  ${titleSmall};
  margin-bottom: 4px;
`

const RollbackTargetDescription = styled.div`
  ${bodyMedium};
  max-width: 560px;
  margin-bottom: 12px;
  color: var(--theme-on-surface-variant);
`

const RollbackTargetScale = styled.div`
  ${labelMedium};
  position: relative;
  height: 16px;
  margin-top: 2px;
  color: var(--color-grey-blue80);
`

const InputDelaySetting = styled.div`
  margin-top: 32px;
  display: flex;
  align-items: center;
  gap: 4px;
`

const InfoIcon = styled.span`
  display: flex;
  color: var(--theme-on-surface-variant);
`

const ScaleEnd = styled.span<{ $end: 'start' | 'end' }>`
  position: absolute;
  ${props => (props.$end === 'start' ? 'left: 0;' : 'right: 0;')}
`

const ScaleRecommended = styled.span<{ $selected: boolean }>`
  position: absolute;
  left: ${sliderPosition(RECOMMENDED_ROLLBACK_TARGET / MAX_ROLLBACK_TARGET)};
  transform: translateX(-50%);
  color: ${props => (props.$selected ? 'var(--theme-amber)' : 'inherit')};
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
  const resolved = pickAutoRegion(regions, latencies)
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
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
  quitOnClose: boolean

  gameServerRegion: string
  rollbackTarget: number
  emulateTurnRate24Delay: boolean
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

  const rollbackTitleId = useId()
  const rollbackDescriptionId = useId()

  const { bindCheckable, bindCustom, getInputValue, submit, form } =
    useForm<AppSystemSettingsModel>(
      {
        runAppAtSystemStart: localSettings.runAppAtSystemStart,
        runAppAtSystemStartMinimized: localSettings.runAppAtSystemStartMinimized,
        quitOnClose: localSettings.quitOnClose,
        gameServerRegion:
          localSettings.gameServerRegion !== undefined &&
          regions.some(r => r.id === localSettings.gameServerRegion)
            ? localSettings.gameServerRegion
            : AUTO_REGION_VALUE,
        rollbackTarget: localSettings.rollbackTarget,
        emulateTurnRate24Delay: localSettings.emulateTurnRate24Delay,
      },
      {},
    )

  const isRollbackRecommended = getInputValue('rollbackTarget') === RECOMMENDED_ROLLBACK_TARGET

  useFormCallbacks(form, {
    onValidatedChange: model => {
      dispatch(
        mergeLocalSettings(
          {
            runAppAtSystemStart: model.runAppAtSystemStart,
            runAppAtSystemStartMinimized: model.runAppAtSystemStartMinimized,
            quitOnClose: model.quitOnClose,
            gameServerRegion:
              model.gameServerRegion === AUTO_REGION_VALUE
                ? undefined
                : (model.gameServerRegion as GameServerRegionId),
            rollbackTarget: model.rollbackTarget,
            emulateTurnRate24Delay: model.emulateTurnRate24Delay,
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
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.closingOverline', 'Closing')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('quitOnClose')}
            label={t(
              'settings.app.system.quitOnClose',
              'Quit ShieldBattery when closing the window',
            )}
            inputProps={{ tabIndex: 0 }}
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
            <RollbackTarget>
              <RollbackTargetTitle id={rollbackTitleId}>
                {t('settings.app.system.rollbackTarget.label', 'Rollback balance')}
              </RollbackTargetTitle>
              <RollbackTargetDescription id={rollbackDescriptionId}>
                {t(
                  'settings.app.system.rollbackTarget.description',
                  'Higher values make your commands more responsive, but units may visibly jump ' +
                    'more often.',
                )}
              </RollbackTargetDescription>
              <Slider
                {...bindCustom('rollbackTarget')}
                ariaLabelledBy={rollbackTitleId}
                ariaDescribedBy={rollbackDescriptionId}
                formatValueText={value =>
                  value === RECOMMENDED_ROLLBACK_TARGET
                    ? t('settings.app.system.rollbackTarget.recommendedValue', {
                        defaultValue: '{{value}}, recommended',
                        value,
                      })
                    : String(value)
                }
                tabIndex={0}
                min={0}
                max={MAX_ROLLBACK_TARGET}
                step={1}
              />
              <RollbackTargetScale aria-hidden={true}>
                <ScaleEnd $end='start'>
                  {t('settings.app.system.rollbackTarget.smoother', 'Smoother')}
                </ScaleEnd>
                <ScaleRecommended $selected={isRollbackRecommended}>
                  {t('settings.app.system.rollbackTarget.recommended', 'Recommended')}
                </ScaleRecommended>
                <ScaleEnd $end='end'>
                  {t('settings.app.system.rollbackTarget.responsive', 'More responsive')}
                </ScaleEnd>
              </RollbackTargetScale>
            </RollbackTarget>
            <InputDelaySetting>
              <CheckBox
                {...bindCheckable('emulateTurnRate24Delay')}
                label={t(
                  'settings.app.system.emulateTurnRate24Delay.label',
                  'Add input delay to match TR24 Low',
                )}
                inputProps={{ tabIndex: 0 }}
              />
              <Tooltip
                text={t(
                  'settings.app.system.emulateTurnRate24Delay.description',
                  'Your commands always take at least 2 frames to happen, even when your ' +
                    'connection is fast enough for less. This only changes your own game.',
                )}
                position='right'>
                <InfoIcon>
                  <MaterialIcon icon='info' size={18} />
                </InfoIcon>
              </Tooltip>
            </InputDelaySetting>
          </SectionContainer>
        ) : null}
      </FormContainer>
    </form>
  )
}
