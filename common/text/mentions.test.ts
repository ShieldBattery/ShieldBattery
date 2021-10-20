import { isUserMentioned } from './mentions'

describe('common/text/mentions/isUserMentioned', () => {
  test('user as entire text', () => {
    expect(isUserMentioned('test', '@test')).toBe(true)
  })

  test('user as beginning text', () => {
    expect(isUserMentioned('test', '@test hi!')).toBe(true)
  })

  test('user as ending text', () => {
    expect(isUserMentioned('test', 'Hi @test')).toBe(true)
  })

  test('user as middle text', () => {
    expect(isUserMentioned('test', 'Hi @test hello')).toBe(true)
  })

  test('user with multiple mentions', () => {
    expect(isUserMentioned('test', 'Hi @test, and hi again @test.')).toBe(true)
  })

  test('user with mixed case', () => {
    expect(isUserMentioned('test', 'Hi @TEsT')).toBe(true)
  })

  test('user with comma after it', () => {
    expect(isUserMentioned('test', 'Hi @test, and everyone else.')).toBe(true)
  })

  test('user with semi-colon after it', () => {
    expect(isUserMentioned('test', 'Hi @test; how are you?')).toBe(true)
  })

  test('user with colon after it', () => {
    expect(isUserMentioned('test', '@test: hello.')).toBe(true)
  })

  test('user with question mark after it', () => {
    expect(isUserMentioned('test', 'Hi @test?')).toBe(true)
  })

  test('user without the @ character is not mentioned', () => {
    expect(isUserMentioned('test', 'test')).toBe(false)
  })

  test('user with no spaces at beginning is not mentioned', () => {
    expect(isUserMentioned('test', 'Hi hello@test')).toBe(false)
  })

  test('user with no spaces at ending is not mentioned', () => {
    expect(isUserMentioned('test', 'Hi @testing')).toBe(false)
  })

  test('user with no spaces on both sides is not mentioned', () => {
    expect(isUserMentioned('test', 'Hi hello@testing')).toBe(false)
  })

  test('user with period after it is not mentioned', () => {
    expect(isUserMentioned('test', 'Hi @test.')).toBe(false)
  })

  test('user with exclamation mark after it is not mentioned', () => {
    expect(isUserMentioned('test', 'Hi @test!')).toBe(false)
  })
})
