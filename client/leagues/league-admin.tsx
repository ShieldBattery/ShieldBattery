import React, { useContext, useEffect, useId, useMemo, useState } from 'react'
import styled from 'styled-components'
import { Route, RouteComponentProps, Switch } from 'wouter'
import {
  AdminEditLeagueRequest,
  LeagueJson,
  LEAGUE_BADGE_HEIGHT,
  LEAGUE_BADGE_WIDTH,
  LEAGUE_IMAGE_HEIGHT,
  LEAGUE_IMAGE_WIDTH,
  makeLeagueId,
} from '../../common/leagues'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import FileInput from '../forms/file-input'
import { FormHook, useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { required } from '../forms/validators'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaisedButton } from '../material/button'
import CheckBox from '../material/check-box'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import { TextField } from '../material/text-field'
import { push } from '../navigation/routing'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { body1, headline4, subtitle1 } from '../styles/typography'
import {
  adminAddLeague,
  adminGetLeague,
  adminGetLeagues,
  adminUpdateLeague,
} from './action-creators'
import { LeagueDetailsHeader, LeagueDetailsInfo } from './league-details'
import { LeagueCard, LeagueSectionType } from './league-list'
import { fromRouteLeagueId, makeRouteLeagueId, toRouteLeagueId } from './route-league-id'
import { useTranslation } from 'react-i18next'

const Root = styled.div`
  padding: 12px 24px;
`

const Title = styled.div`
  ${headline4};
`

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
`

const ListRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const CardList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const LeagueAdminContext = React.createContext<{ triggerRefresh: () => void }>({
  triggerRefresh: () => {},
})

export function LeagueAdmin() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [leagues, setLeagues] = useState<LeagueJson[]>([])
  const [error, setError] = useState<Error>()
  const [refreshToken, triggerRefresh] = useRefreshToken()

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    dispatch(
      adminGetLeagues({
        signal,
        onSuccess: res => {
          setLeagues(res.leagues)
          setError(undefined)
        },
        onError: err => {
          setError(err)
        },
      }),
    )

    return () => controller.abort()
  }, [dispatch, refreshToken])

  const contextValue = useMemo(() => {
    return { triggerRefresh }
  }, [triggerRefresh])

  const curDate = Date.now()

  return (
    <Root>
      <LeagueAdminContext.Provider value={contextValue}>
        <Switch>
          <Route path='/leagues/admin/new' component={CreateLeague} />
          <Route path='/leagues/admin/:id' component={EditLeague} />
          <Route>
            <ListRoot>
              <Title>{t('leagues.admin.manageLeaguesLabel', 'Manage leagues')}</Title>
              <div>
                <RaisedButton
                  label='Add league'
                  iconStart={<MaterialIcon icon='add' />}
                  onClick={() => push('/leagues/admin/new')}
                />
              </div>
              {error ? <ErrorText>{error.message}</ErrorText> : null}
              <CardList>
                {leagues.map(l => (
                  <LeagueCard
                    key={l.id}
                    league={l}
                    type={LeagueSectionType.Current}
                    joined={false}
                    curDate={curDate}
                    onClick={league => push(`/leagues/admin/${toRouteLeagueId(league.id)}`)}
                    actionText={'Edit'}
                  />
                ))}
              </CardList>
            </ListRoot>
          </Route>
        </Switch>
      </LeagueAdminContext.Provider>
    </Root>
  )
}

const FieldLabel = styled.label`
  ${body1};
  display: block;

  color: ${colorTextSecondary};
`

const DateInput = styled.input`
  color: rgba(0, 0, 0, 0.87);
  padding: 4px 0;
  margin: 8px 0;
`

const DateError = styled.div`
  ${body1};
  color: ${colorError};
`

// TODO(tec27): Write a real version of this
// Also fix it to properly deal with DST, right now we use `Date.parse` on these values which isn't
// really correct since it uses the *current moment's timezone offset* rather than the timezone
// offset of the time chosen
function BadValidatedDateInput<ModelType>({
  id,
  label,
  binds,
}: {
  id: string
  label: string
  binds: ReturnType<FormHook<ModelType>['bindInput']>
}) {
  const { errorText, ...rest } = binds
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DateInput {...(rest as any)} id={id} type='datetime-local' tabIndex={0} />
      {errorText ? <DateError>{errorText}</DateError> : null}
    </div>
  )
}

const CreateLeagueRoot = styled.div``

const LeagueFormAndPreview = styled.div`
  margin-top: 8px;

  display: flex;
  gap: 16px;
