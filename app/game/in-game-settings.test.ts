import { describe, expect, test } from 'vitest'
import { ConsoleSkin, DisplayMode } from '../../common/settings/blizz-settings'
import { FramePacing, MinimapColorMode } from '../../common/settings/local-settings'
import { readInGameSettingsChange } from './in-game-settings'

describe('app/game/in-game-settings', () => {
  test('keeps settings the options screen owns, in the app encodings', () => {
    const { change, rejected } = readInGameSettingsChange({
      local: {
        framePacing: FramePacing.Display,
        rollbackTarget: 3,
        minimapColorMode: MinimapColorMode.Preset,
        customCursorSize: 0.625,
      },
      scr: {
        musicVolume: 40,
        vsyncOn: 1,
        displayMode: DisplayMode.Fullscreen,
        consoleSkin: ConsoleSkin.War3Spoils,
      },
    })

    expect(rejected).toEqual([])
    expect(change).toEqual({
      local: {
        framePacing: FramePacing.Display,
        rollbackTarget: 3,
        minimapColorMode: MinimapColorMode.Preset,
        customCursorSize: 0.625,
      },
      scr: {
        musicVolume: 40,
        vsyncOn: 1,
        displayMode: DisplayMode.Fullscreen,
        consoleSkin: ConsoleSkin.War3Spoils,
      },
    })
  })

  test('drops keys the game has no screen for and values out of range', () => {
    const { change, rejected } = readInGameSettingsChange({
      local: { starcraftPath: 'C:\\evil', rollbackTarget: 9, framePacing: 'turbo' },
      scr: { musicVolume: 101, vsyncOn: true, version: 99, showFps: true },
    })

    expect(change).toEqual({ local: {}, scr: { showFps: true } })
    expect(rejected.sort()).toEqual(
      [
        'framePacing',
        'musicVolume',
        'rollbackTarget',
        'starcraftPath',
        'version',
        'vsyncOn',
      ].sort(),
    )
  })

  test('reads the chosen monitor as bounds, or null for the primary display', () => {
    expect(readInGameSettingsChange({ monitor: [1920, 0, 2560, 1440] }).change.monitor).toEqual({
      x: 1920,
      y: 0,
      width: 2560,
      height: 1440,
    })
    expect(readInGameSettingsChange({ monitor: null }).change.monitor).toBeNull()
    expect(readInGameSettingsChange({}).change).not.toHaveProperty('monitor')
    expect(readInGameSettingsChange({ monitor: [1, 2] }).rejected).toEqual(['monitor'])
  })

  test('keeps the observer panels the game saves, and nothing shaped otherwise', () => {
    const panels = { matchup: true, graphs: false, series: 'Income' }
    expect(readInGameSettingsChange({ local: { observerPanels: panels } }).change.local).toEqual({
      observerPanels: panels,
    })
    expect(
      readInGameSettingsChange({ local: { observerPanels: { matchup: { nested: true } } } })
        .rejected,
    ).toEqual(['observerPanels'])
  })

  test('saves observer window layouts and rejects malformed values', () => {
    const windows = {
      economy: { collapsed: false, position: [120, 240] },
      graphs: { collapsed: true, position: null },
      timeline: { collapsed: false, position: [24, 48] },
    }
    const panels = { economy: true, windows }
    expect(readInGameSettingsChange({ local: { observerPanels: panels } }).change.local).toEqual({
      observerPanels: panels,
    })
    for (const position of [
      [1],
      [1, 2, 3],
      [NaN, 0],
      [Infinity, 0],
      [1.5, 0],
      ['1', 0],
      [2 ** 32, 0],
    ]) {
      const observerPanels = { windows: { economy: { collapsed: false, position } } }
      expect(readInGameSettingsChange({ local: { observerPanels } }).rejected).toEqual([
        'observerPanels',
      ])
    }
    for (const layout of [null, [], { collapsed: 'true', position: null }]) {
      expect(
        readInGameSettingsChange({ local: { observerPanels: { windows: { economy: layout } } } })
          .rejected,
      ).toEqual(['observerPanels'])
    }
  })

  test('tolerates a payload missing either half', () => {
    expect(readInGameSettingsChange(undefined).change).toEqual({ local: {}, scr: {} })
    expect(readInGameSettingsChange({ scr: 'nope' }).change).toEqual({ local: {}, scr: {} })
  })
})
