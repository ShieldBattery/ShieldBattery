import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  ALL_FFA_COLOR_PRESETS,
  ALL_MINIMAP_COLOR_MODES,
  ALL_TEAM_COLOR_PRESETS,
  ALL_TEAM_COLOR_USAGES,
  CustomTeamColors,
  FfaColorPreset,
  getMinimapColorModeLabel,
  MinimapColorMode,
  TeamColorPreset,
  TeamColorUsage,
} from '../../../common/settings/local-settings'
import {
  cloneCustomTeamColors,
  FFA_COLOR_PRESETS,
  getFfaColorPresetAttribution,
  getFfaColorPresetLabel,
  getTeamColorPresetLabel,
  getTeamColorUsageLabel,
  MAX_FFA_COLORS,
  MAX_TEAM_POOL_COLORS,
  MIN_FFA_COLORS,
  resolveFfaColors,
  resolveTeamColors,
  SC_COLORS,
  TEAM_COLOR_PRESETS,
} from '../../../common/settings/team-colors'
import { MaterialIcon } from '../../icons/material/material-icon'
import { OutlinedButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { Card } from '../../material/card'
import { CheckBox } from '../../material/check-box'
import { ColorPickerSwatch, getColorLabel, nextUnusedColor } from '../../material/color-picker'
import { ColorPoolEditor } from '../../material/color-pool-editor'
import { EditableColorSwatch } from '../../material/editable-color-swatch'
import { MenuItem } from '../../material/menu/item'
import { MenuList } from '../../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../../material/popover'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { ExternalLink } from '../../navigation/external-link'
import { bodySmall, labelMedium, labelSmall, titleSmall } from '../../styles/typography'
import { DEFAULT_TILESET, PreviewRow, TeamColorPreview, TilesetId } from './team-color-preview'

// Preview roster flavor. Untranslated on purpose -- these are mock player names, not UI copy.
const ALLY_NAMES = ['hydra_dance', 'NotAProxy', 'VultureMines'] as const
const ENEMY_NAMES = ['4PoolAndPray', 'GuyInTheChat', 'StimAbuser', 'ProbeUnion'] as const
const FFA_NAMES = [
  'You',
  'hydra_dance',
  '4PoolAndPray',
  'VultureMines',
  'GuyInTheChat',
  'NotAProxy',
  'StimAbuser',
  'ProbeUnion',
] as const

const DEFAULT_FFA_SELF_COLOR = '#00E4FC'

const SC_SWATCHES: ReadonlyArray<ColorPickerSwatch> = SC_COLORS.map(c => ({
  color: c.hex,
  label: c.name,
}))

const BUILTIN_TEAM_PRESETS = ALL_TEAM_COLOR_PRESETS.filter(
  (p): p is Exclude<TeamColorPreset, TeamColorPreset.Custom> => p !== TeamColorPreset.Custom,
)
const BUILTIN_FFA_PRESETS = ALL_FFA_COLOR_PRESETS.filter(
  (p): p is Exclude<FfaColorPreset, FfaColorPreset.Custom> => p !== FfaColorPreset.Custom,
)

function buildTeamRows(colors: CustomTeamColors): PreviewRow[] {
  const friendly: PreviewRow[] = [
    { color: colors.self, name: 'You', isSelf: true },
    ...ALLY_NAMES.map((name, i) => ({
      color: colors.allies[i % colors.allies.length],
      name,
      isSelf: false,
    })),
  ]
  const hostile: PreviewRow[] = ENEMY_NAMES.map((name, i) => ({
    color: colors.enemies[i % colors.enemies.length],
    name,
    isSelf: false,
  }))
  return [...friendly, ...hostile]
}

/**
 * Assigns preview colors from the pool, consuming a fixed self color if set: the local player
 * gets `ffaSelfColor` and the first matching pool entry is skipped for everyone else, so a
 * duplicate isn't handed out twice.
 */
function buildFfaRows(pool: readonly string[], ffaSelfColor: string | undefined): PreviewRow[] {
  let assigned: ReadonlyArray<string>
  if (ffaSelfColor) {
    const rest: string[] = []
    let consumed = false
    for (const color of pool) {
      if (!consumed && color.toLowerCase() === ffaSelfColor.toLowerCase()) {
        consumed = true
        continue
      }
      rest.push(color)
    }
    assigned = [ffaSelfColor, ...rest.slice(0, 7)]
  } else {
    assigned = pool.slice(0, 8)
  }
  return FFA_NAMES.map((name, i) => ({ color: assigned[i], name, isSelf: i === 0 }))
}

function getMinimapColorModeDescription(mode: MinimapColorMode, t: TFunction): string {
  switch (mode) {
    case MinimapColorMode.Standard:
      return t(
        'settings.game.gameplay.teamColors.mode.standardDesc',
        "StarCraft's normal colors. The settings below have no effect.",
      )
    case MinimapColorMode.PresetOnMinimapOnly:
      return t(
        'settings.game.gameplay.teamColors.mode.presetOnMinimapDesc',
        'Ally and enemy colors on the minimap only.',
      )
    case MinimapColorMode.Preset:
      return t(
        'settings.game.gameplay.teamColors.mode.presetEverywhereDesc',
        'Your color scheme on units and the minimap.',
      )
    default:
      return assertUnreachable(mode)
  }
}

function getTeamColorUsageDescription(
  usage: TeamColorUsage,
  shuffleColors: boolean,
  t: TFunction,
): string {
  switch (usage) {
    case TeamColorUsage.Always:
      return shuffleColors
        ? t(
            'settings.game.gameplay.teamColorUsage.alwaysShuffledDesc',
            'Your 1v1 opponent gets a random color from your enemy pool.',
          )
        : t(
            'settings.game.gameplay.teamColorUsage.alwaysDesc',
            'Your 1v1 opponent always gets the first enemy color.',
          )
    case TeamColorUsage.ExceptIn1v1:
      return t(
        'settings.game.gameplay.teamColorUsage.exceptIn1v1Desc',
        'Two-player games use individual colors instead.',
      )
    case TeamColorUsage.Never:
      return t(
        'settings.game.gameplay.teamColorUsage.neverDesc',
        'Everyone keeps their own color, even when alliances change.',
      )
    default:
      return assertUnreachable(usage)
  }
}

function getAlliesRepeatHint(count: number, shuffleColors: boolean, t: TFunction): string {
  return shuffleColors
    ? t('settings.game.gameplay.teamColors.alliesShuffledRepeatHint', {
        defaultValue:
          'These colors are used in a random order each game. With more than {{count}} allies, colors repeat.',
        count,
      })
    : t('settings.game.gameplay.teamColors.alliesOrderedRepeatHint', {
        defaultValue:
          'Colors are used in order, from the left. With more than {{count}} allies, colors repeat.',
        count,
      })
}

function getEnemiesRepeatHint(count: number, shuffleColors: boolean, t: TFunction): string {
  return shuffleColors
    ? t('settings.game.gameplay.teamColors.enemiesShuffledRepeatHint', {
        defaultValue:
          'These colors are used in a random order each game. With more than {{count}} enemies, colors repeat.',
        count,
      })
    : t('settings.game.gameplay.teamColors.enemiesOrderedRepeatHint', {
        defaultValue:
          'Colors are used in order, from the left. With more than {{count}} enemies, colors repeat.',
        count,
      })
}

const BehaviorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
  margin: 8px 0 20px;
`

const UsageSelect = styled(Select)`
  flex-grow: 1;
`

const ShuffleCheckBox = styled(CheckBox)`
  align-self: center;
  width: 264px;
  flex-shrink: 0;
`

const BelowMode = styled.div<{ $inert: boolean }>`
  ${props => (props.$inert ? 'opacity: 0.38; pointer-events: none;' : '')}
`

const CollapsedCard = styled(Card)`
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
`

const CollapsedTitle = styled.h3`
  ${titleSmall};
  margin: 0;
`

const CollapsedNote = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const RelativeCard = styled(Card)`
  position: relative;
`

const TeamSchemeCard = styled(RelativeCard)`
  margin-bottom: 16px;
`

const SchemeContentRow = styled.div`
  display: flex;
  gap: 24px;
`

const SchemeColumn = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
`

const CardTitle = styled.h3`
  ${titleSmall};
  margin: 0;
`

const PresetBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const PresetHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const AttributionLine = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const GroupLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  margin-bottom: 8px;
`

const Hint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
  margin-top: 6px;
`

const Preview = styled(TeamColorPreview)`
  width: 288px;
  flex-shrink: 0;
`

const CopyButtonContainer = styled.div`
  position: absolute;
  bottom: 16px;
  right: 16px;
`

const CopyButtonAnchor = styled.div`
  display: inline-block;
`

const CopyMenuList = styled(MenuList)`
  width: 212px;
`

const CopyMenuCaption = styled.div`
  ${bodySmall};
  padding: 4px 12px 6px;
  color: var(--theme-on-surface-variant);
`

const FfaSelfRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const FfaSelfAddLabel = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const ClearButton = styled.button`
  ${buttonReset};
  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-amber);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--theme-amber-container);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 2px;
  }

  &:disabled {
    color: rgb(from var(--theme-on-surface) r g b / var(--theme-disabled-opacity));
    cursor: default;
    pointer-events: none;
  }
`

const ClearLabel = styled.span`
  ${labelMedium};
`

interface PresetOption<T extends string> {
  value: T
  label: string
}

function CopyFromPresetButton<T extends string>({
  presets,
  onSelect,
}: {
  presets: ReadonlyArray<PresetOption<T>>
  onSelect: (value: T) => void
}) {
  const { t } = useTranslation()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLDivElement>(
    'right',
    'top',
  )
  const [open, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })

  return (
    <CopyButtonContainer>
      <CopyButtonAnchor ref={anchorRef}>
        <OutlinedButton
          label={t('settings.game.gameplay.teamColors.copyFromPreset', 'Copy from preset')}
          iconStart={<MaterialIcon icon='content_copy' size={16} />}
          onClick={event => (open ? closePopover() : openPopover(event))}
        />
      </CopyButtonAnchor>
      <Popover
        open={open}
        onDismiss={closePopover}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='bottom'>
        <CopyMenuList dense={true}>
          {presets.map(preset => (
            <MenuItem
              key={preset.value}
              text={preset.label}
              onClick={() => {
                onSelect(preset.value)
                closePopover()
              }}
            />
          ))}
          <CopyMenuCaption>
            {t(
              'settings.game.gameplay.teamColors.copyFromPresetCaption',
              'Overwrites your custom colors',
            )}
          </CopyMenuCaption>
        </CopyMenuList>
      </Popover>
    </CopyButtonContainer>
  )
}

