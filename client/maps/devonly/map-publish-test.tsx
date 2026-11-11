import { useState } from 'react'
import styled from 'styled-components'
import { makeSbMapId, MapInfoJson } from '../../../common/maps'
import { makeFragmentData } from '../../gql'
import { MapPublishBlockedReason } from '../../gql/graphql'
import { ScenarioPicker } from '../../lobbies/devonly/scenario-picker'
import { titleMedium } from '../../styles/typography'
import { MapFileImage_FileFragment } from '../map-image'
import {
  MapPublish_FileFragment,
  MapPublish_PreviewFragment,
  MapPublish_SuggestionFragment,
  PublishDialogContents,
} from '../map-publish-dialog'
import { BigGameHunters, FightingSpirit } from './maps-for-testing'

type ScenarioId =
  | 'blocked'
  | 'alreadyListed'
  | 'existingMap'
  | 'noSuggestion'
  | 'oneSuggestion'
  | 'oneLongName'
  | 'threeSuggestions'
  | 'needsReview'
  | 'ownedMaps'
  | 'ownedNoSuggestion'
  | 'error'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'blocked', label: 'Blocked' },
  { id: 'alreadyListed', label: 'Already listed' },
  { id: 'existingMap', label: 'Existing map' },
  { id: 'noSuggestion', label: 'No suggestion' },
  { id: 'oneSuggestion', label: 'One suggestion' },
  { id: 'oneLongName', label: 'One suggestion, long name' },
  { id: 'threeSuggestions', label: 'Three suggestions' },
  { id: 'needsReview', label: 'Needs review' },
  { id: 'ownedMaps', label: 'Owns maps' },
  { id: 'ownedNoSuggestion', label: 'Owns maps, no suggestion' },
  { id: 'error', label: 'Publish failed' },
]

const FILE_ID = makeSbMapId('f00d0000-0000-4000-8000-000000000001')

function fileImage(map: MapInfoJson, id: string) {
  return {
    id,
    ...makeFragmentData(
      {
        id,
        image256Url: map.image256Url ?? '',
        image512Url: map.image512Url ?? '',
        image1024Url: map.image1024Url ?? '',
        image2048Url: map.image2048Url ?? '',
        imageSpawnsBaked: map.imageSpawnsBaked,
        width: map.mapData.width,
        height: map.mapData.height,
        umsContent: false,
        startLocations: [],
      },
      MapFileImage_FileFragment,
    ),
  }
}

const FILE = makeFragmentData(
  {
    id: FILE_ID,
    name: 'Fighting Spirit 1.4 (fixed ramps)',
    family: {
      id: 'f00d-family',
      name: 'Fighting Spirit 1.4 (fixed ramps)',
      current: { id: FILE_ID },
    },
    file: fileImage(FightingSpirit, 'f00d-file'),
  },
  MapPublish_FileFragment,
)

function suggestion(
  n: number,
  map: MapInfoJson,
  name: string,
  facts: {
    similarity: number
    sameKind?: boolean
    triggerSimilarity?: number | null
    sameResources?: boolean
  },
) {
  const fileId = makeSbMapId(`5c00000${n}-0000-4000-8000-000000000000`)
  return {
    id: `suggestion-${n}`,
    ...makeFragmentData(
      {
        id: `suggestion-${n}`,
        similarity: facts.similarity,
        sameKind: facts.sameKind ?? true,
        triggerSimilarity: facts.triggerSimilarity ?? null,
        sameResources: facts.sameResources ?? false,
        family: { id: `family-${n}`, name },
        file: { id: fileId, file: fileImage(map, `${fileId}-file`) },
      },
      MapPublish_SuggestionFragment,
    ),
  }
}

const FIGHTING_SPIRIT = suggestion(1, FightingSpirit, 'Fighting Spirit 1.3', {
  similarity: 0.973,
  sameResources: true,
})
const LONG_NAME = suggestion(2, FightingSpirit, 'Fighting Spirit (Korean ladder edition)', {
  similarity: 0.999,
})
const HUNTERS = suggestion(3, BigGameHunters, 'Big Game Hunters', {
  similarity: 0.81,
  sameKind: false,
})
const UMS = suggestion(4, BigGameHunters, 'Hunters Defense', {
  similarity: 0.72,
  triggerSimilarity: 0.3,
})

function preview({
  blockedReason = null,
  needsReview = false,
  existingMap = null,
  suggestions = [],
}: {
  blockedReason?: MapPublishBlockedReason | null
  needsReview?: boolean
  existingMap?: { id: string; name: string } | null
  suggestions?: Array<ReturnType<typeof suggestion>>
}) {
  return makeFragmentData(
    { id: 'preview', blockedReason, needsReview, existingMap, suggestions },
    MapPublish_PreviewFragment,
  )
}

const PREVIEWS: Record<ScenarioId, ReturnType<typeof preview>> = {
  blocked: preview({ blockedReason: MapPublishBlockedReason.EmailUnverified }),
  alreadyListed: preview({ blockedReason: MapPublishBlockedReason.AlreadyListed }),
  existingMap: preview({ existingMap: { id: 'family-1', name: 'Fighting Spirit 1.3' } }),
  noSuggestion: preview({}),
  oneSuggestion: preview({ suggestions: [FIGHTING_SPIRIT] }),
  oneLongName: preview({ suggestions: [LONG_NAME] }),
  threeSuggestions: preview({ suggestions: [FIGHTING_SPIRIT, HUNTERS, UMS] }),
  needsReview: preview({ needsReview: true, suggestions: [FIGHTING_SPIRIT] }),
  ownedMaps: preview({ suggestions: [FIGHTING_SPIRIT] }),
  ownedNoSuggestion: preview({}),
  error: preview({ suggestions: [FIGHTING_SPIRIT, HUNTERS] }),
}

/**
 * Maps the viewer owns. The suggested map among them stays a suggestion, and the file's own map
 * isn't offered.
 */
const OWNED_MAPS = [
  { id: 'family-1', name: 'Fighting Spirit 1.3' },
  { id: 'f00d-family', name: 'Fighting Spirit 1.4 (fixed ramps)' },
  { id: 'owned-1', name: 'Eclipse 1.2' },
  { id: 'owned-2', name: 'Sylphid' },
]

const Container = styled.div`
  height: 100%;
  overflow: hidden;

  display: flex;
  flex-direction: column;
`

const Controls = styled.div`
  flex-shrink: 0;
  padding: 16px 0;
`

const ControlsTitle = styled.div`
  ${titleMedium};
  margin: 0 16px 8px;
`

const DialogArea = styled.div`
  position: relative;
  flex-grow: 1;
  min-height: 0;
`

const noop = () => {}

/** Renders the publish dialog's contents for each of the states a publish preview can put it in. */
export function MapPublishTest() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('oneSuggestion')

  return (
    <Container>
      <Controls>
        <ControlsTitle>Publish dialog</ControlsTitle>
        <ScenarioPicker scenarios={SCENARIOS} active={scenarioId} onChange={setScenarioId} />
      </Controls>
      <DialogArea>
        <PublishDialogContents
          key={scenarioId}
          preview={PREVIEWS[scenarioId]}
          file={FILE}
          ownedMaps={
            scenarioId === 'ownedMaps' || scenarioId === 'ownedNoSuggestion' ? OWNED_MAPS : []
          }
          sending={false}
          errorMessage={
            scenarioId === 'error' ? 'That map is no longer suggested for this file.' : undefined
          }
          onPublish={noop}
          onCancel={noop}
          close={noop}
        />
      </DialogArea>
    </Container>
  )
}
