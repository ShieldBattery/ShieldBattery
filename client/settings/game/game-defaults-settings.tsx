import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  GameDefaultsPresetKey,
  getGameDefaultsMismatches,
  getGameDefaultsPresetLabel,
} from '../../../common/settings/game-defaults'
import {
  ALL_GAME_DEFAULTS_PRESETS,
  GameDefaultsPreset,
  getStartingFogLabel,
  StartingFog,
  TeamColorPreset,
} from '../../../common/settings/local-settings'
import { getTeamColorPresetLabel } from '../../../common/settings/team-colors'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { OutlinedButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { standardEasing } from '../../material/curve-constants'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyMedium, bodySmall, labelMedium, titleMedium } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionContainer, SettingsSectionDescription } from '../settings-content'
import { GameDefaultsRadio } from './game-defaults-radio'

const ARROW_KEY_DELTAS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

const TABLE_COLUMNS = '1.3fr 1fr 1fr 1fr'

const PresetCards = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
`

const PresetCard = styled.button<{ $selected: boolean }>`
  ${buttonReset};

  padding: 12px 16px;

  display: flex;
  flex-direction: column;
  gap: 4px;

  background-color: ${props =>
    props.$selected ? 'rgb(from var(--color-blue60) r g b / 0.14)' : 'var(--theme-container-high)'};
  border: 2px solid ${props => (props.$selected ? 'var(--color-blue60)' : 'transparent')};
  border-radius: 6px;
  text-align: left;
  transition:
    background-color 150ms ${standardEasing},
    border-color 150ms ${standardEasing};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'rgb(from var(--color-blue60) r g b / 0.14)'
        : 'var(--theme-container-highest)'};
  }
`

const PresetCardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const PresetCardName = styled.div`
  ${titleMedium};
  flex-grow: 1;
`

const PresetCardDescription = styled.div`
  ${bodyMedium};

  color: var(--theme-on-surface-variant);
`

const TableHeader = styled.div`
  display: grid;
  grid-template-columns: ${TABLE_COLUMNS};
  column-gap: 16px;
  align-items: center;
  padding: 0 12px;
  margin-bottom: 4px;
`

const TableHeaderCell = styled.div<{ $highlighted?: boolean }>`
  ${labelMedium};

  color: ${props =>
    props.$highlighted ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)'};
  transition: color 150ms linear;
`

/* Indented past the mismatch dot the values below it carry, so the column reads as one edge. */
const TableHeaderValueCell = styled(TableHeaderCell)`
  padding-left: 14px;

  color: var(--theme-on-surface);
`

const TableRows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const TableRow = styled.div`
  display: grid;
  grid-template-columns: ${TABLE_COLUMNS};
  column-gap: 16px;
  align-items: center;
  padding: 8px 12px;

  background-color: var(--theme-container-low);
  border-radius: 4px;
`

const SettingName = styled.div`
  ${bodyMedium};
`

const SettingPage = styled.div`
  ${bodySmall};

  color: var(--theme-on-surface-variant);
`

const ValueCell = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 8px;
`

const PresetValueCell = styled.div`
  ${bodyMedium};

  color: var(--theme-on-surface-variant);
`

const MismatchDot = styled.div<{ $mismatched: boolean }>`
  width: 6px;
  height: 6px;
  flex-shrink: 0;

  background-color: ${props => (props.$mismatched ? 'var(--theme-amber)' : 'transparent')};
  border-radius: 50%;
  transition: background-color 150ms linear;
`

const TableFooter = styled.div`
  margin-top: 12px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const TableCaption = styled.div`
  ${bodySmall};

  color: var(--theme-on-surface-variant);
