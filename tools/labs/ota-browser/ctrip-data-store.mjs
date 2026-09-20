import { CTRIP_DATA_RECIPES, dataAssert } from './ctrip-data-contract.mjs'

export const createCtripDataStore = db => {
  db.exec(`CREATE TABLE IF NOT EXISTS lab_data_recipes (
    profile_id TEXT NOT NULL, recipe_id TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(profile_id,recipe_id)) STRICT;
    CREATE TABLE IF NOT EXISTS lab_data_result (
    profile_id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS lab_monthly_result (
      profile_id TEXT NOT NULL, month TEXT NOT NULL, hotel_id TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(profile_id,month)) STRICT;`)
  const validRecipe = value => {
    const known = CTRIP_DATA_RECIPES[value?.id]
    return known && Object.keys(value).sort().join(',') === 'hotelId,id,method,page,path,profileId,schemaHash,verifiedAt,version'
      && Object.entries(known).every(([k, v]) => value[k] === v)
      && /^ctrip-[a-f0-9]{32}$/u.test(value.profileId)
      && /^[1-9]\d{0,14}$/u.test(value.hotelId)
      && /^[a-f0-9]{64}$/u.test(value.schemaHash)
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value.verifiedAt)
  }
  return {
    saveRecipe: async value => {
      dataAssert(validRecipe(value))
      db.prepare('INSERT INTO lab_data_recipes(profile_id,recipe_id,value) VALUES(?,?,?) ON CONFLICT(profile_id,recipe_id) DO UPDATE SET value=excluded.value')
        .run(value.profileId, value.id, JSON.stringify(value))
    },
    getRecipeCount: (profileId, hotelId) => db.prepare('SELECT value FROM lab_data_recipes WHERE profile_id=?').all(profileId)
      .filter(row => { try { const value = JSON.parse(row.value); return validRecipe(value) && value.profileId === profileId && value.hotelId === hotelId } catch { return false } }).length,
    // Caller supplies only the contract-projected aggregate, never HTTP bodies.
    saveData: async value => {
      dataAssert(value.version === 1 && /^ctrip-[a-f0-9]{32}$/u.test(value.profileId)
        && /^[1-9]\d{0,14}$/u.test(value.hotelId) && ['COMPLETE', 'PARTIAL'].includes(value.status))
      db.prepare('INSERT INTO lab_data_result(profile_id,value) VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET value=excluded.value')
        .run(value.profileId, JSON.stringify(value))
    },
    saveMonthlyData: async value => {
      dataAssert(value.version === 1 && value.kind === 'CTRIP_MONTHLY' && value.scope === 'CTRIP_ONLY'
        && /^ctrip-[a-f0-9]{32}$/u.test(value.profileId) && /^[1-9]\d{0,14}$/u.test(value.hotelId)
        && /^20\d{2}-(0[1-9]|1[0-2])$/u.test(value.window?.month) && ['COMPLETE', 'PARTIAL'].includes(value.status))
      db.prepare('INSERT INTO lab_monthly_result(profile_id,month,hotel_id,value) VALUES(?,?,?,?) ON CONFLICT(profile_id,month) DO UPDATE SET hotel_id=excluded.hotel_id,value=excluded.value')
        .run(value.profileId, value.window.month, value.hotelId, JSON.stringify(value))
    },
    getMonthlyData: (profileId, hotelId) => {
      if (!hotelId) return null
      const row = db.prepare('SELECT value FROM lab_monthly_result WHERE profile_id=? AND hotel_id=? ORDER BY month DESC LIMIT 1').get(profileId, hotelId)
      try {
        const value = JSON.parse(row?.value)
        return value.version === 1 && value.kind === 'CTRIP_MONTHLY' && value.scope === 'CTRIP_ONLY'
          && value.profileId === profileId && value.hotelId === hotelId && ['COMPLETE', 'PARTIAL'].includes(value.status) ? value : null
      } catch { return null }
    },
  }
}
