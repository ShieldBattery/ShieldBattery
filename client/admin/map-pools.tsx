import { List, OrderedMap } from 'immutable'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MapInfoJson, MapVisibility } from '../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  hasVetoes,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import Carousel from '../lists/carousel'
import { MapThumbnail } from '../maps/map-thumbnail'
import { FilledButton, IconButton, TextButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { NumberTextField } from '../material/number-text-field'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TabItem, Tabs } from '../material/tabs'
import { TextField } from '../material/text-field'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, bodyMedium } from '../styles/typography'
import {
  clearSearch,
  createMapPool,
  deleteMapPool,
  getMapPoolHistory,
  searchMaps,
} from './action-creators'

const MAP_POOLS_LIMIT = 10
const SEARCH_MAPS_LIMIT = 30

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const Container = styled.div`
  padding: 0 16px;
`

const StyledTabs = styled(Tabs<MatchmakingType>)`
  max-width: 600px;
`

const EditorContainer = styled.div`
  margin-bottom: 24px;
`

const SearchContainer = styled.div`
  display: flex;
  align-items: center;
  max-width: 600px;
`

const SearchInput = styled(TextField)`
  flex-grow: 1;
`

const SearchMapsButton = styled(TextButton)`
  margin-left: 8px;
`

const MapContainer = styled.div`
  flex-shrink: 0;
  width: 200px;
  height: 200px;

  &:not(:first-child) {
    margin-left: 4px;
  }
`

const StyledSelectedIcon = styled(MaterialIcon).attrs({ icon: 'check_circle', size: 64 })`
  text-shadow: 0 0 8px #000;
`

const SectionTitle = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-secondary);
`

const DateInputContainer = styled.div`
  display: flex;
  align-items: center;
`

const DateInput = styled.input`
  color: #000;
`

const InvalidDateInput = styled.div`
  ${bodyMedium};
  margin-left: 16px;
  color: var(--theme-error);
`

const ValidDateIcon = styled(MaterialIcon).attrs({ icon: 'check_circle' })`
  color: var(--theme-success);
  margin-left: 8px;
`

const CreatePoolButton = styled(FilledButton)`
  margin: 16px 0;
`

const HistoryContainer = styled.table`
  width: 100%;

  th,
  td {
    border: 5px solid transparent;
    padding: 5px 0px;
  }

  th {
    color: var(--theme-on-surface-secondary);
    text-align: left;
    font-weight: 500;
  }

  td {
    width: 1px;
    vertical-align: top;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    border-left: none;
  }
`

const MapPoolActionButton = styled(IconButton)`
  margin-left: 8px;
`

const LoadingArea = styled.div`
  margin: 16px 0;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

interface MapPool {
  id: string
  startDate: number
  maps: OrderedMap<string, MapInfoJson>
}

interface MapPoolHistoryState {
  isRequesting: boolean
  lastError?: { message: string } | null
  mapPools: List<string>
  byId: OrderedMap<string, MapPool>
}

interface SearchResults {
  list: List<string>
  byId: OrderedMap<string, MapInfoJson>
  total: number
  isRequesting: boolean
  lastError?: { message: string } | null
}

interface MapPoolEditorProps {
  initialMaps: List<MapInfoJson>
  searchResults: SearchResults
  onSearchClick: () => void
  onLoadMoreMaps: (searchQuery: string, page: number) => void
  onCreate: (maps: string[], maxVetoCount: number, startDate: number) => void
  hasVetoes: boolean
}

