import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BEST_OF_MAX_LENGTH,
  BEST_OF_MAX_SIDE_SIZE,
  BEST_OF_PRESET_LENGTHS,
  BEST_OF_TITLE_MAX_LENGTH,
  BestOfSideIndex,
  getBestOfScore,
  getRunningBestOf,
  isValidBestOfLength,
  LobbyBestOfSides,
  suggestBestOfSides,
} from '../../common/lobbies/lobby-best-of'
import {
  StartLobbyBestOfRequest,
  UpdateLobbyBestOfRequest,
} from '../../common/lobbies/lobby-network'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton, TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { EllipsizedText } from '../material/ellipsized-text'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover } from '../material/popover'
import { Segment, SegmentedButtonGroup } from '../material/segmented-button'
import { TextField } from '../material/text-field'
import { Tooltip } from '../material/tooltip'
import { useAppSelector } from '../redux-hooks'
import { bodyLarge, bodyMedium, labelLarge, labelMedium } from '../styles/typography'
import { BestOfCandidate, getBestOfCandidates } from './room/best-of-display'
import { useBestOfSideLabel } from './room/best-of-parts'
import { useAnchoredMenu } from './room/room-parts'

const DEFAULT_LENGTH = 3

/** An empty side, shared so it reads the same on every render. */
const NO_PLAYERS: ReadonlyArray<SbUserId> = Object.freeze([])

const StyledDialog = styled(Dialog)`
  max-width: 560px;
`

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const FieldLabel = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const LengthRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
`

const CustomLengthField = styled(TextField)`
  width: 240px;
`

const FixedLength = styled.div`
  ${bodyLarge};
