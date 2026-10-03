import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import {
  DEFAULT_TITLE_ID,
  getTitleProgress,
  TitleDefinition,
  TitleDivision,
  TitleId,
  TitleMetrics,
  TITLES,
  TitleTrack,
} from '../../common/titles'
import { GetSelfTitlesResponse } from '../../common/titles-network'
import { useSelfUser } from '../auth/auth-utils'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useFormatLocale } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, labelLarge, labelMedium, titleSmall } from '../styles/typography'
import { equipTitle, getSelfTitles } from './action-creators'
import { getTitleName, getTitleRequirement } from './title-strings'
import { getTitleToneColor, TitleIcon, UserTitle } from './user-title'

/**
 * How titles are laid out in the picker: groups separated by spacing, each made of rows. A tiered
 * track is one row, lowest tier first, so the first locked title in a row is the next one to earn.
 */
interface PickerRow {
  titles: ReadonlyArray<TitleDefinition>
  /** Whether the row wraps freely instead of lining up with the tiered rows' columns. */
  wrap?: boolean
  /** A color for the bar marking the row's left edge, identifying the race of a race row. */
  barColor?: string
}

const TIERED_COLUMNS = 6

function titlesIn(...tracks: TitleTrack[]): TitleDefinition[] {
  return TITLES.filter(t => tracks.includes(t.track))
}

function makeLayout(): PickerRow[][] {
  return [
    [{ titles: titlesIn(TitleTrack.Starter), wrap: true }],
    [
      { titles: titlesIn(TitleTrack.Protoss), barColor: 'var(--theme-color-protoss)' },
      { titles: titlesIn(TitleTrack.Zerg), barColor: 'var(--theme-color-zerg)' },
      { titles: titlesIn(TitleTrack.Terran), barColor: 'var(--theme-color-terran)' },
      { titles: titlesIn(TitleTrack.Random), barColor: 'var(--theme-color-random)' },
    ],
    [{ titles: titlesIn(TitleTrack.EveryRace) }],
    [{ titles: titlesIn(TitleTrack.Rank) }],
    [{ titles: titlesIn(TitleTrack.League) }],
    [{ titles: titlesIn(TitleTrack.Mode), wrap: true }],
    [{ titles: titlesIn(TitleTrack.GamesPlayed) }, { titles: titlesIn(TitleTrack.TimePlayed) }],
    [{ titles: titlesIn(TitleTrack.Veteran), wrap: true }],
    [{ titles: titlesIn(TitleTrack.Feats), wrap: true }],
    [{ titles: titlesIn(TitleTrack.Community, TitleTrack.Staff), wrap: true }],
  ]
}

const StyledDialog = styled(Dialog)`
  max-width: 760px;
`

const Preview = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 8px;

  border-radius: 8px;
  background-color: var(--theme-container-lowest);
`

const PreviewText = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex-grow: 1;
`

const PreviewName = styled.div`
  ${titleSmall};
`

const PreviewTitle = styled(UserTitle)`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const UnlockedCount = styled.div`
  ${labelMedium};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
`

const Row = styled.div<{ $wrap: boolean; $barColor?: string }>`
  display: grid;
  grid-template-columns: ${props =>
    props.$wrap
      ? 'repeat(auto-fill, minmax(120px, 1fr))'
      : `repeat(${TIERED_COLUMNS}, minmax(0, 1fr))`};
  gap: 6px;
  padding-left: 8px;

  border-left: 3px solid ${props => props.$barColor ?? 'transparent'};
`

const ChipTooltip = styled(Tooltip)`
  display: flex;
  min-width: 0;
`

const Chip = styled.button<{ $selected: boolean; $locked: boolean }>`
  ${labelLarge};
  width: 100%;
  min-height: 36px;
  padding: 6px 6px;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;

  border: 1px solid ${props => (props.$selected ? 'var(--theme-primary)' : 'transparent')};
  border-radius: 6px;
  background-color: ${props =>
    props.$selected ? 'var(--theme-primary-container)' : 'var(--theme-container-high)'};
  color: var(--theme-on-surface);
  text-align: center;
  cursor: ${props => (props.$locked ? 'default' : 'pointer')};

  &:focus-visible {
    outline: 2px solid var(--theme-primary);
    outline-offset: 1px;
  }

  ${props =>
    props.$locked
      ? css`
          background-color: var(--theme-container-low);
        `
      : css`
          &:hover {
            background-color: var(--theme-container-highest);
          }
        `}
