import { debounce } from 'lodash-es'
import * as React from 'react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { concatWithoutDuplicates } from '../../common/data-structures/arrays'
import { SbMapId } from '../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import {
  CreateMatchmakingMapPoolRequest,
  CreateMatchmakingMapPoolResponse,
  GetMatchmakingMapPoolsHistoryResponse,
  MatchmakingMapPoolJson,
} from '../../common/matchmaking/matchmaking-map-pools'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { Carousel, CarouselInfiniteListProps } from '../lists/carousel'
import { getMaps } from '../maps/action-creators'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { FilledButton, TextButton } from '../material/button'
import { fastOutSlowInShort } from '../material/curves'
import { DateTimeTextField } from '../material/datetime-text-field'
import { NumberTextField } from '../material/number-text-field'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingDotsArea } from '../progress/dots'
import { useNow } from '../react/date-hooks'
import { useAppDispatch } from '../redux-hooks'
import { SearchInput } from '../search/search-input'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { FlexSpacer } from '../styles/flex-spacer'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  BodyLarge,
  bodyLarge,
  bodyMedium,
  labelLarge,
  titleLarge,
  titleMedium,
} from '../styles/typography'

function getMapPoolsHistory(
  type: MatchmakingType,
  offset: number,
  spec: RequestHandlingSpec<GetMatchmakingMapPoolsHistoryResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetMatchmakingMapPoolsHistoryResponse>(
      apiUrl`matchmaking-map-pools/${type}?offset=${offset}`,
      {
        signal: spec.signal,
      },
    )

    dispatch({
      type: '@maps/loadMapInfos',
      payload: result.mapInfos,
    })

    return result
  })
}

function createMapPool(
  type: MatchmakingType,
  maps: ReadonlyArray<SbMapId>,
  maxVetoCount: number,
  startDate: number,
  spec: RequestHandlingSpec<CreateMatchmakingMapPoolResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<CreateMatchmakingMapPoolResponse>(
      apiUrl`matchmaking-map-pools/${type}`,
      {
        method: 'post',
        body: encodeBodyAsParams<CreateMatchmakingMapPoolRequest>({
          maps,
          maxVetoCount,
          startDate,
        }),
        signal: spec.signal,
      },
    )

    dispatch({
      type: '@maps/loadMapInfos',
      payload: result.mapInfos,
    })

    return result
  })
}

function deleteMapPool(id: number, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    await fetchJson(apiUrl`matchmaking-map-pools/${id}`, {
      method: 'delete',
      signal: spec.signal,
    })
  })
}

const Container = styled(CenteredContentContainer)`
  padding-block: 16px 8px;
`

const PageHeadline = styled.div`
  ${titleLarge};

  margin-block: 16px 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

const MapPoolsContainer = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface-variant);

  margin-block: 16px 8px;
`

const HistoryContainer = styled.div`
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
`

const HistoryCard = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border-radius: 8px;
`

const HistoryInfo = styled.div`
  height: 40px;

  display: flex;
  align-items: center;
  gap: 8px;
`

const HistoryInfoText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const MapsListContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  flex-shrink: 0;
  width: 256px;
  height: 256px;
`

const EmptyStateContainer = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  margin: 16px 0;
  padding: 32px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  text-align: center;
`

const EmptyStateIcon = styledWithAttrs(MaterialIcon, { icon: 'schedule', size: 48 })`
  color: var(--theme-on-surface-variant);
  margin-bottom: 24px;
  opacity: 0.7;
`

const EmptyStateText = styled.p`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);

  margin: 0;
