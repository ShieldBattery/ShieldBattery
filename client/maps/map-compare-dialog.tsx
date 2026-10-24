import { TFunction } from 'i18next'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapChange, MapStartLocationChangeKind } from '../gql/graphql'
import { LoadErrorRow } from '../lists/load-error-row'
import { CheckBox } from '../material/check-box'
import { Dialog } from '../material/dialog'
import { LoadingDotsArea } from '../progress/dots'
import { bodyMedium, bodySmall, labelLarge, titleSmall } from '../styles/typography'
import { MapFileImage } from './map-image'
import { decodeTerrainChanges } from './terrain-changes'

const MapCompareQuery = graphql(/* GraphQL */ `
  query MapCompare($a: SbMapId!, $b: SbMapId!) {
    mapComparison(a: $a, b: $b) {
      id
      changes
      terrainSimilarity
      terrainChanges
      startLocations {
        id
        slot
        kind
      }
      bases {
        id
        beforeIndex
        afterIndex
        changed
      }
      a {
        id
        ...MapCompare_Side
      }
      b {
        id
        ...MapCompare_Side
      }
    }
  }
`)

const MapCompareSideFragment = graphql(/* GraphQL */ `
  fragment MapCompare_Side on SbMap {
    id
    name
    playerCount
    file {
      id
      tileset
      width
      height
      isEud
      analysis {
        id
        triggerCount
        umsActionKinds
      }
      ...MapFileImage_FileFragment
    }
  }
`)

const NO_SUSPENSE_CONTEXT = { suspense: false }

const StyledDialog = styled(Dialog)`
  width: 760px;
  max-width: calc(100vw - 32px);
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Sides = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;

  @media (max-width: 600px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Side = styled.figure`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  min-width: 0;
`

const ImageFrame = styled.div`
  position: relative;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--theme-container);
`

const TerrainCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  pointer-events: none;
`

const SideCaption = styled.figcaption`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`

const SideLabel = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const SideName = styled.div`
  ${titleSmall};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const TerrainControls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 24px;
  row-gap: 4px;
`

const Similarity = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const ChangesSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionTitle = styled.h3`
  ${titleSmall};
  margin: 0;
`

const ChangeList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const ChangeRow = styled.li`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const ChangeLabel = styled.div`
  ${labelLarge};
