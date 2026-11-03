import { TFunction } from 'i18next'
import { isEqual } from 'lodash-es'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { getErrorStack } from '../../../common/errors'
import { TypedIpcRenderer } from '../../../common/ipc'
import {
  BATTLE_NET_FEEL_VALUES,
  BattleNetFeelKey,
  getBattleNetFeelMismatches,
} from '../../../common/settings/game-defaults'
import {
  BlizzardScrSettings,
  FramePacing,
  LocalSettings,
} from '../../../common/settings/local-settings'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { MaterialIcon } from '../../icons/material/material-icon'
import logger from '../../logging/logger'
import { FilledButton } from '../../material/button'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyLarge, bodyMedium, titleMedium } from '../../styles/typography'
import { FormContainer, SectionContainer, SettingsSectionDescription } from '../settings-content'
import { GameSettingsPage } from '../settings-page'
import {
  ALL_SCR_SETTING_KEYS,
  formatScrSetting,
  getScrSettingLabel,
  getScrSettingPage,
} from './scr-setting-labels'
import {
  SettingName,
  SettingPage,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TableRows,
} from './settings-table'

const ipcRenderer = new TypedIpcRenderer()

const TABLE_COLUMNS = '1.3fr 1fr 1fr'

const Actions = styled.div`
  margin-top: 24px;

  display: flex;
  justify-content: center;
`

const ComparisonSection = styled.div`
  margin-top: 32px;
`

const SectionTitle = styled.div`
  ${titleMedium};
`

const DifferenceSummary = styled.div`
  ${bodyLarge};
  margin: 4px 0 16px;
`

const ValueCell = styled.div`
  ${bodyMedium};
`

const MatchCard = styled.div`
  padding: 32px 24px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;

  background-color: var(--theme-container-low);
  border-radius: 6px;
`

const MatchIcon = styled(MaterialIcon).attrs({ icon: 'check_circle', size: 40 })`
  color: var(--theme-success);
`

const MatchMessage = styled.div`
  ${titleMedium};
`

/**
 * Compares ShieldBattery's copy of the StarCraft settings with the values in Battle.net's own
 * settings file, and offers to replace ShieldBattery's values with Battle.net's.
 */
export function BattleNetSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const scrSettings = useAppSelector(s => s.settings.scr)
  const localSettings = useAppSelector(s => s.settings.local)
  const [blizzard, setBlizzard] = useState<BlizzardScrSettings | undefined>()

  // Copying from Battle.net replaces the settings in the store, so this re-reads the file
  // afterwards too, keeping the comparison current.
  useEffect(() => {
    let canceled = false
    ipcRenderer
      .invoke('settingsScrGetBlizzard')
      ?.then(result => {
        if (!canceled) {
          setBlizzard(result)
        }
      })
      .catch(err => {
        logger.error('Error reading Battle.net settings: ' + getErrorStack(err))
        if (!canceled) {
          setBlizzard({ found: false })
        }
      })

    return () => {
      canceled = true
    }
  }, [scrSettings])

  if (!blizzard) {
    return null
  }

  if (!blizzard.found) {
    return (
      <FormContainer>
        <SectionContainer>
          <SettingsSectionDescription>
            {t(
              'settings.game.battleNet.notFound',
              "ShieldBattery couldn't read the Battle.net settings file. Launching StarCraft from " +
                'Battle.net once creates it.',
            )}
          </SettingsSectionDescription>
        </SectionContainer>
      </FormContainer>
    )
  }

  const pageNames: Readonly<Record<GameSettingsPage, string>> = {
    [GameSettingsPage.StarCraft]: t('settings.game.starcraft.title', 'StarCraft'),
    [GameSettingsPage.Input]: t('settings.game.input.title', 'Input'),
    [GameSettingsPage.Sound]: t('settings.game.sound.title', 'Sound'),
    [GameSettingsPage.Video]: t('settings.game.video.title', 'Video'),
    [GameSettingsPage.Gameplay]: t('settings.game.gameplay.title', 'Gameplay'),
    [GameSettingsPage.Network]: t('settings.game.network.title', 'Network'),
    [GameSettingsPage.Defaults]: t('settings.game.defaults.title', 'Defaults'),
    [GameSettingsPage.BattleNet]: t('settings.game.battleNet.title', 'Battle.net'),
  }

  // Keys missing from Battle.net's file aren't differences, since there's nothing to copy for them.
  const settingRows = ALL_SCR_SETTING_KEYS.flatMap(key => {
    const blizzardValue = blizzard.settings[key]
    return blizzardValue !== undefined && !isEqual(blizzardValue, scrSettings[key])
      ? [
          {
            key,
            name: getScrSettingLabel(key, t),
            page: pageNames[getScrSettingPage(key)],
            shieldBattery: formatScrSetting(key, scrSettings[key], t),
            battleNet: formatScrSetting(key, blizzardValue, t),
          },
        ]
      : []
  })
  const featureRows = getBattleNetFeelMismatches(localSettings).map(key => {
    const { name, page, format } = getFeelSettingInfo(key, t)
    return {
      key,
      name,
      page: pageNames[page],
      shieldBattery: format(localSettings[key]),
      battleNet: format(BATTLE_NET_FEEL_VALUES[key]),
    }
  })

  return (
    <FormContainer>
      <SectionContainer>
        <SettingsSectionDescription>
          {t(
            'settings.game.battleNet.intro',
            'ShieldBattery keeps its own copy of your StarCraft settings, so changes made through ' +
              "Battle.net don't carry over.",
          )}
        </SettingsSectionDescription>

        {settingRows.length > 0 ? (
          <ComparisonSection>
            <SectionTitle>
              {t('settings.game.battleNet.settingsTitle', 'StarCraft settings')}
            </SectionTitle>
            <DifferenceSummary>
              {t('settings.game.battleNet.differenceSummary', {
                defaultValue:
                  '{{count}} settings differ from Battle.net. Settings that already match ' +
                  "aren't listed.",
                defaultValue_one:
                  '{{count}} setting differs from Battle.net. Settings that already match ' +
                  "aren't listed.",
                count: settingRows.length,
              })}
            </DifferenceSummary>
            <ComparisonTable rows={settingRows} />
          </ComparisonSection>
        ) : null}

        {featureRows.length > 0 ? (
          <ComparisonSection>
            <SectionTitle>
              {t('settings.game.battleNet.featuresTitle', 'ShieldBattery features')}
            </SectionTitle>
            <DifferenceSummary>
              {t('settings.game.battleNet.featureSummary', {
                defaultValue:
                  '{{count}} ShieldBattery features make the game feel different from Battle.net.',
                defaultValue_one:
                  '{{count}} ShieldBattery feature makes the game feel different from Battle.net.',
                count: featureRows.length,
              })}
            </DifferenceSummary>
            <ComparisonTable rows={featureRows} />
          </ComparisonSection>
        ) : null}

        {settingRows.length === 0 && featureRows.length === 0 ? (
          <MatchCard>
            <MatchIcon />
            <MatchMessage>
              {t('settings.game.battleNet.matches', 'Your settings match Battle.net.')}
            </MatchMessage>
          </MatchCard>
        ) : null}

        <Actions>
          <FilledButton
            label={t('settings.game.battleNet.copyButton', 'Copy from Battle.net')}
            disabled={settingRows.length === 0 && featureRows.length === 0}
            onClick={() =>
              dispatch(
                openDialog({
                  type: DialogType.BattleNetSettingsCopy,
                  initData: { settingCount: settingRows.length, featureCount: featureRows.length },
                }),
              )
            }
            testName='battle-net-copy-button'
          />
        </Actions>
      </SectionContainer>
    </FormContainer>
  )
}

