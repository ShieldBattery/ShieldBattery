import { matchMentionsMarkup, matchUserMentions } from './mentions'

describe('common/text/mentions/matchUserMentions', () => {
  const doMatch = (text: string): string[] => {
    return Array.from(matchUserMentions(text), match => match.groups.username)
  }

  test('user as entire text', () => {
    expect(doMatch('@test')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user as beginning text', () => {
    expect(doMatch('@test hi!')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user as ending text', () => {
    expect(doMatch('Hi @test')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user as middle text', () => {
    expect(doMatch('Hi @test hello')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user with multiple mentions', () => {
    expect(doMatch('Hi @test, and hi again @test')).toMatchInlineSnapshot(`
      [
        "test",
        "test",
      ]
    `)
  })

  test('user with multiple mentions separated by space', () => {
    expect(doMatch('Hi @test @test @test')).toMatchInlineSnapshot(`
      [
        "test",
        "test",
        "test",
      ]
    `)
  })

  test('user with comma after it', () => {
    expect(doMatch('Hi @test, and everyone else.')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user with semi-colon after it', () => {
    expect(doMatch('Hi @test; how are you?')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user with colon after it', () => {
    expect(doMatch('@test: hello.')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user with question mark after it', () => {
    expect(doMatch('Hi @test?')).toMatchInlineSnapshot(`
      [
        "test",
      ]
    `)
  })

  test('user with brackets in name', () => {
    expect(doMatch('Hi @[test]')).toMatchInlineSnapshot(`
      [
        "[test]",
      ]
    `)
  })

  test('user with curly brackets in name', () => {
    expect(doMatch('Hi @{test}')).toMatchInlineSnapshot(`
      [
        "{test}",
      ]
    `)
  })

  test('user with braces in name', () => {
    expect(doMatch('Hi @(test)')).toMatchInlineSnapshot(`
      [
        "(test)",
      ]
    `)
  })

  test('user with question mark in name', () => {
    expect(doMatch('Hi @test!')).toMatchInlineSnapshot(`
      [
        "test!",
      ]
    `)
  })

  test('user with period in name', () => {
    expect(doMatch('Hi @test.')).toMatchInlineSnapshot(`
      [
        "test.",
      ]
    `)
  })

  test('user with various other special characters in name', () => {
    expect(doMatch('Hi @test`$^&*+=_-')).toMatchInlineSnapshot(`
      [
        "test\`$^&*+=_-",
      ]
    `)
  })

  test('user without the @ character is not mentioned', () => {
    expect(doMatch('test')).not.toContain('test')
  })

  test('user with no spaces at beginning is not mentioned', () => {
    expect(doMatch('Hi hello@test')).not.toContain('test')
  })

  test('user with no spaces at ending is not mentioned', () => {
    expect(doMatch('Hi @testing')).not.toContain('test')
  })

  test('user with no spaces on both sides is not mentioned', () => {
    expect(doMatch('Hi hello@testing')).not.toContain('test')
  })

  test('user with period after it is not mentioned', () => {
    expect(doMatch('Hi @test.')).not.toContain('test')
  })

  test('user with exclamation mark after it is not mentioned', () => {
    expect(doMatch('Hi @test!')).not.toContain('test')
  })
})

describe('common/text/mentions/matchMentionsMarkup', () => {
  const doMatch = (text: string): string[] => {
    return Array.from(matchMentionsMarkup(text), match => match.groups.userId)
  }

  test('mention markup as entire text', () => {
    expect(doMatch('<@123>')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup as beginning text', () => {
    expect(doMatch('<@123> hi!')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup as ending text', () => {
    expect(doMatch('Hi <@123>')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup as middle text', () => {
    expect(doMatch('Hi <@123> hello')).toMatchInlineSnapshot(`
      [
        "123",
      ]
    `)
  })

  test('mention markup with multiple mentions', () => {
    expect(doMatch('Hi <@123>, and hi again <@123>')).toMatchInlineSnapshot(`
      [
        "123",
        "123",
      ]
    `)
  })

  test('mention markup without the @ character is not mentioned', () => {
    expect(doMatch('<123>')).toMatchInlineSnapshot(`[]`)
  })

  test('mention markup with non-digit `userId` is not mentioned', () => {
    expect(doMatch('<@test>')).toMatchInlineSnapshot(`[]`)
  })
})
