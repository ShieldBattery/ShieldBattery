import { isUserMentioned } from './mentions'

describe('common/text/mentions/isUserMentioned', () => {
  test('user without the @ character is not mentioned', () => {
    expect(isUserMentioned('test', 'test')).toBe(false)
  })

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

  test('user with no spaces at beginning', () => {
    expect(isUserMentioned('test', 'Hi hello@test')).toBe(true)
  })

  test('user with no spaces at ending', () => {
    expect(isUserMentioned('test', 'Hi @test!')).toBe(true)
  })

  test('user with no spaces on both sides', () => {
    expect(isUserMentioned('test', 'Hi hello@test!')).toBe(true)
  })

  test('user with multiple mentions', () => {
    expect(isUserMentioned('test', 'Hi @test, and hi again @test.')).toBe(true)
  })

  test('user with mixed case', () => {
    expect(isUserMentioned('test', 'Hi @TEsT!')).toBe(true)
  })
})
