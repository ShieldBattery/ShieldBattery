import { matchChannelMentions, matchChannelMentionsMarkup } from './channel-mentions'

describe('common/text/mentions/matchChannelMentions', () => {
  const doMatch = (text: string): string[] => {
    return Array.from(matchChannelMentions(text), match => match.groups.channelName)
  }

  test('channel as entire text', () => {
    expect(doMatch('#test')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('channel as beginning text', () => {
    expect(doMatch('#test join!')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('channel as ending text', () => {
    expect(doMatch('Join #test')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('channel as middle text', () => {
    expect(doMatch('Join #test please')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('channel with multiple mentions', () => {
    expect(doMatch('Join #test, and join again #test')).toMatchInlineSnapshot(`
      [
        "test,",
        "test",
      ]
    `)
  })

  test('channel with multiple mentions separated by space', () => {
    expect(doMatch('Join #test #test #test')).toMatchInlineSnapshot(`
      [
        "test",
        "test",
        "test",
      ]
    `)
  })

  test('channel with brackets in name', () => {
    expect(doMatch('Join #[test]')).toMatchInlineSnapshot(`
      [
        "[test]",
      ]
    `)
  })

  test('channel with curly brackets in name', () => {
    expect(doMatch('Join #{test}')).toMatchInlineSnapshot(`
      [
        "{test}",
      ]
    `)
  })

  test('channel with angle brackets in name', () => {
    expect(doMatch('Join #<test>')).toMatchInlineSnapshot(`
      [
        "<test>",
      ]
    `)
  })

  test('channel with braces in name', () => {
    expect(doMatch('Join #(test)')).toMatchInlineSnapshot(`
      [
        "(test)",
      ]
    `)
  })

  test('channel with period in name', () => {
    expect(doMatch('Join #test.')).toMatchInlineSnapshot(`
      [
        "test.",
      ]
    `)
  })

  test('channel with comma in name', () => {
    expect(doMatch('Join #test,')).toMatchInlineSnapshot(`
      [
        "test,",
      ]
    `)
  })

  test('channel with colon in name', () => {
    expect(doMatch('Join #test:')).toMatchInlineSnapshot(`
      [
        "test:",
      ]
    `)
  })

  test('channel with semi-colon in name', () => {
    expect(doMatch('Join #test;')).toMatchInlineSnapshot(`
      [
        "test;",
      ]
    `)
  })

  test('channel with question mark in name', () => {
    expect(doMatch('Join #test?')).toMatchInlineSnapshot(`
      [
        "test?",
      ]
    `)
  })

  test('channel with exclamation mark in name', () => {
    expect(doMatch('Join #test!')).toMatchInlineSnapshot(`
      [
        "test!",
      ]
    `)
  })

  test('channel with various other special characters in name', () => {
    expect(doMatch(`Join #test\`$^&*+=_-|'"`)).toMatchInlineSnapshot(`
      [
        "test\`$^&*+=_-|'"",
      ]
    `)
  })

  test('channel without the # character is not mentioned', () => {
    expect(doMatch('test')).not.toContain('test')
  })

  test('channel with no spaces at beginning is not mentioned', () => {
    expect(doMatch('Join test#test')).not.toContain('test')
  })

  test('channel with no spaces at ending is not mentioned', () => {
    expect(doMatch('Join #testing')).not.toContain('test')
  })

  test('channel with no spaces on both sides is not mentioned', () => {
    expect(doMatch('Join test#testing')).not.toContain('test')
  })

  test('channel with period after it is not mentioned', () => {
    expect(doMatch('Join #test.')).not.toContain('test')
  })

  test('channel with comma after it is not mentioned', () => {
    expect(doMatch('Join #test, please')).not.toContain('test')
  })

  test('channel with colon after it is not mentioned', () => {
    expect(doMatch('Join #test: please')).not.toContain('test')
  })

  test('channel with semi-colon after it is not mentioned', () => {
    expect(doMatch('Join #test; please')).not.toContain('test')
  })

  test('channel with question mark after it is not mentioned', () => {
    expect(doMatch('Join #test?')).not.toContain('test')
  })

  test('channel with exclamation mark after it is not mentioned', () => {
    expect(doMatch('Join #test!')).not.toContain('test')
  })
})

describe('common/text/mentions/matchChannelMentionsMarkup', () => {
  const doMatch = (text: string): string[] => {
    return Array.from(matchChannelMentionsMarkup(text), match => match.groups.channelId)
  }

  test('mention markup as entire text', () => {
    expect(doMatch('<#123>')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup as beginning text', () => {
    expect(doMatch('<#123> join!')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup as ending text', () => {
    expect(doMatch('Join <#123>')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup as middle text', () => {
    expect(doMatch('Join <#123> please')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup with multiple mentions', () => {
    expect(doMatch('Join <#123> and join again <#123>')).toMatchInlineSnapshot(`
      [
        "123",
        "123",
      ]
    `)
  })

  test('mention markup without the # character is not mentioned', () => {
    expect(doMatch('<123>')).toMatchInlineSnapshot(`[]`)
  })

  test('mention markup with non-digit `channelId` is not mentioned', () => {
    expect(doMatch('<#test>')).toMatchInlineSnapshot(`[]`)
  })
})
