import { Button } from '@react-email/button'
import { Html } from '@react-email/html'
import React from 'react'
import { t } from '../i18n/i18next'

export default function Email() {
  return (
    <Html>
      <Button
        pX={20}
        pY={12}
        href='https://example.com'
        style={{ background: '#000', color: '#fff' }}>
        {t('test.click', 'Click me (updated)')}
      </Button>
    </Html>
  )
}