function MapPoolEditor({
  initialMaps,
  searchResults,
  onSearchClick,
  onLoadMoreMaps,
  onCreate,
  hasVetoes,
}: MapPoolEditorProps) {
  const [maps, setMaps] = useState<OrderedMap<string, MapInfoJson>>(() =>
    OrderedMap<string, MapInfoJson>(initialMaps.map(m => [m.id, m])),
  )
  const [startDate, setStartDate] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [maxVetoCount, setMaxVetoCount] = useState(3)
  const [invalidDate, setInvalidDate] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [currentSearchPage, setCurrentSearchPage] = useState(0)
  const carouselRef = useRef<any>(null)

  useEffect(() => {
    setMaps(OrderedMap<string, MapInfoJson>(initialMaps.map(m => [m.id, m])))
  }, [initialMaps])

  const renderSearchMapsResult = () => {
    const { list, byId, total, isRequesting, lastError } = searchResults
    if (lastError) {
      return (
        <>
          <p>Something went wrong while trying to search maps. The error message was:</p>
          <ErrorText as='p'>{lastError.message}</ErrorText>
        </>
      )
    }
    if (total === 0) {
      return <p>No results</p>
    }
    const mapItems = list.map(id => {
      const map = byId.get(id)
      if (!map) return null
      return (
        <MapContainer key={id}>
          <MapThumbnail
            map={map as any}
            showMapName={true}
            isSelected={maps.has(id)}
            selectedIcon={<StyledSelectedIcon icon='check_circle' size={64} />}
            onClick={() =>
              (map => {
                if (!map) return
                setMaps(prevMaps =>
                  prevMaps.has(map.id) ? prevMaps.delete(map.id) : prevMaps.set(map.id, map),
                )
              })(map)
            }
          />
        </MapContainer>
      )
    })
    const hasMoreMaps = total === -1 || total > list.size
    return (
      <Carousel
        ref={carouselRef}
        isLoading={isRequesting}
        hasMoreItems={hasMoreMaps}
        onLoadMoreData={() => {
          onLoadMoreMaps(searchQuery, currentSearchPage)
          setCurrentSearchPage(currentSearchPage + 1)
        }}>
        {mapItems}
      </Carousel>
    )
  }

  useKeyListener({
    onKeyDown(event: KeyboardEvent) {
      if ((event.code === ENTER || event.code === ENTER_NUMPAD) && searchFocused) {
        ;(() => {
          onSearchClick()
          setCurrentSearchPage(0)
          if (carouselRef.current) carouselRef.current.reset()
        })()
        return true
      }
      return false
    },
  })

  const onCreateHandler = () => {
    onCreate(maps.keySeq().toArray(), hasVetoes ? maxVetoCount : 0, Date.parse(startDate))
    setMaps(OrderedMap())
    setStartDate('')
  }

  const selectedMaps = maps
    .valueSeq()
    .toArray()
    .map(m => (
      <MapContainer key={m.id}>
        <MapThumbnail map={m} showMapName={true} />
      </MapContainer>
    ))

  let dateValidationContents
  if (invalidDate) {
    dateValidationContents = (
      <InvalidDateInput>Start date must be set into the future</InvalidDateInput>
    )
  } else if (startDate && !invalidDate) {
    dateValidationContents = <ValidDateIcon icon='check_circle' />
  }

  return (
    <EditorContainer>
      <SearchContainer>
        <SearchInput
          label='Find a map'
          value={searchQuery}
          allowErrors={false}
          leadingIcons={[<MaterialIcon icon='search' key='search' />]}
          onChange={event => {
            setSearchQuery(event.target.value)
          }}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
        <SearchMapsButton
          label='Find'
          onClick={() => {
            onSearchClick()
            setCurrentSearchPage(0)
            if (carouselRef.current) carouselRef.current.reset()
          }}
        />
      </SearchContainer>
      <SectionTitle>Search results</SectionTitle>
      {renderSearchMapsResult()}
      <SectionTitle>Selected maps</SectionTitle>
      {selectedMaps && selectedMaps.length > 0 ? (
        <Carousel>{selectedMaps}</Carousel>
      ) : (
        <p>Use the search above to find maps and select them to be used in the map pool</p>
      )}
      {hasVetoes ? (
        <>
          <SectionTitle>Maximum veto count</SectionTitle>
          <NumberTextField dense={true} value={maxVetoCount} onChange={setMaxVetoCount} />
        </>
      ) : undefined}
      <SectionTitle>Start date</SectionTitle>
      <p>Choose a date and time (in your local timezone) when the map pool will start</p>
      <DateInputContainer>
        <DateInput
          type='datetime-local'
          value={startDate}
          onChange={event => {
            if (event.target.validity.valid && Date.parse(event.target.value) > Date.now()) {
              setStartDate(event.target.value)
              setInvalidDate(false)
            } else {
              setStartDate(event.target.value)
              setInvalidDate(true)
            }
          }}
        />
        {dateValidationContents}
      </DateInputContainer>
      <CreatePoolButton
        label='Create'
        disabled={maps.size < 1 || startDate === '' || invalidDate}
        onClick={onCreateHandler}
      />
    </EditorContainer>
  )
}

interface MapPoolHistoryRowProps {
  mapPool: MapPool
  onUseAsTemplate: () => void
  onDelete: () => void
}

