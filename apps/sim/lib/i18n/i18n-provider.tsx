'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  APP_LOCALE_COOKIE_NAME,
  type AppLocale,
  DEFAULT_LOCALE,
  isAppLocale,
  type TranslationKey,
  type TranslationValues,
  translate,
} from '@/lib/i18n/messages'

const LOCALE_STORAGE_KEY = 'sim-locale'
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export type TranslationFunction = (key: TranslationKey, values?: TranslationValues) => string

interface I18nContextValue {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: TranslationFunction
}

const I18nContext = createContext<I18nContextValue | null>(null)

interface I18nProviderProps {
  children: ReactNode
  initialLocale?: AppLocale
}

export function I18nProvider({ children, initialLocale = DEFAULT_LOCALE }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale)

  useEffect(() => {
    try {
      const persistedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
      if (isAppLocale(persistedLocale)) setLocaleState(persistedLocale)
    } catch {}
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale)
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
      document.cookie = `${APP_LOCALE_COOKIE_NAME}=${nextLocale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
    } catch {}
  }, [])

  const t = useCallback<TranslationFunction>(
    (key, values) => translate(locale, key, values),
    [locale]
  )
  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within an I18nProvider')
  return context
}
