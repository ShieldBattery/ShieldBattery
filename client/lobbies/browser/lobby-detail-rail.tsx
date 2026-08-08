import { TFunction } from 'i18next'
import { m } from 'motion/react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { LobbySummarySlotJson, LobbySummaryTeamJson } from '../../../common/lobbies/lobby-network'
import { tilesetToName } from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { AvatarStack } from '../../avatars/avatar-stack'
import { MaterialIcon } from '../../icons/material/material-icon'
import { openMapPreviewDialog } from '../../maps/action-creators'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { FilledButton, TextButton } from '../../material/button'
import { useAppDispatch } from '../../redux-hooks'
import {
  bodyMedium,
  bodySmall,
  labelMedium,
  singleLine,
  titleMedium,
} from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'
import { useJoinLobbyAction } from '../use-join-lobby-action'
import { HostCrown, LobbyChip, RaceMark, SectionLabel } from './browser-parts'
import { hasObserverTeam, hasOpenObserverSlot, LobbySummary, observerCounts } from './summary-utils'

const RailRoot = styled.div`
  /* The rail sits on a raised surface, so avatar-stack rings need to match it rather than the page. */
  --sb-avatar-stack-ring: var(--theme-container-low);

  width: 360px;
  flex-shrink: 0;
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border-radius: 8px;
  background-color: var(--theme-container-low);
  overflow-y: auto;
`

const PlaceholderRoot = styled(RailRoot)`
  ${bodyMedium};

  align-items: center;
  justify-content: center;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const LobbyName = styled.div`
  ${titleMedium};
`

const HostLine = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  color: var(--theme-on-surface-variant);
`

const HostNames = styled.span`
  ${singleLine};
  min-width: 0;
`

const MapSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

/**
 * The thumbnail sizes itself with percentage heights, so its frame needs an explicit aspect ratio
 * to give it a definite height — without one, the percentage-height chain collapses to 0 against
 * this rail's auto-height layout.
 */
const MapFrame = styled.div<{ $aspectRatio: number }>`
  width: 100%;
  aspect-ratio: ${props => props.$aspectRatio};
  flex-shrink: 0;

  border-radius: 4px;
  overflow: hidden;
`

const MapMeta = styled.div`
  ${bodySmall};

  color: var(--theme-on-surface-variant);
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Slots = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionHeading = styled(SectionLabel)`
  display: flex;
  align-items: baseline;
  gap: 6px;
`

/** Every seat is the same shape, whoever is or isn't in it, so the column reads as one list. */
const slotRow = css`
  min-height: 36px;
  padding: 2px 8px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 8px;
`

const OccupiedRow = styled(m.div)`
  ${slotRow};
  background-color: var(--theme-container-high);
`

const OpenRow = styled.div`
  ${slotRow};

  border: 1px dashed var(--theme-outline);
  color: var(--theme-on-surface-variant);
`

const ClosedRow = styled.div`
  ${slotRow};

  color: var(--theme-on-surface-variant);
  opacity: 0.6;
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const RowIcon = styled.span`
  width: 24px;
  flex-shrink: 0;

  display: flex;
  justify-content: center;
  color: var(--theme-on-surface-variant);
`

const RowName = styled.div`
  ${bodyMedium};
  ${singleLine};

  flex-grow: 1;
  /* Never let a crowded row squeeze the name out entirely — truncate it instead. */
  min-width: 40px;
`

const RowTrailing = styled.span`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`

const QuietLine = styled.div`
  ${bodyMedium};
  padding: 0 8px;

  color: var(--theme-on-surface-variant);
`

const FriendsCallout = styled.div`
  --sb-avatar-stack-ring: rgb(from var(--theme-primary) r g b / 0.12);

  padding: 8px 12px;

  display: flex;
  align-items: center;
  gap: 10px;

  border-radius: 8px;
  background-color: rgb(from var(--theme-primary) r g b / 0.12);
`

const FriendsText = styled.div`
  ${labelMedium};
  min-width: 0;

  color: var(--theme-on-surface);
`

const RailFoot = styled.div`
  margin-top: auto;
  padding-top: 8px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const JoinError = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

const FullWidthFilledButton = styled(FilledButton)`
  width: 100%;
`

const FullWidthTextButton = styled(TextButton)`
  width: 100%;
