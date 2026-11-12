import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { MapPublishAnswerKind, MapPublishBlockedReason } from '../gql/graphql'
import { AddFileFacts, addFileUnavailableText, joinedMessage, planAddFile } from './map-add-file'
import { publishErrorText } from './map-publish'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, defaultValue: string, options?: Record<string, unknown>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? ''),
  )) as unknown as TFunction

const VIEWER = makeSbUserId(1)
const SOMEONE_ELSE = makeSbUserId(2)
const TARGET = 'target-family'

function file({
  family,
  ...overrides
}: Partial<Omit<AddFileFacts, 'family'>> & { family?: Partial<AddFileFacts['family']> } = {}) {
  return {
    name: 'Eclipse 1.3',
    listed: false,
    official: false,
    staffDelisted: false,
    ...overrides,
    family: {
      id: 'own-family',
      name: 'Eclipse 1.3',
      fileCount: 1,
      listed: false,
      credited: false,
      ...family,
    },
  }
}

describe('maps/map-add-file/planAddFile', () => {
  test('moves in a listed file the viewer published that is alone in its map', () => {
    expect(planAddFile(file({ listed: true, publisherId: VIEWER }), TARGET, VIEWER)).toEqual({
      kind: 'link',
    })
  })

  test('publishes an unlisted file into the map', () => {
    expect(planAddFile(file(), TARGET, VIEWER)).toEqual({
      kind: 'publish',
      answer: MapPublishAnswerKind.Join,
    })
  })

  test('lists an unlisted file that is already in the map where it is', () => {
    expect(planAddFile(file({ family: { id: TARGET, fileCount: 3 } }), TARGET, VIEWER)).toEqual({
      kind: 'publish',
      answer: MapPublishAnswerKind.Keep,
    })
  })

  test('knows a listed file of the map is already there', () => {
    expect(
      planAddFile(
        file({ listed: true, publisherId: SOMEONE_ELSE, family: { id: TARGET } }),
        TARGET,
        VIEWER,
      ),
    ).toEqual({ kind: 'alreadyHere' })
  })

  test("won't take a listed file someone else published, or one sharing its map", () => {
    const listedElsewhere = {
      kind: 'unavailable',
      reason: 'listedElsewhere',
      mapName: 'Eclipse 1.3',
    }
    expect(planAddFile(file({ listed: true, publisherId: SOMEONE_ELSE }), TARGET, VIEWER)).toEqual(
      listedElsewhere,
    )
    expect(
      planAddFile(
        file({ listed: true, publisherId: VIEWER, family: { fileCount: 2 } }),
        TARGET,
        VIEWER,
      ),
    ).toEqual(listedElsewhere)
    expect(
      planAddFile(file({ listed: true, official: true, publisherId: VIEWER }), TARGET, VIEWER),
    ).toEqual(listedElsewhere)
  })

  test("won't merge away a map with another maker or a credit", () => {
    const protectedMap = { kind: 'unavailable', reason: 'protected', mapName: 'Eclipse 1.3' }
    expect(planAddFile(file({ family: { ownerId: SOMEONE_ELSE } }), TARGET, VIEWER)).toEqual(
      protectedMap,
    )
    expect(planAddFile(file({ family: { credited: true } }), TARGET, VIEWER)).toEqual(protectedMap)
    expect(
      planAddFile(
        file({ listed: true, publisherId: VIEWER, family: { credited: true } }),
        TARGET,
        VIEWER,
      ),
    ).toEqual(protectedMap)
  })

  test("takes a file from a map the viewer makes, which they're free to merge away", () => {
    expect(planAddFile(file({ family: { ownerId: VIEWER } }), TARGET, VIEWER)).toEqual({
      kind: 'publish',
      answer: MapPublishAnswerKind.Join,
    })
  })

  test("won't publish a file staff delisted, one without a name, or one sharing a listed map", () => {
    expect(planAddFile(file({ staffDelisted: true }), TARGET, VIEWER)).toMatchObject({
      reason: 'staffDelisted',
    })
    expect(planAddFile(file({ name: '\u0003 ' }), TARGET, VIEWER)).toMatchObject({
      reason: 'noName',
    })
    expect(
      planAddFile(
        file({ family: { fileCount: 2, listed: true, name: 'Eclipse' } }),
        TARGET,
        VIEWER,
      ),
    ).toEqual({ kind: 'unavailable', reason: 'inOtherMap', mapName: 'Eclipse' })
  })

  test("publishes a file out of a map it shares while none of that map's files is listed", () => {
    const join = { kind: 'publish', answer: MapPublishAnswerKind.Join }
    expect(planAddFile(file({ family: { fileCount: 2 } }), TARGET, VIEWER)).toEqual(join)
    // Its map stays, so the file moving out merges nothing away
    expect(
      planAddFile(file({ family: { fileCount: 2, ownerId: SOMEONE_ELSE } }), TARGET, VIEWER),
    ).toEqual(join)
    expect(planAddFile(file({ family: { fileCount: 2, credited: true } }), TARGET, VIEWER)).toEqual(
      join,
    )
  })
})

describe('maps/map-add-file/addFileUnavailableText', () => {
  test('names the map the file is in', () => {
    expect(
      addFileUnavailableText(
        { kind: 'unavailable', reason: 'listedElsewhere', mapName: '\u0003Eclipse' },
        t,
      ),
    ).toBe('This file is already published in Eclipse.')
    expect(
      addFileUnavailableText({ kind: 'unavailable', reason: 'inOtherMap', mapName: 'Eclipse' }, t),
    ).toBe('This file is already part of Eclipse.')
  })
})

describe('maps/map-add-file/joinedMessage', () => {
  test('says whether the file became the recommended one', () => {
    expect(joinedMessage({ mapName: 'Eclipse', recommended: 'made' }, t)).toBe(
      'Added to Eclipse as the recommended file',
    )
    expect(joinedMessage({ mapName: 'Eclipse', recommended: 'failed' }, t)).toBe(
      "Added to Eclipse, but couldn't make it recommended",
    )
    expect(joinedMessage({ mapName: 'Eclipse', recommended: 'skipped' }, t)).toBe(
      'Added to Eclipse',
    )
  })

  test('says a published file was published', () => {
    expect(joinedMessage({ mapName: 'Eclipse', recommended: 'made', published: true }, t)).toBe(
      'Published as part of Eclipse as the recommended file',
    )
    expect(joinedMessage({ mapName: 'Eclipse', recommended: 'skipped', published: true }, t)).toBe(
      'Published as part of Eclipse',
    )
  })
})

describe('maps/map-publish/publishErrorText', () => {
  test('explains the codes the server sends', () => {
    expect(publishErrorText(MapPublishBlockedReason.RateLimited, t)).toBe(
      "You've published a lot of maps today. Try again tomorrow.",
    )
    expect(publishErrorText('PROTECTED_MAP', t)).toBe(
      "This file's map has a maker, so it can't be added to another map.",
    )
    expect(publishErrorText('NOT_SUGGESTED', t)).toBe(
      'That map is no longer suggested for this file.',
    )
    expect(publishErrorText('HAS_EXISTING_MAP', t)).toBe(
      "This file is already part of another map, so it can't be added here.",
    )
    expect(publishErrorText('BAD_REQUEST', t)).toBe('Something went wrong. Please try again later.')
    expect(publishErrorText(undefined, t)).toBe('Something went wrong. Please try again later.')
  })
})
