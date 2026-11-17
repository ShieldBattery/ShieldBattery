import { TFunction } from 'i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { filterColorCodes, MapInfoJson, SbMapId, tilesetToName } from '../../common/maps'
import { RaceChar, raceCharToLabel } from '../../common/races'
import { canPlayMapAlone } from '../../common/solo-games'
import { isInParticipatingGame } from '../active-game/game-client-reducer'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { LoadErrorRow } from '../lists/load-error-row'
import { isInLobby } from '../lobbies/lobby-reducer'
import { RaceIcon } from '../lobbies/race-icon'
import { RacePicker } from '../lobbies/race-picker'
import { getMapInfo } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { isMatchmakingAtom } from '../matchmaking/matchmaking-atoms'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, bodySmall, labelLarge, singleLine } from '../styles/typography'
import { launchSoloGame } from './action-creators'
import {
  ComputerForceSummary,
  getComputerSummary,
  getPlayAloneSlots,
  PlayAloneSlot,
  resolvePlayAloneSlot,
  slotFixedRace,
} from './play-alone-model'
import { soloLaunchPendingAtom } from './solo-game-atoms'
import { soloGameRequestErrorMessage } from './solo-game-errors'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

/** Something the user is doing that keeps them from starting a game alone. */
export type PlayAloneBusyReason = 'inGame' | 'inLobby' | 'searching'

/** What the dialog knows about the map so far. */
export type PlayAloneMapState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'notFound' }
  | { kind: 'loaded'; map: ReadonlyDeep<MapInfoJson> }

export interface PlayAloneDialogProps extends CommonDialogProps {
  mapId: SbMapId
}

/** Reads what the user is doing from the client's state, for whether they can start a game. */
function usePlayAloneBusyReason(): PlayAloneBusyReason | undefined {
  const inGame = useAppSelector(s => isInParticipatingGame(s.gameClient))
  const inLobby = useAppSelector(s => isInLobby(s.lobby))
  const searching = useAtomValue(isMatchmakingAtom)

  if (inGame) {
    return 'inGame'
  } else if (inLobby) {
    return 'inLobby'
  } else if (searching) {
    return 'searching'
  } else {
    return undefined
  }
}

/**
 * Sets up a game on a map that the user plays alone (their slot and race), and starts it. Loads the
 * map's info if the client doesn't have it yet.
 */
export function PlayAloneDialog({ mapId, onCancel }: PlayAloneDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const map = useAppSelector(s => s.maps.byId.get(mapId))
  const hasMap = !!map
  const busyReason = usePlayAloneBusyReason()
  const setLaunchPending = useSetAtom(soloLaunchPendingAtom)

  const [attempt, setAttempt] = useState(0)
  // The load attempt that last finished without the map turning up, and whether it failed
  const [settled, setSettled] = useState<{ attempt: number; failed: boolean }>()

  useEffect(() => {
    if (hasMap) {
      return undefined
    }

    const abortController = new AbortController()
    dispatch(
      getMapInfo(mapId, {
        signal: abortController.signal,
        onSuccess: () => setSettled({ attempt, failed: false }),
        onError: () => setSettled({ attempt, failed: true }),
      }),
    )
    return () => abortController.abort()
  }, [attempt, dispatch, hasMap, mapId])

  let mapState: PlayAloneMapState
  if (map) {
    mapState = { kind: 'loaded', map }
  } else if (settled?.attempt === attempt) {
    mapState = settled.failed
      ? { kind: 'error', onRetry: () => setAttempt(attempt + 1) }
      : { kind: 'notFound' }
  } else {
    mapState = { kind: 'loading' }
  }

  const onStart = (slot: number, race: RaceChar | undefined) => {
    dispatch(closeDialog(DialogType.PlayAlone))
    dispatch(openDialog({ type: DialogType.LaunchingGame }))
    setLaunchPending(true)
    dispatch(
      launchSoloGame(
        { map: mapId, slot, race },
        {
          onSuccess: () => {},
          onError: err => {
            setLaunchPending(false)
            dispatch(closeDialog(DialogType.LaunchingGame))
            snackbarController.showSnackbar(soloGameRequestErrorMessage(err, t))
          },
        },
      ),
    )
  }

  return (
    <PlayAloneDialogView
      mapState={mapState}
      busyReason={busyReason}
      onStart={onStart}
      onCancel={onCancel}
    />
  )
}

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const MapRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const MapThumbnailWrapper = styled.div`
  width: 96px;
  height: 96px;
  flex-shrink: 0;
`

