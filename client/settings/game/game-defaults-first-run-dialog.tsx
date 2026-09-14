import * as React from 'react'
import { useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  GAME_DEFAULTS_PRESET_VALUES,
  getGameDefaultsPresetLabel,
} from '../../../common/settings/game-defaults'
import {
  ALL_GAME_DEFAULTS_PRESETS,
  GameDefaultsPreset,
} from '../../../common/settings/local-settings'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { TextButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { standardEasing } from '../../material/curve-constants'
import { Dialog } from '../../material/dialog'
import { useAppDispatch } from '../../redux-hooks'
import { bodyMedium, bodySmall, titleMedium, titleSmall } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'
import { GameDefaultsPreview, GameDefaultsPreviewKind } from './game-defaults-preview'
import { GameDefaultsRadio } from './game-defaults-radio'

const ARROW_KEY_DELTAS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/** The background a column's preview cells get for its current selected/hovered state. */
function getCellBackground(selected: boolean, hovered: boolean): string {
  if (selected) {
    return 'rgb(from var(--color-blue60) r g b / 0.12)'
  }
  return hovered ? 'rgb(from var(--theme-on-surface) r g b / 0.06)' : 'transparent'
}

/** The background a column's header gets for its current selected/hovered state. */
function getHeaderBackground(selected: boolean, hovered: boolean): string {
  if (selected) {
    return 'rgb(from var(--color-blue60) r g b / 0.24)'
  }
  return hovered ? 'rgb(from var(--theme-on-surface) r g b / 0.1)' : 'var(--theme-container-high)'
}

/*
  Wider and taller than the standard surface allows: the preview grid needs the width, and letting
  the dialog use most of the window height keeps all four rows visible on typical windows instead
  of scrolling the body.
*/
const StyledDialog = styled(Dialog)`
  width: 900px;
  max-width: calc(100% - 64px);
  max-height: calc(100% - 48px);
`

const Intro = styled.div`
  ${bodyMedium};
  max-width: 620px;
  margin-bottom: 16px;

  color: var(--theme-on-surface-variant);
  text-wrap: pretty;
`

const PresetGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 200px 200px;
  column-gap: 8px;
`

const PresetHeader = styled.button<{ $selected: boolean; $hovered: boolean }>`
  ${buttonReset};

  display: flex;
  align-items: center;
  padding: 6px 8px 6px 0;

  background-color: ${props => getHeaderBackground(props.$selected, props.$hovered)};
  border-bottom: 2px solid ${props => (props.$selected ? 'var(--color-blue60)' : 'transparent')};
  border-radius: 6px 6px 0 0;
  text-align: left;
  transition:
    background-color 200ms ${standardEasing},
    border-color 200ms ${standardEasing};
`

const HeaderRadio = styled(GameDefaultsRadio)`
  margin: 8px 12px;
`

const PresetName = styled.div<{ $selected: boolean }>`
  ${titleMedium};

  color: ${props =>
    props.$selected ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
  transition: color 150ms linear;
`

const RowLabel = styled.div<{ $lastRow: boolean }>`
  padding: 14px 16px 14px 0;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;

  border-bottom: 1px solid
    ${props => (props.$lastRow ? 'transparent' : 'var(--theme-outline-variant)')};
`

const RowName = styled.div`
  ${titleSmall};
`

const RowDescription = styled.div`
  ${bodyMedium};
  font-size: 13px;
  line-height: 18px;

  color: var(--theme-on-surface-variant);
  text-wrap: pretty;
`

const Emphasized = styled.b`
  color: var(--theme-on-surface);
  font-weight: 600;
`

const PreviewCell = styled.div<{ $selected: boolean; $hovered: boolean; $lastRow: boolean }>`
  padding: 8px;

  background-color: ${props => getCellBackground(props.$selected, props.$hovered)};
  border-bottom: 1px solid
    ${props => (props.$lastRow ? 'transparent' : 'var(--theme-outline-variant)')};
  border-radius: ${props => (props.$lastRow ? '0 0 6px 6px' : '0')};
  cursor: pointer;
  transition: background-color 150ms linear;
`

const Footnote = styled.div`
  ${bodySmall};
  margin-top: 16px;

  color: var(--theme-on-surface-variant);
`

/**
 * Asks the user, on their first launch, which set of values ShieldBattery's own gameplay settings
 * should start on. Shown as a modal: the choice also decides what settings added later default to,
 * so it's only dismissable by picking one.
 */
export function GameDefaultsFirstRunDialog({ close }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [selected, setSelected] = useState(GameDefaultsPreset.Recommended)
  const [hovered, setHovered] = useState<GameDefaultsPreset | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const radioRefs = useRef(new Map<GameDefaultsPreset, HTMLButtonElement | null>())

  const onContinue = () => {
    if (saving) {
      return
    }

    setSaving(true)
    dispatch(
      mergeLocalSettings(
        { gameDefaultsPreset: selected, ...GAME_DEFAULTS_PRESET_VALUES[selected] },
        { onSuccess: close, onError: close },
      ),
    )
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
        (ALL_GAME_DEFAULTS_PRESETS.indexOf(selected) + delta + count) % count
      ]
    setSelected(next)
    radioRefs.current.get(next)?.focus()
  }

  const rows: Array<{ kind: GameDefaultsPreviewKind; name: string; description: React.ReactNode }> =
    [
      {
        kind: 'startingFog',
        name: t('settings.game.defaults.firstRun.startingFog', 'Starting fog'),
        description: (
          <Trans t={t} i18nKey='settings.game.defaults.firstRun.startingFogDescription'>
            <Emphasized>Recommended</Emphasized> shows unexplored terrain dimly.{' '}
            <Emphasized>Legacy</Emphasized> keeps it black until scouted.
          </Trans>
        ),
      },
      {
        kind: 'cursor',
        name: t('settings.game.defaults.firstRun.cursorSize', 'Cursor size'),
        description: (
          <Trans t={t} i18nKey='settings.game.defaults.firstRun.cursorSizeDescription'>
            <Emphasized>Recommended</Emphasized> draws every cursor at its original size.{' '}
            <Emphasized>Legacy</Emphasized> scales some larger cursors down.
          </Trans>
        ),
      },
      {
        kind: 'teamColors',
        name: t('settings.game.defaults.firstRun.playerColors', 'Player colors'),
        description: (
          <Trans t={t} i18nKey='settings.game.defaults.firstRun.playerColorsDescription'>
            Shift+Tab colors. <Emphasized>Recommended</Emphasized>: allies cool, enemies warm,
            everyone distinct. <Emphasized>Legacy</Emphasized>: you teal, allies yellow, enemies
            red.
          </Trans>
        ),
      },
      {
        kind: 'grabPan',
        name: t('settings.game.defaults.firstRun.dragPan', 'Drag pan'),
        description: (
          <Trans t={t} i18nKey='settings.game.defaults.firstRun.dragPanDescription'>
            <Emphasized>Recommended</Emphasized> pans more slowly and is adjustable in Settings ›
            Input. <Emphasized>Legacy</Emphasized> keeps the fixed original speed.
          </Trans>
        ),
      },
    ]

  const buttons = [
    <TextButton
      key='continue'
      label={t('settings.game.defaults.firstRun.continue', 'Continue')}
      disabled={saving}
      onClick={onContinue}
      testName='game-defaults-continue'
    />,
  ]

  return (
    <StyledDialog
      overline={t('settings.game.defaults.firstRun.overline', 'First launch')}
      title={t('settings.game.defaults.firstRun.title', 'Same game. Your call on the details.')}
      showCloseButton={false}
      buttons={buttons}
      testName='game-defaults-first-run-dialog'>
      <Intro>
        {t(
          'settings.game.defaults.firstRun.intro',
          'ShieldBattery tunes a few gameplay details differently from Battle.net, and we ' +
            'recommend giving them a try. If you would rather keep things exactly how you ' +
            'remember them, Legacy leaves everything alone. Whichever you pick also becomes the ' +
            'default for features we add later.',
        )}
      </Intro>

      <PresetGrid
        role='radiogroup'
        aria-label={t('settings.game.defaults.firstRun.presetLabel', 'Game defaults preset')}
        onKeyDown={onKeyDown}>
        <div />
        {ALL_GAME_DEFAULTS_PRESETS.map(preset => (
          <PresetHeader
            key={preset}
            ref={elem => {
              radioRefs.current.set(preset, elem)
            }}
            type='button'
            role='radio'
            aria-checked={selected === preset}
            tabIndex={selected === preset ? 0 : -1}
            $selected={selected === preset}
            $hovered={hovered === preset}
            onClick={() => setSelected(preset)}
            onMouseEnter={() => setHovered(preset)}
            onMouseLeave={() => setHovered(undefined)}>
            <HeaderRadio selected={selected === preset} />
            <PresetName $selected={selected === preset}>
              {getGameDefaultsPresetLabel(preset, t)}
            </PresetName>
          </PresetHeader>
        ))}

        {rows.map((row, i) => {
          const lastRow = i === rows.length - 1
          return (
            <React.Fragment key={row.kind}>
              <RowLabel $lastRow={lastRow}>
                <RowName>{row.name}</RowName>
                <RowDescription>{row.description}</RowDescription>
              </RowLabel>
              {ALL_GAME_DEFAULTS_PRESETS.map(preset => (
                <PreviewCell
                  key={preset}
                  aria-hidden={true}
                  $selected={selected === preset}
                  $hovered={hovered === preset}
                  $lastRow={lastRow}
                  onClick={() => setSelected(preset)}
                  onMouseEnter={() => setHovered(preset)}
                  onMouseLeave={() => setHovered(undefined)}>
                  <GameDefaultsPreview kind={row.kind} preset={preset} />
                </PreviewCell>
              ))}
            </React.Fragment>
          )
        })}
      </PresetGrid>

      <Footnote>
        {t(
          'settings.game.defaults.firstRun.footnote',
          'Your other Battle.net settings carry over either way. Change this later in ' +
            'Settings › Game › Defaults.',
        )}
      </Footnote>
    </StyledDialog>
  )
}