`

const SidesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
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

export interface LobbyBestOfDialogProps extends CommonDialogProps {
  onStart: (
    request: Omit<StartLobbyBestOfRequest, 'clientId'>,
    handlers: { onSuccess: () => void; onError: (err: Error) => void },
  ) => void
  onUpdate: (
    request: Omit<UpdateLobbyBestOfRequest, 'clientId'>,
    handlers: { onSuccess: () => void; onError: (err: Error) => void },
  ) => void
}

function sameSides(a: Readonly<LobbyBestOfSides>, b: Readonly<LobbyBestOfSides>): boolean {
  return a.every(
    (side, i) => side.length === b[i].length && side.every((userId, j) => userId === b[i][j]),
  )
}

/**
 * The host's form for a best-of series: starting one when none is running, or changing the title
 * and sides of the one that is. A running series' length is part of what its sides agreed to play,
 * so it can't be changed.
 *
 * Whether it starts or edits is settled when it opens, from the lobby as it stood then, so a series
 * starting or ending under it doesn't turn the form into the other one halfway through.
 */
export function LobbyBestOfDialog({ onCancel, close, onStart, onUpdate }: LobbyBestOfDialogProps) {
  const { t } = useTranslation()
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
  const [isSubmitting, setIsSubmitting] = useState(false)

  const length = lengthChoice === 'custom' ? Number(customLength) : lengthChoice
  const isLengthValid = editing !== undefined || isValidBestOfLength(length)
  const showLengthError = lengthChoice === 'custom' && customLength !== '' && !isLengthValid
  const trimmedTitle = title.trim()
  const canSubmit =
    !isSubmitting &&
    isLengthValid &&
    trimmedTitle.length <= BEST_OF_TITLE_MAX_LENGTH &&
    sides[0].length > 0 &&
    sides[1].length > 0

  const candidates = getBestOfCandidates(lobby, sides)

  const addToSide = (sideIndex: BestOfSideIndex, userId: SbUserId) => {
    setSides(current => {
      const next: LobbyBestOfSides = [[...current[0]], [...current[1]]]
      next[sideIndex].push(userId)
      return next
    })
  }
  const removeFromSide = (sideIndex: BestOfSideIndex, userId: SbUserId) => {
    setSides(current => {
      const next: LobbyBestOfSides = [[...current[0]], [...current[1]]]
      next[sideIndex] = next[sideIndex].filter(id => id !== userId)
      return next
    })
  }

  const handlers = {
    onSuccess: () => close(),
    // The refusal itself is reported by whoever sent the request; the form stays open so the host
    // can fix whatever it was about.
    onError: () => setIsSubmitting(false),
  }

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSubmit) {
      return
    }

    if (!editing) {
      setIsSubmitting(true)
      onStart({ length, ...(trimmedTitle ? { title: trimmedTitle } : {}), sides }, handlers)
      return
    }

    const titleChanged = trimmedTitle !== (editing.title ?? '')
    const sidesChanged = !sameSides(sides, editing.sides)
    if (!titleChanged && !sidesChanged) {
      close()
      return
    }

    setIsSubmitting(true)
    onUpdate(
      {
        ...(titleChanged ? { title: trimmedTitle || null } : {}),
        ...(sidesChanged ? { sides } : {}),
      },
      handlers,
    )
  }

  const lengthSegments: ReadonlyArray<Segment<number | 'custom'>> = [
    ...BEST_OF_PRESET_LENGTHS.map(preset => ({
      value: preset,
      label: t('lobbies.bestOfDialog.lengthPreset', {
        defaultValue: 'Bo{{length}}',
        length: preset,
      }),
    })),
    { value: 'custom', label: t('lobbies.bestOfDialog.lengthCustom', 'Custom') },
  ]

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={isSubmitting}
    />,
    <TextButton
      label={
        editing
          ? t('common.actions.save', 'Save')
          : t('lobbies.bestOfDialog.startAction', 'Start series')
      }
      key='submit'
      onClick={() => onSubmit()}
      disabled={!canSubmit}
      testName='best-of-submit-button'
    />,
  ]

  return (
    <StyledDialog
      title={
        editing
          ? t('lobbies.bestOfDialog.editTitle', 'Edit series')
          : t('lobbies.bestOfDialog.startTitle', 'Start a series')
      }
      buttons={buttons}
      onCancel={onCancel}>
      <Form noValidate={true} onSubmit={onSubmit}>
        <TextField
          label={t('lobbies.bestOfDialog.titleLabel', 'Title (optional)')}
          floatingLabel={true}
          value={title}
          maxLength={BEST_OF_TITLE_MAX_LENGTH}
          disabled={isSubmitting}
          onChange={event => setTitle(event.target.value)}
          inputProps={{ maxLength: BEST_OF_TITLE_MAX_LENGTH, autoComplete: 'off' }}
        />

        <Field>
          <FieldLabel>{t('lobbies.bestOfDialog.lengthLabel', 'Length')}</FieldLabel>
          {editing ? (
            <FixedLength>
              {t('lobbies.bestOfDialog.fixedLength', {
                defaultValue: 'Best of {{length}}',
                length: editing.length,
              })}
            </FixedLength>
          ) : (
            <LengthRow>
              <SegmentedButtonGroup
                segments={lengthSegments}
                value={lengthChoice}
                onChange={setLengthChoice}
                ariaLabel={t('lobbies.bestOfDialog.lengthLabel', 'Length')}
                disabled={isSubmitting}
              />
              {lengthChoice === 'custom' ? (
                <CustomLengthField
                  type='number'
                  dense={true}
                  label={t('lobbies.bestOfDialog.customLengthLabel', 'Games')}
                  floatingLabel={true}
                  value={customLength}
                  disabled={isSubmitting}
                  onChange={event => setCustomLength(event.target.value)}
                  errorText={
                    showLengthError
                      ? t('lobbies.bestOfDialog.invalidLength', {
                          defaultValue: 'An odd number from 1 to {{max}}',
                          max: BEST_OF_MAX_LENGTH,
                        })
                      : undefined
                  }
                  inputProps={{ min: 1, max: BEST_OF_MAX_LENGTH, step: 2 }}
                />
              ) : null}
            </LengthRow>
          )}
        </Field>

        <Field>
          <FieldLabel>{t('lobbies.bestOfDialog.playersLabel', 'Players')}</FieldLabel>
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
        </Field>
      </Form>
    </StyledDialog>
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

  const seatLabels: Record<BestOfCandidate['seat'], string> = {
    player: t('lobbies.bestOfDialog.seatPlayer', 'Player'),
    observer: t('lobbies.bestOfDialog.seatObserver', 'Observer'),
    bench: t('lobbies.bestOfDialog.seatBench', 'Bench'),
  }

  return (
    <SideColumn>
      <SideHeading>
        {t('lobbies.bestOfDialog.sideHeading', {
          defaultValue: 'Side {{number}}',
          number: sideIndex + 1,
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
        <EmptySide>{t('lobbies.bestOfDialog.emptySide', 'No players yet')}</EmptySide>
      )}
      <AddPlayerButton
        ref={anchorRef}
        label={t('lobbies.bestOfDialog.addPlayer', 'Add player')}
        iconStart={<MaterialIcon icon='add' size={20} />}
        disabled={disabled || isFull || candidates.length === 0}
        onClick={openMenu}
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
    <SidePlayerRow>
      <SidePlayerAvatar userId={userId} />
      <SidePlayerName text={name} />
      <Tooltip text={t('lobbies.bestOfDialog.removePlayer', 'Remove from side')} tabIndex={-1}>
        <RemoveButton
          icon={<MaterialIcon icon='close' size={20} />}
          ariaLabel={t('lobbies.bestOfDialog.removePlayerNamed', {
            defaultValue: 'Remove {{name}}',
            name,
          })}
          disabled={disabled}
          onClick={onRemove}
        />
      </Tooltip>
    </SidePlayerRow>
  )
}

export interface LobbyEndBestOfDialogProps extends CommonDialogProps {
  onConfirm: () => void
}

/**
 * Confirms ending the lobby's running best-of series before either side has won it, stating where
 * it stands. The series is captured when this opens, so the text doesn't change under the host as
 * the ending lands.
 */
export function LobbyEndBestOfDialog({ onCancel, close, onConfirm }: LobbyEndBestOfDialogProps) {
  const { t } = useTranslation()
  const currentBestOf = useAppSelector(s => getRunningBestOf(s.lobby.bestOfs))
  const [bestOf] = useState(currentBestOf)
  const side1 = useBestOfSideLabel(bestOf?.sides[0] ?? NO_PLAYERS)
  const side2 = useBestOfSideLabel(bestOf?.sides[1] ?? NO_PLAYERS)
  const [score1, score2] = bestOf ? getBestOfScore(bestOf) : [0, 0]
  const hasPendingGame = bestOf?.games.some(game => game.status === 'pending') ?? false

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('lobbies.endBestOfDialog.confirmAction', 'End series')}
      key='confirm'
      onClick={() => {
        close()
        onConfirm()
      }}
      testName='end-best-of-button'
    />,
  ]

  return (
    <StyledDialog
      title={t('lobbies.endBestOfDialog.title', 'End the series?')}
      buttons={buttons}
      onCancel={onCancel}>
      <FixedLength>
        {hasPendingGame
          ? t('lobbies.endBestOfDialog.bodyPending', {
              defaultValue:
                "{{side1}} and {{side2}} are at {{score1}}–{{score2}}. Ending the series now leaves it unfinished, and a game still waiting for its result won't count.",
              side1,
              side2,
              score1,
              score2,
            })
          : t('lobbies.endBestOfDialog.body', {
              defaultValue:
                '{{side1}} and {{side2}} are at {{score1}}–{{score2}}. Ending the series now leaves it unfinished.',
              side1,
              side2,
              score1,
              score2,
            })}
      </FixedLength>
    </StyledDialog>
  )
}
