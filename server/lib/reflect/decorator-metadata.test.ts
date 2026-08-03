import { injectable } from 'tsyringe'
import { describe, expect, test } from 'vitest'

class Dependency {}

@injectable()
class NeedsMetadata {
  constructor(readonly dep: Dependency) {}
}

describe('decorator metadata emission', () => {
  // tsyringe resolves constructor dependencies through design:paramtypes, which only exists if
  // the transform emits it (emitDecoratorMetadata comes from tsconfig, not from anything the
  // type checker verifies), and a transform that stops emitting it breaks dependency injection
  // at runtime with no build-time signal. This guards the transform vitest applies to test
  // files, which is what tests that exercise the container depend on. The production build never
  // compiles test files, so it carries its own equivalent check: `tsdown.server.config.ts`
  // asserts design:paramtypes on the compiled output after every build.
  test('design:paramtypes is emitted for injectable constructors', () => {
    expect(Reflect.getMetadata('design:paramtypes', NeedsMetadata)).toEqual([Dependency])
  })
})
