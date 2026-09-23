import { nanoid } from 'nanoid'
import { MapPoolPreset, OpponentPreset, PracticeBotRef } from '../../common/bots/practice'
import { SbMapId } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { updatePracticeStore } from './practice-store'

/**
 * Whether a lineup is exactly what a preset holds. Presets pin releases, so a differing release on
 * the same bot counts as an edit.
 */
export function lineupMatchesPreset(
  lineup: ReadonlyArray<PracticeBotRef>,
  preset: Pick<OpponentPreset, 'bots'> | undefined,
): boolean {
  if (!preset) {
    return false
  }
  if (lineup.length !== preset.bots.length) {
    return false
  }
  return lineup.every((entry, i) => entry.key === preset.bots[i].key)
}

/** Saves the given lineup under a new name and selects it as the loaded preset. */
export function saveLineupAsPreset(name: string, lineup: ReadonlyArray<PracticeBotRef>): string {
  const id = nanoid()
  const now = Date.now()
  updatePracticeStore(draft => {
    draft.opponentPresets.push({
      id,
      name,
      bots: lineup.map(b => ({ ...b })),
      createdAt: now,
      updatedAt: now,
    })
    draft.matchmaking.lineupPresetId = id
  })
  return id
}

/** Overwrites a preset with the given lineup. */
export function updateLineupPreset(presetId: string, lineup: ReadonlyArray<PracticeBotRef>): void {
  updatePracticeStore(draft => {
    const preset = draft.opponentPresets.find(p => p.id === presetId)
    if (!preset) {
      return
    }
    preset.bots = lineup.map(b => ({ ...b }))
    preset.updatedAt = Date.now()
    draft.matchmaking.lineupPresetId = presetId
  })
}

/** Replaces the current lineup with a preset's bots. */
export function loadLineupPreset(presetId: string): void {
  updatePracticeStore(draft => {
    const preset = draft.opponentPresets.find(p => p.id === presetId)
    if (!preset) {
      return
    }
    draft.matchmaking.lineup = preset.bots.map(b => ({ ...b }))
    draft.matchmaking.lineupPresetId = presetId
  })
}

/** Detaches the current lineup from its preset, leaving the bots in place. */
export function clearLineupPreset(): void {
  updatePracticeStore(draft => {
    draft.matchmaking.lineupPresetId = undefined
  })
}

export function renameOpponentPreset(presetId: string, name: string): void {
  updatePracticeStore(draft => {
    const preset = draft.opponentPresets.find(p => p.id === presetId)
    if (preset) {
      preset.name = name
      preset.updatedAt = Date.now()
    }
  })
}

/** Removes a saved lineup. Bot installations and their learning data are untouched. */
export function deleteOpponentPreset(presetId: string): void {
  updatePracticeStore(draft => {
    draft.opponentPresets = draft.opponentPresets.filter(p => p.id !== presetId)
    if (draft.matchmaking.lineupPresetId === presetId) {
      draft.matchmaking.lineupPresetId = undefined
    }
  })
}

/** Saves the given maps as a named pool and selects it. */
export function saveMapPoolPreset(name: string, mapIds: ReadonlyArray<SbMapId>): string {
  const id = nanoid()
  const now = Date.now()
  updatePracticeStore(draft => {
    draft.mapPoolPresets.push({
      id,
      name,
      mapIds: [...mapIds],
      createdAt: now,
      updatedAt: now,
    })
    draft.matchmaking.mapPool = { kind: 'preset', presetId: id }
  })
  return id
}

export function updateMapPoolPreset(presetId: string, mapIds: ReadonlyArray<SbMapId>): void {
  updatePracticeStore(draft => {
    const preset = draft.mapPoolPresets.find(p => p.id === presetId)
    if (!preset) {
      return
    }
    preset.mapIds = [...mapIds]
    preset.updatedAt = Date.now()
  })
}

export function renameMapPoolPreset(presetId: string, name: string): void {
  updatePracticeStore(draft => {
    const preset = draft.mapPoolPresets.find(p => p.id === presetId)
    if (preset) {
      preset.name = name
      preset.updatedAt = Date.now()
    }
  })
}

/**
 * Removes a saved map pool. When it was the selected pool, the setup falls back to the official
 * pool rather than being left pointing at something that no longer exists.
 */
export function deleteMapPoolPreset(presetId: string): void {
  updatePracticeStore(draft => {
    draft.mapPoolPresets = draft.mapPoolPresets.filter(p => p.id !== presetId)
    if (draft.matchmaking.presetEdit?.presetId === presetId) {
      draft.matchmaking.presetEdit = undefined
    }
    if (
      draft.matchmaking.mapPool.kind === 'preset' &&
      draft.matchmaking.mapPool.presetId === presetId
    ) {
      draft.matchmaking.mapPool = { kind: 'ladder', matchmakingType: MatchmakingType.Match1v1 }
    }
  })
}

/** Starts editing a saved pool's maps, selecting that pool. */
export function beginMapPoolPresetEdit(preset: MapPoolPreset): void {
  updatePracticeStore(draft => {
    draft.matchmaking.mapPool = { kind: 'preset', presetId: preset.id }
    draft.matchmaking.presetEdit = { presetId: preset.id, mapIds: [...preset.mapIds] }
  })
}

/** Adds a map to the pool being edited, or removes it when it's already there. */
export function toggleMapPoolPresetEditMap(mapId: SbMapId): void {
  updatePracticeStore(draft => {
    const edit = draft.matchmaking.presetEdit
    if (!edit) {
      return
    }
    edit.mapIds = edit.mapIds.includes(mapId)
      ? edit.mapIds.filter(id => id !== mapId)
      : [...edit.mapIds, mapId]
  })
}

export function cancelMapPoolPresetEdit(): void {
  updatePracticeStore(draft => {
    draft.matchmaking.presetEdit = undefined
  })
}

/** Writes the edited maps to their saved pool and ends the edit. */
export function saveMapPoolPresetEdit(): void {
  updatePracticeStore(draft => {
    const edit = draft.matchmaking.presetEdit
    const preset = edit && draft.mapPoolPresets.find(p => p.id === edit.presetId)
    if (preset && edit.mapIds.length > 0) {
      preset.mapIds = [...edit.mapIds]
      preset.updatedAt = Date.now()
    }
    draft.matchmaking.presetEdit = undefined
  })
}