`

/** A label for the way a lobby's seats are split up, e.g. "3 vs 5" or "3 teams". */
function gameSubTypeLabel(
  gameType: GameType,
  playerTeams: ReadonlyArray<LobbySummaryTeamJson>,
  t: TFunction,
): string | undefined {
  if (!isTeamType(gameType) || playerTeams.length < 2) {
    return undefined
  }

  if (gameType === GameType.TopVsBottom) {
    return t('lobbies.createLobby.gameSubTypeOptionTvB', {
      defaultValue: '{{topSlots}} vs {{bottomSlots}}',
      topSlots: playerTeams[0].slots.length,
      bottomSlots: playerTeams[1].slots.length,
    })
  }

  return t('lobbies.createLobby.gameSubTypeOption', {
    defaultValue: '{{numTeams}} teams',
    numTeams: playerTeams.length,
  })
}

/**
 * One seat of the previewed lobby. Occupied seats fade in as they fill, so a lobby filling up while
 * you read it is visible movement rather than a silent swap.
 */
function SlotRow({
  slot,
  hostId,
  isObserverTeam,
}: {
  slot: LobbySummarySlotJson
  hostId: SbUserId
  isObserverTeam: boolean
}) {
  const { t } = useTranslation()

  switch (slot.type) {
    case 'open':
      return (
        <OpenRow>
          <RowIcon>
            <MaterialIcon icon='circle' size={16} />
          </RowIcon>
          <RowName>{t('lobbies.browser.slotOpen', 'Open')}</RowName>
        </OpenRow>
      )
    case 'closed':
      return (
        <ClosedRow>
          <RowIcon>
            <MaterialIcon icon='block' size={18} />
          </RowIcon>
          <RowName>{t('lobbies.browser.slotClosed', 'Closed')}</RowName>
        </ClosedRow>
      )
    case 'computer':
      return (
        <OccupiedRow initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <RowIcon>
            <MaterialIcon icon='smart_toy' size={20} />
          </RowIcon>
          <RowName>{t('lobbies.browser.slotComputer', 'Computer')}</RowName>
          <RowTrailing>
            <RaceMark race={slot.race} />
          </RowTrailing>
        </OccupiedRow>
      )
    case 'human':
    case 'observer':
      return (
        <OccupiedRow initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <RowAvatar userId={slot.userId} />
          <RowName as='span'>
            <ConnectedUsername userId={slot.userId} />
          </RowName>
          {slot.userId === hostId ? <HostCrown /> : null}
          {!isObserverTeam && slot.type === 'human' ? (
            <RowTrailing>
              <RaceMark race={slot.race} />
            </RowTrailing>
          ) : null}
        </OccupiedRow>
      )
    default:
      return assertUnreachable(slot)
  }
}

export interface LobbyDetailRailProps {
  /** The lobby being previewed, or undefined when the list has nothing to select. */
  summary: LobbySummary | undefined
  /** The viewer's friends inside this lobby, in seating order. */
  friendIds: ReadonlyArray<SbUserId>
  className?: string
}

/**
 * A live window into the selected lobby: its map and settings, every seat and who's in it, and the
 * two ways to get inside. The list channel keeps streaming while this is open, so the seats fill and
 * empty as they really do.
 *
 * Mount this keyed by the selected lobby's id — the join failure it shows belongs to the lobby it
 * was aimed at, and a remount is what clears it when the selection moves.
 */
export function LobbyDetailRail({ summary, friendIds, className }: LobbyDetailRailProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const joinLobbyAction = useJoinLobbyAction()
  const [joinError, setJoinError] = useState<string>()

  if (!summary) {
    return (
      <PlaceholderRoot className={className}>
        {t('lobbies.browser.railPlaceholder', 'Select a lobby to preview it')}
      </PlaceholderRoot>
    )
  }

  const map = summary.map
  const playerTeams = summary.teams.filter(team => !team.isObserver)
  const observerTeam = summary.teams.find(team => team.isObserver)
  const observers = observerCounts(summary)
  const subTypeLabel = gameSubTypeLabel(summary.gameType, playerTeams, t)
  // Melee and its kin have a single unnamed team, and a heading over the whole roster says nothing.
  const showTeamHeadings = playerTeams.length > 1 || !!playerTeams[0]?.name

  const join = (asObserver: boolean) => {
    setJoinError(undefined)
    joinLobbyAction(summary.id, {
      name: summary.name,
      asObserver,
      onJoinFailed: setJoinError,
    })
  }

  return (
    <RailRoot className={className}>
      <Header>
        <LobbyName title={summary.name}>{summary.name}</LobbyName>
        <HostLine>
          <HostNames>
            <Trans t={t} i18nKey='lobbies.browser.hostedBy'>
              hosted by <ConnectedUsername userId={summary.host.id} />
            </Trans>
          </HostNames>
        </HostLine>
      </Header>

      <MapSection>
        <MapFrame $aspectRatio={map.mapData.width / map.mapData.height}>
          <ReduxMapThumbnail
            mapId={map.id}
            size={512}
            showInfoLayer={true}
            onClick={() => dispatch(openMapPreviewDialog(map.id))}
          />
        </MapFrame>
        <MapMeta>
          {map.mapData.width}×{map.mapData.height} · {tilesetToName(map.mapData.tileset, t)}
        </MapMeta>
      </MapSection>

      <ChipRow>
        <LobbyChip>{gameTypeToLabel(summary.gameType, t)}</LobbyChip>
        {subTypeLabel ? <LobbyChip>{subTypeLabel}</LobbyChip> : null}
        {hasObserverTeam(summary) ? (
          <LobbyChip>{t('lobbies.browser.observers', 'Observers')}</LobbyChip>
        ) : null}
        {summary.useLegacyLimits ? (
          <LobbyChip>{t('lobbies.browser.legacyLimits', 'Legacy limits')}</LobbyChip>
        ) : null}
      </ChipRow>

      <Slots>
        {playerTeams.map((team, teamIndex) => (
          <Section key={teamIndex}>
            {showTeamHeadings ? (
              <SectionHeading>
                {team.name ||
                  t('game.teamName.number', {
                    defaultValue: 'Team {{teamNumber}}',
                    teamNumber: teamIndex + 1,
                  })}
              </SectionHeading>
            ) : null}
            {team.slots.map((slot, slotIndex) => (
              <SlotRow
                key={`${slotIndex}-${slot.type === 'human' || slot.type === 'observer' ? slot.userId : slot.type}`}
                slot={slot}
                hostId={summary.host.id}
                isObserverTeam={false}
              />
            ))}
          </Section>
        ))}

        {/*
         * An observer team whose slots are all closed has nothing to preview — no one watching, no
         * seat to take — so only the settings chip says observers are allowed at all.
         */}
        {observerTeam && observers.taken + observers.open > 0 ? (
          <Section>
            <SectionHeading>
              {t('lobbies.browser.observersCount', {
                defaultValue: 'Observers · {{taken}}/{{total}}',
                taken: observers.taken,
                total: observers.taken + observers.open,
              })}
            </SectionHeading>
            {observerTeam.slots.map((slot, slotIndex) =>
              slot.type === 'observer' ? (
                <SlotRow
                  key={`${slotIndex}-${slot.userId}`}
                  slot={slot}
                  hostId={summary.host.id}
                  isObserverTeam={true}
                />
              ) : null,
            )}
            {observers.open > 0 ? (
              <QuietLine>
                {t('lobbies.browser.observerSlotsOpen', {
                  defaultValue: '{{count}} open',
                  count: observers.open,
                })}
              </QuietLine>
            ) : null}
          </Section>
        ) : null}
      </Slots>

      {friendIds.length ? (
        <FriendsCallout>
          <AvatarStack userIds={friendIds} size={24} max={4} />
          <FriendsText>
            {friendIds.length === 1
              ? t('lobbies.browser.oneFriendInside', 'A friend is in this lobby')
              : t('lobbies.browser.friendsInside', {
                  defaultValue: '{{count}} friends are in this lobby',
                  // eslint-disable-next-line camelcase -- i18next's plural-form key convention
                  defaultValue_one: '{{count}} friend is in this lobby',
                  count: friendIds.length,
                })}
          </FriendsText>
        </FriendsCallout>
      ) : null}

      <RailFoot>
        {joinError ? <JoinError>{joinError}</JoinError> : null}
        <FullWidthFilledButton
          label={t('lobbies.browser.joinLobby', 'Join lobby')}
          onClick={() => join(false)}
          testName='join-lobby-button'
        />
        {hasOpenObserverSlot(summary) ? (
          <FullWidthTextButton
            label={t('lobbies.browser.joinAsObserver', 'Join as observer')}
            iconStart={<MaterialIcon icon='visibility' size={20} />}
            onClick={() => join(true)}
          />
        ) : null}
      </RailFoot>
    </RailRoot>
  )
}