`

export function AdminMatchmakingMapPools() {
  const { t } = useTranslation()

  const [activeTab, setActiveTab] = useState<MatchmakingType>(MatchmakingType.Match1v1)

  return (
    <Container>
      <Tabs activeTab={activeTab} onChange={setActiveTab}>
        {ALL_MATCHMAKING_TYPES.map(type => (
          <TabItem key={type} text={matchmakingTypeToLabel(type, t)} value={type} />
        ))}
      </Tabs>

      <PageHeadline>Matchmaking map pools</PageHeadline>

      {/**
       * Recreate this component when the active tab changes so it clears its local state (and the
       * local state of its children components).
       */}
      <MapPools key={activeTab} activeTab={activeTab} />
    </Container>
  )
}

function MapPools({ activeTab }: { activeTab: MatchmakingType }) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const [creatingMapPoolError, setCreatingMapPoolError] = useState<Error>()

  const [pools, setPools] = useState<MatchmakingMapPoolJson[]>()
  const [hasMorePools, setHasMorePools] = useState(true)
  const [isLoadingPools, setIsLoadingPools] = useState(false)
  const [loadingPoolsError, setLoadingPoolsError] = useState<Error | undefined>(undefined)

  const [refreshFormToken, triggerRefreshForm] = useRefreshToken()

  const createMapPoolFormRef = useRef<CreateMapPoolFormHandle>(null)

  const onLoadMorePools = useCallback(
    (offset: number) => {
      dispatch(
        getMapPoolsHistory(activeTab, offset, {
          onStart: () => {
            setIsLoadingPools(true)
          },
          onSuccess: data => {
            setPools(existingPools =>
              concatWithoutDuplicates(existingPools ?? [], data.pools, value => value.id).sort(
                (a, b) => a.startDate - b.startDate,
              ),
            )
            setHasMorePools(data.hasMorePools)
            setIsLoadingPools(false)
            setLoadingPoolsError(undefined)
          },
          onError: err => {
            setIsLoadingPools(false)
            setLoadingPoolsError(err)
          },
        }),
      )
    },
    [activeTab, dispatch, setPools],
  )

  useEffect(() => {
    const abortController = new AbortController()

    onLoadMorePools(0)

    return () => abortController.abort()
  }, [onLoadMorePools])

  const now = useNow(10_000)

  let poolsContents: React.ReactNode
  if (!pools && isLoadingPools) {
    // Only show loader on the initial load
    poolsContents = <LoadingDotsArea />
  } else if (!pools) {
    // Intentionally empty
  } else if (loadingPoolsError) {
    poolsContents = <ErrorText>Error retrieving map pools: {loadingPoolsError.message}</ErrorText>
  } else if (pools.length === 0) {
    poolsContents = (
      <EmptyStateContainer>
        <EmptyStateIcon />
        <EmptyStateText>
          No map pools have been created for this matchmaking type yet.
        </EmptyStateText>
      </EmptyStateContainer>
    )
  } else {
    poolsContents = (
      <>
        <HistoryContainer>
          {pools.map(pool => (
            <HistoryCard key={pool.id}>
              <HistoryInfo>
                <HistoryInfoText>{longTimestamp.format(pool.startDate)}</HistoryInfoText>

                <HistoryInfoText>|</HistoryInfoText>

                <HistoryInfoText>Max veto count: {pool.maxVetoCount}</HistoryInfoText>

                <FlexSpacer />

                <TextButton
                  label='Use as template'
                  iconStart={<MaterialIcon icon='content_copy' />}
                  onClick={() => {
                    createMapPoolFormRef.current?.setSelectedMaps(pool.maps)
                  }}
                />

                {pool.startDate > now && (
                  <TextButton
                    label='Delete'
                    onClick={() => {
                      dispatch(
                        deleteMapPool(pool.id, {
                          onSuccess: () => {
                            setPools(pools => pools?.filter(p => p.id !== pool.id))

                            snackbarController.showSnackbar('Map pool deleted')
                          },
                          onError: err => {
                            snackbarController.showSnackbar('Error deleting map pool')
                          },
                        }),
                      )
                    }}
                  />
                )}
              </HistoryInfo>

              <MapsListContainer>
                {pool.maps.map(mapId => (
                  <StyledMapThumbnail
                    key={mapId}
                    mapId={mapId}
                    forceAspectRatio={1}
                    size={196}
                    showInfoLayer={true}
                  />
                ))}
              </MapsListContainer>
            </HistoryCard>
          ))}
        </HistoryContainer>

        {hasMorePools && (
          <TextButton
            label={isLoadingPools ? 'Loading...' : 'Load more map pools'}
            disabled={isLoadingPools}
            onClick={() => onLoadMorePools(pools.length)}
          />
        )}
      </>
    )
  }

  return (
    <MapPoolsContainer>
      <SectionTitle>Create new map pool</SectionTitle>
      <CreateMapPoolForm
        key={refreshFormToken}
        ref={createMapPoolFormRef}
        onSubmit={model => {
          dispatch(
            createMapPool(
              activeTab,
              model.selectedMaps,
              model.maxVetoCount,
              Date.parse(model.startDate),
              {
                onSuccess: data => {
                  setPools(pools =>
                    concatWithoutDuplicates(pools ?? [], [data.pool], value => value.id).sort(
                      (a, b) => a.startDate - b.startDate,
                    ),
                  )
                  setCreatingMapPoolError(undefined)

                  triggerRefreshForm()
                  snackbarController.showSnackbar('New map pool created')
                },
                onError: err => {
                  setCreatingMapPoolError(err)
                },
              },
            ),
          )
        }}
      />

      {creatingMapPoolError ? <ErrorText>Error: {creatingMapPoolError.message}</ErrorText> : null}

      <SectionTitle>Map pools history</SectionTitle>
      {poolsContents}
    </MapPoolsContainer>
  )
}

const CreateNewCard = styled.div`
  ${containerStyles(ContainerLevel.Low)};
  ${elevationPlus1};

  padding: 16px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;

  border-radius: 8px;
