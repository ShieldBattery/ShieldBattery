import { FormEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../../common/errors'
import {
  BEST_OF_DISPLAY_NAME_MAX_LENGTH,
  BEST_OF_MAX_LENGTH,
  BEST_OF_MAX_SIDE_SIZE,
  BEST_OF_OVERLAY_LINE_MAX_LENGTH,
  BEST_OF_PRESET_LENGTHS,
  BEST_OF_SIDE_NAME_MAX_LENGTH,
  BEST_OF_TITLE_MAX_LENGTH,
  BestOfHostResult,
  BestOfSideIndex,
  BestOfTextProblem,
  countBestOfTextCharacters,
  getBestOfGameNumber,
  getBestOfScore,
  getBestOfSideName,
  getBestOfTextProblem,
  getRunningBestOf,
  isBestOfAddedResult,
  isValidBestOfLength,
  LobbyBestOfAddedResultJson,
  LobbyBestOfJson,
  LobbyBestOfLaunchedGameJson,
  LobbyBestOfSides,
  suggestBestOfSides,
} from '../../../common/lobbies/lobby-best-of'
import {
  GetRememberedBestOfDisplayNamesResponse,
  GetRememberedBestOfOverlayResponse,
} from '../../../common/lobbies/lobby-network'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { openDialog } from '../../dialogs/action-creators'
import { DialogType } from '../../dialogs/dialog-type'
import { MaterialIcon } from '../../icons/material/material-icon'
import { LoadErrorRow } from '../../lists/load-error-row'
import logger from '../../logging/logger'
import { batchGetMapInfo } from '../../maps/action-creators'
import { FilledButton, IconButton, TextButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
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
import { bodyMedium, bodySmall, labelLarge, labelMedium } from '../../styles/typography'
import { StartBestOfParams, UpdateBestOfParams } from '../action-creators'
import { Section, SectionHeader } from '../create/game-setup-form'
import { lobbyActionErrorMessage } from '../lobby-action-errors'
import { SetupPage } from '../setup-page'
import { BestOfCandidate, getBestOfCandidates } from './best-of-display'
import { BestOfLogoSlot } from './best-of-logo-slot'
import { bestOfLabel, useBestOfSideLabel } from './best-of-parts'
import { useAnchoredMenu } from './room-parts'
import {
  batchDisplayNameLookups,
  bestOfFormatHint,
  bestOfLogoErrorMessage,
  bestOfTextProblemMessage,
  buildStartBestOfParams,
  buildUpdateBestOfParams,
  DisplayNameFields,
  fillRememberedDisplayNames,
  formatSeriesSetupSummary,
  getDisplayNamesToLoad,
  getFormatChangeOutcome,
  initialDisplayNameFields,
  LogoSlotValue,
  SeriesSetupValues,
  storedLogoSlot,
  typeDisplayName,
} from './series-setup'

const DEFAULT_LENGTH = 3

/**
 * The narrowest a side's column can be while a person's row fits their name and "Shown as" field
 * side by side. Below it the field moves under the name.
 */
const SIDE_ROW_STACKS_BELOW_PX = 360

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

/** Cancels `CheckBox`'s start padding so the box lines up with the length choices above it. */
const PlayAllCheckBox = styled(CheckBox)`
  align-self: flex-start;
  margin-left: -2px;
`

const SidesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
`

const SideColumn = styled.div`
  container: series-side / inline-size;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

/**
 * A person on a side: who they are, the name observers see them under, and removing them. In a
 * narrow column the "Shown as" field drops below the name, lined up with it.
 */
const SidePlayerRow = styled.div`
  display: grid;
  grid-template-areas: 'avatar name field remove';
  grid-template-columns: 24px minmax(0, 1fr) minmax(128px, 176px) 32px;
  align-items: start;
  column-gap: 8px;

  @container series-side (width < ${SIDE_ROW_STACKS_BELOW_PX}px) {
    grid-template-areas:
      'avatar name remove'
      '. field field';
    grid-template-columns: 24px minmax(0, 1fr) 32px;
    row-gap: 2px;
  }
`

/** Holds a row's leading and trailing parts level with the "Shown as" field beside them. */
const RowCell = styled.div`
  min-width: 0;
  height: 40px;

  display: flex;
  align-items: center;
`

const AvatarCell = styled(RowCell)`
  grid-area: avatar;
`

const NameCell = styled(RowCell)`
  grid-area: name;
`

const RemoveCell = styled(RowCell)`
  grid-area: remove;
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

const ShownAsField = styled(TextField)`
  grid-area: field;
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

const FullSideNote = styled.div`
  ${bodySmall};
  min-height: 40px;

  display: flex;
  align-items: center;

  color: var(--theme-on-surface-variant);
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

const SectionHint = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const SectionLoadError = styled(LoadErrorRow)`
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

const ResultsHeader = styled(SectionHeader)`
  display: flex;
  align-items: center;
  gap: 12px;
`

const ResultsTitle = styled(EllipsizedText)`
  flex: 0 1 auto;
  min-width: 0;
`

const ResultsOutcome = styled.span`
  ${labelMedium};
  flex-shrink: 0;
`

const ResultsScore = styled.span`
  ${labelLarge};
  flex-shrink: 0;
  margin-left: auto;

  color: var(--theme-on-surface);
  font-variant-numeric: tabular-nums;
`

const ResultRows = styled.div`
  display: flex;
  flex-direction: column;
`

/**
 * One entry of a series' results: its game number, what it was, and how it counts. The rows share
 * their columns, so the controls line up down the list.
 */
const ResultRow = styled.div`
  min-height: 48px;
  padding-block: 4px;

  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 16px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const ResultNumber = styled.div`
  ${labelLarge};
`

const ResultMain = styled.div`
  min-width: 0;

  display: flex;
  align-items: baseline;
  gap: 8px;
`

const ResultMapName = styled(EllipsizedText)`
  ${bodyMedium};
  flex: 0 1 auto;
  min-width: 0;
`

const ResultNote = styled.span`
  ${bodySmall};
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--theme-on-surface-variant);
`

/** A side's label in a result's choices, which gives way to the other choices when it's long. */
const ResultSideLabel = styled(EllipsizedText)`
  max-width: 160px;
`

const AddedResultWinner = styled.div`
  ${bodyMedium};
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

const AddedResultTrophy = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const AddedResultSide = styled(EllipsizedText)`
  max-width: 240px;
`

const AddResultLabel = styled.div`
  ${bodyMedium};
  grid-column: 1 / 3;
  color: var(--theme-on-surface-variant);
`

const AddResultButtons = styled.div`
  min-width: 0;

  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
`

const AddResultSide = styled(EllipsizedText)`
  max-width: 200px;
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
  /**
   * Loads the display names the host last gave the given people, at most as many as both sides
   * hold.
   */
  onLoadRememberedDisplayNames: (
    userIds: ReadonlyArray<SbUserId>,
    spec: RequestHandlingSpec<GetRememberedBestOfDisplayNamesResponse>,
  ) => void
  /**
   * Sets the result of a game of the lobby's latest series, answering with the series as that left
   * it.
   */
  onSetBestOfGameResult: (
    gameId: string,
    result: BestOfHostResult,
    spec: RequestHandlingSpec<LobbyBestOfJson>,
  ) => void
  /**
   * Adds a win for a side, with no game behind it, to the lobby's latest series, answering with the
   * series as that left it.
   */
  onAddBestOfResult: (winner: BestOfSideIndex, spec: RequestHandlingSpec<LobbyBestOfJson>) => void
  /**
   * Removes a result the host added by hand from the lobby's latest series, answering with the
   * series as that left it.
   */
  onRemoveBestOfResult: (resultId: string, spec: RequestHandlingSpec<LobbyBestOfJson>) => void
}

/**
 * The host's page for a best-of series, which takes over the room the way Game setup does: starting
 * one when none is running, or changing the format, title, sides, names and caster overlay of the
 * one that is. Under either form it lists the results of the lobby's latest series, which the host
 * can correct there.
 *
 * Whether it starts or edits is settled when it opens, from the lobby as it stood then, so a series
 * starting or ending under it doesn't turn the form into the other one halfway through. The one
 * exception is a correction made on the page itself that ends the running series or reopens the
 * ended one: the host asked for that change, so the form is replaced by the one the series now
 * needs, set up from the series the correction answered with. The lobby's own copy of the series
 * may not have caught up with the correction yet.
 *
 * A new series opens with the caster overlay the host's last one had, which the server remembers
 * per account, and every person on a side gets the display name the host last gave them unless the
 * series already has one for them.
 */
export function RoomSeriesSetup(props: RoomSeriesSetupProps) {
  const currentBestOf = useAppSelector(s => getRunningBestOf(s.lobby.bestOfs))
  const [form, setForm] = useState(() => ({ key: 0, editing: currentBestOf }))

  return (
    <SeriesSetupForm
      key={form.key}
      {...props}
      editing={form.editing}
      onRunningChange={bestOf =>
        setForm(current => ({
          key: current.key + 1,
          editing: bestOf.outcome ? undefined : bestOf,
        }))
      }
    />
  )
}

/** Picks the length choice a form opens with for `length`: its preset, or a custom one. */
function openingLengthChoice(length: number): number | 'custom' {
  return BEST_OF_PRESET_LENGTHS.includes(length) ? length : 'custom'
}

function SeriesSetupForm({
  editing,
  onRunningChange,
  onClose,
  onStartBestOf,
  onUpdateBestOf,
  onEndBestOf,
  onLoadRememberedOverlay,
  onLoadRememberedDisplayNames,
  onSetBestOfGameResult,
  onAddBestOfResult,
  onRemoveBestOfResult,
}: RoomSeriesSetupProps & {
  /** The running series the form edits, or `undefined` for a form that starts one. */
  editing: LobbyBestOfJson | undefined
  /**
   * Called when a correction made on the page ended the series the form edits, or reopened the
   * ended one shown under a form that starts one, with the series the correction answered with.
   */
  onRunningChange: (bestOf: LobbyBestOfJson) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const lobby = useAppSelector(s => s.lobby.info)
  const latestBestOf = useAppSelector(s => s.lobby.bestOfs.at(-1))

  const [title, setTitle] = useState(editing?.title ?? '')
  const [lengthChoice, setLengthChoice] = useState(() =>
    openingLengthChoice(editing?.length ?? DEFAULT_LENGTH),
  )
  const [customLength, setCustomLength] = useState(() =>
    editing && openingLengthChoice(editing.length) === 'custom' ? String(editing.length) : '',
  )
  const [playAll, setPlayAll] = useState(!!editing?.playAll)
  // The sides and "Shown as" fields the page opens with, and the remembered display names to look
  // up for them as it opens.
  const [opening] = useState(() => {
    const initial = editing?.sides ?? suggestBestOfSides(lobby) ?? [[], []]
    const openingSides: LobbyBestOfSides = [[...initial[0]], [...initial[1]]]
    const openingDisplayNames = initialDisplayNameFields(editing)
    return {
      sides: openingSides,
      displayNames: openingDisplayNames,
      nameLookups: batchDisplayNameLookups(
        getDisplayNamesToLoad(openingSides, openingDisplayNames),
      ),
    }
  })
  const [sides, setSides] = useState<LobbyBestOfSides>(opening.sides)
  const [sideNames, setSideNames] = useState<[string, string]>(() =>
    editing ? [getBestOfSideName(editing, 0) ?? '', getBestOfSideName(editing, 1) ?? ''] : ['', ''],
  )
  const [displayNames, setDisplayNames] = useState<DisplayNameFields>(opening.displayNames)
  const [pendingNameLoads, setPendingNameLoads] = useState(opening.nameLookups.length)
  const [hasNameLoadFailed, setHasNameLoadFailed] = useState(false)
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
  const [isCorrecting, setIsCorrecting] = useState(false)

  const titleRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const logoSlotRef = useRef<HTMLDivElement>(null)
  // Aborts the page's loads once it closes, including the ones started after it opened.
  const loadSignalRef = useRef<AbortSignal>(undefined)

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

  // A failed load only leaves fields empty: the server keeps what it remembers either way, since an
  // empty field the page didn't fill in sends nothing about that person.
  // Each lookup is counted in `pendingNameLoads` before it is requested.
  const requestRememberedNames = (batch: ReadonlyArray<SbUserId>, signal?: AbortSignal) => {
    onLoadRememberedDisplayNames(batch, {
      signal,
      onSuccess: ({ displayNames: remembered }) => {
        setDisplayNames(fields => fillRememberedDisplayNames(fields, remembered))
        setPendingNameLoads(count => count - 1)
      },
      onError: err => {
        logger.error(`Error loading remembered best-of display names: ${getErrorStack(err)}`)
        setHasNameLoadFailed(true)
        setPendingNameLoads(count => count - 1)
      },
    })
  }
  const loadRememberedNames = (userIds: ReadonlyArray<SbUserId>, signal?: AbortSignal) => {
    for (const batch of batchDisplayNameLookups(userIds)) {
      setPendingNameLoads(count => count + 1)
      requestRememberedNames(batch, signal)
    }
  }

  const isEditing = editing !== undefined
  const loadOnOpen = useEffectEvent((signal: AbortSignal) => {
    if (!isEditing) {
      loadRemembered(signal)
    }
    for (const batch of opening.nameLookups) {
      requestRememberedNames(batch, signal)
    }
  })

  useEffect(() => {
    titleRef.current?.focus()
    const controller = new AbortController()
    loadSignalRef.current = controller.signal
    loadOnOpen(controller.signal)
    return () => controller.abort()
  }, [])

  const length = lengthChoice === 'custom' ? Number(customLength) : lengthChoice
  const isLengthValid =
    (lengthChoice !== 'custom' || customLength.trim() !== '') && isValidBestOfLength(length)
  const showLengthError = lengthChoice === 'custom' && customLength !== '' && !isLengthValid
  const isRememberedLoading = rememberedState === 'loading'

  const titleProblem = getBestOfTextProblem(title, BEST_OF_TITLE_MAX_LENGTH)
  const line1Problem = getBestOfTextProblem(line1, BEST_OF_OVERLAY_LINE_MAX_LENGTH)
  const line2Problem = getBestOfTextProblem(line2, BEST_OF_OVERLAY_LINE_MAX_LENGTH)
  const sideNameProblems = [
    getBestOfTextProblem(sideNames[0], BEST_OF_SIDE_NAME_MAX_LENGTH),
    getBestOfTextProblem(sideNames[1], BEST_OF_SIDE_NAME_MAX_LENGTH),
  ] as const
  const getDisplayNameProblem = (userId: SbUserId) =>
    getBestOfTextProblem(displayNames.get(userId)?.value ?? '', BEST_OF_DISPLAY_NAME_MAX_LENGTH)
  const hasTextProblem =
    !!titleProblem ||
    !!line1Problem ||
    !!line2Problem ||
    sideNameProblems.some(Boolean) ||
    sides.flat().some(userId => !!getDisplayNameProblem(userId))

  const canSubmit =
    !isSubmitting &&
    !isCorrecting &&
    !isRememberedLoading &&
    pendingNameLoads === 0 &&
    isLengthValid &&
    !hasTextProblem &&
    sides[0].length > 0 &&
    sides[1].length > 0

  const candidates = getBestOfCandidates(lobby, sides)

  const usableSideName = (side: BestOfSideIndex) =>
    !sideNameProblems[side] ? sideNames[side].trim() || undefined : undefined
  const side1Label = useBestOfSideLabel(sides[0], usableSideName(0))
  const side2Label = useBestOfSideLabel(sides[1], usableSideName(1))
  // The score keeps up with the series while the page is open, since games can settle and results
  // be corrected under it.
  const liveBestOf = editing && latestBestOf?.id === editing.id ? latestBestOf : editing
  const summary = formatSeriesSetupSummary(t, {
    format: isLengthValid ? { length, ...(playAll ? { playAll: true } : {}) } : undefined,
    sideLabels: sides[0].length && sides[1].length ? [side1Label, side2Label] : undefined,
    score: liveBestOf ? getBestOfScore(liveBestOf) : undefined,
    title,
  })

  const problemText = (problem: BestOfTextProblem | undefined, maxLength: number) =>
    problem ? bestOfTextProblemMessage(problem, maxLength, t) : undefined

  // A refusal is about what was sent, so it stops applying once the host changes anything.
  const edited = () => setRequestError(undefined)

  const addToSide = (sideIndex: BestOfSideIndex, userId: SbUserId) => {
    edited()
    setSides(current => {
      const next: LobbyBestOfSides = [[...current[0]], [...current[1]]]
      next[sideIndex].push(userId)
      return next
    })
    loadRememberedNames(getDisplayNamesToLoad([[userId], []], displayNames), loadSignalRef.current)
  }
  const removeFromSide = (sideIndex: BestOfSideIndex, userId: SbUserId) => {
    edited()
    setSides(current => {
      const next: LobbyBestOfSides = [[...current[0]], [...current[1]]]
      next[sideIndex] = next[sideIndex].filter(id => id !== userId)
      return next
    })
  }
  const changeSideName = (sideIndex: BestOfSideIndex, name: string) => {
    edited()
    setSideNames(current => (sideIndex === 0 ? [name, current[1]] : [current[0], name]))
  }
  const changeDisplayName = (userId: SbUserId, name: string) => {
    edited()
    setDisplayNames(fields => typeDisplayName(fields, userId, name))
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

    const values: SeriesSetupValues = {
      length,
      playAll,
      title,
      sides,
      sideNames,
      displayNames,
      line1,
      line2,
      logo,
    }
    const spec: RequestHandlingSpec<void> = {
      onSuccess: () => onClose(),
      onError: onRequestError,
    }

    if (!editing) {
      setIsSubmitting(true)
      setRequestError(undefined)
      setLogoError(undefined)
      onStartBestOf(buildStartBestOfParams(values, initialLogo), spec)
      return
    }

    const changes = buildUpdateBestOfParams(editing, values)
    if (!changes) {
      onClose()
      return
    }
    const save = () => {
      setIsSubmitting(true)
      setRequestError(undefined)
      setLogoError(undefined)
      onUpdateBestOf(changes, spec)
    }

    const ending = liveBestOf ? getFormatChangeOutcome(liveBestOf, changes) : undefined
    if (!liveBestOf || !ending) {
      save()
      return
    }
    dispatch(
      openDialog({
        type: DialogType.LobbyBestOfFormatEnds,
        initData: {
          length,
          playAll,
          score: getBestOfScore(liveBestOf),
          outcome:
            ending.kind === 'won'
              ? {
                  kind: 'won',
                  winner: ending.winner,
                  winnerLabel: ending.winner === 0 ? side1Label : side2Label,
                }
              : { kind: 'drawn' },
          onConfirm: save,
        },
      }),
    )
  }

  // A correction applies at once and is answered with the series as it left it, which decides
  // whether the form still fits: one that edits a series the correction ended, or starts one while
  // the correction reopened the last one, is replaced.
  const correct = (send: (spec: RequestHandlingSpec<LobbyBestOfJson>) => void) => {
    setIsCorrecting(true)
    setRequestError(undefined)
    send({
      signal: loadSignalRef.current,
      onSuccess: bestOf => {
        setIsCorrecting(false)
        if (!!bestOf.outcome === isEditing) {
          onRunningChange(bestOf)
        }
      },
      onError: err => {
        logger.error(`Error correcting a best-of series: ${getErrorStack(err)}`)
        setIsCorrecting(false)
        setRequestError(lobbyActionErrorMessage(err, t, latestBestOf))
      },
    })
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

  const resultsSection = latestBestOf ? (
    <BestOfResultsSection
      bestOf={latestBestOf}
      isEditing={isEditing}
      disabled={isSubmitting || isCorrecting}
      onSetGameResult={(gameId, result) =>
        correct(spec => onSetBestOfGameResult(gameId, result, spec))
      }
      onAddResult={winner => correct(spec => onAddBestOfResult(winner, spec))}
      onRemoveResult={resultId => correct(spec => onRemoveBestOfResult(resultId, spec))}
    />
  ) : null

  const submitLabel = editing
    ? t('common.actions.save', 'Save')
    : t('lobbies.seriesSetup.startAction', 'Start series')
  const footerActions = (
    <>
      {editing ? (
        <EndSeriesButton
          label={t('lobbies.seriesSetup.endAction', 'End series')}
          disabled={isSubmitting || isCorrecting}
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
              countCharacters={countBestOfTextCharacters}
              errorText={problemText(titleProblem, BEST_OF_TITLE_MAX_LENGTH)}
              disabled={isSubmitting}
              onChange={event => {
                edited()
                setTitle(event.target.value)
              }}
              inputProps={{ autoComplete: 'off' }}
              testName='series-setup-title-input'
            />
            <LengthBlock>
              <LengthLabel id='series-setup-length-label'>
                {t('lobbies.seriesSetup.lengthLabel', 'Length')}
              </LengthLabel>
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
                      ? t('lobbies.seriesSetup.lengthOutOfRange', {
                          defaultValue: 'A number from 1 to {{max}}',
                          max: BEST_OF_MAX_LENGTH,
                        })
                      : undefined
                  }
                  inputProps={{ min: 1, max: BEST_OF_MAX_LENGTH, step: 1 }}
                  testName='series-setup-custom-length-input'
                />
              ) : null}
              <PlayAllCheckBox
                label={t('lobbies.seriesSetup.playAllLabel', 'Play all games')}
                checked={playAll}
                disabled={isSubmitting}
                onChange={event => {
                  edited()
                  setPlayAll(event.target.checked)
                }}
              />
              {isLengthValid ? (
                <SectionHint data-testid='series-setup-format-hint'>
                  {bestOfFormatHint({ length, ...(playAll ? { playAll: true } : {}) }, t)}
                </SectionHint>
              ) : null}
            </LengthBlock>
          </SeriesRow>
        </Section>

        {/* A running series' results sit by its format, which decides what they add up to. */}
        {isEditing ? resultsSection : null}

        <Section>
          <SectionHeader>{t('lobbies.seriesSetup.playersSection', 'Players')}</SectionHeader>
          <SectionHint>
            {t(
              'lobbies.seriesSetup.playersHint',
              'Observers see each player by their “Shown as” name in game. Remembered for your next series.',
            )}
          </SectionHint>
          {hasNameLoadFailed ? (
            <SectionLoadError
              message={t(
                'lobbies.seriesSetup.rememberedNamesLoadError',
                "Your remembered “Shown as” names couldn't be loaded.",
              )}
              onRetry={() => {
                setHasNameLoadFailed(false)
                loadRememberedNames(
                  getDisplayNamesToLoad(sides, displayNames),
                  loadSignalRef.current,
                )
              }}
            />
          ) : null}
          <SidesGrid>
            {([0, 1] as const).map(sideIndex => (
              <BestOfSideEditor
                key={sideIndex}
                sideIndex={sideIndex}
                name={sideNames[sideIndex]}
                nameError={problemText(sideNameProblems[sideIndex], BEST_OF_SIDE_NAME_MAX_LENGTH)}
                players={sides[sideIndex]}
                displayNames={displayNames}
                getDisplayNameError={userId =>
                  problemText(getDisplayNameProblem(userId), BEST_OF_DISPLAY_NAME_MAX_LENGTH)
                }
                candidates={candidates}
                disabled={isSubmitting}
                onNameChange={name => changeSideName(sideIndex, name)}
                onDisplayNameChange={changeDisplayName}
                onAdd={userId => addToSide(sideIndex, userId)}
                onRemove={userId => removeFromSide(sideIndex, userId)}
              />
            ))}
          </SidesGrid>
        </Section>

        <Section>
          <SectionHeader>{t('lobbies.seriesSetup.overlaySection', 'Caster overlay')}</SectionHeader>
          {rememberedState === 'failed' ? (
            <SectionLoadError
              message={t(
                'lobbies.seriesSetup.rememberedLoadError',
                "Your last lines and logo couldn't be loaded.",
              )}
              onRetry={() => {
                setRememberedState('loading')
                loadRemembered(loadSignalRef.current)
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
                countCharacters={countBestOfTextCharacters}
                errorText={problemText(line1Problem, BEST_OF_OVERLAY_LINE_MAX_LENGTH)}
                disabled={isSubmitting || isRememberedLoading}
                onChange={event => {
                  edited()
                  setLine1(event.target.value)
                }}
                inputProps={{ autoComplete: 'off' }}
                testName='series-setup-line1-input'
              />
              <TextField
                label={t('lobbies.seriesSetup.line2Label', 'Line 2 (optional)')}
                floatingLabel={true}
                value={line2}
                maxLength={BEST_OF_OVERLAY_LINE_MAX_LENGTH}
                countCharacters={countBestOfTextCharacters}
                errorText={problemText(line2Problem, BEST_OF_OVERLAY_LINE_MAX_LENGTH)}
                disabled={isSubmitting || isRememberedLoading}
                onChange={event => {
                  edited()
                  setLine2(event.target.value)
                }}
                inputProps={{ autoComplete: 'off' }}
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
          <SectionHint>
            {t(
              'lobbies.seriesSetup.overlayHint',
              'Shown to observers on the scoreboard. Remembered for your next series.',
            )}
          </SectionHint>
        </Section>

        {/* Under a form that starts a series, the results are the last series', so they come last. */}
        {isEditing ? null : resultsSection}
      </Form>
    </SetupPage>
  )
}

/**
 * One side of the series being set up: its name, who's on it with the name observers see each of
 * them under, and adding more people up to the limit.
 */
function BestOfSideEditor({
  sideIndex,
  name,
  nameError,
  players,
  displayNames,
  getDisplayNameError,
  candidates,
  disabled,
  onNameChange,
  onDisplayNameChange,
  onAdd,
  onRemove,
}: {
  sideIndex: BestOfSideIndex
  name: string
  nameError: string | undefined
  players: ReadonlyArray<SbUserId>
  displayNames: DisplayNameFields
  getDisplayNameError: (userId: SbUserId) => string | undefined
  candidates: ReadonlyArray<BestOfCandidate>
  disabled: boolean
  onNameChange: (name: string) => void
  onDisplayNameChange: (userId: SbUserId, name: string) => void
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
      <TextField
        label={t('lobbies.seriesSetup.sideNameLabel', {
          defaultValue: 'Side {{number}} name (optional)',
          number: sideNumber,
        })}
        floatingLabel={true}
        value={name}
        maxLength={BEST_OF_SIDE_NAME_MAX_LENGTH}
        countCharacters={countBestOfTextCharacters}
        errorText={nameError}
        disabled={disabled}
        onChange={event => onNameChange(event.target.value)}
        inputProps={{ autoComplete: 'off' }}
        testName={`series-setup-side-name-${sideNumber}`}
      />
      {players.length ? (
        players.map(userId => (
          <SidePlayer
            key={userId}
            userId={userId}
            displayName={displayNames.get(userId)?.value ?? ''}
            displayNameError={getDisplayNameError(userId)}
            disabled={disabled}
            onDisplayNameChange={value => onDisplayNameChange(userId, value)}
            onRemove={() => onRemove(userId)}
          />
        ))
      ) : (
        <EmptySide>{t('lobbies.seriesSetup.emptySide', 'No players yet')}</EmptySide>
      )}
      {isFull ? (
        <FullSideNote data-testid={`series-setup-side-full-${sideNumber}`}>
          {t('lobbies.seriesSetup.sideFull', {
            defaultValue: 'A side holds at most {{max}} players',
            max: BEST_OF_MAX_SIDE_SIZE,
          })}
        </FullSideNote>
      ) : (
        <AddPlayerButton
          ref={anchorRef}
          label={t('lobbies.seriesSetup.addPlayer', 'Add player')}
          iconStart={<MaterialIcon icon='add' size={20} />}
          disabled={disabled || candidates.length === 0}
          onClick={openMenu}
          testName={`series-setup-add-player-${sideNumber}`}
        />
      )}
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
  displayName,
  displayNameError,
  disabled,
  onDisplayNameChange,
  onRemove,
}: {
  userId: SbUserId
  displayName: string
  displayNameError: string | undefined
  disabled: boolean
  onDisplayNameChange: (value: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const name = useAppSelector(s => s.users.byId.get(userId)?.name) ?? '…'

  return (
    <SidePlayerRow data-testid='series-setup-side-player'>
      <AvatarCell>
        <SidePlayerAvatar userId={userId} />
      </AvatarCell>
      <NameCell>
        <SidePlayerName text={name} />
      </NameCell>
      <ShownAsField
        label={t('lobbies.seriesSetup.shownAsLabel', 'Shown as')}
        floatingLabel={true}
        alwaysHasValue={true}
        dense={true}
        value={displayName}
        maxLength={BEST_OF_DISPLAY_NAME_MAX_LENGTH}
        countCharacters={countBestOfTextCharacters}
        errorText={displayNameError}
        allowErrors={!!displayNameError}
        disabled={disabled}
        onChange={event => onDisplayNameChange(event.target.value)}
        inputProps={{
          placeholder: name,
          autoComplete: 'off',
          'aria-label': t('lobbies.seriesSetup.shownAsLabelNamed', {
            defaultValue: '{{name}} is shown to observers as',
            name,
          }),
        }}
        testName={`series-setup-shown-as-${userId}`}
      />
      <RemoveCell>
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
      </RemoveCell>
    </SidePlayerRow>
  )
}

/**
 * How a game of a series counts, as its result choices show it. Nothing is chosen while it waits
 * for its results or they gave it no winner.
 */
type GameResultChoice = BestOfSideIndex | 'notCounted' | undefined

function getGameResultChoice(game: LobbyBestOfLaunchedGameJson): GameResultChoice {
  switch (game.status) {
    case 'won':
      return game.winner
    case 'notCounted':
      return 'notCounted'
    case 'pending':
    case 'noWinner':
      return undefined
    default:
      return game satisfies never
  }
}

/**
 * The results of the lobby's latest best-of series, read live from the lobby, each of which the
 * host can correct on the spot: a game can be given to either side or stop counting, and a win can
 * be added for either side with no game behind it (or such a win removed). Under a form that edits
 * a series, it is that series; under one that starts a series, it is the last one, which ended.
 */
function BestOfResultsSection({
  bestOf,
  isEditing,
  disabled,
  onSetGameResult,
  onAddResult,
  onRemoveResult,
}: {
  bestOf: LobbyBestOfJson
  /** Whether the page's form edits this series, rather than starting the next one. */
  isEditing: boolean
  disabled: boolean
  onSetGameResult: (gameId: string, result: BestOfHostResult) => void
  onAddResult: (winner: BestOfSideIndex) => void
  onRemoveResult: (resultId: string) => void
}) {
  const { t } = useTranslation()
  const side1Label = useBestOfSideLabel(bestOf.sides[0], getBestOfSideName(bestOf, 0))
  const side2Label = useBestOfSideLabel(bestOf.sides[1], getBestOfSideName(bestOf, 1))
  const sideLabels: [string, string] = [side1Label, side2Label]
  const [score1, score2] = getBestOfScore(bestOf)
  // The server takes no more wins once the score adds up to the longest series there can be.
  const isFull = score1 + score2 >= BEST_OF_MAX_LENGTH

  const title = isEditing
    ? t('lobbies.seriesSetup.resultsSection', 'Results')
    : t('lobbies.seriesSetup.resultsSectionOf', {
        defaultValue: 'Results · {{label}}',
        label: bestOfLabel(bestOf, t),
      })
  let outcomeNote: string | undefined
  switch (bestOf.outcome?.kind) {
    case undefined:
      break
    case 'won':
      outcomeNote = t('lobbies.seriesSetup.resultsFinal', 'Final')
      break
    case 'drawn':
      outcomeNote = t('lobbies.seriesSetup.resultsDrawn', 'Drawn')
      break
    case 'unfinished':
      outcomeNote = t('lobbies.seriesSetup.resultsEndedEarly', 'Ended early')
      break
    default:
      bestOf.outcome satisfies never
  }

  return (
    <Section data-testid='series-results'>
      <ResultsHeader>
        <ResultsTitle text={title} />
        {outcomeNote ? (
          <ResultsOutcome data-testid='series-results-outcome'>{outcomeNote}</ResultsOutcome>
        ) : null}
        <ResultsScore data-testid='series-results-score'>
          {t('lobbies.room.bestOf.score', {
            defaultValue: '{{score1}} – {{score2}}',
            score1,
            score2,
          })}
        </ResultsScore>
      </ResultsHeader>
      <ResultRows>
        {bestOf.games.map((entry, index) =>
          isBestOfAddedResult(entry) ? (
            <AddedResultRow
              key={`added-${entry.resultId}`}
              result={entry}
              gameNumber={getBestOfGameNumber(bestOf, index)}
              sideLabels={sideLabels}
              disabled={disabled}
              onRemove={() => onRemoveResult(entry.resultId)}
            />
          ) : (
            <GameResultRow
              key={`game-${entry.gameId}`}
              game={entry}
              gameNumber={getBestOfGameNumber(bestOf, index)}
              sideLabels={sideLabels}
              disabled={disabled}
              onSetResult={result => onSetGameResult(entry.gameId, result)}
            />
          ),
        )}
        <ResultRow data-testid='series-results-add'>
          <AddResultLabel>{t('lobbies.seriesSetup.addResult', 'Add a result')}</AddResultLabel>
          <AddResultButtons>
            {([0, 1] as const).map(side => (
              <TextButton
                key={side}
                label={
                  <AddResultSide
                    text={t('lobbies.seriesSetup.addWinFor', {
                      defaultValue: 'Win for {{side}}',
                      side: sideLabels[side],
                    })}
                  />
                }
                iconStart={<MaterialIcon icon='add' size={20} />}
                disabled={disabled || isFull}
                onClick={() => onAddResult(side)}
                testName={`series-results-add-${side + 1}`}
              />
            ))}
          </AddResultButtons>
        </ResultRow>
      </ResultRows>
      <SectionHint>
        {t(
          'lobbies.seriesSetup.resultsHint',
          'Changes apply right away and are announced in the lobby chat.',
        )}
      </SectionHint>
    </Section>
  )
}

/**
 * A game launched as part of the series: its number, the map it was played on (once the lobby has
 * it among its finished games), anything to note about how it counts, and the choice of how it
 * counts, which applies as soon as it's picked.
 */
function GameResultRow({
  game,
  gameNumber,
  sideLabels,
  disabled,
  onSetResult,
}: {
  game: LobbyBestOfLaunchedGameJson
  gameNumber: number
  sideLabels: [string, string]
  disabled: boolean
  onSetResult: (result: BestOfHostResult) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const mapId = useAppSelector(s => s.lobby.series.find(g => g.gameId === game.gameId)?.mapId)
  const mapName = useAppSelector(s => (mapId ? s.maps.byId.get(mapId)?.name : undefined))

  // A series' earlier games can be on maps the lobby has since moved off of, which nothing else
  // here has any reason to have loaded.
  useEffect(() => {
    if (mapId) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, mapId])

  let note: string | undefined
  if (game.status === 'pending') {
    note = t('lobbies.room.series.waitingForResults', 'Waiting for results')
  } else if (game.status === 'noWinner') {
    note = t('lobbies.room.series.noRecordedWinner', 'No recorded winner')
  } else if (game.status === 'won' && game.setByHost) {
    note = t('lobbies.room.bestOf.setByHost', 'Set by host')
  }

  const choice = getGameResultChoice(game)
  const segments: ReadonlyArray<Segment<GameResultChoice>> = [
    ...([0, 1] as const).map(side => ({
      value: side,
      label: <ResultSideLabel text={sideLabels[side]} />,
      testName: `series-results-${game.gameId}-side-${side + 1}`,
    })),
    {
      value: 'notCounted',
      label: t('lobbies.seriesSetup.resultNotCounted', 'Not counted'),
      neutral: true,
      testName: `series-results-${game.gameId}-not-counted`,
    },
  ]

  return (
    <ResultRow data-testid={`series-results-game-${game.gameId}`}>
      <ResultNumber>
        {t('lobbies.room.series.gameNumber', 'Game {{number}}', { number: gameNumber })}
      </ResultNumber>
      <ResultMain>
        {mapName ? <ResultMapName text={mapName} /> : null}
        {note ? <ResultNote>{note}</ResultNote> : null}
      </ResultMain>
      <SegmentedButtonGroup
        segments={segments}
        value={choice}
        onChange={value => {
          // The server refuses a game set to the result it already counts as.
          if (value === choice || value === undefined) {
            return
          }
          onSetResult(
            value === 'notCounted' ? { status: 'notCounted' } : { status: 'won', winner: value },
          )
        }}
        ariaLabel={t('lobbies.seriesSetup.resultChoicesLabel', {
          defaultValue: 'How game {{number}} counts',
          number: gameNumber,
        })}
        disabled={disabled}
        testName={`series-results-${game.gameId}`}
      />
    </ResultRow>
  )
}

/** A win the host added to the series by hand: its number, the side it is for, and removing it. */
function AddedResultRow({
  result,
  gameNumber,
  sideLabels,
  disabled,
  onRemove,
}: {
  result: LobbyBestOfAddedResultJson
  gameNumber: number
  sideLabels: [string, string]
  disabled: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()

  return (
    <ResultRow data-testid={`series-results-added-${result.resultId}`}>
      <ResultNumber>
        {t('lobbies.room.series.gameNumber', 'Game {{number}}', { number: gameNumber })}
      </ResultNumber>
      <ResultMain>
        <ResultNote>{t('lobbies.room.bestOf.addedByHost', 'Added by host')}</ResultNote>
      </ResultMain>
      <AddedResultWinner>
        <AddedResultTrophy icon='trophy' size={18} filled />
        <AddedResultSide text={sideLabels[result.winner]} />
        <Tooltip text={t('lobbies.seriesSetup.removeResult', 'Remove this result')} tabIndex={-1}>
          <RemoveButton
            icon={<MaterialIcon icon='close' size={20} />}
            ariaLabel={t('lobbies.seriesSetup.removeResultNamed', {
              defaultValue: 'Remove the added win for {{side}}',
              side: sideLabels[result.winner],
            })}
            disabled={disabled}
            onClick={onRemove}
            testName={`series-results-remove-${result.resultId}`}
          />
        </Tooltip>
      </AddedResultWinner>
    </ResultRow>
  )
}
