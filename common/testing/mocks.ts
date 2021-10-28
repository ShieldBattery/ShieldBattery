/**
 * Casts any given function to Jest's mocked function type, preserving its original signature.
 */
export function asMockedFunction<T extends (...args: any[]) => any>(fn: T): jest.MockedFunction<T> {
  return fn as jest.MockedFunction<T>
}
