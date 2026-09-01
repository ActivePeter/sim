import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, isAppLocale, translate } from '@/lib/i18n/messages'

describe('i18n messages', () => {
  it('defaults new Sim sessions to Simplified Chinese', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })

  it('recognizes only supported locales', () => {
    expect(isAppLocale('zh-CN')).toBe(true)
    expect(isAppLocale('en')).toBe(true)
    expect(isAppLocale('zh-TW')).toBe(false)
    expect(isAppLocale(undefined)).toBe(false)
  })

  it('translates typed messages and interpolates values', () => {
    expect(translate('zh-CN', 'plan.header.revision', { revision: 13 })).toBe('版本 13')
    expect(translate('en', 'plan.header.ready', { count: 2 })).toBe('2 ready')
  })
})
