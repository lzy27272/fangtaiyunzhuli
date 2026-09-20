// Exact dependencies observed on the official EBooking login and subsequent
// merchant-workbench redirect on 2026-09-18. Test the entire transition: the
// initial login form does not exercise the verification or merchant origins.
// This enables the provider's UI only: it does not solve challenges, read
// credentials, authorize a hotel, or provide a business-data collector.
export const MEITUAN_LOGIN_NETWORK_VERSION = '2026-09-18-merchant-transition-v2'
export const MEITUAN_LOGIN_PORTAL_URL = 'https://eb.meituan.com/'

const origins = [
  'https://eb.meituan.com',
  'https://epassport.meituan.com',
  // Verification is loaded only after pressing Login; the initial form alone
  // does not exercise this dependency. Missing it leaves the dialog spinning.
  'https://verify.meituan.com',
  // After login EBooking embeds its workbench in the merchant shell here.
  // Blocking this exact origin produces Chrome ERR_BLOCKED_BY_CLIENT even
  // though the user has already completed the provider's verification.
  'https://me.meituan.com',
  'https://s3plus.meituan.com',
  'https://s3plus.meituan.net', 'https://awp-assets.meituan.net',
  'https://s3.meituan.net', 'https://awps-assets.meituan.net',
  'https://s0.meituan.net', 'https://portal-portm.meituan.com',
  'https://p0.meituan.net', 'https://appsec-mobile.meituan.com',
  'https://rcf.meituan.com', 'https://msp.meituan.com',
  'https://msp.meituan.net', 'https://msp-backup.meituan.net',
  'https://img.meituan.net', 'https://p1.meituan.net',
  'https://throne-hfe.meituan.com', 'https://static.meituan.net',
]

const rules = Object.freeze([
  ...origins.map(origin => ({ origin, pathPrefix: '/', methods: ['GET', 'POST', 'HEAD', 'OPTIONS'] })),
  { origin: 'https://www.dpfile.com', pathPrefix: '/', methods: ['GET', 'HEAD'] },
].map(rule => Object.freeze({ ...rule, methods: Object.freeze(rule.methods) })))

export const createMeituanLoginNetwork = () => ({
  portalUrl: MEITUAN_LOGIN_PORTAL_URL,
  // Each live profile gets its own working copy; diagnostic changes never
  // mutate the baseline or another store. Unknown origins remain denied.
  networkRules: rules.map(rule => ({ ...rule, methods: [...rule.methods] })),
})