interface ComparisonRow {
  key: string
  name: string
  page: string
  shieldBattery: string
  battleNet: string
}

function ComparisonTable({ rows }: { rows: ReadonlyArray<ComparisonRow> }) {
  const { t } = useTranslation()
  return (
    <>
      <TableHeader $columns={TABLE_COLUMNS}>
        <TableHeaderCell>{t('settings.game.battleNet.table.setting', 'Setting')}</TableHeaderCell>
        <TableHeaderCell>
          {t('settings.game.battleNet.table.shieldBattery', 'ShieldBattery')}
        </TableHeaderCell>
        <TableHeaderCell>
          {t('settings.game.battleNet.table.battleNet', 'Battle.net')}
        </TableHeaderCell>
      </TableHeader>
      <TableRows>
        {rows.map(row => (
          <TableRow key={row.key} $columns={TABLE_COLUMNS}>
            <div>
              <SettingName>{row.name}</SettingName>
              <SettingPage>{row.page}</SettingPage>
            </div>
            <ValueCell>{row.shieldBattery}</ValueCell>
            <ValueCell>{row.battleNet}</ValueCell>
          </TableRow>
        ))}
      </TableRows>
    </>
  )
}

/** How a ShieldBattery feature setting is named and shown, matching the page it's changed on. */
function getFeelSettingInfo<K extends BattleNetFeelKey>(
  key: K,
  t: TFunction,
): { name: string; page: GameSettingsPage; format: (value: LocalSettings[K]) => string } {
  // Each case's `format` takes the value type of its own key, which TS can't narrow `K` to.
  const info = (() => {
    switch (key as BattleNetFeelKey) {
      case 'framePacing':
        return {
          name: t('settings.game.video.framePacing.title', 'Frame pacing'),
          page: GameSettingsPage.Video,
          format: (value: FramePacing) => {
            switch (value) {
              case FramePacing.Off:
                return t('settings.game.video.framePacing.off.title', 'Off')
              case FramePacing.Display:
                return t('settings.game.video.framePacing.match.title', 'Match refresh')
              case FramePacing.VariableRefresh:
                return t(
                  'settings.game.video.framePacing.variableRefresh.title',
                  'Variable refresh',
                )
              default:
                return assertUnreachable(value)
            }
          },
        }
      case 'grabPanSensitivityOn':
        return {
          name: t('settings.game.defaults.table.dragPanSensitivity', 'Drag pan sensitivity'),
          page: GameSettingsPage.Input,
          format: (value: boolean) =>
            value
              ? t('settings.game.defaults.table.dragPanAdjustable', 'Adjustable')
              : t('settings.game.defaults.table.dragPanFixed', 'Fixed'),
        }
      case 'useCustomCursorSize':
        return {
          name: t('settings.game.battleNet.customCursorSize', 'Custom cursor size'),
          page: GameSettingsPage.Input,
          format: (value: boolean) =>
            value
              ? t('material.segmentedButton.on', 'On')
              : t('material.segmentedButton.off', 'Off'),
        }
      case 'legacyCursorSizing':
        return {
          name: t('settings.game.defaults.table.cursorSizing', 'Cursor sizing'),
          page: GameSettingsPage.Input,
          format: (value: boolean) =>
            value
              ? t('settings.game.defaults.table.cursorPerCursor', 'Per-cursor')
              : t('settings.game.defaults.table.cursorConsistent', 'Consistent'),
        }
      default:
        return assertUnreachable(key as never)
    }
  })()
  return info as {
    name: string
    page: GameSettingsPage
    format: (value: LocalSettings[K]) => string
  }
}
