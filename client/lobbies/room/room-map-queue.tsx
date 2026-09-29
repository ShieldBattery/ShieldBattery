import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MAX_MAP_QUEUE } from '../../../common/lobbies'
import { SbMapId } from '../../../common/maps'
import { MaterialIcon } from '../../icons/material/material-icon'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { IconButton, TextButton } from '../../material/button'
import { useAppSelector } from '../../redux-hooks'
import { bodyMedium, bodySmall, labelMedium, singleLine } from '../../styles/typography'
import { Section, SectionHeader } from '../create/game-setup-form'

/**
 * One map in a map queue being edited. The same map can be queued more than once, so each entry
 * carries its own key to tell the copies apart.
 */
export interface QueuedMapEntry {
  key: string
  mapId: SbMapId
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

const AddMapButton = styled(TextButton)`
  align-self: flex-start;
`

function QueuedMapRow({
  entry,
  index,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  entry: QueuedMapEntry
  index: number
  isFirst: boolean
  isLast: boolean
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const mapName = useAppSelector(s => s.maps.byId.get(entry.mapId)?.name)

  return (
    <QueueRow>
      <QueueNumber>{index + 1}</QueueNumber>
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
      <QueueMapName title={mapName}>{mapName ?? ''}</QueueMapName>
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
 * The section of the room's game setup where the host lines up maps for the games after the next
 * one. Each time a game ends, the lobby moves on to the first of them.
 */
export function MapQueueSection({
  queue,
  onChange,
  onAddMap,
}: {
  queue: ReadonlyArray<QueuedMapEntry>
  onChange: (queue: QueuedMapEntry[]) => void
  onAddMap: () => void
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
            <QueuedMapRow
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
            'Queue maps to play after this one. The lobby moves on to the next one whenever a ' +
              'game ends.',
          )}
        </EmptyText>
      )}
      <AddMapButton
        label={t('lobbies.mapQueue.addMap', 'Add map')}
        iconStart={<MaterialIcon icon='add' />}
        disabled={queue.length >= MAX_MAP_QUEUE}
        onClick={onAddMap}
      />
    </Section>
  )
}
