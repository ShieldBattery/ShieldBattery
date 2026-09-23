import { describe, expect, test } from 'vitest'
import { parseJavaProperties } from './java-runtime'

const JAVA_17_OUTPUT = `Property settings:
    java.class.version = 61.0
    java.home = C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.9
    java.specification.version = 17
    sun.arch.data.model = 64
    sun.desktop = windows

openjdk version "17.0.9" 2023-10-17
`

const JAVA_8_32BIT_OUTPUT = `Property settings:
    java.specification.version = 1.8
    sun.arch.data.model = 32

java version "1.8.0_391"
`

describe('app/bots/java-runtime/parseJavaProperties', () => {
  test('reads a modern runtime', () => {
    expect(parseJavaProperties(JAVA_17_OUTPUT)).toEqual({ major: 17, architecture: 'x86_64' })
  })

  test('reads a 1.x runtime as its major version', () => {
    expect(parseJavaProperties(JAVA_8_32BIT_OUTPUT)).toEqual({ major: 8, architecture: 'x86' })
  })

  test('handles carriage returns', () => {
    expect(parseJavaProperties(JAVA_17_OUTPUT.replaceAll('\n', '\r\n'))).toEqual({
      major: 17,
      architecture: 'x86_64',
    })
  })

  test.each([
    ['nothing at all', ''],
    ['no version', '    sun.arch.data.model = 64\n'],
    ['no data model', '    java.specification.version = 17\n'],
    [
      'an unknown data model',
      '    java.specification.version = 17\n    sun.arch.data.model = 128\n',
    ],
    [
      'an unreadable version',
      '    java.specification.version = wat\n    sun.arch.data.model = 64\n',
    ],
  ])('returns nothing for %s', (_description, output) => {
    expect(parseJavaProperties(output)).toBeUndefined()
  })
})