function MapPoolHistoryRow({ mapPool, onUseAsTemplate, onDelete }: MapPoolHistoryRowProps) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'top')
  const [actionsOverlayOpen, openActionsOverlay, closeActionsOverlay] = usePopoverController({
    refreshAnchorPos,
  })

  const { id, startDate } = mapPool

  const mapThumbnails = mapPool.maps
    .valueSeq()
    .toArray()
    .map(m => (
      <MapContainer key={m.id}>
        <MapThumbnail map={m} showMapName={true} />
      </MapContainer>
    ))

  const mapPoolActions: [string, () => void][] = [['Use as template', onUseAsTemplate]]
  if (startDate > Date.now()) {
    mapPoolActions.push(['Delete', onDelete])
  }

  let actionsMenu
  if (mapPoolActions.length < 1) {
    actionsMenu = null
  } else {
    const actions = mapPoolActions.map(([text, handler], i) => (
      <MenuItem
        key={i}
        text={text}
        onClick={() => {
          handler()
          closeActionsOverlay()
        }}
      />
    ))

    actionsMenu = (
      <>
        <MapPoolActionButton
          icon={<MaterialIcon icon='more_vert' />}
          title='Map pool actions'
          ref={anchorRef}
          onClick={openActionsOverlay}
        />
        <Popover
          open={actionsOverlayOpen}
          onDismiss={closeActionsOverlay}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX='left'
          originY='top'>
          <MenuList>{actions}</MenuList>
        </Popover>
      </>
    )
  }

  return (
    <tr key={id}>
      <td>
        {dateFormat.format(startDate)}
        {actionsMenu}
      </td>
      <td>
        <Carousel>{mapThumbnails}</Carousel>
      </td>
    </tr>
  )
}

type MapPoolHistoryProps = {
  history: MapPoolHistoryState | undefined
  onUseAsTemplate: (id: string) => void
  onDelete: (id: string) => void
}

function MapPoolHistory({ history, onUseAsTemplate, onDelete }: MapPoolHistoryProps) {
  if (!history) return null
  if (history.isRequesting) {
    return (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }
  if (history.lastError) {
    return (
      <>
        <p>
          Something went wrong while trying to retrieve the map pool history. The error message was:
        </p>
        <ErrorText as='p'>{history.lastError.message}</ErrorText>
      </>
    )
  }
  if (history.mapPools.isEmpty()) {
    return <p>This matchmaking type doesn't have map pool history.</p>
  }
  return (
    <HistoryContainer>
      <thead>
        <tr>
          <th>Info</th>
          <th>Maps</th>
        </tr>
      </thead>
      <tbody>
        {history.mapPools.map(id => {
          const mapPool = history.byId.get(id)
          if (!mapPool) return null
          return (
            <MapPoolHistoryRow
              key={id}
              mapPool={mapPool}
              onUseAsTemplate={() => onUseAsTemplate(id)}
              onDelete={() => onDelete(id)}
            />
          )
        })}
      </tbody>
    </HistoryContainer>
  )
}

export default function MapPools() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const mapPools = useAppSelector((state: any) => state.adminMapPools)
  const [activeTab, setActiveTab] = useState<MatchmakingType>(MatchmakingType.Match1v1)
  const [initialMaps, setInitialMaps] = useState<List<MapInfoJson>>(List())

  useEffect(() => {
    dispatch(getMapPoolHistory(activeTab, MAP_POOLS_LIMIT, 0) as any)
  }, [dispatch, activeTab])

  const mapPoolHistory = mapPools.types.get(activeTab)

  return (
    <Container>
      <StyledTabs activeTab={activeTab} onChange={setActiveTab}>
        {ALL_MATCHMAKING_TYPES.map(type => (
          <TabItem key={type} text={matchmakingTypeToLabel(type, t)} value={type} />
        ))}
      </StyledTabs>
      <h3>Create a new map pool</h3>
      <MapPoolEditor
        initialMaps={initialMaps}
        searchResults={mapPools.searchResult}
        onSearchClick={() => {
          dispatch(clearSearch() as any)
        }}
        onLoadMoreMaps={(searchQuery, page) => {
          dispatch(searchMaps(MapVisibility.Official, SEARCH_MAPS_LIMIT, page, searchQuery) as any)
        }}
        onCreate={(maps, maxVetoCount, startDate) => {
          dispatch(createMapPool(activeTab, maps, maxVetoCount, startDate) as any)
        }}
        hasVetoes={hasVetoes(activeTab)}
      />
      <h3>Map pool history</h3>
      <MapPoolHistory
        history={mapPoolHistory}
        onUseAsTemplate={id => {
          const mapPoolHistory = mapPools.types.get(activeTab)
          const mapPool = mapPoolHistory?.byId.get(id)
          if (!mapPool) return
          setInitialMaps(mapPool.maps)
        }}
        onDelete={id => {
          dispatch(deleteMapPool(activeTab, id) as any)
        }}
      />
    </Container>
  )
}
