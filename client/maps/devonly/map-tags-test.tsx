import { useState } from 'react'
import styled from 'styled-components'
import { MapKind } from '../../gql/graphql'
import { ScenarioPicker } from '../../lobbies/devonly/scenario-picker'
import { titleMedium } from '../../styles/typography'
import { TagListEntry } from '../map-tags'
import { MapTagsDialogContents, TagsDialogFamily } from '../map-tags-dialog'

/** A tag of the made-up list, with its names in other languages as `[locale, name]` pairs. */
function devTag(
  id: string,
  kind: MapKind,
  name: string,
  mapCount: number,
  names: ReadonlyArray<[locale: string, name: string]> = [],
): TagListEntry {
  return {
    id,
    kind,
    name,
    names: names.map(([locale, name]) => ({ locale, name })),
    mapCount,
  }
}

/**
 * A tag list as staff might set one up, with made-up map counts. Some tags have names in other
 * languages, and others show their English name in every language.
 */
export const DEV_TAG_LIST: ReadonlyArray<TagListEntry> = [
  devTag('standard', MapKind.Melee, 'Standard', 412, [
    ['es', 'Estándar'],
    ['ko', '표준'],
    ['ru', 'Стандарт'],
    ['zh-Hans', '标准'],
  ]),
  devTag('money', MapKind.Melee, 'Money', 87, [
    ['ko', '무한'],
    ['ru', 'Мани'],
    ['zh-Hans', '钱图'],
  ]),
  devTag('island', MapKind.Melee, 'Island', 23, [['es', 'Isla']]),
  devTag('team', MapKind.Melee, 'Team', 0),
  devTag('defense', MapKind.Ums, 'Defense', 156, [
    ['es', 'Defensa'],
    ['ko', '디펜스'],
    ['ru', 'Защита'],
    ['zh-Hans', '防守'],
  ]),
  devTag('bound', MapKind.Ums, 'Bound', 64),
  devTag('rpg', MapKind.Ums, 'RPG', 31),
  devTag('arena', MapKind.Ums, 'Arena', 12),
  devTag('co-op', MapKind.Ums, 'Co-op', 48, [['es', 'Cooperativo']]),
  devTag('cat-and-mouse', MapKind.Ums, 'Cat & mouse', 9),
  devTag('micro', MapKind.Ums, 'Micro', 27),
  devTag('blood', MapKind.Ums, 'Blood', 5),
  devTag('tug-of-war', MapKind.Ums, 'Tug of war', 3),
  devTag('strategy', MapKind.Ums, 'Strategy', 0),
  devTag('mini-games', MapKind.Ums, 'Mini-games', 14),
  devTag('training', MapKind.Ums, 'Training', 7),
  devTag('campaign', MapKind.Ums, 'Campaign', 2),
]

type ScenarioId = 'none' | 'three' | 'locked' | 'melee' | 'error'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'none', label: 'No tags' },
  { id: 'three', label: 'Three tags' },
  { id: 'locked', label: 'Locked tag' },
  { id: 'melee', label: 'Melee map' },
  { id: 'error', label: 'Save failed' },
]

const FAMILIES: Record<ScenarioId, TagsDialogFamily> = {
  none: { kind: MapKind.Ums, tags: [], lockedTagIds: [], canEditTags: true },
  three: {
    kind: MapKind.Ums,
    tags: ['defense', 'co-op', 'strategy'],
    lockedTagIds: [],
    canEditTags: true,
  },
  locked: {
    kind: MapKind.Ums,
    tags: ['bound', 'micro'],
    lockedTagIds: ['bound'],
    canEditTags: true,
  },
  melee: { kind: MapKind.Melee, tags: ['standard'], lockedTagIds: [], canEditTags: true },
  error: {
    kind: MapKind.Ums,
    tags: ['defense'],
    lockedTagIds: ['defense'],
    canEditTags: true,
  },
}

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

/** Renders the Edit tags dialog's contents for each of the states a map's tags can put it in. */
export function MapTagsTest() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('none')

  return (
    <Container>
      <Controls>
        <ControlsTitle>Edit tags dialog</ControlsTitle>
        <ScenarioPicker scenarios={SCENARIOS} active={scenarioId} onChange={setScenarioId} />
      </Controls>
      <DialogArea>
        <MapTagsDialogContents
          key={scenarioId}
          family={FAMILIES[scenarioId]}
          tagList={DEV_TAG_LIST}
          saving={false}
          errorMessage={
            scenarioId === 'error'
              ? "One of the tags you removed was set by staff or the map's maker, so it stays."
              : undefined
          }
          onSave={noop}
          onCancel={noop}
        />
      </DialogArea>
    </Container>
  )
}
