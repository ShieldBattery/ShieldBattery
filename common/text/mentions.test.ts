import { matchMentionsMarkup, matchUserMentions } from './mentions'

function doMatch1(text: string): string[] {
  return Array.from(matchUserMentions(text), match => match.groups!.user)
}

describe('common/text/mentions/matchUserMentions', () => {
  test('user as entire text', () => {
    expect(doMatch1('@test')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user as beginning text', () => {
    expect(doMatch1('@test hi!')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user as ending text', () => {
    expect(doMatch1('Hi @test')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user as middle text', () => {
    expect(doMatch1('Hi @test hello')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user with multiple mentions', () => {
    expect(doMatch1('Hi @test, and hi again @test')).toMatchInlineSnapshot(`
      Array [
        "test",
        "test",
      ]
    `)
  })

  test('user with comma after it', () => {
    expect(doMatch1('Hi @test, and everyone else.')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user with semi-colon after it', () => {
    expect(doMatch1('Hi @test; how are you?')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user with colon after it', () => {
    expect(doMatch1('@test: hello.')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user with question mark after it', () => {
    expect(doMatch1('Hi @test?')).toMatchInlineSnapshot(`
      Array [
        "test",
      ]
    `)
  })

  test('user with brackets in name', () => {
    expect(doMatch1('Hi @[test]')).toMatchInlineSnapshot(`
      Array [
        "[test]",
      ]
    `)
  })

  test('user with curly brackets in name', () => {
    expect(doMatch1('Hi @{test}')).toMatchInlineSnapshot(`
      Array [
        "{test}",
      ]
    `)
  })

  test('user with braces in name', () => {
    expect(doMatch1('Hi @(test)')).toMatchInlineSnapshot(`
      Array [
        "(test)",
      ]
    `)
  })

  test('user with question mark in name', () => {
    expect(doMatch1('Hi @test!')).toMatchInlineSnapshot(`
      Array [
        "test!",
      ]
    `)
  })

  test('user with period in name', () => {
    expect(doMatch1('Hi @test.')).toMatchInlineSnapshot(`
      Array [
        "test.",
      ]
    `)
  })

  test('user with varios other special characters in name', () => {
    expect(doMatch1('Hi @test`$^&*+=_-')).toMatchInlineSnapshot(`
      Array [
        "test\`$^&*+=_-",
      ]
    `)
  })

  test('user without the @ character is not mentioned', () => {
    expect(doMatch1('test')).not.toContain('test')
  })

  test('user with no spaces at beginning is not mentioned', () => {
    expect(doMatch1('Hi hello@test')).not.toContain('test')
  })

  test('user with no spaces at ending is not mentioned', () => {
    expect(doMatch1('Hi @testing')).not.toContain('test')
  })

  test('user with no spaces on both sides is not mentioned', () => {
    expect(doMatch1('Hi hello@testing')).not.toContain('test')
  })

  test('user with period after it is not mentioned', () => {
    expect(doMatch1('Hi @test.')).not.toContain('test')
  })

  test('user with exclamation mark after it is not mentioned', () => {
    expect(doMatch1('Hi @test!')).not.toContain('test')
  })
})

function doMatch2(text: string): string[] {
  return Array.from(matchMentionsMarkup(text), match => match.groups!.userId)
}

describe('common/text/mentions/matchMentionsMarkup', () => {
  test('mention markup as entire text', () => {
    expect(doMatch2('<@123>')).toMatchInlineSnapshot(`
      Array [
        "123",
      ]
    `)
  })

  test('mention markup as beginning text', () => {
    expect(doMatch1('<@123> hi!')).toMatchInlineSnapshot(`Array []`)
  })

  test('mention markup as ending text', () => {
    expect(doMatch1('Hi <@123>')).toMatchInlineSnapshot(`Array []`)
  })

  test('mention markup as middle text', () => {
    expect(doMatch1('Hi <@123> hello')).toMatchInlineSnapshot(`Array []`)
  })

  test('mention markup with multiple mentions', () => {
    expect(doMatch1('Hi <@123>, and hi again <@123>')).toMatchInlineSnapshot(`Array []`)
  })

  test('mention markup without the @ character is not mentioned', () => {
    expect(doMatch1('<123>')).toMatchInlineSnapshot(`Array []`)
  })

  test('mention markup with non-digit `userId` is not mentioned', () => {
    expect(doMatch1('<@test>')).toMatchInlineSnapshot(`Array []`)
  })
})
