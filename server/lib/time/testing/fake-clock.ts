import { Clock } from '../clock'

export class FakeClock extends Clock {
  private currentTime = 0

  setCurrentTime(time: number) {
    this.currentTime = time
  }

  override now() {
    return this.currentTime
  }
}