`

const StyledSearchInput = styled(SearchInput)`
  width: 200px;
  ${fastOutSlowInShort};
  transition-property: width;

  &:focus-within {
    width: 256px;
  }
`

const CreateNewForm = styled.form`
  width: 100%;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
`

const CreateNewOptionsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;

  & > * {
    width: 256px;
    flex-shrink: 0;
  }
`

const SelectedMapsHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const CreateButton = styled(FilledButton)`
  margin-top: 24px;
`

interface CreateMapPoolModel {
  selectedMaps: ReadonlyArray<SbMapId>
  maxVetoCount: number
  startDate: string
}

interface CreateMapPoolFormHandle {
  setSelectedMaps: (maps: ReadonlyArray<SbMapId>) => void
}

function CreateMapPoolForm({
  ref,
  onSubmit,
}: {
  ref: React.Ref<CreateMapPoolFormHandle>
  onSubmit: (model: CreateMapPoolModel) => void
}) {
  const dispatch = useAppDispatch()

  const { submit, bindInput, bindCustom, form, getInputValue, setInputValue } =
    useForm<CreateMapPoolModel>(
      {
        selectedMaps: [],
        maxVetoCount: 0,
        startDate: '',
      },
      {
        selectedMaps: value => (value.length ? undefined : 'At least one map must be selected'),
        maxVetoCount: value => (value >= 0 ? undefined : 'Maximum veto count must be positive'),
        startDate: value =>
          !value || Date.parse(value) < Date.now() ? 'Start date must be in the future' : undefined,
      },
    )

  useFormCallbacks(form, {
    onSubmit,
  })

  useImperativeHandle(ref, () => ({
    setSelectedMaps: (maps: ReadonlyArray<SbMapId>) => {
      setInputValue('selectedMaps', maps)
    },
  }))

  const [searchQuery, setSearchQuery] = useState('')
  const [foundMapIds, setFoundMapIds] = useState<SbMapId[]>()
  const [isLoadingMoreMaps, setIsLoadingMoreMaps] = useState(false)
  const [hasMoreMaps, setHasMoreMaps] = useState(true)
  const [getMapsError, setGetMapsError] = useState<Error>()

  const getMapsAbortControllerRef = useRef<AbortController>(new AbortController())

  const [refreshToken, triggerRefresh] = useRefreshToken()

  const reset = (query?: string) => {
    // Just need to clear the search results here and let the infinite scroll list initiate the
    // network request.
    setSearchQuery(query ?? '')
    setGetMapsError(undefined)
    setFoundMapIds(undefined)
    setIsLoadingMoreMaps(false)
    setHasMoreMaps(true)
    triggerRefresh()
  }

  const debouncedSearchRef = useRef(debounce(reset, 100))

  const onLoadMoreMaps = () => {
    setIsLoadingMoreMaps(true)

    getMapsAbortControllerRef.current?.abort()
    getMapsAbortControllerRef.current = new AbortController()

    dispatch(
      getMaps(
        {
          q: searchQuery,
          offset: foundMapIds?.length ?? 0,
        },
        {
          signal: getMapsAbortControllerRef.current.signal,
          onSuccess: data => {
            setIsLoadingMoreMaps(false)
            setFoundMapIds((foundMapIds ?? []).concat(data.maps.map(m => m.id)))
            setHasMoreMaps(data.hasMoreMaps)
          },
          onError: err => {
            setIsLoadingMoreMaps(false)
            setGetMapsError(err)
          },
        },
      ),
    )
  }

  useEffect(() => {
    return () => {
      getMapsAbortControllerRef.current?.abort()
    }
  }, [])

  const selectedMaps = getInputValue('selectedMaps')

  return (
    <CreateNewCard>
      <StyledSearchInput
        searchQuery={searchQuery}
        onSearchChange={query => debouncedSearchRef.current(query)}
      />

      {getMapsError ? <ErrorText>Error: {getMapsError.message}</ErrorText> : null}

      <CreateNewForm noValidate={true} onSubmit={submit}>
        <MapSelect
          {...bindCustom('selectedMaps')}
          mapIds={foundMapIds}
          carouselInfiniteListProps={{
            isLoadingNext: isLoadingMoreMaps,
            hasNextData: hasMoreMaps,
            refreshToken,
            onLoadNextData: onLoadMoreMaps,
          }}
        />

        {selectedMaps.length > 0 ? (
          <>
            <SelectedMapsHeader>Selected maps</SelectedMapsHeader>
            <MapsListContainer>
              {selectedMaps.map((id, i) => (
                <StyledMapThumbnail
                  key={id}
                  mapId={id}
                  forceAspectRatio={1}
                  size={256}
                  showInfoLayer={true}
                  isSelected={true}
                  selectedIcon={<StyledSelectedIcon />}
                  onClick={() => {
                    setInputValue(
                      'selectedMaps',
                      selectedMaps.filter(mapId => mapId !== id),
                    )
                  }}
                />
              ))}
            </MapsListContainer>
          </>
        ) : null}

        <CreateNewOptionsContainer>
          <NumberTextField
            {...bindCustom('maxVetoCount')}
            label='Maximum veto count'
            floatingLabel
            inputProps={{ tabIndex: 0 }}
          />

          <DateTimeTextField
            {...bindInput('startDate')}
            label='Start date'
            floatingLabel
            inputProps={{ tabIndex: 0 }}
          />
        </CreateNewOptionsContainer>

        <CreateButton type='submit' label='Create' onClick={submit} />
      </CreateNewForm>
    </CreateNewCard>
  )
}