`

const ChangeDetail = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const EmptyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

interface CompareSide {
  name: string
  playerCount: number
  file: {
    tileset: number
    width: number
    height: number
    isEud: boolean
    analysis?: { triggerCount: number; umsActionKinds: ReadonlyArray<string> } | null
  }
}

interface ChangeEntry {
  key: string
  label: string
  lines: string[]
}

interface ComparisonDetails {
  changes: ReadonlyArray<MapChange>
  terrainSimilarity?: number | null
  startLocations: ReadonlyArray<{ slot: number; kind: MapStartLocationChangeKind }>
  bases: ReadonlyArray<{
    beforeIndex?: number | null
    afterIndex?: number | null
    changed: boolean
  }>
}

function beforeAfter(t: TFunction, before: string | number, after: string | number) {
  return t('maps.compare.beforeAfter', {
    defaultValue: '{{before}} → {{after}}',
    before,
    after,
  })
}

function yesNo(t: TFunction, value: boolean) {
  return value ? t('maps.compare.yes', 'Yes') : t('maps.compare.no', 'No')
}

/**
 * Rounds a 0-1 share to a whole percent, but never shows 0% or 100% for a share that isn't
 * exactly that.
 */
function formatPercent(share: number): number {
  const percent = Math.round(share * 100)
  if (share < 1 && percent >= 100) {
    return 99
  }
  if (share > 0 && percent <= 0) {
    return 1
  }
  return percent
}

function terrainSimilarityText(t: TFunction, similarity: number) {
  return t('maps.compare.terrainSimilarity', {
    defaultValue: '{{percent}}% of the walkable terrain is the same',
    percent: formatPercent(similarity),
  })
}

function describeChanges(
  t: TFunction,
  a: CompareSide,
  b: CompareSide,
  comparison: ComparisonDetails,
): ChangeEntry[] {
  return comparison.changes.map((change): ChangeEntry => {
    switch (change) {
      case MapChange.Name:
        return {
          key: change,
          label: t('maps.compare.name', 'Name'),
          lines: [beforeAfter(t, a.name, b.name)],
        }
      case MapChange.Description:
        return {
          key: change,
          label: t('maps.compare.descriptionChanged', 'Description changed'),
          lines: [],
        }
      case MapChange.Dimensions:
        return {
          key: change,
          label: t('maps.compare.dimensions', 'Dimensions'),
          lines: [
            beforeAfter(t, `${a.file.width}×${a.file.height}`, `${b.file.width}×${b.file.height}`),
          ],
        }
      case MapChange.Tileset:
        return {
          key: change,
          label: t('maps.compare.tileset', 'Tileset'),
          lines: [
            beforeAfter(
              t,
              tilesetToName(a.file.tileset as Tileset, t),
              tilesetToName(b.file.tileset as Tileset, t),
            ),
          ],
        }
      case MapChange.PlayerCount:
        return {
          key: change,
          label: t('maps.compare.playerCount', 'Player slots'),
          lines: [beforeAfter(t, a.playerCount, b.playerCount)],
        }
      case MapChange.Forces:
        return {
          key: change,
          label: t('maps.compare.forcesChanged', 'Forces changed'),
          lines: [],
        }
      case MapChange.Eud:
        return {
          key: change,
          label: t('maps.compare.eud', 'Uses EUDs'),
          lines: [beforeAfter(t, yesNo(t, a.file.isEud), yesNo(t, b.file.isEud))],
        }
      case MapChange.UmsActions: {
        const before = new Set(a.file.analysis?.umsActionKinds ?? [])
        const after = new Set(b.file.analysis?.umsActionKinds ?? [])
        const added = Array.from(after).filter(k => !before.has(k))
        const removed = Array.from(before).filter(k => !after.has(k))
        const lines: string[] = []
        if (added.length) {
          lines.push(
            t('maps.compare.umsActionsAdded', {
              defaultValue: 'Added: {{actions}}',
              actions: added.join(', '),
            }),
          )
        }
        if (removed.length) {
          lines.push(
            t('maps.compare.umsActionsRemoved', {
              defaultValue: 'Removed: {{actions}}',
              actions: removed.join(', '),
            }),
          )
        }
        return { key: change, label: t('maps.compare.umsActions', 'Trigger actions'), lines }
      }
      case MapChange.TriggerCount:
        return {
          key: change,
          label: t('maps.compare.triggerCount', 'Trigger count'),
          lines: [
            beforeAfter(t, a.file.analysis?.triggerCount ?? 0, b.file.analysis?.triggerCount ?? 0),
          ],
        }
      case MapChange.StartLocations:
        return {
          key: change,
          label: t('maps.compare.startLocations', 'Start locations'),
          lines: comparison.startLocations.map(s => {
            const player = s.slot + 1
            switch (s.kind) {
              case MapStartLocationChangeKind.Moved:
                return t('maps.compare.startMoved', {
                  defaultValue: 'Player {{player}} start moved',
                  player,
                })
              case MapStartLocationChangeKind.Added:
                return t('maps.compare.startAdded', {
                  defaultValue: 'Player {{player}} start added',
                  player,
                })
              case MapStartLocationChangeKind.Removed:
                return t('maps.compare.startRemoved', {
                  defaultValue: 'Player {{player}} start removed',
                  player,
                })
              default:
                return s.kind satisfies never
            }
          }),
        }
      case MapChange.Bases: {
        const added = comparison.bases.filter(x => x.beforeIndex == null).length
        const removed = comparison.bases.filter(x => x.afterIndex == null).length
        const changed = comparison.bases.filter(
          x => x.beforeIndex != null && x.afterIndex != null && x.changed,
        ).length
        const parts: string[] = []
        if (changed) {
          parts.push(
            t('maps.compare.basesChanged', { defaultValue: '{{count}} changed', count: changed }),
          )
        }
        if (added) {
          parts.push(
            t('maps.compare.basesAdded', { defaultValue: '{{count}} added', count: added }),
          )
        }
        if (removed) {
          parts.push(
            t('maps.compare.basesRemoved', { defaultValue: '{{count}} removed', count: removed }),
          )
        }
        return {
          key: change,
          label: t('maps.compare.bases', 'Resource bases'),
          lines: parts.length ? [parts.join(', ')] : [],
        }
      }
      case MapChange.Terrain:
        return {
          key: change,
          label: t('maps.compare.terrainChanged', 'Terrain shape changed'),
          lines:
            comparison.terrainSimilarity != null
              ? [terrainSimilarityText(t, comparison.terrainSimilarity)]
              : [],
        }
      default:
        return { key: change, label: change satisfies never, lines: [] }
    }
  })
}

function TerrainOverlay({
  encoded,
  width,
  height,
}: {
  encoded: string
  width: number
  height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }

    ctx.clearRect(0, 0, width, height)
    // Resolved at draw time so the highlight follows the active theme.
    const color = getComputedStyle(canvas).getPropertyValue('--theme-amber').trim()
    ctx.fillStyle = color || '#ffb300'
    ctx.globalAlpha = 0.7
    for (const index of decodeTerrainChanges(encoded, width * height)) {
      ctx.fillRect(index % width, Math.floor(index / width), 1, 1)
    }
  }, [encoded, width, height])

  return <TerrainCanvas ref={canvasRef} width={width} height={height} aria-hidden={true} />
}

function CompareBody({
  a: aRef,
  b: bRef,
  details,
  terrainChanges,
}: {
  a: FragmentType<typeof MapCompareSideFragment>
  b: FragmentType<typeof MapCompareSideFragment>
  details: ComparisonDetails
  terrainChanges?: string | null
}) {
  const { t } = useTranslation()
  const [showTerrain, setShowTerrain] = useState(false)
  const a = useFragment(MapCompareSideFragment, aRef)
  const b = useFragment(MapCompareSideFragment, bRef)
  const changes = describeChanges(t, a, b, details)

  return (
    <Content>
      <Sides>
        <Side>
          <ImageFrame style={{ aspectRatio: `${a.file.width} / ${a.file.height}` }}>
            <MapFileImage file={a.file} name={a.name} size={512} />
          </ImageFrame>
          <SideCaption>
            <SideLabel>{t('maps.compare.before', 'Before')}</SideLabel>
            <SideName>{a.name}</SideName>
          </SideCaption>
        </Side>
        <Side>
          <ImageFrame style={{ aspectRatio: `${b.file.width} / ${b.file.height}` }}>
            <MapFileImage file={b.file} name={b.name} size={512} />
            {showTerrain && terrainChanges ? (
              <TerrainOverlay
                encoded={terrainChanges}
                width={b.file.width}
                height={b.file.height}
              />
            ) : null}
          </ImageFrame>
          <SideCaption>
            <SideLabel>{t('maps.compare.after', 'After')}</SideLabel>
            <SideName>{b.name}</SideName>
          </SideCaption>
        </Side>
      </Sides>

      {terrainChanges ? (
        <TerrainControls>
          <CheckBox
            label={t('maps.compare.showTerrainChanges', 'Show terrain changes')}
            checked={showTerrain}
            onChange={event => setShowTerrain(event.target.checked)}
          />
          {details.terrainSimilarity != null ? (
            <Similarity>{terrainSimilarityText(t, details.terrainSimilarity)}</Similarity>
          ) : null}
        </TerrainControls>
      ) : null}

      <ChangesSection>
        <SectionTitle>{t('maps.compare.whatChanged', 'What changed')}</SectionTitle>
        {changes.length ? (
          <ChangeList>
            {changes.map(c => (
              <ChangeRow key={c.key}>
                <ChangeLabel>{c.label}</ChangeLabel>
                {c.lines.map((line, i) => (
                  <ChangeDetail key={i}>{line}</ChangeDetail>
                ))}
              </ChangeRow>
            ))}
          </ChangeList>
        ) : (
          <EmptyText>{t('maps.compare.noDifferences', 'No differences found.')}</EmptyText>
        )}
      </ChangesSection>
    </Content>
  )
}

export interface MapCompareDialogProps extends CommonDialogProps {
  a: SbMapId
  b: SbMapId
}

/** Shows what changed from map `a` (the before side) to map `b` (the after side). */
export function MapCompareDialog({ a, b, onCancel }: MapCompareDialogProps) {
  const { t } = useTranslation()
  const [{ data, error }, reexecuteQuery] = useQuery({
    query: MapCompareQuery,
    variables: { a, b },
    context: NO_SUSPENSE_CONTEXT,
  })

  const comparison = data?.mapComparison
  let content: React.ReactNode
  if (comparison) {
    content = (
      <CompareBody
        a={comparison.a}
        b={comparison.b}
        details={comparison}
        terrainChanges={comparison.terrainChanges}
      />
    )
  } else if (error) {
    content = (
      <LoadErrorRow
        message={t('maps.compare.loadError', "Couldn't compare these maps.")}
        onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
      />
    )
  } else {
    content = <LoadingDotsArea />
  }

  return (
    <StyledDialog
      title={t('maps.compare.title', 'Compare maps')}
      onCancel={onCancel}
      showCloseButton={true}>
      {content}
    </StyledDialog>
  )
}
