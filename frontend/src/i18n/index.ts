// i18n/index.ts — i18next configuration. Resources are bundled at build time
// (one JSON file per page/namespace under locales/<lng>/<namespace>.json) so
// translations are available synchronously on first render. Persists the
// chosen language to localStorage and falls back to the browser language.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enCommon from './locales/en/common.json'
import enNav from './locales/en/nav.json'
import enLogin from './locales/en/login.json'
import enOnboarding from './locales/en/onboarding.json'
import enPortfolios from './locales/en/portfolios.json'
import enRecommendations from './locales/en/recommendations.json'
import enStrategyLab from './locales/en/strategyLab.json'
import enTopics from './locales/en/topics.json'
import enSettings from './locales/en/settings.json'
import enUniverse from './locales/en/universe.json'
import enScores from './locales/en/scores.json'
import enStockDetail from './locales/en/stockDetail.json'

import heCommon from './locales/he/common.json'
import heNav from './locales/he/nav.json'
import heLogin from './locales/he/login.json'
import heOnboarding from './locales/he/onboarding.json'
import hePortfolios from './locales/he/portfolios.json'
import heRecommendations from './locales/he/recommendations.json'
import heStrategyLab from './locales/he/strategyLab.json'
import heTopics from './locales/he/topics.json'
import heSettings from './locales/he/settings.json'
import heUniverse from './locales/he/universe.json'
import heScores from './locales/he/scores.json'
import heStockDetail from './locales/he/stockDetail.json'

export const SUPPORTED_LANGUAGES = ['en', 'he'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        nav: enNav,
        login: enLogin,
        onboarding: enOnboarding,
        portfolios: enPortfolios,
        recommendations: enRecommendations,
        strategyLab: enStrategyLab,
        topics: enTopics,
        settings: enSettings,
        universe: enUniverse,
        scores: enScores,
        stockDetail: enStockDetail,
      },
      he: {
        common: heCommon,
        nav: heNav,
        login: heLogin,
        onboarding: heOnboarding,
        portfolios: hePortfolios,
        recommendations: heRecommendations,
        strategyLab: heStrategyLab,
        topics: heTopics,
        settings: heSettings,
        universe: heUniverse,
        scores: heScores,
        stockDetail: heStockDetail,
      },
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: [
      'common',
      'nav',
      'login',
      'onboarding',
      'portfolios',
      'recommendations',
      'strategyLab',
      'topics',
      'settings',
      'universe',
      'scores',
      'stockDetail',
    ],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'aitrader-language',
    },
  })

export default i18n