`

/**
 * Lets the user change which set of values ShieldBattery's own gameplay settings start on, and
 * shows how their current values compare against each preset.
 */
export function GameDefaultsSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const cardRefs = useRef(new Map<GameDefaultsPreset, HTMLButtonElement | null>())

  const selectedPreset = localSettings.gameDefaultsPreset ?? GameDefaultsPreset.Recommended
  const mismatches = new Set<GameDefaultsPresetKey>(
    getGameDefaultsMismatches(localSettings, selectedPreset),
  )

  const onSelectPreset = (preset: GameDefaultsPreset) => {
    if (preset === selectedPreset) {
      return
    }

    dispatch(
      mergeLocalSettings(
        { gameDefaultsPreset: preset },
        { onSuccess: () => {}, onError: () => {} },
      ),
    )
    if (getGameDefaultsMismatches(localSettings, preset).length > 0) {
      dispatch(
        openDialog({
          type: DialogType.GameDefaultsApply,
          initData: { preset, justSwitched: true },
        }),
      )
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = ARROW_KEY_DELTAS[event.key]
    if (delta === undefined) {
      return
    }

    event.preventDefault()
    const count = ALL_GAME_DEFAULTS_PRESETS.length
    const next =
      ALL_GAME_DEFAULTS_PRESETS[
        (ALL_GAME_DEFAULTS_PRESETS.indexOf(selectedPreset) + delta + count) % count
      ]
    cardRefs.current.get(next)?.focus()
    onSelectPreset(next)
  }

  const gameplayPage = t('settings.game.gameplay.title', 'Gameplay')
  const inputPage = t('settings.game.input.title', 'Input')
  const consistentCursors = t('settings.game.defaults.table.cursorConsistent', 'Consistent')
  const perCursorSizing = t('settings.game.defaults.table.cursorPerCursor', 'Per-cursor')
  const adjustablePan = t('settings.game.defaults.table.dragPanAdjustable', 'Adjustable')
  const fixedPan = t('settings.game.defaults.table.dragPanFixed', 'Fixed')

  const rows: Array<{
    key: GameDefaultsPresetKey
    name: string
    page: string
    yourValue: string
    recommendedValue: string
    legacyValue: string
  }> = [
    {
      key: 'startingFog',
      name: t('settings.game.defaults.table.startingFog', 'Starting fog'),
      page: gameplayPage,
      yourValue: getStartingFogLabel(localSettings.startingFog, t),
      recommendedValue: getStartingFogLabel(StartingFog.ShowTerrainAndResources, t),
      legacyValue: getStartingFogLabel(StartingFog.Legacy, t),
    },
    {
      key: 'legacyCursorSizing',
      name: t('settings.game.defaults.table.cursorSizing', 'Cursor sizing'),
      page: inputPage,
      yourValue: localSettings.legacyCursorSizing ? perCursorSizing : consistentCursors,
      recommendedValue: consistentCursors,
      legacyValue: perCursorSizing,
    },
    {
      key: 'teamColorPreset',
      name: t('settings.game.defaults.table.teamColorPreset', 'Team color preset'),
      page: gameplayPage,
      yourValue: getTeamColorPresetLabel(localSettings.teamColorPreset, t),
      recommendedValue: getTeamColorPresetLabel(TeamColorPreset.CoolVsWarm, t),
      legacyValue: getTeamColorPresetLabel(TeamColorPreset.LegacyDiplomacy, t),
    },
    {
      key: 'grabPanSensitivityOn',
      name: t('settings.game.defaults.table.dragPanSensitivity', 'Drag pan sensitivity'),
      page: inputPage,
      yourValue: localSettings.grabPanSensitivityOn ? adjustablePan : fixedPan,
      recommendedValue: adjustablePan,
      legacyValue: fixedPan,
    },
  ]

  const presetDescriptions: Readonly<Record<GameDefaultsPreset, string>> = {
    [GameDefaultsPreset.Recommended]: t(
      'settings.game.defaults.recommendedDescription',
      "ShieldBattery's tuned defaults.",
    ),
    [GameDefaultsPreset.Legacy]: t(
      'settings.game.defaults.legacyDescription',
      'Matches Battle.net.',
    ),
  }

  return (
    <FormContainer>
      <SectionContainer>
        <SettingsSectionDescription>
          {t(
            'settings.game.defaults.intro',
            "The preset decides which values ShieldBattery's own gameplay settings start on. It " +
              'also picks the default for anything added later.',
          )}
        </SettingsSectionDescription>

        <PresetCards
          role='radiogroup'
          aria-label={t('settings.game.defaults.presetLabel', 'Game defaults preset')}
          onKeyDown={onKeyDown}>
          {ALL_GAME_DEFAULTS_PRESETS.map(preset => (
            <PresetCard
              key={preset}
              ref={elem => {
                cardRefs.current.set(preset, elem)
              }}
              type='button'
              role='radio'
              aria-checked={selectedPreset === preset}
              tabIndex={selectedPreset === preset ? 0 : -1}
              $selected={selectedPreset === preset}
              onClick={() => onSelectPreset(preset)}>
              <PresetCardHeader>
                <PresetCardName>{getGameDefaultsPresetLabel(preset, t)}</PresetCardName>
                <GameDefaultsRadio selected={selectedPreset === preset} />
              </PresetCardHeader>
              <PresetCardDescription>{presetDescriptions[preset]}</PresetCardDescription>
            </PresetCard>
          ))}
        </PresetCards>

        <TableHeader>
          <TableHeaderCell>{t('settings.game.defaults.table.setting', 'Setting')}</TableHeaderCell>
          <TableHeaderValueCell>
            {t('settings.game.defaults.table.yourValue', 'Your value')}
          </TableHeaderValueCell>
          <TableHeaderCell $highlighted={selectedPreset === GameDefaultsPreset.Recommended}>
            {getGameDefaultsPresetLabel(GameDefaultsPreset.Recommended, t)}
          </TableHeaderCell>
          <TableHeaderCell $highlighted={selectedPreset === GameDefaultsPreset.Legacy}>
            {getGameDefaultsPresetLabel(GameDefaultsPreset.Legacy, t)}
          </TableHeaderCell>
        </TableHeader>

        <TableRows>
          {rows.map(row => (
            <TableRow key={row.key}>
              <div>
                <SettingName>{row.name}</SettingName>
                <SettingPage>{row.page}</SettingPage>
              </div>
              <ValueCell>
                <MismatchDot $mismatched={mismatches.has(row.key)} />
                <span>{row.yourValue}</span>
              </ValueCell>
              <PresetValueCell>{row.recommendedValue}</PresetValueCell>
              <PresetValueCell>{row.legacyValue}</PresetValueCell>
            </TableRow>
          ))}
        </TableRows>

        <TableFooter>
          <TableCaption>
            {t(
              'settings.game.defaults.table.caption',
              'Amber dot: your value differs from the selected preset.',
            )}
          </TableCaption>
          <OutlinedButton
            label={t('settings.game.defaults.resetToPreset', 'Reset to preset')}
            disabled={mismatches.size === 0}
            onClick={() =>
              dispatch(
                openDialog({
                  type: DialogType.GameDefaultsApply,
                  initData: { preset: selectedPreset, justSwitched: false },
                }),
              )
            }
            testName='game-defaults-reset-to-preset'
          />
        </TableFooter>
      </SectionContainer>
    </FormContainer>
  )
}
