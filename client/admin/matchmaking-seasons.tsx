import React, { useEffect, useState } from 'react'
import styled from 'styled-components'
import {
  AddMatchmakingSeasonRequest,
  GetMatchmakingSeasonsResponse,
  makeSeasonId,
  MatchmakingSeasonJson,
  SeasonId,
} from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { longTimestamp } from '../i18n/date-formats'
import CloseIcon from '../icons/material/close-24px.svg'
import { IconButton, RaisedButton, TextButton } from '../material/button'
import CheckBox from '../material/check-box'
import { TextField } from '../material/text-field'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { useRefreshToken } from '../network/refresh-token'
import { useStableCallback } from '../state-hooks'
import { amberA400, colorError, colorTextSecondary } from '../styles/colors'
import { headline5, headline6, subtitle1, Subtitle2 } from '../styles/typography'

const Container = styled.div`
  height: 100%;
  max-width: 860px;
  padding: 0 16px;

  overflow-x: hidden;
  overflow-y: auto;
`

const PageHeadline = styled.div`
  ${headline5};
  margin-top: 16px;
  margin-bottom: 8px;
`

const HeadlineAndButton = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  margin-bottom: 8px;

  padding: 0 8px;
`

const ErrorText = styled.div`
  ${subtitle1};
  margin-bottom: 8px;
  padding: 0 8px;

  color: ${colorError};
`

const Row = styled.div<{ $current?: boolean }>`
  ${subtitle1};
  min-height: 48px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 32px;

  border: ${props => (props.$current ? '1px' : '0px')} solid ${amberA400};
`

const StartDate = styled.div`
  color: ${colorTextSecondary};
`

const SeasonName = styled.div`
  ${headline6};
  flex-grow: 1;
`

const ModifierText = styled.span`
  color: ${colorTextSecondary};
`

function SeasonRow({
  season,
  isCurrent,
  onDeleteClick,
}: {
  season: MatchmakingSeasonJson
  isCurrent: boolean
  onDeleteClick: (id: SeasonId) => void
}) {
  const { t } = useTranslation()
  return (
    <Row $current={isCurrent}>
      <StartDate>{longTimestamp.format(season.startDate)}</StartDate>
      <SeasonName>
        {season.name}
        {season.resetMmr ? <ModifierText> (MMR reset)</ModifierText> : undefined}
      </SeasonName>
      {season.startDate > Date.now() ? (
        <IconButton icon={<CloseIcon />} title={t('admin.matchmakingSeasons.deleteButtonText', 'Delete')} onClick={() => onDeleteClick(season.id)} />
      ) : (
        <div></div>
      )}
    </Row>
  )
}

const FormContainer = styled.div`
  margin-top: 40px;
`

const FormTitle = styled.div`
  ${headline5};
  margin-bottom: 16px;
  padding: 0 8px;
`

const DateInput = styled.input`
  color: #000;
  padding: 4px 0;
  margin: 8px 0;
`

interface AddSeasonModel {
  startDate?: string
  name?: string
  resetMmr: boolean
}

function AddSeasonForm(props: { onSubmit: (model: AddSeasonModel) => void }) {
  const { onSubmit, bindInput, bindCheckable } = useForm<AddSeasonModel>(
    {
      resetMmr: false,
    },
    {
      startDate: value =>
        !value || Date.parse(value) < Date.now() ? 'Start date must be in the future' : undefined,
      name: value => (value && value.length ? undefined : 'Season name must be provided'),
    },
    { onSubmit: props.onSubmit },
  )

  // TODO(tec27): Display validation errors on date input (or create a Material-ish date input)
  return (
    <FormContainer>
      <FormTitle>Add new season</FormTitle>

      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <TextField
          {...bindInput('name')}
          label='Season name'
          floatingLabel={true}
          inputProps={{ tabIndex: 0 }}
        />
        <DateInput {...bindInput('startDate')} type='datetime-local' tabIndex={0} />
        <CheckBox {...bindCheckable('resetMmr')} label='Reset MMR' inputProps={{ tabIndex: 0 }} />

        <RaisedButton label='Submit' color='primary' onClick={onSubmit} />
      </form>
    </FormContainer>
  )
}

export function AdminMatchmakingSeasons() {
  const [refreshToken, triggerRefresh] = useRefreshToken()
  const [seasons, setSeasons] = useState<MatchmakingSeasonJson[]>([])
  const [currentSeasonId, setCurrentSeasonId] = useState<SeasonId>(makeSeasonId(1))
  const [requestError, setRequestError] = useState<Error>()
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<SeasonId>()
  const [formVersion, setFormVersion] = useState(0)

  const loadSeasons = useStableCallback(() => {
    fetchJson<GetMatchmakingSeasonsResponse>(apiUrl`matchmaking/seasons`)
      .then(data => {
        setRequestError(undefined)
        setSeasons(data.seasons)
        setCurrentSeasonId(data.current)
      })
      .catch(err => {
        setRequestError(err)
      })
  })
  const confirmDelete = useStableCallback((id: SeasonId) => {
    setRequestError(undefined)
    fetchJson<void>(apiUrl`matchmaking/seasons/${id}`, { method: 'delete' })
      .then(() => {
        setConfirmingDeleteId(curId => (curId === id ? undefined : curId))
        loadSeasons()
      })
      .catch(err => {
        setRequestError(err)
      })
  })
  const addSeason = useStableCallback((model: AddSeasonModel) => {
    setRequestError(undefined)
    fetchJson<void>(apiUrl`matchmaking/seasons`, {
      method: 'post',
      body: encodeBodyAsParams<AddMatchmakingSeasonRequest>({
        startDate: Date.parse(model.startDate!),
        name: model.name!,
        resetMmr: model.resetMmr,
      }),
    })
      .then(() => {
        setFormVersion(version => version + 1)
        loadSeasons()
      })
      .catch(err => {
        setRequestError(err)
      })
  })

  useEffect(() => {
    loadSeasons()
  }, [loadSeasons, refreshToken])

  return (
    <Container>
      <HeadlineAndButton>
        <PageHeadline>Matchmaking seasons</PageHeadline>
        <RaisedButton color='primary' label='Refresh' onClick={triggerRefresh} />
      </HeadlineAndButton>
      {requestError ? <ErrorText>{String(requestError)}</ErrorText> : undefined}
      {seasons.map(s =>
        confirmingDeleteId !== s.id ? (
          <SeasonRow
            key={s.id}
            season={s}
            isCurrent={s.id === currentSeasonId}
            onDeleteClick={setConfirmingDeleteId}
          />
        ) : (
          <Row>
            <div>
              Really delete <Subtitle2 as='span'>{s.name}</Subtitle2>?
            </div>
            <TextButton
              color='accent'
              label='Cancel'
              onClick={() => setConfirmingDeleteId(undefined)}
            />
            <TextButton color='accent' label='Delete it' onClick={() => confirmDelete(s.id)} />
          </Row>
        ),
      )}

      <AddSeasonForm onSubmit={addSeason} key={formVersion} />
    </Container>
  )
}
