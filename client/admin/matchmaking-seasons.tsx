import { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  AddMatchmakingSeasonRequest,
  ALL_MATCHMAKING_TYPES,
  DivisionRatingOffsets,
  divisionTableHasRatingOffsets,
  MatchmakingSeasonJson,
  matchmakingTypeToLabel,
  SeasonId,
} from '../../common/matchmaking'
import { apiUrl } from '../../common/urls'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { longTimestamp } from '../i18n/date-formats'
import { useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { getMatchmakingSeasons } from '../matchmaking/action-creators'
import { FilledButton, IconButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { TextField } from '../material/text-field'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { useRefreshToken } from '../network/refresh-token'
import { useNow } from '../react/date-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, bodyMedium, titleLarge, TitleMedium } from '../styles/typography'

const Container = styled.div`
  height: 100%;
  max-width: 860px;
  padding: 0 16px;

  overflow-x: hidden;
  overflow-y: auto;
`

const PageHeadline = styled.div`
  ${titleLarge};
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
  ${bodyLarge};
  margin-bottom: 8px;
  padding: 0 8px;

  color: var(--theme-error);
`

const Row = styled.div<{ $current?: boolean }>`
  ${bodyLarge};
  min-height: 48px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 32px;

  border: ${props => (props.$current ? '1px' : '0px')} solid var(--theme-amber);
`

const StartDate = styled.div`
  color: var(--theme-on-surface);
`

const SeasonInfo = styled.div`
  flex-grow: 1;
  padding: 8px 0;
`

const SeasonName = styled.div`
  ${titleLarge};
`

const ModifierText = styled.span`
  color: var(--theme-on-surface-variant);
`

const OffsetsText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

function describeOffsets(
  offsets: ReadonlyDeep<DivisionRatingOffsets> | undefined,
  t: TFunction,
): string {
  if (!offsets) {
    return 'not computed yet'
  }

  const parts = []
  for (const type of ALL_MATCHMAKING_TYPES) {
    const offset = offsets[type] ?? 0
    if (offset !== 0) {
      parts.push(`${matchmakingTypeToLabel(type, t)} ${offset > 0 ? '+' : ''}${offset}`)
    }
  }
  return parts.length ? parts.join(', ') : 'none'
}

function SeasonRow({
  season,
  isCurrent,
  onDeleteClick,
}: {
  season: ReadonlyDeep<MatchmakingSeasonJson>
  isCurrent: boolean
  onDeleteClick: (id: SeasonId) => void
}) {
  const { t } = useTranslation()
  const now = useNow(60_000)
  const longTimestampFormat = useFormat(longTimestamp)

  return (
    <Row $current={isCurrent}>
      <StartDate>{longTimestampFormat.format(season.startDate)}</StartDate>
      <SeasonInfo>
        <SeasonName>
          {season.name}
          {season.resetMmr ? <ModifierText> (MMR reset)</ModifierText> : undefined}
        </SeasonName>
        <OffsetsText>
          Division bounds v{season.divisionTableVersion}, offsets:{' '}
          {divisionTableHasRatingOffsets(season.divisionTableVersion)
            ? describeOffsets(season.divisionRatingOffsets, t)
            : 'not used'}
        </OffsetsText>
      </SeasonInfo>
      {season.startDate > now ? (
        <IconButton
          icon={<MaterialIcon icon='close' />}
          title='Delete'
          onClick={() => onDeleteClick(season.id)}
        />
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
  ${titleLarge};
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

function AddSeasonForm({ onSubmit }: { onSubmit: (model: AddSeasonModel) => void }) {
  const { submit, bindInput, bindCheckable, form } = useForm<AddSeasonModel>(
    {
      resetMmr: false,
    },
    {
      startDate: value =>
        !value || Date.parse(value) < Date.now() ? 'Start date must be in the future' : undefined,
      name: value => (value && value.length ? undefined : 'Season name must be provided'),
    },
  )

  useFormCallbacks(form, {
    onSubmit,
  })

  // TODO(tec27): Display validation errors on date input (or create a Material-ish date input)
  return (
    <FormContainer>
      <FormTitle>Add new season</FormTitle>

      <form noValidate={true} onSubmit={submit}>
        <TextField
          {...bindInput('name')}
          label='Season name'
          floatingLabel={true}
          inputProps={{ tabIndex: 0 }}
        />
        <DateInput {...bindInput('startDate')} type='datetime-local' tabIndex={0} />
        <CheckBox {...bindCheckable('resetMmr')} label='Reset MMR' inputProps={{ tabIndex: 0 }} />

        <FilledButton type='submit' label='Submit' onClick={submit} />
      </form>
    </FormContainer>
  )
}

export function AdminMatchmakingSeasons() {
  const dispatch = useAppDispatch()
  const [refreshToken, triggerRefresh] = useRefreshToken()
  // The list's membership and order come from the last fetch, while each season's contents come
  // from the store, which also takes in seasons the server pushes (e.g. once offsets are stored).
  const [seasonIds, setSeasonIds] = useState<SeasonId[]>([])
  const seasonsById = useAppSelector(s => s.matchmakingSeasons.byId)
  const currentSeasonId = useAppSelector(s => s.matchmakingSeasons.currentSeasonId)
  const [requestError, setRequestError] = useState<Error>()
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<SeasonId>()
  const [formVersion, setFormVersion] = useState(0)

  useEffect(() => {
    const abortController = new AbortController()
    dispatch(
      getMatchmakingSeasons({
        signal: abortController.signal,
        onSuccess: data => {
          setRequestError(undefined)
          setSeasonIds(data.seasons.map(s => s.id))
        },
        onError: err => setRequestError(err),
      }),
    )
    return () => abortController.abort()
  }, [dispatch, refreshToken])

  const seasons = seasonIds.flatMap(id => {
    const season = seasonsById.get(id)
    return season ? [season] : []
  })

  return (
    <Container>
      <HeadlineAndButton>
        <PageHeadline>Matchmaking seasons</PageHeadline>
        <FilledButton label='Refresh' onClick={triggerRefresh} />
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
          <Row key={s.id}>
            <div>
              Really delete <TitleMedium as='span'>{s.name}</TitleMedium>?
            </div>
            <TextButton label='Cancel' onClick={() => setConfirmingDeleteId(undefined)} />
            <TextButton
              label='Delete it'
              onClick={() =>
                ((id: SeasonId) => {
                  setRequestError(undefined)
                  fetchJson<void>(apiUrl`matchmaking/seasons/${id}`, { method: 'delete' })
                    .then(() => {
                      setConfirmingDeleteId(curId => (curId === id ? undefined : curId))
                      triggerRefresh()
                    })
                    .catch(err => {
                      setRequestError(err)
                    })
                })(s.id)
              }
            />
          </Row>
        ),
      )}

      <AddSeasonForm
        onSubmit={model => {
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
              triggerRefresh()
            })
            .catch(err => {
              setRequestError(err)
            })
        }}
        key={formVersion}
      />
    </Container>
  )
}