export interface TeamColorSettingsProps {
  minimapColorMode: MinimapColorMode
  onMinimapColorModeChange: (value: MinimapColorMode) => void
  teamColorPreset: TeamColorPreset
  onTeamColorPresetChange: (value: TeamColorPreset) => void
  ffaColorPreset: FfaColorPreset
  onFfaColorPresetChange: (value: FfaColorPreset) => void
  teamColorUsage: TeamColorUsage
  onTeamColorUsageChange: (value: TeamColorUsage) => void
  shuffleColors: boolean
  onShuffleColorsChange: (value: boolean) => void
  customTeamColors: CustomTeamColors
  onCustomTeamColorsChange: (value: CustomTeamColors) => void
  customFfaColors: string[]
  onCustomFfaColorsChange: (value: string[]) => void
  ffaSelfColor: string | undefined
  onFfaSelfColorChange: (value: string | undefined) => void
}

/**
 * The "Player colors" settings section: minimap color mode, team-vs-individual usage behavior,
 * and the two color-scheme cards (team and individual) with their presets, pool editors, and
 * mock previews.
 */
export function TeamColorSettings({
  minimapColorMode,
  onMinimapColorModeChange,
  teamColorPreset,
  onTeamColorPresetChange,
  ffaColorPreset,
  onFfaColorPresetChange,
  teamColorUsage,
  onTeamColorUsageChange,
  shuffleColors,
  onShuffleColorsChange,
  customTeamColors,
  onCustomTeamColorsChange,
  customFfaColors,
  onCustomFfaColorsChange,
  ffaSelfColor,
  onFfaSelfColorChange,
}: TeamColorSettingsProps) {
  const { t } = useTranslation()
  const [tileset, setTileset] = useState<TilesetId>(DEFAULT_TILESET)

  const isModeInert = minimapColorMode === MinimapColorMode.Standard
  const isTeamCollapsed = teamColorUsage === TeamColorUsage.Never
  const isTeamCustom = teamColorPreset === TeamColorPreset.Custom
  const isFfaCustom = ffaColorPreset === FfaColorPreset.Custom
  const teamEditable = isTeamCustom && !isModeInert
  const ffaEditable = isFfaCustom && !isModeInert

  const activeTeamColors = resolveTeamColors({ teamColorPreset, customTeamColors })
  const activeFfaColors = resolveFfaColors({ ffaColorPreset, customFfaColors })

  const teamRows = buildTeamRows(activeTeamColors)
  const ffaRows = buildFfaRows(activeFfaColors, ffaSelfColor)

  // Order only matters left-to-right when shuffle is off; with shuffle on, each game draws the
  // pool in a random permutation, so only the repeat-on-wrap behavior is worth describing.
  const poolFullHint = shuffleColors
    ? t(
        'settings.game.gameplay.teamColors.poolShuffledHint',
        'These colors are used in a random order each game.',
      )
    : t(
        'settings.game.gameplay.teamColors.poolOrderedHint',
        'Colors are used in order, from the left.',
      )
  const alliesHint =
    activeTeamColors.allies.length < 7
      ? getAlliesRepeatHint(activeTeamColors.allies.length, shuffleColors, t)
      : poolFullHint
  const enemiesHint =
    activeTeamColors.enemies.length < 7
      ? getEnemiesRepeatHint(activeTeamColors.enemies.length, shuffleColors, t)
      : poolFullHint

  const selectCustomHint = t(
    'settings.game.gameplay.teamColors.selectCustomHint',
    'Select the Custom preset to edit colors.',
  )
  const editHint = t(
    'settings.game.gameplay.teamColors.editHint',
    'Click a color to change it, or drag to reorder.',
  )
  const teamPresetHint = isTeamCustom ? editHint : selectCustomHint
  const ffaPresetHint = isFfaCustom ? editHint : selectCustomHint
  const ffaAttribution = getFfaColorPresetAttribution(ffaColorPreset)

  const teamPresetCopyOptions = BUILTIN_TEAM_PRESETS.map(preset => ({
    value: preset,
    label: getTeamColorPresetLabel(preset, t),
  }))
  const ffaPresetCopyOptions = BUILTIN_FFA_PRESETS.map(preset => ({
    value: preset,
    label: getFfaColorPresetLabel(preset, t),
  }))

  function updateAllies(next: string[]) {
    onCustomTeamColorsChange({ ...customTeamColors, allies: next })
  }
  function updateEnemies(next: string[]) {
    onCustomTeamColorsChange({ ...customTeamColors, enemies: next })
  }

  function handleTeamSelfChange(hex: string | undefined) {
    if (hex !== undefined) {
      onCustomTeamColorsChange({ ...customTeamColors, self: hex })
    }
  }

  function handleAllySwatchChange(index: number, hex: string) {
    const next = customTeamColors.allies.slice()
    next[index] = hex
    updateAllies(next)
  }
  function handleAllyRemove(index: number) {
    const next = customTeamColors.allies.slice()
    next.splice(index, 1)
    updateAllies(next)
  }
  function handleAllyReorder(from: number, to: number) {
    const next = customTeamColors.allies.slice()
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    updateAllies(next)
  }
  function handleAllyAdd() {
    const used = [customTeamColors.self, ...customTeamColors.allies, ...customTeamColors.enemies]
    updateAllies([...customTeamColors.allies, nextUnusedColor(used)])
  }

  function handleEnemySwatchChange(index: number, hex: string) {
    const next = customTeamColors.enemies.slice()
    next[index] = hex
    updateEnemies(next)
  }
  function handleEnemyRemove(index: number) {
    const next = customTeamColors.enemies.slice()
    next.splice(index, 1)
    updateEnemies(next)
  }
  function handleEnemyReorder(from: number, to: number) {
    const next = customTeamColors.enemies.slice()
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    updateEnemies(next)
  }
  function handleEnemyAdd() {
    const used = [customTeamColors.self, ...customTeamColors.allies, ...customTeamColors.enemies]
    updateEnemies([...customTeamColors.enemies, nextUnusedColor(used)])
  }

  function handleFfaSwatchChange(index: number, hex: string) {
    const next = customFfaColors.slice()
    next[index] = hex
    onCustomFfaColorsChange(next)
  }
  function handleFfaRemove(index: number) {
    const next = customFfaColors.slice()
    next.splice(index, 1)
    onCustomFfaColorsChange(next)
  }
  function handleFfaReorder(from: number, to: number) {
    const next = customFfaColors.slice()
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onCustomFfaColorsChange(next)
  }
  function handleFfaAdd() {
    onCustomFfaColorsChange([...customFfaColors, nextUnusedColor(customFfaColors)])
  }

  function handleCopyTeamPreset(preset: Exclude<TeamColorPreset, TeamColorPreset.Custom>) {
    onCustomTeamColorsChange(cloneCustomTeamColors(TEAM_COLOR_PRESETS[preset]))
  }
  function handleCopyFfaPreset(preset: Exclude<FfaColorPreset, FfaColorPreset.Custom>) {
    onCustomFfaColorsChange([...FFA_COLOR_PRESETS[preset]])
  }

  const addColorLabel = t('settings.game.gameplay.teamColors.addColor', 'Add a color')
  const removeColorLabel = t('settings.game.gameplay.teamColors.removeColor', 'Remove color')
  const youLabel = t('settings.game.gameplay.teamColors.preview.self', 'You')

  return (
    <>
      <Select
        value={minimapColorMode}
        onChange={onMinimapColorModeChange}
        label={t('settings.game.gameplay.teamColors.label', 'Mode')}
        tabIndex={0}
        allowErrors={false}>
        {ALL_MINIMAP_COLOR_MODES.map(mode => (
          <SelectOption
            key={mode}
            value={mode}
            text={getMinimapColorModeLabel(mode, t)}
            secondaryText={getMinimapColorModeDescription(mode, t)}
          />
        ))}
      </Select>

      <BelowMode $inert={isModeInert}>
        <BehaviorRow>
          <UsageSelect
            value={teamColorUsage}
            onChange={onTeamColorUsageChange}
            label={t('settings.game.gameplay.teamColorUsage.title', 'Team colors usage')}
            tabIndex={0}
            allowErrors={false}
            disabled={isModeInert}>
            {ALL_TEAM_COLOR_USAGES.map(usage => (
              <SelectOption
                key={usage}
                value={usage}
                text={getTeamColorUsageLabel(usage, t)}
                secondaryText={getTeamColorUsageDescription(usage, shuffleColors, t)}
              />
            ))}
          </UsageSelect>
          <ShuffleCheckBox
            checked={shuffleColors}
            onChange={event => onShuffleColorsChange(event.target.checked)}
            label={t('settings.game.gameplay.teamColors.shuffle', 'Shuffle colors each game')}
            disabled={isModeInert}
            inputProps={{ tabIndex: 0 }}
          />
        </BehaviorRow>

        {isTeamCollapsed ? (
          <CollapsedCard>
            <CollapsedTitle>
              {t('settings.game.gameplay.teamColors.title', 'Team colors')}
            </CollapsedTitle>
            <CollapsedNote>
              {t(
                'settings.game.gameplay.teamColors.offNote',
                'Off — individual colors are used in every game.',
              )}
            </CollapsedNote>
          </CollapsedCard>
        ) : (
          <TeamSchemeCard>
            <SchemeContentRow>
              <SchemeColumn>
                <CardTitle>{t('settings.game.gameplay.teamColors.title', 'Team colors')}</CardTitle>
                <PresetBlock>
                  <Select
                    value={teamColorPreset}
                    onChange={onTeamColorPresetChange}
                    label={t('settings.game.gameplay.teamColorPreset.title', 'Preset')}
                    dense={true}
                    tabIndex={0}
                    allowErrors={false}
                    disabled={isModeInert}>
                    {ALL_TEAM_COLOR_PRESETS.map(preset => (
                      <SelectOption
                        key={preset}
                        value={preset}
                        text={getTeamColorPresetLabel(preset, t)}
                      />
                    ))}
                  </Select>
                  <PresetHint>{teamPresetHint}</PresetHint>
                </PresetBlock>
                <div>
                  <GroupLabel>{youLabel}</GroupLabel>
                  <EditableColorSwatch
                    value={activeTeamColors.self}
                    defaultValue={activeTeamColors.self}
                    onChange={handleTeamSelfChange}
                    editable={teamEditable}
                    swatches={SC_SWATCHES}
                    pickerSubtitle={t(
                      'settings.game.gameplay.teamColors.pickerTargetSelf',
                      'Team scheme · your color',
                    )}
                    label={getColorLabel(activeTeamColors.self)}
                    addLabel=''
                  />
                </div>
                <div>
                  <GroupLabel>
                    {t('settings.game.gameplay.teamColors.preview.allies', 'Allies')}
                  </GroupLabel>
                  <ColorPoolEditor
                    colors={activeTeamColors.allies}
                    editable={teamEditable}
                    minLength={1}
                    maxLength={MAX_TEAM_POOL_COLORS}
                    swatches={SC_SWATCHES}
                    colorLabel={getColorLabel}
                    getPickerSubtitle={index =>
                      t('settings.game.gameplay.teamColors.pickerTargetAlly', {
                        defaultValue: 'Team scheme · allies · #{{n}}',
                        n: index + 1,
                      })
                    }
                    addLabel={addColorLabel}
                    removeLabel={removeColorLabel}
                    hint={alliesHint}
                    onSwatchChange={handleAllySwatchChange}
                    onRemove={handleAllyRemove}
                    onReorder={handleAllyReorder}
                    onAdd={handleAllyAdd}
                  />
                </div>
                <div>
                  <GroupLabel>
                    {t('settings.game.gameplay.teamColors.preview.enemies', 'Enemies')}
                  </GroupLabel>
                  <ColorPoolEditor
                    colors={activeTeamColors.enemies}
                    editable={teamEditable}
                    minLength={1}
                    maxLength={MAX_TEAM_POOL_COLORS}
                    swatches={SC_SWATCHES}
                    colorLabel={getColorLabel}
                    getPickerSubtitle={index =>
                      t('settings.game.gameplay.teamColors.pickerTargetEnemy', {
                        defaultValue: 'Team scheme · enemies · #{{n}}',
                        n: index + 1,
                      })
                    }
                    addLabel={addColorLabel}
                    removeLabel={removeColorLabel}
                    hint={enemiesHint}
                    onSwatchChange={handleEnemySwatchChange}
                    onRemove={handleEnemyRemove}
                    onReorder={handleEnemyReorder}
                    onAdd={handleEnemyAdd}
                  />
                </div>
              </SchemeColumn>
              <Preview
                variant='team'
                rows={teamRows}
                tileset={tileset}
                onTilesetChange={setTileset}
              />
            </SchemeContentRow>
            {isTeamCustom ? (
              <CopyFromPresetButton
                presets={teamPresetCopyOptions}
                onSelect={handleCopyTeamPreset}
              />
            ) : null}
          </TeamSchemeCard>
        )}

        <RelativeCard>
          <SchemeContentRow>
            <SchemeColumn>
              <CardTitle>
                {t('settings.game.gameplay.ffaColors.title', 'Individual colors')}
              </CardTitle>
              <PresetBlock>
                <Select
                  value={ffaColorPreset}
                  onChange={onFfaColorPresetChange}
                  label={t('settings.game.gameplay.ffaColorPreset.title', 'Preset')}
                  dense={true}
                  tabIndex={0}
                  allowErrors={false}
                  disabled={isModeInert}>
                  {ALL_FFA_COLOR_PRESETS.map(preset => (
                    <SelectOption
                      key={preset}
                      value={preset}
                      text={getFfaColorPresetLabel(preset, t)}
                    />
                  ))}
                </Select>
                <PresetHint>{ffaPresetHint}</PresetHint>
                {ffaAttribution ? (
                  <AttributionLine>
                    {t('settings.game.gameplay.ffaColorPreset.attributionPrefix', 'Palette: ')}
                    <ExternalLink href={ffaAttribution.url}>{ffaAttribution.name}</ExternalLink>
                  </AttributionLine>
                ) : null}
              </PresetBlock>
              <div>
                <GroupLabel>{t('settings.game.gameplay.ffaColors.poolGroup', 'Pool')}</GroupLabel>
                <ColorPoolEditor
                  colors={activeFfaColors}
                  editable={ffaEditable}
                  minLength={MIN_FFA_COLORS}
                  maxLength={MAX_FFA_COLORS}
                  swatches={SC_SWATCHES}
                  colorLabel={getColorLabel}
                  getPickerSubtitle={index =>
                    t('settings.game.gameplay.ffaColors.pickerTargetPool', {
                      defaultValue: 'Individual colors · #{{n}}',
                      n: index + 1,
                    })
                  }
                  addLabel={addColorLabel}
                  removeLabel={removeColorLabel}
                  hint={t(
                    'settings.game.gameplay.ffaColors.poolHint',
                    'Minimum 8 colors, so every player always gets a unique color.',
                  )}
                  onSwatchChange={handleFfaSwatchChange}
                  onRemove={handleFfaRemove}
                  onReorder={handleFfaReorder}
                  onAdd={handleFfaAdd}
                />
              </div>
              <div>
                <GroupLabel>{youLabel}</GroupLabel>
                <FfaSelfRow>
                  <EditableColorSwatch
                    value={ffaSelfColor}
                    defaultValue={DEFAULT_FFA_SELF_COLOR}
                    onChange={onFfaSelfColorChange}
                    editable={!isModeInert}
                    swatches={SC_SWATCHES}
                    pickerSubtitle={t(
                      'settings.game.gameplay.ffaColors.pickerTargetSelf',
                      'Your individual color',
                    )}
                    label={ffaSelfColor ? getColorLabel(ffaSelfColor) : ''}
                    addLabel={t(
                      'settings.game.gameplay.ffaColors.selfAddLabel',
                      'Fixed color for yourself (optional)',
                    )}
                  />
                  {ffaSelfColor ? (
                    <ClearButton
                      type='button'
                      disabled={isModeInert}
                      onClick={() => onFfaSelfColorChange(undefined)}>
                      <MaterialIcon icon='close' size={15} />
                      <ClearLabel>
                        {t('settings.game.gameplay.ffaColors.clear', 'Clear')}
                      </ClearLabel>
                    </ClearButton>
                  ) : (
                    <FfaSelfAddLabel>
                      {t(
                        'settings.game.gameplay.ffaColors.selfAddLabel',
                        'Fixed color for yourself (optional)',
                      )}
                    </FfaSelfAddLabel>
                  )}
                </FfaSelfRow>
                <Hint>
                  {ffaSelfColor
                    ? t(
                        'settings.game.gameplay.ffaColors.selfSetHint',
                        "You'll always get this color in games without teams. It's set aside so other players don't take it.",
                      )
                    : t(
                        'settings.game.gameplay.ffaColors.selfUnsetHint',
                        "You'll get a color from the pool, just like everyone else.",
                      )}
                </Hint>
              </div>
            </SchemeColumn>
            <Preview variant='ffa' rows={ffaRows} tileset={tileset} onTilesetChange={setTileset} />
          </SchemeContentRow>
          {isFfaCustom ? (
            <CopyFromPresetButton presets={ffaPresetCopyOptions} onSelect={handleCopyFfaPreset} />
          ) : null}
        </RelativeCard>
      </BelowMode>
    </>
  )
}
