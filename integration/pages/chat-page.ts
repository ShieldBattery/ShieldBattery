import { Page } from '@playwright/test'
import { LeftNav } from './left-nav'

export class ChatPage extends LeftNav {
  constructor(page: Page) {
    super(page)
  }
}