const MapText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`

const MapName = styled.div`
  ${bodyLarge};
  ${singleLine};
`

const MapMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const SectionText = styled.div`
  ${bodyLarge};
`

const FixedRace = styled.div`
  ${bodyLarge};
  display: flex;
  align-items: center;
  gap: 8px;
`

const FixedRaceIcon = styled(RaceIcon)`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  fill: currentColor;
`

const ComputerList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ComputerRow = styled.li`
  ${bodyMedium};
  display: flex;
  align-items: center;
  gap: 8px;
`

const ComputerIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const Notice = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const NotFoundText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

function forceLabel(forceName: string, forceIndex: number, t: TFunction): string {
  const name = filterColorCodes(forceName).trim()
  return name
    ? name
    : t('soloGames.playAlone.unnamedForce', {
        defaultValue: 'Force {{number}}',
        number: forceIndex + 1,
      })
}

export interface PlayAloneDialogViewProps {
  mapState: PlayAloneMapState
  /** What keeps the user from starting a game right now, if anything does. */
  busyReason: PlayAloneBusyReason | undefined
  /**
   * Starts the game from `slot` (a map player slot) as `race`, which is only given when the map
   * leaves the slot's race free.
   */
  onStart: (slot: number, race: RaceChar | undefined) => void
  onCancel: () => void
}

/** What the play alone dialog shows for a map, given what it knows about it and the user. */
export function PlayAloneDialogView({
  mapState,
  busyReason,
  onStart,
  onCancel,
}: PlayAloneDialogViewProps) {
  const { t } = useTranslation()
  const [pickedSlotId, setPickedSlotId] = useState<number>()
  const [pickedRace, setPickedRace] = useState<RaceChar>('r')

  const map = mapState.kind === 'loaded' ? mapState.map : undefined
  const forces = map?.mapData.umsForces ?? []
  const playable = !!map && canPlayMapAlone(map.kind, forces)
  const slots = playable ? getPlayAloneSlots(forces) : []
  const slot = resolvePlayAloneSlot(slots, pickedSlotId)
  const fixedRace = slot ? slotFixedRace(slot) : undefined
  const canStart = playable && !!slot && !busyReason

  const start = () => {
    if (canStart) {
      onStart(slot.id, fixedRace ? undefined : pickedRace)
    }
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.code !== ENTER && event.code !== ENTER_NUMPAD) {
        return false
      }
      // A focused control takes Enter for itself (a button presses, a select opens)
      if (
        event.target instanceof Element &&
        event.target.closest('button, input, textarea, [role="button"]')
      ) {
        return false
      }
      if (!canStart) {
        return false
      }

      start()
      return true
    },
  })

  let body: ReactNode
  switch (mapState.kind) {
    case 'loading':
      body = <LoadingDotsArea />
      break
    case 'error':
      body = (
        <LoadErrorRow
          message={t('soloGames.playAlone.loadError', "Couldn't load this map.")}
          onRetry={mapState.onRetry}
        />
      )
      break
    case 'notFound':
      body = (
        <NotFoundText>
          {t('soloGames.playAlone.notFound', 'This map could not be found.')}
        </NotFoundText>
      )
      break
    case 'loaded':
      body = (
        <Content>
          <MapSummary map={mapState.map} />
          {playable && slot ? (
            <>
              <PlayAsSection slots={slots} slot={slot} onChange={setPickedSlotId} />
              <Section>
                <SectionHeader>{t('soloGames.playAlone.race', 'Race')}</SectionHeader>
                {fixedRace ? (
                  <FixedRace>
                    <FixedRaceIcon race={fixedRace} />
                    {raceCharToLabel(fixedRace, t)}
                  </FixedRace>
                ) : (
                  <RacePicker race={pickedRace} onSetRace={setPickedRace} />
                )}
              </Section>
              <AgainstSection summary={getComputerSummary(forces)} />
              {busyReason ? <Notice>{busyReasonText(busyReason, t)}</Notice> : null}
            </>
          ) : (
            <Notice>
              {t(
                'soloGames.playAlone.notPlayable',
                "This map can't be played alone. It needs a slot for you and a computer to play " +
                  'against.',
              )}
            </Notice>
          )}
        </Content>
      )
      break
    default:
      body = mapState satisfies never
  }

  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
  ]
  // A map that turned out not to exist or not to be playable alone offers nothing to start
  if (mapState.kind === 'loading' || mapState.kind === 'error' || playable) {
    buttons.push(
      <TextButton
        key='start'
        label={t('soloGames.playAlone.start', 'Start')}
        disabled={!canStart}
        onClick={start}
        testName='play-alone-start-button'
      />,
    )
  }

  return (
    <StyledDialog
      title={t('soloGames.playAlone.title', 'Play alone')}
      buttons={buttons}
      onCancel={onCancel}>
      {body}
    </StyledDialog>
  )
}

function busyReasonText(reason: PlayAloneBusyReason, t: TFunction): string {
  switch (reason) {
    case 'inGame':
      return t('soloGames.playAlone.busyInGame', "You can start once you're out of your game.")
    case 'inLobby':
      return t('soloGames.playAlone.busyInLobby', 'Leave your lobby to play alone.')
    case 'searching':
      return t('soloGames.playAlone.busySearching', 'Stop searching for a match to play alone.')
    default:
      return reason satisfies never
  }
}

function MapSummary({ map }: { map: ReadonlyDeep<MapInfoJson> }) {
  const { t } = useTranslation()
  const name = filterColorCodes(map.name)
  const meta = [tilesetToName(map.mapData.tileset, t), `${map.mapData.width}×${map.mapData.height}`]
  return (
    <MapRow>
      <MapThumbnailWrapper>
        <MapThumbnail map={map} forceAspectRatio={1} size={256} />
      </MapThumbnailWrapper>
      <MapText>
        <MapName>{name}</MapName>
        <MapMeta>{meta.join(' · ')}</MapMeta>
      </MapText>
    </MapRow>
  )
}

function PlayAsSection({
  slots,
  slot,
  onChange,
}: {
  slots: ReadonlyArray<PlayAloneSlot>
  slot: PlayAloneSlot
  onChange: (slotId: number) => void
}) {
  const { t } = useTranslation()

  if (slots.length === 1) {
    const name = filterColorCodes(slot.forceName).trim()
    return name ? (
      <Section>
        <SectionHeader>{t('soloGames.playAlone.playAs', 'Play as')}</SectionHeader>
        <SectionText>{name}</SectionText>
      </Section>
    ) : null
  }

  return (
    <Section>
      <Select
        label={t('soloGames.playAlone.playAs', 'Play as')}
        value={slot.id}
        dense={true}
        allowErrors={false}
        onChange={onChange}>
        {slots.map(s => (
          <SelectOption
            key={s.id}
            value={s.id}
            text={t('soloGames.playAlone.slotLabel', {
              defaultValue: '{{force}} · Slot {{number}}',
              force: forceLabel(s.forceName, s.forceIndex, t),
              number: s.indexInForce + 1,
            })}
            secondaryText={fixedRaceLabel(s, t)}
          />
        ))}
      </Select>
    </Section>
  )
}

function fixedRaceLabel(slot: PlayAloneSlot, t: TFunction): string | undefined {
  const race = slotFixedRace(slot)
  return race ? raceCharToLabel(race, t) : undefined
}

function AgainstSection({ summary }: { summary: ReadonlyArray<ComputerForceSummary> }) {
  const { t } = useTranslation()
  return (
    <Section>
      <SectionHeader>{t('soloGames.playAlone.against', 'Against')}</SectionHeader>
      <ComputerList>
        {summary.map(force => (
          <ComputerRow key={force.forceIndex}>
            <ComputerIcon icon='smart_toy' size={20} />
            {t('soloGames.playAlone.computerForce', {
              defaultValue: '{{force}} · {{count}} computers',
              defaultValue_one: '{{force}} · {{count}} computer',
              force: forceLabel(force.forceName, force.forceIndex, t),
              count: force.computers,
            })}
          </ComputerRow>
        ))}
      </ComputerList>
    </Section>
  )
}
