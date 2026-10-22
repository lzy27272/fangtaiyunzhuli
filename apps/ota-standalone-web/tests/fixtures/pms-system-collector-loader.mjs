// Child-process integration fixture: keep the real API, stores, monitoring,
// and publication paths, replacing only the external PMS/browser boundary.
import { registerHooks } from 'node:module'
import { appendFileSync } from 'node:fs'

// Keep real message validation and ledger handling, intercepting only the
// final network boundary. No fixture may access an external network.
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, options)
  if (url.hostname === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/webhook/send') {
    appendFileSync(process.env.PMS_SYSTEM_TEST_SEND_SPY_PATH, `${JSON.stringify({
      host: url.hostname, path: url.pathname, method: options?.method,
    })}\n`)
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  throw new Error('PMS_SYSTEM_TEST_EXTERNAL_NETWORK_BLOCKED')
}

function syntheticPmsCollection({ hotel, previousSnapshots = [], sources = [] }) {
  const state = JSON.parse(readPmsFixture(process.env.PMS_SYSTEM_TEST_COLLECTOR_STATE_PATH, 'utf8'))
  if (state.completeness === 'FAILED') throw new Error('LIVE_TEST_UPSTREAM_REJECTED')
  const completeness = state.completeness
  const observedAt = new Date().toISOString()
  const snapshot = {
    tenantId: hotel.tenantId, hotelId: hotel.hotelId, sourceSystem: hotel.pmsSystemCode,
    collectionRunId: crypto.randomUUID(), observedAt,
    businessDate: observedAt.slice(0, 10), businessDateBasis: 'PMS_CONFIRMED',
    completeness, physicalInventory: [], roomForecast: [], orders: [], sources: [],
    futureDaily: [], futureBookingChanges: { daily: [] },
    overview: { roomCount: 10, availableRooms: 6, soldRooms: 4, roomNights: 4, roomFee: 400, adr: 100, revPar: 40 },
    testBaselineSnapshotCount: previousSnapshots.length,
  }
  const sourceCount = sources.filter(source => source.enabled).length || 3
  return { snapshot, monitor: {}, run: { status: completeness === 'COMPLETE' ? 'SUCCEEDED' : 'PARTIAL',
    sourceCount, successfulSourceCount: completeness === 'COMPLETE' ? sourceCount : sourceCount - 1,
    outboundDeliveryAttempted: false } }
}

registerHooks({
  load(url, context, nextLoad) {
    const externalBoundary = url.endsWith('/tools/uat/luopan-controlled-browser-collector.mjs')
      ? ['collectLuopanControlledBrowser', 'validateLuopanBrowserSession']
      : url.endsWith('/tools/uat/live-report-collector.mjs') ? ['collectLiveReports'] : []
    const result = nextLoad(url, context)
    if (!externalBoundary.length) return result
    let source = String(result.source)
    for (const name of externalBoundary) source = source.replace(`export const ${name} =`, `const original_${name} =`)
    source += `\nimport { readFileSync as readPmsFixture } from 'node:fs';\n${syntheticPmsCollection.toString()}\n`
    if (externalBoundary.includes('collectLiveReports')) source += '\nexport const collectLiveReports = syntheticPmsCollection;\n'
    else source += `
export const collectLuopanControlledBrowser = syntheticPmsCollection;
export const validateLuopanBrowserSession = async () => ({ hotelFingerprint: '1234567890abcdef',
  scopeStatus: 'SINGLE_HOTEL_CONFIRMED', validatedAt: new Date().toISOString(), businessDate: new Date().toISOString().slice(0,10) });
`
    return { ...result, source }
  },
})
