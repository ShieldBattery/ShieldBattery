/**
 * Produces a value with exponential smoothing applied to it given inputs from consistent time
 * intervals.
 *
 * @example
 * const smoothed = new ExponentialSmoothValue(0.5, 0)
 * setInterval(() => {
 *   smoothed.add(getCurrentPopulation)
 *   console.log('smoothed population: ' + smoothed.value)
 * }, 60000)
 *
 * @see https://en.wikipedia.org/wiki/Exponential_smoothing
 */
export class ExponentialSmoothValue {
  private curValue: number

  /**
   * Creates a new ExponentialSmoothValue.
   *
   * @param alpha the smoothing factor, in the range (0, 1). Lower numbers means more immediate
   *     changes based on recent values (e.g. less smoothing)
   * @param initialValue the value to start from, defaults to 1
   */
  constructor(readonly alpha: number, initialValue = 0) {
    this.curValue = initialValue
  }

  /**
   * Resets the smoothed value to the specified value.
   */
  reset(newValue = 0): this {
    this.curValue = newValue
    return this
  }

  /**
   * Adds a new interval value, updating the smoother value.
   */
  add(value: number): this {
    this.curValue = value * this.alpha + (1 - this.alpha) * this.curValue
    return this
  }

  /** A getter that returns the current smoothed value. */
  get value(): number {
    return this.curValue
  }
}
