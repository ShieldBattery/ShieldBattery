import { FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../../common/errors'
import {
  BEST_OF_MAX_LENGTH,
  BEST_OF_MAX_SIDE_SIZE,
  BEST_OF_OVERLAY_LINE_MAX_LENGTH,
  BEST_OF_PRESET_LENGTHS,
  BEST_OF_TITLE_MAX_LENGTH,
  BestOfSideIndex,
  getBestOfScore,
  getRunningBestOf,
  isValidBestOfLength,
  LobbyBestOfSides,
  suggestBestOfSides,
} from '../../../common/lobbies/lobby-best-of'
import { GetRememberedBestOfOverlayResponse } from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { MaterialIcon } from '../../icons/material/material-icon'
import { LoadErrorRow } from '../../lists/load-error-row'
import logger from '../../logging/logger'
import { FilledButton, IconButton, TextButton } from '../../material/button'
import { EllipsizedText } from '../../material/ellipsized-text'
import { MenuItem } from '../../material/menu/item'
import { MenuList } from '../../material/menu/menu'
import { Popover } from '../../material/popover'
import { Segment, SegmentedButtonGroup } from '../../material/segmented-button'
import { TextField } from '../../material/text-field'
import { Tooltip } from '../../material/tooltip'
import { RequestHandlingSpec } from '../../network/abortable-thunk'
import { DotsIndicator } from '../../progress/dots'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyLarge, bodyMedium, bodySmall, labelMedium } from '../../styles/typography'
import { StartBestOfParams, UpdateBestOfParams } from '../action-creators'
import { Section, SectionHeader } from '../create/game-setup-form'
import { lobbyActionErrorMessage } from '../lobby-action-errors'
import { SetupPage } from '../setup-page'
import { BestOfCandidate, getBestOfCandidates } from './best-of-display'
import { BestOfLogoSlot } from './best-of-logo-slot'
import { useBestOfSideLabel } from './best-of-parts'
import { useAnchoredMenu } from './room-parts'
import {
  bestOfLogoErrorMessage,
  buildStartBestOfParams,
  buildUpdateBestOfParams,
  formatSeriesSetupSummary,
  LogoSlotValue,
  SeriesSetupValues,
  storedLogoSlot,
} from './series-setup'

const DEFAULT_LENGTH = 3

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 32px;
`

const SeriesRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 24px;
`

const TitleField = styled(TextField)`
  flex: 1 1 280px;
  min-width: 0;
`

const LengthBlock = styled.div`
  flex: 0 0 auto;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const LengthLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const CustomLengthField = styled(TextField)`
  width: 240px;
  margin-top: 8px;
`

const FixedLength = styled.div`
  ${bodyLarge};
  min-height: 40px;

  display: flex;
  align-items: center;
`

const SidesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
`

const SideColumn = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SideHeading = styled.div`
  ${labelMedium};
  padding-bottom: 4px;

  border-bottom: 1px solid var(--theme-outline-variant);
  color: var(--theme-on-surface-variant);
`

const SidePlayerRow = styled.div`
  min-height: 40px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const SidePlayerAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const SidePlayerName = styled(EllipsizedText)`
  ${bodyMedium};
  flex-grow: 1;
  min-width: 0;
`

const RemoveButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  padding: 0;
  flex-shrink: 0;
`

const EmptySide = styled.div`
  ${bodyMedium};
  min-height: 40px;

  display: flex;
  align-items: center;

  color: var(--theme-on-surface-variant);
`

/** Cancels `TextButton`'s start padding so its label lines up with the rows above it. */
const AddPlayerButton = styled(TextButton)`
  align-self: flex-start;
  margin-left: -8px;
`

const CandidateAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
`

const OverlayGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 24px;
`

const LineFields = styled.div`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const OverlayHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const OverlayLoadError = styled(LoadErrorRow)`
  justify-content: flex-start;
`

const RequestError = styled.div`
  ${bodySmall};
  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--theme-error);
`

const RequestErrorIcon = styled(MaterialIcon)`
  flex-shrink: 0;
`

const EndSeriesButton = styled(TextButton)`
  color: var(--theme-error);
