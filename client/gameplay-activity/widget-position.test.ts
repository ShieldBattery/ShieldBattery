import { describe, expect, test } from 'vitest'
import {
  anchorWidgetPosition,
  DEFAULT_WIDGET_POSITION,
  parseWidgetPosition,
} from './widget-position'

const AREA = { width: 1000, height: 600 }
const WIDGET = { width: 200, height: 100 }

describe('client/gameplay-activity/widget-position', () => {
  describe('anchorWidgetPosition', () => {
    test('anchors a widget in the near half to the start edges', () => {
      expect(anchorWidgetPosition({ left: 30, top: 20 }, AREA, WIDGET)).toEqual({
        x: { edge: 'start', offset: 30 },
        y: { edge: 'start', offset: 20 },
      })
    })

    test('anchors a widget in the far half to the end edges', () => {
      // Right edge at 960 of 1000, bottom edge at 570 of 600
      expect(anchorWidgetPosition({ left: 760, top: 470 }, AREA, WIDGET)).toEqual({
        x: { edge: 'end', offset: 40 },
        y: { edge: 'end', offset: 30 },
      })
    })

    test('clamps a corner dragged past the area to its edges', () => {
      expect(anchorWidgetPosition({ left: -50, top: -50 }, AREA, WIDGET)).toEqual({
        x: { edge: 'start', offset: 0 },
        y: { edge: 'start', offset: 0 },
      })
      expect(anchorWidgetPosition({ left: 5000, top: 5000 }, AREA, WIDGET)).toEqual({
        x: { edge: 'end', offset: 0 },
        y: { edge: 'end', offset: 0 },
      })
    })

    test('keeps a widget larger than the area at the start', () => {
      expect(
        anchorWidgetPosition({ left: 100, top: 100 }, { width: 100, height: 50 }, WIDGET),
      ).toEqual({
        x: { edge: 'start', offset: 0 },
        y: { edge: 'start', offset: 0 },
      })
    })
  })

  describe('parseWidgetPosition', () => {
    test('accepts a well-formed position', () => {
      const value = { x: { edge: 'end', offset: 12 }, y: { edge: 'start', offset: 3 } }
      expect(parseWidgetPosition(value)).toEqual(value)
    })

    test.each([
      ['nothing', undefined],
      ['null', null],
      ['a number', 5],
      ['a missing axis', { x: { edge: 'start', offset: 1 } }],
      ['an unknown edge', { x: { edge: 'left', offset: 1 }, y: { edge: 'start', offset: 1 } }],
      [
        'a non-numeric offset',
        { x: { edge: 'start', offset: '1' }, y: { edge: 'start', offset: 1 } },
      ],
      [
        'a non-finite offset',
        { x: { edge: 'start', offset: null }, y: { edge: 'start', offset: 1 } },
      ],
    ])('falls back to the default for %s', (_name, value) => {
      expect(parseWidgetPosition(value)).toEqual(DEFAULT_WIDGET_POSITION)
    })

    test('never yields a negative offset', () => {
      expect(
        parseWidgetPosition({ x: { edge: 'start', offset: -5 }, y: { edge: 'end', offset: -1 } }),
      ).toEqual({ x: { edge: 'start', offset: 0 }, y: { edge: 'end', offset: 0 } })
    })
  })
})
