const value = (candidate: string | undefined, fallback: string) => candidate?.trim() || fallback

export const product = Object.freeze({
  name: value(import.meta.env.VITE_PRODUCT_NAME, '贵州四方馆酒店管理有限公司中台'),
  shortName: value(import.meta.env.VITE_PRODUCT_SHORT_NAME, '四方馆中台'),
  edition: value(import.meta.env.VITE_PRODUCT_EDITION, 'Pilot Test Version'),
  editionLabel: value(import.meta.env.VITE_PRODUCT_EDITION_LABEL, '内部测试版'),
  version: value(import.meta.env.VITE_PRODUCT_VERSION, 'TECH-V0.2-PILOT.6'),
  publicUrl: value(import.meta.env.VITE_PUBLIC_URL, 'https://www.sfgzt.cn'),
})