`

/** Where loading the host's remembered caster overlay stands. */
type RememberedLoadState = 'loading' | 'loaded' | 'failed'

export interface RoomSeriesSetupProps {
  onClose: () => void
  onStartBestOf: (request: StartBestOfParams, spec: RequestHandlingSpec<void>) => void
  onUpdateBestOf: (request: UpdateBestOfParams, spec: RequestHandlingSpec<void>) => void
  /** Ends the running series, once the host has confirmed it. */
  onEndBestOf: () => void
  /** Loads the caster overlay the host's last series was started or saved with. */
  onLoadRememberedOverlay: (spec: RequestHandlingSpec<GetRememberedBestOfOverlayResponse>) => void
}

/**
 * The host's page for a best-of series, which takes over the room the way Game setup does: starting
 * one when none is running, or changing the title, sides and caster overlay of the one that is. A
 * running series' length is part of what its sides agreed to play, so it can't be changed.
 *
 * Whether it starts or edits is settled when it opens, from the lobby as it stood then, so a series
 * starting or ending under it doesn't turn the form into the other one halfway through. A new
 * series opens with the caster overlay the host's last one had, which the server remembers per
 * account.
 */
export function RoomSeriesSetup({
  onClose,
  onStartBestOf,
  onUpdateBestOf,
  onEndBestOf,
  onLoadRememberedOverlay,
}: RoomSeriesSetupProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const lobby = useAppSelector(s => s.lobby.info)
  const currentBestOf = useAppSelector(s => getRunningBestOf(s.lobby.bestOfs))

  const [editing] = useState(currentBestOf)
  const [title, setTitle] = useState(editing?.title ?? '')
  const [lengthChoice, setLengthChoice] = useState<number | 'custom'>(DEFAULT_LENGTH)
  const [customLength, setCustomLength] = useState('')
  const [sides, setSides] = useState<LobbyBestOfSides>(() => {
    const initial = editing?.sides ?? suggestBestOfSides(lobby) ?? [[], []]
    return [[...initial[0]], [...initial[1]]]
  })
  const [line1, setLine1] = useState(editing?.overlay?.line1 ?? '')
  const [line2, setLine2] = useState(editing?.overlay?.line2 ?? '')
  // What the logo slot opened with, which decides what an empty slot means on submit. A new series'
  // slot is unknown until the remembered overlay has loaded.
  const [initialLogo, setInitialLogo] = useState<LogoSlotValue>(() =>
    editing ? storedLogoSlot(editing.overlay?.logo) : { kind: 'unknown' },
  )
  const [logo, setLogo] = useState<LogoSlotValue>(initialLogo)
  const [logoError, setLogoError] = useState<string>()
  const [rememberedState, setRememberedState] = useState<RememberedLoadState>(
    editing ? 'loaded' : 'loading',
  )
  const [requestError, setRequestError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const titleRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const logoSlotRef = useRef<HTMLDivElement>(null)

  const loadRemembered = (signal?: AbortSignal) => {
    onLoadRememberedOverlay({
      signal,
      onSuccess: remembered => {
        const rememberedLogo = storedLogoSlot(remembered.logo)
        // A retry can land after the host has started typing, so only what they haven't touched is
        // filled in.
        setLine1(current => current || (remembered.line1 ?? ''))
        setLine2(current => current || (remembered.line2 ?? ''))
        setInitialLogo(rememberedLogo)
        setLogo(current => (current.kind === 'unknown' ? rememberedLogo : current))
        setRememberedState('loaded')
      },
      onError: err => {
        logger.error(`Error loading the remembered best-of overlay: ${getErrorStack(err)}`)
        setRememberedState('failed')
      },
    })
  }
  const loadRememberedOnOpen = useEffectEvent((signal: AbortSignal) => loadRemembered(signal))

  const isEditing = editing !== undefined
  useEffect(() => {
    titleRef.current?.focus()
    if (isEditing) {
      return () => {}
    }

    const controller = new AbortController()
    loadRememberedOnOpen(controller.signal)
    return () => controller.abort()
  }, [isEditing])

  const length = lengthChoice === 'custom' ? Number(customLength) : lengthChoice
  const isLengthValid = editing !== undefined || isValidBestOfLength(length)
  const showLengthError = lengthChoice === 'custom' && customLength !== '' && !isLengthValid
  const isRememberedLoading = rememberedState === 'loading'
  const canSubmit =
    !isSubmitting &&
    !isRememberedLoading &&
    isLengthValid &&
    title.trim().length <= BEST_OF_TITLE_MAX_LENGTH &&
    line1.trim().length <= BEST_OF_OVERLAY_LINE_MAX_LENGTH &&
    line2.trim().length <= BEST_OF_OVERLAY_LINE_MAX_LENGTH &&
    sides[0].length > 0 &&
    sides[1].length > 0

  const candidates = getBestOfCandidates(lobby, sides)

  const side1Label = useBestOfSideLabel(sides[0])
  const side2Label = useBestOfSideLabel(sides[1])
  // The score keeps up with the series while the page is open, since games can settle under it.
  let summaryLength: number | undefined
  if (editing) {
    summaryLength = editing.length
  } else if (isLengthValid) {
    summaryLength = length
  }
  const liveBestOf = editing && currentBestOf?.id === editing.id ? currentBestOf : editing
  const summary = formatSeriesSetupSummary(t, {
    length: summaryLength,
    sideLabels: sides[0].length && sides[1].length ? [side1Label, side2Label] : undefined,
    score: liveBestOf ? getBestOfScore(liveBestOf) : undefined,
    title,
  })

  // A refusal is about what was sent, so it stops applying once the host changes anything.
  const edited = () => setRequestError(undefined)

  const addToSide = (sideIndex: BestOfSideIndex, userId: SbUserId) => {
    edited()
    setSides(current => {
      const next: LobbyBestOfSides = [[...current[0]], [...current[1]]]
      next[sideIndex].push(userId)
      return next
    })
  }
  const removeFromSide = (sideIndex: BestOfSideIndex, userId: SbUserId) => {
    edited()
    setSides(current => {
      const next: LobbyBestOfSides = [[...current[0]], [...current[1]]]
      next[sideIndex] = next[sideIndex].filter(id => id !== userId)
      return next
    })
  }

  const onRequestError = (err: Error) => {
    logger.error(`Error ${editing ? 'saving' : 'starting'} a best-of series: ${getErrorStack(err)}`)
    setIsSubmitting(false)
    const logoMessage = bestOfLogoErrorMessage(err, t)
    if (logoMessage) {
      setLogoError(logoMessage)
      logoSlotRef.current?.scrollIntoView({ block: 'nearest' })
    } else {
      setRequestError(lobbyActionErrorMessage(err, t))
    }
  }

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit) {
      return
    }

    const values: SeriesSetupValues = { title, sides, line1, line2, logo }
    const spec: RequestHandlingSpec<void> = {
      onSuccess: () => onClose(),
      onError: onRequestError,
    }

    if (!editing) {
      setIsSubmitting(true)
      setRequestError(undefined)
      setLogoError(undefined)
      onStartBestOf(buildStartBestOfParams(length, values, initialLogo), spec)
      return
    }

    const changes = buildUpdateBestOfParams(editing, values)
    if (!changes) {
      onClose()
      return
    }
    setIsSubmitting(true)
    setRequestError(undefined)
    setLogoError(undefined)
    onUpdateBestOf(changes, spec)
  }

  const onBack = () => {
    if (!isSubmitting) {
      onClose()
    }
  }

  const onEndSeries = () => {
    dispatch(
      openDialog({
        type: DialogType.LobbyEndBestOf,
        initData: {
          onConfirm: () => {
            onEndBestOf()
            onClose()
          },
        },
      }),
    )
  }

  const lengthSegments: ReadonlyArray<Segment<number | 'custom'>> = [
    ...BEST_OF_PRESET_LENGTHS.map(preset => ({
      value: preset,
      label: t('lobbies.seriesSetup.lengthPreset', {
        defaultValue: 'Bo{{length}}',
        length: preset,
      }),
      testName: `series-setup-length-${preset}`,
    })),
    {
      value: 'custom',
      label: t('lobbies.seriesSetup.lengthCustom', 'Custom'),
      testName: 'series-setup-length-custom',
    },
  ]

  const submitLabel = editing
    ? t('common.actions.save', 'Save')
    : t('lobbies.seriesSetup.startAction', 'Start series')
  const footerActions = (
    <>
      {editing ? (
        <EndSeriesButton
          label={t('lobbies.seriesSetup.endAction', 'End series')}
          disabled={isSubmitting}
          onClick={onEndSeries}
          testName='series-setup-end-button'
        />
      ) : null}
      <TextButton
        label={t('common.actions.cancel', 'Cancel')}
        disabled={isSubmitting}
        onClick={onClose}
        testName='series-setup-cancel-button'
      />
      <FilledButton
        label={submitLabel}
        iconStart={isSubmitting ? <DotsIndicator /> : undefined}
        disabled={!canSubmit}
        onClick={() => onSubmit()}
        testName={editing ? 'series-setup-save-button' : 'series-setup-start-button'}
      />
    </>
  )

  return (
    <SetupPage
      title={t('lobbies.seriesSetup.title', 'Series')}
      onBack={onBack}
      summary={summary}
      footerNotice={
        requestError ? (
          <RequestError role='alert' data-testid='series-setup-request-error'>
            <RequestErrorIcon icon='error' size={20} />
            <span>{requestError}</span>
          </RequestError>
        ) : undefined
      }
      footerActions={footerActions}>
      <Form noValidate={true} onSubmit={onSubmit}>
        <Section>
          <SectionHeader>{t('lobbies.seriesSetup.seriesSection', 'Series')}</SectionHeader>
          <SeriesRow>
            <TitleField
              ref={titleRef}
              label={t('lobbies.seriesSetup.titleLabel', 'Title (optional)')}
              floatingLabel={true}
              value={title}
              maxLength={BEST_OF_TITLE_MAX_LENGTH}
              disabled={isSubmitting}
              onChange={event => {
                edited()
                setTitle(event.target.value)
              }}
              inputProps={{ maxLength: BEST_OF_TITLE_MAX_LENGTH, autoComplete: 'off' }}
              testName='series-setup-title-input'
            />
            <LengthBlock>
              <LengthLabel id='series-setup-length-label'>
                {t('lobbies.seriesSetup.lengthLabel', 'Length')}
              </LengthLabel>
              {editing ? (
                <FixedLength data-testid='series-setup-fixed-length'>
                  {t('lobbies.seriesSetup.fixedLength', {
                    defaultValue: 'Best of {{length}}',
                    length: editing.length,
                  })}
                </FixedLength>
              ) : (
                <>
                  <SegmentedButtonGroup
                    segments={lengthSegments}
                    value={lengthChoice}
                    onChange={value => {
                      edited()
                      setLengthChoice(value)
                    }}
                    ariaLabelledBy='series-setup-length-label'
                    disabled={isSubmitting}
                    testName='series-setup-length'
                  />
                  {lengthChoice === 'custom' ? (
                    <CustomLengthField
                      type='number'
                      dense={true}
                      label={t('lobbies.seriesSetup.customLengthLabel', 'Games')}
                      floatingLabel={true}
                      value={customLength}
                      disabled={isSubmitting}
                      onChange={event => {
                        edited()
                        setCustomLength(event.target.value)
                      }}
                      errorText={
                        showLengthError
                          ? t('lobbies.seriesSetup.invalidLength', {
                              defaultValue: 'An odd number from 1 to {{max}}',
                              max: BEST_OF_MAX_LENGTH,
                            })
                          : undefined
                      }
                      inputProps={{ min: 1, max: BEST_OF_MAX_LENGTH, step: 2 }}
                      testName='series-setup-custom-length-input'
                    />
                  ) : null}
                </>
              )}
            </LengthBlock>
          </SeriesRow>
        </Section>

        <Section>
          <SectionHeader>{t('lobbies.seriesSetup.playersSection', 'Players')}</SectionHeader>
          <SidesGrid>
            {([0, 1] as const).map(sideIndex => (
              <BestOfSideEditor
                key={sideIndex}
                sideIndex={sideIndex}
                players={sides[sideIndex]}
                candidates={candidates}
                disabled={isSubmitting}
                onAdd={userId => addToSide(sideIndex, userId)}
                onRemove={userId => removeFromSide(sideIndex, userId)}
              />
            ))}
          </SidesGrid>
        </Section>

        <Section>
          <SectionHeader>{t('lobbies.seriesSetup.overlaySection', 'Caster overlay')}</SectionHeader>
          {rememberedState === 'failed' ? (
            <OverlayLoadError
              message={t(
                'lobbies.seriesSetup.rememberedLoadError',
                "Your last lines and logo couldn't be loaded.",
              )}
              onRetry={() => {
                setRememberedState('loading')
                loadRemembered()
              }}
            />
          ) : null}
          <OverlayGrid>
            <LineFields>
              <TextField
                label={t('lobbies.seriesSetup.line1Label', 'Line 1 (optional)')}
                floatingLabel={true}
                value={line1}
                maxLength={BEST_OF_OVERLAY_LINE_MAX_LENGTH}
                disabled={isSubmitting || isRememberedLoading}
                onChange={event => {
                  edited()
                  setLine1(event.target.value)
                }}
                inputProps={{ maxLength: BEST_OF_OVERLAY_LINE_MAX_LENGTH, autoComplete: 'off' }}
                testName='series-setup-line1-input'
              />
              <TextField
                label={t('lobbies.seriesSetup.line2Label', 'Line 2 (optional)')}
                floatingLabel={true}
                value={line2}
                maxLength={BEST_OF_OVERLAY_LINE_MAX_LENGTH}
                disabled={isSubmitting || isRememberedLoading}
                onChange={event => {
                  edited()
                  setLine2(event.target.value)
                }}
                inputProps={{ maxLength: BEST_OF_OVERLAY_LINE_MAX_LENGTH, autoComplete: 'off' }}
                testName='series-setup-line2-input'
              />
            </LineFields>
            <div ref={logoSlotRef}>
              <BestOfLogoSlot
                value={logo}
                loading={isRememberedLoading}
                disabled={isSubmitting}
                error={logoError}
                onPick={file => {
                  edited()
                  setLogoError(undefined)
                  setLogo({ kind: 'picked', file })
                }}
                onRefuse={message => setLogoError(message)}
                onRemove={() => {
                  edited()
                  setLogoError(undefined)
                  // With the remembered logo unknown, an empty slot would read as "no logo" while
                  // the server went on to use whatever one the host has, so the slot goes back to
                  // saying it doesn't know.
                  setLogo(initialLogo.kind === 'unknown' ? { kind: 'unknown' } : { kind: 'none' })
                }}
              />
            </div>
          </OverlayGrid>
          <OverlayHint>
            {t(
              'lobbies.seriesSetup.overlayHint',
              'Shown to observers on the scoreboard. Remembered for your next series.',
            )}
          </OverlayHint>
        </Section>
      </Form>
    </SetupPage>
  )
}

/** One side of the series being set up: who's on it, and adding more people up to the limit. */
function BestOfSideEditor({
  sideIndex,
  players,
  candidates,
  disabled,
  onAdd,
  onRemove,
}: {
  sideIndex: BestOfSideIndex
  players: ReadonlyArray<SbUserId>
  candidates: ReadonlyArray<BestOfCandidate>
  disabled: boolean
  onAdd: (userId: SbUserId) => void
  onRemove: (userId: SbUserId) => void
}) {
  const { t } = useTranslation()
  const { anchorRef, anchorX, anchorY, isOpen, openMenu, closeMenu } =
    useAnchoredMenu<HTMLButtonElement>('left', 'bottom')
  const usersById = useAppSelector(s => s.users.byId)
  const isFull = players.length >= BEST_OF_MAX_SIDE_SIZE
  const sideNumber = sideIndex + 1

  const seatLabels: Record<BestOfCandidate['seat'], string> = {
    player: t('lobbies.seriesSetup.seatPlayer', 'Player'),
    observer: t('lobbies.seriesSetup.seatObserver', 'Observer'),
    bench: t('lobbies.seriesSetup.seatBench', 'Bench'),
  }

  return (
    <SideColumn data-testid={`series-setup-side-${sideNumber}`}>
      <SideHeading>
        {t('lobbies.seriesSetup.sideHeading', {
          defaultValue: 'Side {{number}}',
          number: sideNumber,
        })}
      </SideHeading>
      {players.length ? (
        players.map(userId => (
          <SidePlayer
            key={userId}
            userId={userId}
            disabled={disabled}
            onRemove={() => onRemove(userId)}
          />
        ))
      ) : (
        <EmptySide>{t('lobbies.seriesSetup.emptySide', 'No players yet')}</EmptySide>
      )}
      <AddPlayerButton
        ref={anchorRef}
        label={t('lobbies.seriesSetup.addPlayer', 'Add player')}
        iconStart={<MaterialIcon icon='add' size={20} />}
        disabled={disabled || isFull || candidates.length === 0}
        onClick={openMenu}
        testName={`series-setup-add-player-${sideNumber}`}
      />
      <Popover
        open={isOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense>
          {candidates.map(candidate => (
            <MenuItem
              key={candidate.userId}
              dense
              text={usersById.get(candidate.userId)?.name ?? '…'}
              secondaryText={seatLabels[candidate.seat]}
              icon={<CandidateAvatar userId={candidate.userId} />}
              onClick={() => {
                onAdd(candidate.userId)
                closeMenu()
              }}
              testName={`series-setup-add-player-option-${candidate.userId}`}
            />
          ))}
        </MenuList>
      </Popover>
    </SideColumn>
  )
}

function SidePlayer({
  userId,
  disabled,
  onRemove,
}: {
  userId: SbUserId
  disabled: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const name = useAppSelector(s => s.users.byId.get(userId)?.name) ?? '…'

  return (
    <SidePlayerRow data-testid='series-setup-side-player'>
      <SidePlayerAvatar userId={userId} />
      <SidePlayerName text={name} />
      <Tooltip text={t('lobbies.seriesSetup.removePlayer', 'Remove from side')} tabIndex={-1}>
        <RemoveButton
          icon={<MaterialIcon icon='close' size={20} />}
          ariaLabel={t('lobbies.seriesSetup.removePlayerNamed', {
            defaultValue: 'Remove {{name}}',
            name,
          })}
          disabled={disabled}
          onClick={onRemove}
          testName={`series-setup-remove-player-${userId}`}
        />
      </Tooltip>
    </SidePlayerRow>
  )
}
