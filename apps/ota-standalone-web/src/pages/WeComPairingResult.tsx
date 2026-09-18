import { useEffect, useRef, useState } from 'react'
import type { WeComRepairAdminsView } from '../api/business'

export type WeComPairingDetails = NonNullable<WeComRepairAdminsView['createdPairing']> & {
  recipientName: string
  hotelNames: string[]
}

export function WeComPairingResult({ pairing }: { pairing: WeComPairingDetails }) {
  const result = useRef<HTMLElement>(null)
  const [copyStatus, setCopyStatus] = useState('')
  useEffect(() => {
    result.current?.focus({ preventScroll: true })
    result.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [])

  async function copyCommand() {
    if (Date.now() >= Date.parse(pairing.expiresAt)) {
      setCopyStatus('绑定码已过期，请重新生成。')
      return
    }
    try {
      await navigator.clipboard.writeText(`绑定 ${pairing.pairingCode}`)
      setCopyStatus('已复制，请私发给指定人员。')
    } catch {
      setCopyStatus('无法自动复制，请选中或长按上方“绑定 六位码”手动复制。')
    }
  }

  return <section ref={result} tabIndex={-1} className="repair-pairing-result" aria-label="新生成的绑定码">
    <div className="repair-pairing-heading"><h4>绑定码已生成</h4><span>24 小时有效 · 仅限一次</span></div>
    <p className="repair-pairing-recipient">交给 <strong>{pairing.recipientName}</strong> · 绑定 {pairing.hotelNames.length} 家门店</p>
    <div className="repair-pairing-command-row">
      <strong className="repair-pairing-command">绑定 {pairing.pairingCode}</strong>
      <button type="button" onClick={() => void copyCommand()}>复制绑定指令</button>
    </div>
    <p>让本人在企业微信机器人单聊中发送上方指令，即可完成绑定。</p>
    <p className="repair-pairing-expiry">有效至 {new Date(pairing.expiresAt).toLocaleString('zh-CN')}</p>
    {copyStatus ? <p className="repair-pairing-copy-status" role="status">{copyStatus}</p> : null}
    <details className="repair-pairing-scope"><summary>查看授权门店与使用须知</summary>
      <p>{pairing.hotelNames.join('、')}</p>
      <p>最多尝试 5 次，成功后立即失效；新码会替换旧码。仅私发给指定人员，不要发到群聊。</p>
      <p>请及时复制保存。刷新页面后不再展示明文；服务重启或权限变更可能使绑定码提前失效。</p>
    </details>
  </section>
}
