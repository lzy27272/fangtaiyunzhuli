#!/usr/bin/env node

import {
  futureBookingAiConfigFromEnv,
  generateFutureBookingAiActionLines,
} from './src/future-booking-ai-advice.mjs'

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const businessDate = new Date().toISOString().slice(0, 10)
const rows = Array.from({ length: 14 }, (_, index) => ({
  stayDate: addDays(businessDate, index + 1),
  roomCount: 50,
  availableRooms: index === 4 ? 13 : 38 - index,
  bookedRoomNights: index === 4 ? 37 : 12 + index,
  occupancyPercent: index === 4 ? 74 : 24 + index * 2,
  adr: 260 + index * 3,
  hourlyNetRoomNights: index === 4 ? 1 : 0,
  previousDayNetRoomNights: index % 3,
}))
const ruleAdviceLines = [
  '结论｜测试日期售卖率74%，高需求但当前未触发加速。',
  '先做｜收益经理30分钟内核对渠道结构和可售房态。',
  '策略｜若2小时出现新增，人工评估一个价格变量。',
  '复盘｜2小时后比较净增间夜、ADR和余房。',
]

try {
  const config = futureBookingAiConfigFromEnv(process.env)
  const lines = await generateFutureBookingAiActionLines({
    config,
    businessDate,
    rows,
    ruleAdviceLines,
  })
  if (!Array.isArray(lines) || lines.length !== 3) {
    throw new Error('AI_PROVIDER_TEST_OUTPUT_INVALID')
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'AI_PROVIDER_TEST_PASS',
      actionLineCount: lines.length,
    })}\n`,
  )
} catch (error) {
  const candidate = error?.reasonCode ?? error?.message
  const reasonCode =
    typeof candidate === 'string'
    && /^[A-Z0-9][A-Z0-9_]{1,63}$/.test(candidate)
      ? candidate
      : 'AI_PROVIDER_TEST_FAILED'
  process.stderr.write(
    `${JSON.stringify({
      status: 'AI_PROVIDER_TEST_FAILED',
      reasonCode,
    })}\n`,
  )
  process.exitCode = 2
}
