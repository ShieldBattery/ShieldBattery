import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MAX_MAP_QUEUE } from '../../../common/lobbies'
import { MapImageInfo, SbMapId } from '../../../common/maps'
import { MaterialIcon } from '../../icons/material/material-icon'
import { MapInfoImage } from '../../maps/map-image'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { IconButton, TextButton } from '../../material/button'
import { useAppSelector } from '../../redux-hooks'
import { bodyMedium, bodySmall, labelMedium, singleLine } from '../../styles/typography'
import { LobbyReplayChoice } from '../action-creators'
import { Section, SectionHeader } from '../create/game-setup-form'
import { ExtractedReplayMapImage } from '../replay-map-image'

/**
 * One source in a queue being edited. The same source can be queued more than once, so each entry
 * carries its own key to tell the copies apart.
 */
export type QueuedSourceEntry =
  | { key: string; kind: 'map'; mapId: SbMapId }
  | {
      key: string
      kind: 'replay'
      hash?: string
      choice?: LobbyReplayChoice
      mapName: string
      mapImage?: MapImageInfo
    }

const QueueList = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const QueueRow = styled.li`
  display: flex;
  align-items: center;
  gap: 8px;
`

const QueueNumber = styled.div`
  ${labelMedium};
  width: 16px;
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  text-align: end;
`

const QueueThumbnail = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
`

const ReplayThumbnail = styled(QueueThumbnail)`
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  color: var(--theme-on-surface-variant);
  background: var(--theme-container-low);
  border-radius: 4px;
`

const ReplayPlayOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--theme-on-surface);
  background: rgb(0 0 0 / 0.3);
`

const ReplayPlayCircle = styled.div`
  width: 25px;
  height: 25px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.7);
`

const QueueMapName = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex-grow: 1;
  min-width: 0;
`

const QueueActions = styled.div`
  display: flex;
  flex-shrink: 0;
`

/** The map column is narrow, so the row's controls are kept compact to leave room for the name. */
const QueueActionButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
`

const EmptyText = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const AddActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

function QueuedSourceRow({
  entry,
  index,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  entry: QueuedSourceEntry
  index: number
  isFirst: boolean
  isLast: boolean
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const lobbyId = useAppSelector(s => s.lobby.info.id)
  const mapName = useAppSelector(s =>
    entry.kind === 'map' ? s.maps.byId.get(entry.mapId)?.name : undefined,
  )
  const name = entry.kind === 'replay' ? entry.mapName : (mapName ?? '')
  let replayArtwork = <MaterialIcon icon='map' size={28} />
  if (entry.kind === 'replay') {
    if (entry.mapImage?.image512Url) {
      replayArtwork = <MapInfoImage map={entry.mapImage} size={64} forceAspectRatio={1} />
    } else if (entry.hash) {
      replayArtwork = (
        <ExtractedReplayMapImage
          lobbyId={lobbyId}
          hash={entry.hash}
          mapName={entry.mapName}
          queued={true}
        />
      )
    }
  }

  return (
    <QueueRow>
      <QueueNumber>{index + 1}</QueueNumber>
      {entry.kind === 'map' ? (
        <QueueThumbnail>
          <ReduxMapThumbnail
            mapId={entry.mapId}
            size={64}
            forceAspectRatio={1}
            hasMapDetailsAction={false}
            hasDownloadAction={false}
            hasFavoriteAction={false}
            hasMapPreviewAction={false}
            hasRegenMapImageAction={false}
          />
        </QueueThumbnail>
      ) : (
        <ReplayThumbnail>
          {replayArtwork}
          <ReplayPlayOverlay>
            <ReplayPlayCircle>
              <MaterialIcon icon='play_arrow' size={20} filled={true} />
            </ReplayPlayCircle>
          </ReplayPlayOverlay>
        </ReplayThumbnail>
      )}
      <QueueMapName title={name}>{name}</QueueMapName>
      <QueueActions>
        <QueueActionButton
          icon={<MaterialIcon icon='arrow_upward' size={20} />}
          title={t('lobbies.mapQueue.moveUp', 'Move up')}
          disabled={isFirst}
          onClick={() => onMove(-1)}
        />
        <QueueActionButton
          icon={<MaterialIcon icon='arrow_downward' size={20} />}
          title={t('lobbies.mapQueue.moveDown', 'Move down')}
          disabled={isLast}
          onClick={() => onMove(1)}
        />
        <QueueActionButton
          icon={<MaterialIcon icon='close' size={20} />}
          title={t('lobbies.mapQueue.remove', 'Remove from queue')}
          onClick={onRemove}
        />
      </QueueActions>
    </QueueRow>
  )
}

/**
 * The section of the room's game setup where the host lines up maps and replays. Each time a game
 * or replay ends, the lobby moves on to the next source.
 */
export function MapQueueSection({
  queue,
  onChange,
  onAddMap,
  onAddReplay,
}: {
  queue: ReadonlyArray<QueuedSourceEntry>
  onChange: (queue: QueuedSourceEntry[]) => void
  onAddMap: () => void
  onAddReplay: () => void
}) {
  const { t } = useTranslation()

  const move = (index: number, offset: -1 | 1) => {
    const updated = queue.slice()
    const [entry] = updated.splice(index, 1)
    updated.splice(index + offset, 0, entry)
    onChange(updated)
  }

  return (
    <Section>
      <SectionHeader>{t('lobbies.mapQueue.header', 'Up next')}</SectionHeader>
      {queue.length ? (
        <QueueList>
          {queue.map((entry, index) => (
            <QueuedSourceRow
              key={entry.key}
              entry={entry}
              index={index}
              isFirst={index === 0}
              isLast={index === queue.length - 1}
              onMove={offset => move(index, offset)}
              onRemove={() => onChange(queue.filter(e => e.key !== entry.key))}
            />
          ))}
        </QueueList>
      ) : (
        <EmptyText>
          {t(
            'lobbies.mapQueue.empty',
            'Add maps or replays for after this one. The lobby moves on whenever a game or replay ends.',
          )}
        </EmptyText>
      )}
      <AddActions>
        <TextButton
          label={t('lobbies.mapQueue.addMap', 'Add map')}
          iconStart='add'
          disabled={queue.length >= MAX_MAP_QUEUE}
          onClick={onAddMap}
        />
        <TextButton
          label={t('lobbies.mapQueue.addReplay', 'Add replay')}
          iconStart='add'
          disabled={queue.length >= MAX_MAP_QUEUE}
          onClick={onAddReplay}
        />
      </AddActions>
    </Section>
  )
}