`

const ChipLabel = styled.span<{ $locked: boolean; $color?: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  color: ${props => (!props.$locked && props.$color) || 'inherit'};
  opacity: ${props => (props.$locked ? 'var(--theme-disabled-opacity)' : '1')};
`

const TooltipBody = styled.div`
  ${bodyMedium};
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 240px;
`

const TooltipName = styled.div`
  ${titleSmall};
`

// Tooltips are drawn on the inverse surface, so these use its colors.
const TooltipStatus = styled.div`
  color: rgb(from var(--theme-inverse-on-surface) r g b / 0.72);
  font-variant-numeric: tabular-nums;
`

const UnlockedStatus = styled.div`
  color: var(--theme-positive-invert);
`

const ProgressTrack = styled.div`
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background-color: rgb(from var(--theme-inverse-on-surface) r g b / 0.16);
`

const ProgressFill = styled.div`
  height: 100%;
  background-color: var(--theme-primary);
`

const Message = styled.div`
  ${bodyLarge};
  padding: 24px 0;
  color: var(--theme-on-surface-variant);
`

function useDivisionName(): (division: TitleDivision) => string {
  const { t } = useTranslation()
  return division => {
    switch (division) {
      case TitleDivision.Bronze:
        return t('titles.divisions.bronze', 'Bronze')
      case TitleDivision.Silver:
        return t('titles.divisions.silver', 'Silver')
      case TitleDivision.Gold:
        return t('titles.divisions.gold', 'Gold')
      case TitleDivision.Platinum:
        return t('titles.divisions.platinum', 'Platinum')
      case TitleDivision.Diamond:
        return t('titles.divisions.diamond', 'Diamond')
      case TitleDivision.Champion:
        return t('titles.divisions.champion', 'Champion')
      default:
        return division satisfies never
    }
  }
}

function TitleTooltipContent({
  definition,
  unlocked,
  metrics,
  created,
}: {
  definition: TitleDefinition
  unlocked: boolean
  metrics: TitleMetrics
  created?: number
}) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const getDivisionName = useDivisionName()

  if (definition.secret && !unlocked) {
    return (
      <TooltipBody>
        <TooltipName>{t('titles.picker.secret', 'Secret')}</TooltipName>
        <div>{t('titles.picker.secretHint', 'Keep playing to discover this one.')}</div>
      </TooltipBody>
    )
  }

  let status: React.ReactNode
  if (unlocked) {
    status = <UnlockedStatus>{t('titles.picker.unlocked', 'Unlocked')}</UnlockedStatus>
  } else if (definition.criterion.kind === 'division') {
    status = metrics.peakDivision ? (
      <TooltipStatus>
        {t('titles.picker.bestDivision', {
          defaultValue: 'Your best so far: {{division}}',
          division: getDivisionName(metrics.peakDivision),
        })}
      </TooltipStatus>
    ) : undefined
  } else {
    const progress = getTitleProgress(definition.criterion, metrics)
    status = progress ? (
      <>
        <TooltipStatus>
          {t('titles.picker.progress', {
            defaultValue: '{{current}} / {{target}}',
            current: progress.current.toLocaleString(locale),
            target: progress.target.toLocaleString(locale),
          })}
        </TooltipStatus>
        <ProgressTrack>
          <ProgressFill
            style={{ width: `${Math.min(100, (100 * progress.current) / progress.target)}%` }}
          />
        </ProgressTrack>
      </>
    ) : undefined
  }

  return (
    <TooltipBody>
      <TooltipName>{getTitleName(definition.id, t, created)}</TooltipName>
      <div>{getTitleRequirement(definition, t, locale)}</div>
      {status}
    </TooltipBody>
  )
}

