import { ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { Link, useRoute } from 'wouter'
import { ModerationAction, ModerationActionKind } from '../../common/moderation-actions'
import { urlPath } from '../../common/urls'
import {
  ALL_RESTRICTION_KINDS,
  RestrictionKind,
  restrictionReasonToLabel,
} from '../../common/users/restrictions'
import { SbUserId } from '../../common/users/sb-user-id'
import { ALL_BAN_SOURCES, BanSource, banSourceToLabel } from '../../common/users/user-network'
import { getGameResultsUrl } from '../games/action-creators'
import { NarrowDuration } from '../i18n/date-formats'
import { dateTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton, TextButton } from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { TabItem, Tabs } from '../material/tabs'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useNow } from '../react/date-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyLarge,
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  titleLarge,
} from '../styles/typography'
import { adminGetModerationActions } from '../users/action-creators'
import { ConnectedUsername } from '../users/connected-username'
import { UserProfileSubPage } from '../users/user-profile-sub-page'

/** Bans ending after this are effectively permanent (we use the year 9001 for those). */
const PERMANENT_THRESHOLD = Date.UTC(9000, 0, 1)

const endDateFormat = dateTimeFormat({
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

const Root = styled.div`
  padding-block: 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Title = styled.div`
  ${titleLarge};
`

const Filters = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const FilterDivider = styled.div`
  width: 1px;
  height: 24px;
  margin-inline: 4px;
  background: var(--theme-outline-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const EmptyText = styled.div`
  ${bodyLarge};
  padding: 24px 8px;
  color: var(--theme-on-surface-variant);
`

const ActionsTable = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  display: grid;
  grid-template-columns:
    minmax(64px, auto) minmax(160px, auto) minmax(144px, auto) minmax(144px, auto)
    minmax(160px, 1fr);
  align-items: stretch;
  border-radius: 4px;
`

const TableHeader = styled.div`
  ${labelMedium};
  display: contents;

  > div {
    ${containerStyles(ContainerLevel.High)};
    padding: 12px 8px;
  }
`

const TableRow = styled.div<{ $child?: boolean }>`
  ${bodyMedium};
  display: contents;

  > div {
    padding: ${props => (props.$child ? '4px 8px' : '12px 8px')};
    border-top: ${props => (props.$child ? 'none' : '1px solid var(--theme-outline-variant)')};
    min-width: 0;
  }

  > div:first-child {
    padding-left: ${props => (props.$child ? '24px' : '8px')};
  }
`

const TimeText = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const CellStack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
`

const ActionLabel = styled.span`
  ${labelLarge};
`

const SecondaryText = styled.span`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const StatusText = styled.span<{ $active: boolean }>`
  ${bodySmall};
  color: ${props => (props.$active ? 'var(--theme-negative)' : 'var(--theme-on-surface-variant)')};
`

const AccountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`

const AdminPageButton = styled(IconButton)`
  /* Keeps the 48px touch target from pushing the name below the other cells' first line */
  margin-block: -14px;
`

const SourceChip = styled.span<{ $automated: boolean }>`
  ${labelMedium};
  display: inline-block;
  padding: 2px 8px;
  border-radius: 8px;

  background: ${props =>
    props.$automated ? 'var(--theme-amber-container)' : 'var(--theme-grey-blue-container)'};
  color: ${props =>
    props.$automated ? 'var(--theme-on-amber-container)' : 'var(--theme-on-grey-blue-container)'};
`

const ReasonText = styled.div`
  overflow-wrap: anywhere;
  user-select: text;
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
`

function restrictionKindToLabel(kind: RestrictionKind): string {
  switch (kind) {
    case RestrictionKind.Chat:
      return 'Chat'
    case RestrictionKind.Reporting:
      return 'Reporting'
    case RestrictionKind.Matchmaking:
      return 'Matchmaking'
    case RestrictionKind.AvatarUpload:
      return 'Avatar upload'
    default:
      return kind satisfies never
  }
}

function formatLength(startTime: number, endTime: number): string {
  if (endTime >= PERMANENT_THRESHOLD) {
    return 'Permanent'
  }

  const minutes = Math.round((endTime - startTime) / (60 * 1000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 48) {
    return `${hours}h`
  }
  return `${Math.round(hours / 24)}d`
}

interface ActionGroup {
  primary: ReadonlyDeep<ModerationAction>
  /** Actions applied to accounts linked to the primary action's account at the same time. */
  linked: Array<ReadonlyDeep<ModerationAction>>
}

function cascadedFrom(action: ReadonlyDeep<ModerationAction>): SbUserId | undefined {
  return 'cascadedFrom' in action ? action.cascadedFrom : undefined
}

function groupKey(kind: ModerationActionKind, time: number, userId: SbUserId) {
  return `${kind}|${time}|${userId}`
}

/**
 * Groups actions that were applied to linked accounts under the action that caused them. Actions
 * whose cause isn't present (or isn't recorded) are left as their own group.
 */
function groupActions(actions: ReadonlyDeep<ModerationAction[]>): ActionGroup[] {
  // Linked actions can sort before the action that caused them, so find the causes first
  const groups = new Map<ReadonlyDeep<ModerationAction>, ActionGroup>()
  const byCause = new Map<string, ActionGroup>()
  for (const action of actions) {
    if (cascadedFrom(action) === undefined) {
      const group = { primary: action, linked: [] }
      groups.set(action, group)
      const key = groupKey(action.kind, action.time, action.userId)
      if (!byCause.has(key)) byCause.set(key, group)
    }
  }

  const result: ActionGroup[] = []
  for (const action of actions) {
    const from = cascadedFrom(action)
    const cause =
      from !== undefined ? byCause.get(groupKey(action.kind, action.time, from)) : undefined
    if (cause) {
      cause.linked.push(action)
    } else {
      result.push(groups.get(action) ?? { primary: action, linked: [] })
    }
  }

  return result
}

export enum ModerationTab {
  Bans = 'bans',
  Restrictions = 'restrictions',
  Matchmaking = 'matchmaking',
}

const ALL_MODERATION_TABS: ReadonlyArray<ModerationTab> = Object.values(ModerationTab)

export function AdminModerationActions() {
  const [, params] = useRoute<{ tab?: string }>('/admin/moderation-actions/:tab?')
  const tab = ALL_MODERATION_TABS.find(t => t === params?.tab) ?? ModerationTab.Bans

  let content: ReactNode
  switch (tab) {
    case ModerationTab.Bans:
      content = <BansTab />
      break
    case ModerationTab.Restrictions:
      content = <RestrictionsTab />
      break
    case ModerationTab.Matchmaking:
      content = <ModerationFeed kinds={[ModerationActionKind.MatchmakingBan]} filters={null} />
      break
    default:
      content = tab satisfies never
  }

  return (
    <CenteredContentContainer>
      <Root>
        <Title>Moderation actions</Title>
        <Tabs
          activeTab={tab}
          onChange={(value: ModerationTab) => push(urlPath`/admin/moderation-actions/${value}`)}>
          <TabItem value={ModerationTab.Bans} text='Bans' />
          <TabItem value={ModerationTab.Restrictions} text='Restrictions' />
          <TabItem value={ModerationTab.Matchmaking} text='Matchmaking timeouts' />
        </Tabs>
        {content}
      </Root>
    </CenteredContentContainer>
  )
}

function BansTab() {
  const [showUnbans, setShowUnbans] = useState(true)
  const [banSource, setBanSource] = useState<BanSource>()

  return (
    <ModerationFeed
      kinds={
        showUnbans
          ? [ModerationActionKind.Ban, ModerationActionKind.Unban]
          : [ModerationActionKind.Ban]
      }
      banSource={banSource}
      filters={
        <>
          <FilterChip
            label='Show unbans'
            selected={showUnbans}
            onClick={() => setShowUnbans(!showUnbans)}
          />
          <FilterDivider />
          <FilterChip
            label={banSource ? `Source: ${banSourceToLabel(banSource)}` : 'Any source'}
            selected={banSource !== undefined}>
            <SelectableMenuItem
              text='Any source'
              selected={banSource === undefined}
              onClick={() => setBanSource(undefined)}
            />
            {ALL_BAN_SOURCES.map(source => (
              <SelectableMenuItem
                key={source}
                text={banSourceToLabel(source)}
                selected={banSource === source}
                onClick={() => setBanSource(source)}
              />
            ))}
          </FilterChip>
        </>
      }
    />
  )
}

function RestrictionsTab() {
  const [showLifts, setShowLifts] = useState(true)
  const [restrictionKind, setRestrictionKind] = useState<RestrictionKind>()

  return (
    <ModerationFeed
      kinds={
        showLifts
          ? [ModerationActionKind.Restriction, ModerationActionKind.RestrictionLift]
          : [ModerationActionKind.Restriction]
      }
      restrictionKind={restrictionKind}
      filters={
        <>
          <FilterChip
            label='Show lifts'
            selected={showLifts}
            onClick={() => setShowLifts(!showLifts)}
          />
          <FilterDivider />
          <FilterChip
            label={
              restrictionKind ? `Type: ${restrictionKindToLabel(restrictionKind)}` : 'Any type'
            }
            selected={restrictionKind !== undefined}>
            <SelectableMenuItem
              text='Any type'
              selected={restrictionKind === undefined}
              onClick={() => setRestrictionKind(undefined)}
            />
            {ALL_RESTRICTION_KINDS.map(kind => (
              <SelectableMenuItem
                key={kind}
                text={restrictionKindToLabel(kind)}
                selected={restrictionKind === kind}
                onClick={() => setRestrictionKind(kind)}
              />
            ))}
          </FilterChip>
        </>
      }
    />
  )
}

function ModerationFeed({
  kinds,
  banSource,
  restrictionKind,
  filters,
}: {
  kinds: ReadonlyArray<ModerationActionKind>
  banSource?: BanSource
  restrictionKind?: RestrictionKind
  filters: ReactNode
}) {
  const dispatch = useAppDispatch()
  const [actions, setActions] = useState<ReadonlyDeep<ModerationAction[]>>()
  const [nextCursor, setNextCursor] = useState<string>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [requestError, setRequestError] = useState<Error>()
  const abortRef = useRef(new AbortController())

  const kindsParam = kinds.join(',')

  const load = (cursor: string | undefined) => {
    abortRef.current.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    dispatch(
      adminGetModerationActions(
        { kinds: kindsParam, banSource, restrictionKind, cursor },
        {
          signal: abortController.signal,
          onStart: () => {
            if (cursor === undefined) {
              setActions(undefined)
              setNextCursor(undefined)
            } else {
              setLoadingMore(true)
            }
          },
          onSuccess: response => {
            setRequestError(undefined)
            setActions(prev =>
              cursor === undefined ? response.actions : (prev ?? []).concat(response.actions),
            )
            setNextCursor(response.nextCursor)
            setLoadingMore(false)
          },
          onError: err => {
            setRequestError(err)
            setLoadingMore(false)
          },
        },
      ),
    )
  }

  const loadFirstPage = useEffectEvent(() => load(undefined))

  useEffect(() => {
    loadFirstPage()
    return () => {
      abortRef.current.abort()
    }
  }, [kindsParam, banSource, restrictionKind])

  let content: ReactNode
  if (actions === undefined) {
    content = <LoadingDotsArea />
  } else {
    content = (
      <>
        <ActionsList actions={actions} />
        {nextCursor ? (
          <LoadMoreRow>
            {loadingMore ? (
              <LoadingDotsArea />
            ) : (
              <FilledButton label='Load more' onClick={() => load(nextCursor)} />
            )}
          </LoadMoreRow>
        ) : null}
      </>
    )
  }

  return (
    <>
      {filters ? <Filters>{filters}</Filters> : null}
      {requestError ? <ErrorText>{requestError.message}</ErrorText> : null}
      {content}
    </>
  )
}

function ActionsList({ actions }: { actions: ReadonlyDeep<ModerationAction[]> }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const now = useNow(60_000)

  if (!actions.length) {
    return <EmptyText>No moderation actions found</EmptyText>
  }

  const groups = groupActions(actions)

  return (
    <ActionsTable>
      <TableHeader>
        <div>When</div>
        <div>Action</div>
        <div>Account</div>
        <div>Source</div>
        <div>Reason</div>
      </TableHeader>
      {groups.map(({ primary, linked }) => {
        const key = `${primary.kind}|${primary.id}`
        const isExpanded = expanded.has(key)
        return (
          <GroupRows
            key={key}
            primary={primary}
            linked={linked}
            expanded={isExpanded}
            onToggle={() =>
              setExpanded(prev => {
                const next = new Set(prev)
                if (isExpanded) {
                  next.delete(key)
                } else {
                  next.add(key)
                }
                return next
              })
            }
            now={now}
          />
        )
      })}
    </ActionsTable>
  )
}

function GroupRows({
  primary,
  linked,
  expanded,
  onToggle,
  now,
}: {
  primary: ReadonlyDeep<ModerationAction>
  linked: ReadonlyArray<ReadonlyDeep<ModerationAction>>
  expanded: boolean
  onToggle: () => void
  now: number
}) {
  return (
    <>
      <TableRow>
        <div>
          <TimeText>
            <NarrowDuration to={primary.time} from={now} />
          </TimeText>
        </div>
        <div>
          <ActionCell action={primary} now={now} />
        </div>
        <div>
          <CellStack>
            <AccountLink userId={primary.userId} />
            {linked.length ? (
              <TextButton
                label={`${expanded ? 'Hide' : 'Show'} ${linked.length} linked account${
                  linked.length === 1 ? '' : 's'
                }`}
                iconStart={<MaterialIcon icon={expanded ? 'expand_less' : 'expand_more'} />}
                onClick={onToggle}
              />
            ) : null}
          </CellStack>
        </div>
        <div>
          <SourceCell action={primary} />
        </div>
        <div>
          <ReasonCell action={primary} />
        </div>
      </TableRow>
      {expanded
        ? linked.map(action => (
            <TableRow key={`${action.kind}|${action.id}`} $child={true}>
              <div />
              <div>
                <SecondaryText>Linked account</SecondaryText>
              </div>
              <div>
                <AccountLink userId={action.userId} />
              </div>
              <div />
              <div />
            </TableRow>
          ))
        : null}
    </>
  )
}

function AccountLink({ userId }: { userId: SbUserId }) {
  const user = useAppSelector(s => s.users.byId.get(userId))
  return (
    <AccountRow>
      <ConnectedUsername userId={userId} />
      {user ? (
        <AdminPageButton
          icon={<MaterialIcon icon='shield_person' size={20} />}
          title='Open admin page'
          onClick={() => push(urlPath`/users/${user.id}/${user.name}/${UserProfileSubPage.Admin}`)}
        />
      ) : null}
    </AccountRow>
  )
}

function EndStatus({
  endTime,
  liftedAt,
  now,
}: {
  endTime: number
  liftedAt?: number
  now: number
}) {
  const endDateFormatter = useFormat(endDateFormat)
  if (liftedAt !== undefined) {
    return <StatusText $active={false}>Lifted</StatusText>
  } else if (endTime > now) {
    return (
      <StatusText $active={true}>
        {endTime >= PERMANENT_THRESHOLD
          ? 'Active'
          : `Active until ${endDateFormatter.format(endTime)}`}
      </StatusText>
    )
  } else {
    return <StatusText $active={false}>Ended</StatusText>
  }
}

function ActionCell({ action, now }: { action: ReadonlyDeep<ModerationAction>; now: number }) {
  let label: string
  let details: ReactNode = null
  switch (action.kind) {
    case ModerationActionKind.Ban:
      label = `Ban (${formatLength(action.time, action.endTime)})`
      details = (
        <>
          <EndStatus endTime={action.endTime} liftedAt={action.unbannedAt} now={now} />
          {action.gameId ? <Link href={getGameResultsUrl(action.gameId)}>View game</Link> : null}
        </>
      )
      break
    case ModerationActionKind.Unban:
      label = 'Unban'
      break
    case ModerationActionKind.Restriction:
      label =
        `${restrictionKindToLabel(action.restrictionKind)} restriction ` +
        `(${formatLength(action.time, action.endTime)})`
      details = <EndStatus endTime={action.endTime} liftedAt={action.liftedAt} now={now} />
      break
    case ModerationActionKind.RestrictionLift:
      label = `${restrictionKindToLabel(action.restrictionKind)} restriction lifted`
      break
    case ModerationActionKind.MatchmakingBan:
      label = `Matchmaking timeout (${formatLength(action.time, action.endTime)})`
      details = <SecondaryText>Level {action.banLevel}</SecondaryText>
      break
    default:
      label = action satisfies never
  }

  return (
    <CellStack>
      <ActionLabel>{label}</ActionLabel>
      {details}
    </CellStack>
  )
}

function ActorSource({ actor, fallback }: { actor?: SbUserId; fallback: string }) {
  return actor !== undefined ? (
    <ConnectedUsername userId={actor} />
  ) : (
    <SecondaryText>{fallback}</SecondaryText>
  )
}

function SourceCell({ action }: { action: ReadonlyDeep<ModerationAction> }) {
  let main: ReactNode
  switch (action.kind) {
    case ModerationActionKind.Ban:
      main =
        action.source === BanSource.Admin && action.bannedBy !== undefined ? (
          <ConnectedUsername userId={action.bannedBy} />
        ) : (
          <SourceChip $automated={action.source !== BanSource.Admin}>
            {banSourceToLabel(action.source)}
          </SourceChip>
        )
      break
    case ModerationActionKind.Unban:
      main = (
        <>
          <ActorSource actor={action.unbannedBy} fallback='System' />
          <SecondaryText>{banSourceToLabel(action.banSource)} ban</SecondaryText>
        </>
      )
      break
    case ModerationActionKind.Restriction:
      main = <ActorSource actor={action.restrictedBy} fallback='System' />
      break
    case ModerationActionKind.RestrictionLift:
      main = <ActorSource actor={action.liftedBy} fallback='System' />
      break
    case ModerationActionKind.MatchmakingBan:
      main = <SourceChip $automated={true}>Matchmaking</SourceChip>
      break
    default:
      main = action satisfies never
  }

  const linkedTo = cascadedFrom(action)
  return (
    <CellStack>
      {main}
      {linkedTo !== undefined ? (
        <SecondaryText>
          Linked to <ConnectedUsername userId={linkedTo} />
        </SecondaryText>
      ) : null}
    </CellStack>
  )
}

function ReasonCell({ action }: { action: ReadonlyDeep<ModerationAction> }) {
  const { t } = useTranslation()
  switch (action.kind) {
    case ModerationActionKind.Ban:
    case ModerationActionKind.Unban:
    case ModerationActionKind.RestrictionLift:
      return action.reason ? <ReasonText>{action.reason}</ReasonText> : null
    case ModerationActionKind.Restriction:
      return (
        <CellStack>
          {action.reason ? (
            <ReasonText>{restrictionReasonToLabel(action.reason, t)}</ReasonText>
          ) : null}
          {action.adminNotes ? <SecondaryText>{action.adminNotes}</SecondaryText> : null}
        </CellStack>
      )
    case ModerationActionKind.MatchmakingBan:
      return null
    default:
      return action satisfies never
  }
}