const StyledCarousel = styled(Carousel)`
  height: 256px;
  display: flex;
  gap: 4px;
`

const StyledSelectedIcon = styledWithAttrs(MaterialIcon, {
  icon: 'check_circle',
  size: 64,
})`
  text-shadow: 0 0 8px #000;
`

function MapSelect({
  value,
  mapIds,
  errorText,
  carouselInfiniteListProps,
  onChange,
}: {
  value: ReadonlyArray<SbMapId>
  mapIds?: SbMapId[]
  errorText?: string
  carouselInfiniteListProps: CarouselInfiniteListProps
  onChange: (value: ReadonlyArray<SbMapId>) => void
}) {
  return (
    <>
      <StyledCarousel infiniteListProps={carouselInfiniteListProps}>
        {!carouselInfiniteListProps.isLoadingNext && mapIds && mapIds.length === 0 ? (
          <BodyLarge>No maps found</BodyLarge>
        ) : (
          mapIds?.map(mapId => (
            <StyledMapThumbnail
              key={mapId}
              mapId={mapId}
              forceAspectRatio={1}
              size={256}
              showInfoLayer={true}
              isSelected={value.includes(mapId)}
              selectedIcon={<StyledSelectedIcon />}
              onClick={() => {
                if (value.includes(mapId)) {
                  onChange(value.filter(id => id !== mapId))
                } else {
                  onChange([...value, mapId])
                }
              }}
            />
          ))
        )}
      </StyledCarousel>
      {errorText ? <ErrorText>{errorText}</ErrorText> : undefined}
    </>
  )
}