function TitleChip({
  definition,
  unlocked,
  selected,
  metrics,
  created,
  onSelect,
}: {
  definition: TitleDefinition
  unlocked: boolean
  selected: boolean
  metrics: TitleMetrics
  created?: number
  onSelect: (id: TitleId) => void
}) {
  const { t } = useTranslation()
  const hidden = definition.secret && !unlocked

  return (
    <ChipTooltip
      text={
        <TitleTooltipContent
          definition={definition}
          unlocked={unlocked}
          metrics={metrics}
          created={created}
        />
      }
      position='top'
      tabIndex={-1}>
      <Chip
        type='button'
        role='radio'
        aria-checked={selected}
        aria-disabled={!unlocked}
        $selected={selected}
        $locked={!unlocked}
        onClick={() => {
          if (unlocked) {
            onSelect(definition.id)
          }
        }}>
        <ChipLabel $locked={!unlocked} $color={getTitleToneColor(definition.tone)}>
          {selected ? <MaterialIcon icon='check' size={16} /> : null}
          {hidden ? null : <TitleIcon definition={definition} />}
          <span>
            {hidden
              ? t('titles.picker.secretName', '???')
              : getTitleName(definition.id, t, created)}
          </span>
        </ChipLabel>
      </Chip>
    </ChipTooltip>
  )
}

export interface TitlePickerDialogProps extends CommonDialogProps {
  initialSelection?: TitleId
}

export function TitlePickerDialog({ onCancel, close, initialSelection }: TitlePickerDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfUser = useSelfUser()
  const [titles, setTitles] = useState<GetSelfTitlesResponse>()
  const [loadError, setLoadError] = useState<Error>()
  const [selected, setSelected] = useState<TitleId>()
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const abortController = new AbortController()
    dispatch(
      getSelfTitles({
        signal: abortController.signal,
        onSuccess: response => {
          setTitles(response)
          setLoadError(undefined)
        },
        onError: err => setLoadError(err),
      }),
    )
    return () => abortController.abort()
  }, [dispatch])

  const unlockedIds = new Set<TitleId>(titles?.unlocked.map(u => u.id) ?? [])
  unlockedIds.add(DEFAULT_TITLE_ID)
  const equipped = titles?.equipped ?? DEFAULT_TITLE_ID
  const currentSelection =
    selected ??
    (initialSelection && unlockedIds.has(initialSelection) ? initialSelection : equipped)

  const onSave = () => {
    if (currentSelection === equipped) {
      close()
      return
    }
    setIsSaving(true)
    dispatch(
      equipTitle(currentSelection, {
        onSuccess: () => close(),
        onError: () => {
          setIsSaving(false)
          snackbarController.showSnackbar(
            t('titles.picker.saveError', 'There was a problem changing your title'),
          )
        },
      }),
    )
  }

  let content: React.ReactNode
  if (loadError) {
    content = (
      <Message>{t('titles.picker.loadError', 'There was a problem loading your titles.')}</Message>
    )
  } else if (!titles) {
    content = <LoadingDotsArea />
  } else {
    const layout = makeLayout()
      .map(group =>
        group
          .map(row => ({
            ...row,
            // Titles handed out by hand aren't something a player can work toward, so they only
            // appear once held.
            titles: row.titles.filter(d => d.criterion.kind !== 'granted' || unlockedIds.has(d.id)),
          }))
          .filter(row => row.titles.length > 0),
      )
      .filter(group => group.length > 0)
    const total = layout.flat().reduce((sum, row) => sum + row.titles.length, 0)

    content = (
      <>
        <Preview>
          <PreviewText>
            <PreviewName>{selfUser?.name}</PreviewName>
            <PreviewTitle titleId={currentSelection} created={selfUser?.created} />
          </PreviewText>
          <UnlockedCount>
            {t('titles.picker.unlockedCount', {
              defaultValue: '{{unlocked}} / {{total}} unlocked',
              unlocked: unlockedIds.size,
              total,
            })}
          </UnlockedCount>
        </Preview>
        <div role='radiogroup' aria-label={t('titles.picker.title', 'Choose title')}>
          {layout.map((group, i) => (
            <Group key={i}>
              {group.map(row => (
                <Row key={row.titles[0].id} $wrap={!!row.wrap} $barColor={row.barColor}>
                  {row.titles.map(definition => (
                    <TitleChip
                      key={definition.id}
                      definition={definition}
                      unlocked={unlockedIds.has(definition.id)}
                      selected={definition.id === currentSelection}
                      metrics={titles.metrics}
                      created={selfUser?.created}
                      onSelect={setSelected}
                    />
                  ))}
                </Row>
              ))}
            </Group>
          ))}
        </div>
      </>
    )
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      onClick={onSave}
      disabled={!titles || isSaving}
    />,
  ]

  return (
    <StyledDialog
      title={t('titles.picker.title', 'Choose title')}
      buttons={buttons}
      onCancel={onCancel}
      showCloseButton={true}>
      {content}
    </StyledDialog>
  )
}