`

const LeagueForm = styled.form`
  flex-shrink: 0;
  width: 400px;
  padding: 8px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border: 1px solid ${colorDividers};
  border-radius: 2px;
`

const LeaguePreview = styled.div`
  flex-grow: 1;
  max-width: 720px;
  padding: 8px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border: 1px solid ${colorDividers};
  border-radius: 2px;
`

interface LeagueModel {
  name: string
  matchmakingType: MatchmakingType
  description: string
  signupsAfter: string
  startAt: string
  endAt: string
  rulesAndInfo?: string
  link?: string
  image?: File
  badge?: File
}

function CreateLeague() {
  const baseId = useId()
  const adminContext = useContext(LeagueAdminContext)

  const dispatch = useAppDispatch()
  const [error, setError] = useState<Error>()
  const onFormSubmit = useStableCallback((model: LeagueModel) => {
    dispatch(
      adminAddLeague(
        {
          name: model.name,
          matchmakingType: model.matchmakingType,
          description: model.description,
          signupsAfter: Date.parse(model.signupsAfter),
          startAt: Date.parse(model.startAt),
          endAt: Date.parse(model.endAt),
          rulesAndInfo: model.rulesAndInfo,
          link: model.link,
          image: model.image,
          badge: model.badge,
        },
        {
          onSuccess: () => {
            setError(undefined)
            adminContext.triggerRefresh()
            history.back()
          },
          onError: err => {
            setError(err)
          },
        },
      ),
    )
  })

  const [previewLeague, setPreviewLeague] = useState<LeagueJson>()
  const onValidatedChange = useStableCallback((model: Readonly<LeagueModel>) => {
    setPreviewLeague({
      id: makeLeagueId('preview-league'),
      name: model.name,
      matchmakingType: model.matchmakingType,
      description: model.description,
      signupsAfter: Number(Date.parse(model.signupsAfter || new Date().toISOString())),
      startAt: Number(Date.parse(model.startAt || new Date().toISOString())),
      endAt: Number(Date.parse(model.endAt || new Date().toISOString())),
      rulesAndInfo: model.rulesAndInfo,
      link: model.link,
      imagePath: undefined, // TODO(tec27): We could make a blob URL for this
      badgePath: undefined, // TODO(tec27): We could make a blob URL for this
    })
  })

  const { onSubmit, bindInput, bindCustom } = useForm<LeagueModel>(
    {
      name: '',
      matchmakingType: MatchmakingType.Match1v1,
      description: '',
      signupsAfter: '',
      startAt: '',
      endAt: '',
    },
    {
      name: required('Name is required'),
      description: required('Description is required'),
      signupsAfter: value =>
        !value || Date.parse(value) < Date.now() ? 'Signups must start in the future' : undefined,
      startAt: (value, model) =>
        !value || Date.parse(value) < Date.parse(model.signupsAfter)
          ? 'Start date must be after signup date'
          : undefined,
      endAt: (value, model) =>
        !value || Date.parse(value) < Date.parse(model.startAt)
          ? 'End date must be after start date'
          : undefined,
      link: value => {
        if (!value) {
          return undefined
        }

        try {
          const _ = new URL(value)
          return undefined
        } catch (err) {
          return 'If provided, link must be a valid URL'
        }
      },
    },
    { onSubmit: onFormSubmit, onValidatedChange },
  )

  return (
    <CreateLeagueRoot>
      <Title>{t('leagues.admin.createLeagueLabel', 'Create league')}</Title>
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      <LeagueFormAndPreview>
        <LeagueForm noValidate={true} onSubmit={onSubmit}>
          <SubmitOnEnter />

          <div>
            <FieldLabel htmlFor={`${baseId}-image`}>
            {t('common.imageLabel', 'Image')} ({LEAGUE_IMAGE_WIDTH}x{LEAGUE_IMAGE_HEIGHT}{t('leagues.admin.pixelsRecommended', 'px recommended')})
            </FieldLabel>
            <FileInput
              {...bindCustom('image')}
              id={`${baseId}-image`}
              accept='image/*'
              multiple={false}
            />
          </div>
          <div>
            <FieldLabel htmlFor={`${baseId}-badge`}>
            {t('common.badgeLabel', 'Badge')} ({LEAGUE_BADGE_WIDTH}x{LEAGUE_BADGE_HEIGHT}{t('leagues.admin.pixelsRecommended', 'px recommended')})
            </FieldLabel>
            <FileInput
              {...bindCustom('badge')}
              id={`${baseId}-badge`}
              accept='image/*'
              multiple={false}
            />
          </div>

          <TextField
            {...bindInput('name')}
            label={t('common.nameLabel', 'Name')}
            floatingLabel={true}
            dense={true}
            inputProps={{ tabIndex: 0 }}
          />

          <Select
            {...bindCustom('matchmakingType')}
            label={t('common.matchmakingTypeLabel', 'Matchmaking type')}
            tabIndex={0}
            dense={true}>
            {ALL_MATCHMAKING_TYPES.map(m => (
              <SelectOption key={m} text={matchmakingTypeToLabel(m)} value={m} />
            ))}
          </Select>

          <TextField
            {...bindInput('description')}
            label={t('leagues.admin.newLeagueDescriptionText', 'Description (max ~20 words)')}
            floatingLabel={true}
            dense={true}
            inputProps={{ tabIndex: 0 }}
          />

          <BadValidatedDateInput
            binds={bindInput('signupsAfter')}
            id={`${baseId}-signupsAfter`}
            label={t('leagues.admin.signupsAfterLabel', 'Signups after')}
          />
          <BadValidatedDateInput
            binds={bindInput('startAt')}
            id={`${baseId}-startAt`}
            label={t('leagues.admin.startTimeLabel', 'Start at')}
          />
          <BadValidatedDateInput binds={bindInput('endAt')} id={`${baseId}-endAt`} label={t('leagues.admin.endTimeLabel', 'End at')} />

          <TextField
            {...bindInput('rulesAndInfo')}
            label={t('leagues.admin.rulesText', 'Rules and info (markdown)')}
            floatingLabel={true}
            multiline={true}
            rows={6}
            maxRows={16}
            inputProps={{ tabIndex: 0 }}
          />
          <TextField
            {...bindInput('link')}
            label={t('common.linkLabel', 'Link')}
            floatingLabel={true}
            dense={true}
            inputProps={{ tabIndex: 0 }}
          />

          <RaisedButton label={t('leagues.admin.createLeagueLabel', 'Create league')} color='primary' onClick={onSubmit} />
        </LeagueForm>
        <LeaguePreview>
          {previewLeague ? (
            <>
              <LeagueDetailsHeader league={previewLeague} />
              <LeagueDetailsInfo league={previewLeague} />
            </>
          ) : undefined}
        </LeaguePreview>
      </LeagueFormAndPreview>
    </CreateLeagueRoot>
  )
}

function EditLeague({ params: { id: routeId } }: RouteComponentProps<{ id: string }>) {
  const id = fromRouteLeagueId(makeRouteLeagueId(routeId))
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [originalLeague, setOriginalLeague] = useState<LeagueJson>()
  const [previewLeague, setPreviewLeague] = useState<LeagueJson>()
  const [error, setError] = useState<Error>()
  const adminContext = useContext(LeagueAdminContext)

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    dispatch(
      adminGetLeague(makeLeagueId(id), {
        signal,
        onSuccess: res => {
          setOriginalLeague(res.league)
          setPreviewLeague(res.league)
          setError(undefined)
        },
        onError: err => {
          setError(err)
        },
      }),
    )

    return () => controller.abort()
  }, [id, dispatch])

  const onFormSubmit = useStableCallback((model: EditLeagueModel) => {
    const originalSignupsAfter = originalLeague
      ? asDatetimeLocalValue(originalLeague.signupsAfter)
      : ''
    const originalStartAt = originalLeague ? asDatetimeLocalValue(originalLeague.startAt) : ''
    const originalEndAt = originalLeague ? asDatetimeLocalValue(originalLeague.endAt) : ''

    const patch: AdminEditLeagueRequest & { image?: Blob; badge?: Blob } = {
      name: model.name !== originalLeague?.name ? model.name : undefined,
      matchmakingType:
        model.matchmakingType !== originalLeague?.matchmakingType
          ? model.matchmakingType
          : undefined,
      description:
        model.description !== originalLeague?.description ? model.description : undefined,
      signupsAfter:
        model.signupsAfter !== originalSignupsAfter ? Date.parse(model.signupsAfter) : undefined,
      startAt: model.startAt !== originalStartAt ? Date.parse(model.startAt) : undefined,
      endAt: model.endAt !== originalEndAt ? Date.parse(model.endAt) : undefined,
      rulesAndInfo:
        model.rulesAndInfo !== originalLeague?.rulesAndInfo ? model.rulesAndInfo : undefined,
      link: model.link !== originalLeague?.link ? model.link : undefined,
      image: model.deleteImage ? undefined : model.image,
      deleteImage: model.deleteImage ? true : undefined,
      badge: model.deleteBadge ? undefined : model.badge,
      deleteBadge: model.deleteBadge ? true : undefined,
    }

    dispatch(
      adminUpdateLeague(id, patch, {
        onSuccess: () => {
          setError(undefined)
          adminContext.triggerRefresh()
          history.back()
        },
        onError: err => {
          setError(err)
        },
      }),
    )
  })

  const onValidatedChange = useStableCallback((model: Readonly<EditLeagueModel>) => {
    setPreviewLeague({
      id: makeLeagueId('preview-league'),
      name: model.name,
      matchmakingType: model.matchmakingType,
      description: model.description,
      signupsAfter: Number(Date.parse(model.signupsAfter || new Date().toISOString())),
      startAt: Number(Date.parse(model.startAt || new Date().toISOString())),
      endAt: Number(Date.parse(model.endAt || new Date().toISOString())),
      rulesAndInfo: model.rulesAndInfo,
      link: model.link,
      // TODO(tec27): We could make a blob URL for this
      imagePath: model.image || model.deleteImage ? undefined : originalLeague?.imagePath,
      // TODO(tec27): We could make a blob URL for this
      badgePath: model.badge || model.deleteBadge ? undefined : originalLeague?.badgePath,
    })
  })

  return (
    <div>
      <Title>{t('leagues.admin.editLeagueLabel', 'Edit league')}</Title>
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      <LeagueFormAndPreview>
        {originalLeague ? (
          <EditLeagueForm
            originalLeague={originalLeague}
            onSubmit={onFormSubmit}
            onValidatedChange={onValidatedChange}
          />
        ) : (
          <LoadingDotsArea />
        )}
        <LeaguePreview>
          {previewLeague ? (
            <>
              <LeagueDetailsHeader league={previewLeague} />
              <LeagueDetailsInfo league={previewLeague} />
            </>
          ) : undefined}
        </LeaguePreview>
      </LeagueFormAndPreview>
    </div>
  )
}

function asDatetimeLocalValue(unixTime: number): string {
  return new Date(unixTime + new Date().getTimezoneOffset() * -60 * 1000).toISOString().slice(0, 19)
}

interface EditLeagueModel extends LeagueModel {
  deleteImage: boolean
  deleteBadge: boolean
}

function EditLeagueForm({
  originalLeague,
  onSubmit: onFormSubmit,
  onValidatedChange,
}: {
  originalLeague: LeagueJson
  onSubmit?: (model: Readonly<EditLeagueModel>) => void
  onValidatedChange?: (model: Readonly<EditLeagueModel>) => void
}) {
  const baseId = useId()

  const { onSubmit, bindInput, bindCustom, bindCheckable } = useForm<EditLeagueModel>(
    {
      name: originalLeague?.name ?? '',
      matchmakingType: originalLeague?.matchmakingType ?? MatchmakingType.Match1v1,
      description: originalLeague?.description ?? '',
      signupsAfter: originalLeague ? asDatetimeLocalValue(originalLeague.signupsAfter) : '',
      startAt: originalLeague ? asDatetimeLocalValue(originalLeague.startAt) : '',
      endAt: originalLeague ? asDatetimeLocalValue(originalLeague.endAt) : '',
      rulesAndInfo: originalLeague?.rulesAndInfo ?? '',
      link: originalLeague?.link ?? '',
      deleteImage: false,
      deleteBadge: false,
    },
    {
      name: required('Name is required'),
      description: required('Description is required'),
      signupsAfter: useStableCallback(value =>
        !value ||
        (value !== asDatetimeLocalValue(originalLeague.signupsAfter) &&
          Date.parse(value) < Date.now())
          ? 'Signups must start in the future'
          : undefined,
      ),
      startAt: useStableCallback((value, model) =>
        !value ||
        (value !== asDatetimeLocalValue(originalLeague.startAt) && Date.parse(value) < Date.now())
          ? 'Start date must be in the future'
          : undefined,
      ),
      endAt: useStableCallback((value, model) =>
        !value ||
        (value !== asDatetimeLocalValue(originalLeague.endAt) &&
          Date.parse(value) < Date.parse(model.startAt))
          ? 'End date must be after start date'
          : undefined,
      ),
      link: value => {
        if (!value) {
          return undefined
        }

        try {
          const _ = new URL(value)
          return undefined
        } catch (err) {
          return 'If provided, link must be a valid URL'
        }
      },
    },
    { onSubmit: onFormSubmit, onValidatedChange },
  )

  return (
    <LeagueForm noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />

      <div>
        <FieldLabel htmlFor={`${baseId}-image`}>
        {t('common.imageLabel', 'Image')} ({LEAGUE_IMAGE_WIDTH}x{LEAGUE_IMAGE_HEIGHT}{t('leagues.admin.pixelsRecommended', 'px recommended')})
        </FieldLabel>
        <FileInput
          {...bindCustom('image')}
          id={`${baseId}-image`}
          accept='image/*'
          multiple={false}
        />
      </div>
      <div>
        <FieldLabel htmlFor={`${baseId}-badge`}>
        {t('common.badgeLabel', 'Badge')} ({LEAGUE_BADGE_WIDTH}x{LEAGUE_BADGE_HEIGHT}{t('leagues.admin.pixelsRecommended', 'px recommended')})
        </FieldLabel>
        <FileInput
          {...bindCustom('badge')}
          id={`${baseId}-badge`}
          accept='image/*'
          multiple={false}
        />
      </div>

      <CheckBox {...bindCheckable('deleteImage')} label={t('leagues.admin.deleteImage', 'Delete current image')} tabIndex={0} />

      <TextField
        {...bindInput('name')}
        label={t('common.nameLabel', 'Name')}
        floatingLabel={true}
        dense={true}
        inputProps={{ tabIndex: 0 }}
      />

      <Select {...bindCustom('matchmakingType')} label={t('common.matchmakingTypeLabel', 'Matchmaking type')} tabIndex={0} dense={true}>
        {ALL_MATCHMAKING_TYPES.map(m => (
          <SelectOption key={m} text={matchmakingTypeToLabel(m)} value={m} />
        ))}
      </Select>

      <TextField
        {...bindInput('description')}
        label={t('leagues.admin.newLeagueDescriptionText', 'Description (max ~20 words)')}
        floatingLabel={true}
        dense={true}
        inputProps={{ tabIndex: 0 }}
      />

      {/* TODO(tec27): Show these values as readonly? */}
      {originalLeague.signupsAfter > Date.now() ? (
        <BadValidatedDateInput
          binds={bindInput('signupsAfter')}
          id={`${baseId}-signupsAfter`}
          label='Signups after'
        />
      ) : undefined}
      {originalLeague.startAt > Date.now() ? (
        <BadValidatedDateInput
          binds={bindInput('startAt')}
          id={`${baseId}-startAt`}
          label={t('leagues.admin.startTimeLabel', 'Start at')}
        />
      ) : undefined}
      {originalLeague.endAt > Date.now() ? (
        <BadValidatedDateInput binds={bindInput('endAt')} id={`${baseId}-endAt`} label={t('leagues.admin.endTimeLabel', 'End at')} />
      ) : undefined}

      <TextField
        {...bindInput('rulesAndInfo')}
        label={t('leagues.admin.rulesText', 'Rules and info (markdown)')}
        floatingLabel={true}
        multiline={true}
        rows={6}
        maxRows={16}
        inputProps={{ tabIndex: 0 }}
      />
      <TextField
        {...bindInput('link')}
        label={t('common.linkLabel', 'Link')}
        floatingLabel={true}
        dense={true}
        inputProps={{ tabIndex: 0 }}
      />

      <RaisedButton label={t('leagues.admin.saveLeague', 'Save league')} color='primary' onClick={onSubmit} />
    </LeagueForm>
  )
}
