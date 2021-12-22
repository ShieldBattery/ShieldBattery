import { Immutable } from 'immer'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameRecordJson } from '../../common/games/games'
import { LadderPlayer } from '../../common/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbPermissions } from '../../common/users/permissions'
import {
  BanHistoryEntryJson,
  SbUser,
  SbUserId,
  SelfUser,
  UserProfileJson,
} from '../../common/users/sb-user'
import { hasAnyPermission } from '../admin/admin-permissions'
import { useSelfPermissions, useSelfUser } from '../auth/state-hooks'
import { ConnectedAvatar } from '../avatars/avatar'
import { ComingSoon } from '../coming-soon/coming-soon'
import { useForm } from '../forms/form-hook'
import { RaceIcon } from '../lobbies/race-icon'
import { RaisedButton, TextButton } from '../material/button'
import CheckBox from '../material/check-box'
import { Option } from '../material/select/option'
import { Select } from '../material/select/select'
import { shadow2dp } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import TextField from '../material/text-field'
import { goToIndex } from '../navigation/action-creators'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import {
  amberA400,
  backgroundSaturatedDark,
  backgroundSaturatedLight,
  colorDividers,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import {
  body1,
  Body1,
  caption,
  headline3,
  headline4,
  Headline5,
  headline6,
  overline,
  singleLine,
  subtitle1,
  subtitle2,
  Subtitle2,
} from '../styles/typography'
import {
  adminBanUser,
  adminGetUserBanHistory,
  adminGetUserPermissions,
  adminUpdateUserPermissions,
  correctUsernameForProfile,
  navigateToUserProfile,
  viewUserProfile,
} from './action-creators'
import { ConnectedUsername } from './connected-username'
import { MiniMatchHistory } from './mini-match-history'
import { UserProfileSubPage } from './user-profile-sub-page'

const Container = styled.div`
  max-width: 960px;
  /* 18px + 6px from tab = 24px at top, 12px + 24px from tab = 36px from left */
  padding: 18px 12px 24px;
`

const TabArea = styled.div`
  width: 100%;
  max-width: 720px;
`

const LoadingError = styled.div`
  ${subtitle1};
  width: 100%;
  margin-top: 40px;
  margin-bottom: 48px;
  padding: 0 24px;
`

export interface ConnectedUserProfilePageProps {
  userId: SbUserId
  username: string
  subPage?: UserProfileSubPage
}

export function ConnectedUserProfilePage({
  userId,
  username: usernameFromRoute,
  subPage = UserProfileSubPage.Summary,
}: ConnectedUserProfilePageProps) {
  if (isNaN(userId)) {
    goToIndex(replace)
  }

  const dispatch = useAppDispatch()
  const user = useAppSelector(s => s.users.byId.get(userId))
  const profile = useAppSelector(s => s.users.idToProfile.get(userId))
  const matchHistory = useAppSelector(s => s.users.idToMatchHistory.get(userId)) ?? []
  const isAdmin = useAppSelector(s => hasAnyPermission(s.auth, 'editPermissions', 'banUsers'))

  const onTabChange = useCallback(
    (tab: UserProfileSubPage) => {
      navigateToUserProfile(user!.id, user!.name, tab)
    },
    [user],
  )
  const [loadingError, setLoadingError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())

  // TODO(tec27): Move this inside the summary tab instead?
  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    dispatch(
      viewUserProfile(userId, {
        signal: abortController.signal,
        onSuccess: () => setLoadingError(undefined),
        onError: err => setLoadingError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, user, dispatch])

  useEffect(() => {
    if (user && usernameFromRoute !== user.name) {
      correctUsernameForProfile(user.id, user.name, subPage)
    }
  }, [usernameFromRoute, user, subPage])

  useEffect(() => {
    if (subPage === UserProfileSubPage.Admin && !isAdmin) {
      navigateToUserProfile(userId, usernameFromRoute, UserProfileSubPage.Summary, replace)
    }
  }, [subPage, isAdmin, userId, usernameFromRoute])

  if (loadingError) {
    // TODO(tec27): Handle specific errors, e.g. not found vs server error
    return <LoadingError>There was a problem loading this user.</LoadingError>
  }
  if (!user || !profile) {
    return <LoadingDotsArea />
  }

  return (
    <UserProfilePage
      user={user}
      profile={profile}
      matchHistory={matchHistory}
      subPage={subPage}
      onTabChange={onTabChange}
      isAdmin={isAdmin}
    />
  )
}

export interface UserProfilePageProps {
  user: SbUser
  profile: UserProfileJson
  matchHistory: Immutable<GameRecordJson[]>
  subPage?: UserProfileSubPage
  onTabChange: (tab: UserProfileSubPage) => void
  isAdmin: boolean
}

export function UserProfilePage({
  user,
  profile,
  matchHistory,
  subPage = UserProfileSubPage.Summary,
  onTabChange,
  isAdmin,
}: UserProfilePageProps) {
  let content: React.ReactNode
  switch (subPage) {
    case UserProfileSubPage.Summary:
      content = <SummaryPage user={user} profile={profile} matchHistory={matchHistory} />
      break

    case UserProfileSubPage.Stats:
    case UserProfileSubPage.MatchHistory:
    case UserProfileSubPage.Seasons:
      content = <ComingSoonPage />
      break

    case UserProfileSubPage.Admin:
      // Parent component should navigate away from this page in a useEffect if not admin, so null
      // is fine in that case
      content = isAdmin ? <AdminUserPage user={user} /> : null
      break

    default:
      content = assertUnreachable(subPage)
  }

  return (
    <Container>
      <TabArea>
        <Tabs activeTab={subPage} onChange={onTabChange}>
          <TabItem value={UserProfileSubPage.Summary} text='Summary' />
          <TabItem value={UserProfileSubPage.Stats} text='Stats' />
          <TabItem value={UserProfileSubPage.MatchHistory} text='Match history' />
          <TabItem value={UserProfileSubPage.Seasons} text='Seasons' />
          {isAdmin ? <TabItem value={UserProfileSubPage.Admin} text='Admin' /> : null}
        </Tabs>
      </TabArea>

      {content}
    </Container>
  )
}

const TopSection = styled.div`
  height: 100px;
  width: 100%;
  /* 34px + 6px from tab = 40px */
  margin-top: 34px;
  margin-bottom: 48px;
  padding: 0 24px;

  display: flex;
  align-items: center;
`

const AvatarCircle = styled.div`
  width: 100px;
  height: 100px;
  position: relative;

  background-color: ${backgroundSaturatedDark};
  border: 12px solid ${backgroundSaturatedLight};
  border-radius: 50%;
`

const StyledAvatar = styled(ConnectedAvatar)`
  position: absolute;
  width: 56px;
  height: 56px;
  top: calc(50% - 28px);
  left: calc(50% - 28px);
`

const UsernameAndTitle = styled.div`
  flex-grow: 1;
  margin-left: 24px;
`

const Username = styled.div`
  ${headline3};
  ${singleLine};
  color: ${amberA400};
`

const SectionOverline = styled.div`
  ${overline};
  ${singleLine};
  color: ${colorTextFaint};
  margin: 12px 24px;
`

const RankedSection = styled.div`
  padding: 0 24px;
  margin-bottom: 48px;

  display: flex;
  align-items: center;
`

const TotalGamesSection = styled.div`
  padding: 0 24px;
  margin-bottom: 48px;

  display: flex;
  align-items: center;
`

const TotalGamesSpacer = styled.div`
  width: 8px;
  height: 1px;
  flex-grow: 1;
`

const EmptyListText = styled.div`
  ${subtitle1};
  margin: 0 24px;
  color: ${colorTextFaint};
`

interface RaceStats {
  race: RaceChar
  wins: number
  losses: number
}

function SummaryPage({
  user,
  profile,
  matchHistory,
}: {
  user: SbUser
  profile: UserProfileJson
  matchHistory: Immutable<GameRecordJson[]>
}) {
  // TODO(tec27): Build the title feature :)
  const title = 'Novice'

  const stats = profile.userStats
  const pStats: RaceStats = {
    race: 'p',
    wins: stats.pWins + stats.rPWins,
    losses: stats.pLosses + stats.rPLosses,
  }
  const tStats: RaceStats = {
    race: 't',
    wins: stats.tWins + stats.rTWins,
    losses: stats.tLosses + stats.rTLosses,
  }
  const zStats: RaceStats = {
    race: 'z',
    wins: stats.zWins + stats.rZWins,
    losses: stats.zLosses + stats.rZLosses,
  }
  const sortedStats = [pStats, tStats, zStats].sort(
    (a, b) => b.wins + b.losses - (a.wins + a.losses),
  )

  const hasAnyRanks = !!Object.keys(profile.ladder).length

  return (
    <>
      <TopSection>
        <AvatarCircle>
          <StyledAvatar userId={user.id} />
        </AvatarCircle>
        <UsernameAndTitle>
          <Username>{user.name}</Username>
          <Subtitle2>{title}</Subtitle2>
        </UsernameAndTitle>
      </TopSection>

      {hasAnyRanks && (
        <>
          <RankedSection>
            {ALL_MATCHMAKING_TYPES.map(matchmakingType =>
              profile.ladder[matchmakingType] ? (
                <RankDisplay
                  key={matchmakingType}
                  matchmakingType={matchmakingType}
                  ladderPlayer={profile.ladder[matchmakingType]!}
                />
              ) : null,
            )}
          </RankedSection>
        </>
      )}

      <SectionOverline>Total games</SectionOverline>
      <TotalGamesSection>
        {sortedStats.map((s, i) => (
          <React.Fragment key={s.race}>
            {i > 0 ? <TotalGamesSpacer /> : null}
            <TotalGamesEntry race={s.race} wins={s.wins} losses={s.losses} />
          </React.Fragment>
        ))}
      </TotalGamesSection>

      <SectionOverline>Latest games</SectionOverline>
      <MiniMatchHistory forUserId={user.id} games={matchHistory} />

      <SectionOverline>Achievements</SectionOverline>
      <EmptyListText>Nothing to see here</EmptyListText>
    </>
  )
}

const ComingSoonRoot = styled.div`
  /* 34px + 6px from tab = 40px */
  margin-top: 34px;
  padding: 0 24px;
`

function ComingSoonPage() {
  return (
    <ComingSoonRoot>
      <ComingSoon />
    </ComingSoonRoot>
  )
}

const RankDisplayRoot = styled.div`
  position: relative;
  width: 172px;

  text-align: center;

  & + & {
    margin-left: 24px;
  }
`

const RankDisplayTypePositioner = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
`

const RankDisplayType = styled.div`
  ${subtitle2};
  ${singleLine};
  ${shadow2dp};
  display: inline-block;
  padding: 0 16px;

  background-color: ${backgroundSaturatedLight};
  border: 2px solid ${colorDividers};
  border-radius: 12px;
  color: ${colorTextSecondary};
`

const RankDisplayInfo = styled.div`
  width: 100%;
  margin-top: 14px;
  padding: 24px 8px 8px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  background-color: ${backgroundSaturatedDark};
  border: 2px solid ${colorDividers};
  border-radius: 2px;
`

const RankDisplayRank = styled.div`
  ${headline4};
  ${singleLine};
`

const RankDisplayPrefix = styled.span`
  ${subtitle1};
`

const RankDisplayRating = styled.div`
  ${subtitle1};
  ${singleLine};
  margin-top: 4px;

  color: ${colorTextSecondary};
`

const RankWinLoss = styled.div`
  ${subtitle1};
  ${singleLine};
  margin-top: 4px;

  color: ${colorTextSecondary};
`

function RankDisplay({
  matchmakingType,
  ladderPlayer,
}: {
  matchmakingType: MatchmakingType
  ladderPlayer: LadderPlayer
}) {
  return (
    <RankDisplayRoot>
      <RankDisplayTypePositioner>
        <RankDisplayType>{matchmakingTypeToLabel(matchmakingType)}</RankDisplayType>
      </RankDisplayTypePositioner>
      <RankDisplayInfo>
        <RankDisplayRank>
          <RankDisplayPrefix>#</RankDisplayPrefix>
          {ladderPlayer.rank}
        </RankDisplayRank>
        <RankDisplayRating>{Math.round(ladderPlayer.rating)} MMR</RankDisplayRating>
        <RankWinLoss>
          {ladderPlayer.wins} &ndash; {ladderPlayer.losses}
        </RankWinLoss>
      </RankDisplayInfo>
    </RankDisplayRoot>
  )
}

const TotalGamesEntryRoot = styled.div`
  flex-shrink: 1;

  display: flex;
  align-items: center;
`

const RaceCircle = styled.div`
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  position: relative;
  margin-right: 12px;

  background-color: ${backgroundSaturatedDark};
  border: 6px solid ${backgroundSaturatedLight};
  border-radius: 50%;
`

const RaceCircleIcon = styled(RaceIcon)`
  position: absolute;
  width: 40px;
  height: 40px;
  top: calc(50% - 20px);
  left: calc(50% - 20px);

  fill: ${colorTextPrimary};
`

const TotalGamesText = styled.div`
  ${headline6};
  ${singleLine};
`

const WinLossText = styled.div`
  ${caption};
  color: ${colorTextSecondary};
`

function TotalGamesEntry({ race, wins, losses }: { race: RaceChar; wins: number; losses: number }) {
  const total = wins + losses
  const winrate = total > 0 ? Math.round((wins * 100 * 10) / total) / 10 : 0

  let raceText: string
  switch (race) {
    case 'p':
      raceText = 'Protoss'
      break
    case 't':
      raceText = 'Terran'
      break
    case 'z':
      raceText = 'Zerg'
      break
    case 'r':
      raceText = 'Random'
      break
    default:
      raceText = assertUnreachable(race)
  }

  return (
    <TotalGamesEntryRoot title={raceText}>
      <RaceCircle>
        <RaceCircleIcon race={race} ariaLabel={raceText} />
      </RaceCircle>
      <div>
        <TotalGamesText>{wins + losses}</TotalGamesText>
        <WinLossText>
          {wins} W &ndash; {losses} L &ndash; {winrate}%
        </WinLossText>
      </div>
    </TotalGamesEntryRoot>
  )
}

const AdminUserPageRoot = styled.div`
  width: 100%;
  margin: 34px 0 0;
  padding: 0 24px;

  display: grid;
  column-gap: 32px;
  grid-auto-rows: minmax(128px, auto);
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  row-gap: 16px;
`

const AdminSection = styled.div<{ $gridColumn?: string }>`
  block-size: min-content;
  padding: 16px 16px 0;

  border: 1px solid ${colorDividers};
  border-radius: 2px;
  grid-column: ${props => props.$gridColumn ?? 'auto'};
`

function AdminUserPage({ user }: { user: SbUser }) {
  const selfUser = useSelfUser()
  const selfPermissions = useSelfPermissions()
  return (
    <AdminUserPageRoot>
      {selfPermissions.editPermissions ? (
        <PermissionsEditor user={user} selfUser={selfUser} />
      ) : null}
      {selfPermissions.banUsers ? <BanHistory user={user} selfUser={selfUser} /> : null}
    </AdminUserPageRoot>
  )
}

function PermissionsEditor({ user, selfUser }: { user: SbUser; selfUser: SelfUser }) {
  const dispatch = useAppDispatch()
  const [permissions, setPermissions] = useState<Readonly<SbPermissions>>()

  const [requestError, setRequestError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())
  const [formKey, setFormKey] = useState(0)

  const userId = user.id
  const isSelf = userId === selfUser.id

  const onFormSubmit = useCallback(
    (model: SbPermissions) => {
      dispatch(
        adminUpdateUserPermissions(userId, model, {
          onSuccess: () => {
            setPermissions(model)
            setRequestError(undefined)
          },
          onError: (error: Error) => {
            setRequestError(error)
          },
        }),
      )
    },
    [userId, dispatch],
  )

  const model = useMemo(() => (permissions ? { ...permissions } : undefined), [permissions])

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    dispatch(
      adminGetUserPermissions(userId, {
        signal: abortController.signal,
        onSuccess: response => {
          setRequestError(undefined)
          setPermissions(response.permissions)
          setFormKey(key => key + 1)
        },
        onError: err => setRequestError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, dispatch])

  return (
    <AdminSection $gridColumn='span 3'>
      <Headline5>Permissions</Headline5>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {model ? (
        <PermissionsEditorForm
          key={formKey}
          isSelf={isSelf}
          model={model}
          onSubmit={onFormSubmit}
        />
      ) : (
        <LoadingDotsArea />
      )}
    </AdminSection>
  )
}

function PermissionsEditorForm({
  isSelf,
  model,
  onSubmit: onFormSubmit,
}: {
  isSelf: boolean
  model: SbPermissions
  onSubmit: (model: SbPermissions) => void
}) {
  const { onSubmit, bindCheckable } = useForm(
    model,
    {},
    {
      onSubmit: onFormSubmit,
    },
  )

  const inputProps = {
    tabIndex: 0,
  }

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <CheckBox
        {...bindCheckable('editPermissions')}
        label='Edit permissions'
        inputProps={inputProps}
        disabled={isSelf}
      />
      <CheckBox {...bindCheckable('debug')} label='Debug' inputProps={inputProps} />
      <CheckBox
        {...bindCheckable('acceptInvites')}
        label='Accept beta invites'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('editAllChannels')}
        label='Edit all channels'
        inputProps={inputProps}
      />
      <CheckBox {...bindCheckable('banUsers')} label='Ban users' inputProps={inputProps} />
      <CheckBox {...bindCheckable('manageMaps')} label='Manage maps' inputProps={inputProps} />
      <CheckBox
        {...bindCheckable('manageMapPools')}
        label='Manage matchmaking map pools'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('manageMatchmakingTimes')}
        label='Manage matchmaking times'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('manageRallyPointServers')}
        label='Manage rally-point servers'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('massDeleteMaps')}
        label='Mass delete maps'
        inputProps={inputProps}
      />
      <CheckBox
        {...bindCheckable('moderateChatChannels')}
        label='Moderate chat channels'
        inputProps={inputProps}
      />

      <TextButton label='Save' color='accent' tabIndex={0} onClick={onSubmit} />
    </form>
  )
}

const BAN_FORM_DEFAULTS: BanFormModel = {
  banLengthHours: 3,
  reason: undefined,
}

function BanHistory({ user, selfUser }: { user: SbUser; selfUser: SelfUser }) {
  const dispatch = useAppDispatch()
  const [banHistory, setBanHistory] = useState<ReadonlyDeep<BanHistoryEntryJson[]>>()

  const [requestError, setRequestError] = useState<Error>()
  const cancelLoadRef = useRef(new AbortController())

  const userId = user.id
  const isSelf = userId === selfUser.id

  const onFormSubmit = useCallback(
    (model: BanFormModel) => {
      dispatch(
        adminBanUser(
          { userId, banLengthHours: model.banLengthHours, reason: model.reason },
          {
            onSuccess: response => {
              setBanHistory(history => {
                if (!history?.some(b => b.id === response.ban.id)) {
                  return [response.ban].concat(history || [])
                }

                return history
              })
              setRequestError(undefined)
            },
            onError: err => setRequestError(err),
          },
        ),
      )
    },
    [userId, dispatch],
  )

  useEffect(() => {
    cancelLoadRef.current.abort()
    const abortController = new AbortController()
    cancelLoadRef.current = abortController

    setBanHistory(undefined)
    dispatch(
      adminGetUserBanHistory(userId, {
        signal: abortController.signal,
        onSuccess: response => {
          setRequestError(undefined)
          setBanHistory(response.bans)
        },
        onError: err => setRequestError(err),
      }),
    )

    return () => {
      abortController.abort()
    }
  }, [userId, dispatch])

  return (
    <AdminSection $gridColumn='span 6'>
      <Headline5>Ban history</Headline5>
      {requestError ? <LoadingError>{requestError.message}</LoadingError> : null}
      {banHistory === undefined ? <LoadingDotsArea /> : <BanHistoryList banHistory={banHistory} />}
      {!isSelf ? (
        <BanUserForm key={`form-${userId}`} model={BAN_FORM_DEFAULTS} onSubmit={onFormSubmit} />
      ) : null}
    </AdminSection>
  )
}

const BanTable = styled.table`
  text-align: left;
  margin: 16px 0 32px;

  th,
  td {
    ${body1};

    min-width: 100px;
    max-width: 150px;
    padding: 4px;

    border: 1px solid ${colorDividers};
    border-radius: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: top;
    white-space: no-wrap;
  }

  th {
    ${caption};
    color: ${colorTextSecondary};
  }
`

const BanRow = styled.tr<{ $expired?: boolean }>`
  color: ${props => (!props.$expired ? colorTextPrimary : colorTextFaint)};
`

const EmptyState = styled.td`
  ${subtitle1};
  color: ${colorTextFaint};
`

const banDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
})

function BanHistoryList({ banHistory }: { banHistory: ReadonlyDeep<BanHistoryEntryJson[]> }) {
  return (
    <BanTable>
      <thead>
        <tr>
          <th>Start time</th>
          <th>End time</th>
          <th>Banned by</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {banHistory.length ? (
          banHistory.map(b => (
            <BanRow $expired={b.startTime <= Date.now() && b.endTime <= Date.now()}>
              <td>{banDateFormat.format(b.startTime)}</td>
              <td>{banDateFormat.format(b.endTime)}</td>
              <td>
                <ConnectedUsername userId={b.bannedBy} />
              </td>
              <td>{b.reason ?? ''}</td>
            </BanRow>
          ))
        ) : (
          <BanRow>
            <EmptyState colSpan={4}>No bans found</EmptyState>
          </BanRow>
        )}
      </tbody>
    </BanTable>
  )
}

interface BanFormModel {
  banLengthHours: number
  reason?: string
}

function BanUserForm({
  model,
  onSubmit: onFormSubmit,
}: {
  model: BanFormModel
  onSubmit: (model: BanFormModel) => void
}) {
  const { onSubmit, bindCustom, bindInput } = useForm(
    model,
    {},
    {
      onSubmit: onFormSubmit,
    },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <Headline5>Ban user</Headline5>
      <Select {...bindCustom('banLengthHours')} label='Ban length' tabIndex={0}>
        <Option value={3} text='3 Hours' />
        <Option value={24} text='1 Day' />
        <Option value={24 * 7} text='1 Week' />
        <Option value={24 * 7 * 4} text='1 Month' />
        <Option value={24 * 365 * 999} text='Permanent!' />
      </Select>
      <Body1>This reason will be visible to the user!</Body1>
      <TextField
        {...bindInput('reason')}
        label='Ban reason'
        floatingLabel={true}
        inputProps={{
          tabIndex: 0,
          autoCapitalize: 'off',
          autoComplete: 'off',
          autoCorrect: 'off',
          spellCheck: false,
        }}
      />
      <RaisedButton label='Ban' color='primary' tabIndex={0} onClick={onSubmit} />
    </form>
  )
}
