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
  // type checker verifies). A transform that quietly stops emitting it breaks dependency
  // injection at runtime with no build-time signal; this is the only test that would catch that.
  test('design:paramtypes is emitted for injectable constructors', () => {
    expect(Reflect.getMetadata('design:paramtypes', NeedsMetadata)).toEqual([Dependency])
  })
})
