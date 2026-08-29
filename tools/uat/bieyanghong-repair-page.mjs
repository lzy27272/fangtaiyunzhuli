export const renderBieyanghongRepairPage = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>别样红简报授权修复</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17332d;background:#f3f0e8}body{margin:0;padding:24px}main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d8d4c8;border-radius:22px;padding:24px;box-shadow:0 14px 36px rgba(20,44,38,.08)}h1{font-size:25px;margin:0 0 10px}.hint{color:#61706c;line-height:1.6}.store{margin:18px 0;padding:14px;border-radius:14px;background:#f4f8f5;font-weight:700}label{display:block;font-weight:700;margin:12px 0 8px}input{box-sizing:border-box;width:100%;font-size:22px;letter-spacing:5px;padding:13px;border:1px solid #aebbb6;border-radius:12px}button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#176b52;color:#fff;font-size:17px;font-weight:700}button:disabled{background:#9aaba5}.status{margin-top:16px;padding:12px;border-radius:12px;background:#f7f4eb;line-height:1.55}.error{color:#9e2c22;background:#fff0ed}.success{color:#126044;background:#eaf7f0}.hidden{display:none}.visual{margin-top:16px;padding:14px;border:1px solid #d5ddd8;border-radius:16px;background:#f7faf8}.visual h2{font-size:18px;margin:0 0 8px}.screen{overflow:hidden;border:1px solid #8ea39a;border-radius:12px;background:#e6ece8;min-height:180px}.screen img{display:block;width:100%;height:auto;min-height:180px;object-fit:contain;touch-action:none;user-select:none;-webkit-user-drag:none}.visual-tools{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}.visual-tools input{font-size:17px;letter-spacing:0}.visual-tools button{width:auto;padding:13px 16px}.key-tools{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.key-tools button{padding:10px 6px;font-size:14px}.foot{margin-top:18px;color:#78837f;font-size:13px;line-height:1.6}@media(max-width:520px){body{padding:12px}main{padding:18px}.visual-tools{grid-template-columns:1fr}.visual-tools button{width:100%}}
  </style>
  <script src="/api/v1/bieyanghong-repair/client.js" defer></script>
</head>
<body>
<main>
  <h1>别样红简报授权修复</h1>
  <p class="hint">请由本次处理管理员填写自己的手机号，手动发送并填写短信验证码。不需要密码；首次发送后本链接会锁定到本次登录流程，请勿转发或由多人同时操作。</p>
  <div id="store" class="store">正在读取门店信息…</div>
  <form id="credential-form" class="hidden" autocomplete="off">
    <label for="phone">管理员手机号</label>
    <input id="phone" type="tel" inputmode="numeric" pattern="[0-9]*" minlength="11" maxlength="11" required autocomplete="off">
    <button id="request-code" type="submit">发送短信验证码</button>
  </form>
  <form id="code-form" class="hidden" autocomplete="off">
    <label for="answer">短信验证码</label>
    <input id="answer" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required autocomplete="one-time-code">
    <button id="submit" type="submit">授权登录并自动修复</button>
  </form>
  <section id="visual" class="visual hidden">
    <h2>美团官方安全验证</h2>
    <p class="hint">下方是服务器中本次专属的美团官方页面。请直接点按或拖动图片完成验证；需要输入内容时，先点选官方输入框，再使用下方输入框发送。画面不保存。</p>
    <div class="screen"><img id="vendor-screen" alt="正在加载美团官方安全验证页面" draggable="false"></div>
    <form id="visual-text-form" class="visual-tools" autocomplete="off">
      <div><label for="visual-text">向已选中的官方输入框输入</label><input id="visual-text" maxlength="64" autocomplete="off"></div>
      <button id="visual-text-send" type="submit">发送文字</button>
    </form>
    <div class="key-tools">
      <button type="button" data-visual-key="Backspace">退格</button>
      <button type="button" data-visual-key="Tab">下一项</button>
      <button type="button" data-visual-key="Enter">确认</button>
      <button id="refresh-screen" type="button">刷新画面</button>
    </div>
  </section>
  <div id="status" class="status">正在连接云端服务…</div>
  <p class="foot">链接仅限001门店试点，10分钟内有效；手机号最多提交2次，验证码最多提交3次。手机号和验证码只在本次内存会话中使用，不保存、不回显、不写入日志，到期立即清除。罗盘门店不使用此页面。</p>
</main>
</body>
</html>`

export const renderBieyanghongRepairClientScript = () => `(() => {
  let repairToken = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const store = document.getElementById('store')
  const credentialForm = document.getElementById('credential-form')
  const phone = document.getElementById('phone')
  const requestCode = document.getElementById('request-code')
  const codeForm = document.getElementById('code-form')
  const answer = document.getElementById('answer')
  const submit = document.getElementById('submit')
  const visual = document.getElementById('visual')
  const vendorScreen = document.getElementById('vendor-screen')
  const visualTextForm = document.getElementById('visual-text-form')
  const visualText = document.getElementById('visual-text')
  const visualTextSend = document.getElementById('visual-text-send')
  const refreshScreen = document.getElementById('refresh-screen')
  const status = document.getElementById('status')
  let visualFrameBusy = false
  let visualActionBusy = false
  let visualFrameUrl = ''
  let pointerStart = null
  const headers = () => ({ Authorization: 'Repair ' + repairToken })
  const setStatus = (message, kind = '') => {
    status.textContent = message
    status.className = 'status' + (kind ? ' ' + kind : '')
  }
  const failureMessage = (reasonCode) => ({
    BIEYANGHONG_AUTHENTICATION_NOT_COMPLETED: '美团短信登录未建立有效会话。',
    BIEYANGHONG_LOGIN_FORM_UNAVAILABLE: '美团登录页面未能完整加载。',
    BIEYANGHONG_SMS_LOGIN_FORM_UNAVAILABLE: '美团短信登录表单未能完整加载。',
    BIEYANGHONG_LOGIN_PHONE_INPUT_UNAVAILABLE: '手机号未能写入美团短信登录表单。',
    BIEYANGHONG_SMS_REQUEST_NOT_CONFIRMED: '美团页面未确认短信验证码已发送。',
    BIEYANGHONG_LOGIN_ACCOUNT_REJECTED: '手机号未通过美团校验。',
    BIEYANGHONG_SMS_RATE_LIMITED: '美团已限制验证码发送频率，请稍后再试。',
    BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED: '美团要求额外安全验证，自动流程已停止。',
    BIEYANGHONG_ACCOUNT_SELECTION_REQUIRED: '该手机号关联多个美团账号，安全模式不会自动代选账号。'
  }[reasonCode] || '本次授权未完成。')
  const showOnly = (section) => {
    credentialForm.classList.toggle('hidden', section !== credentialForm)
    codeForm.classList.toggle('hidden', section !== codeForm)
    visual.classList.toggle('hidden', section !== visual)
    if (section !== visual && visualFrameUrl) {
      URL.revokeObjectURL(visualFrameUrl)
      visualFrameUrl = ''
      vendorScreen.removeAttribute('src')
    }
  }
  const updateVisualFrame = async () => {
    if (!repairToken || visualFrameBusy || visual.classList.contains('hidden')) return
    visualFrameBusy = true
    try {
      const response = await fetch('/api/v1/bieyanghong-repair/visual/frame', {
        headers: headers(), cache: 'no-store'
      })
      if (response.status === 202) {
        await refresh()
        return
      }
      if (!response.ok || !(response.headers.get('content-type') || '').includes('image/png')) {
        throw new Error('VISUAL_FRAME_UNAVAILABLE')
      }
      const nextUrl = URL.createObjectURL(await response.blob())
      vendorScreen.src = nextUrl
      if (visualFrameUrl) URL.revokeObjectURL(visualFrameUrl)
      visualFrameUrl = nextUrl
    } catch {
      setStatus('安全验证画面暂时未更新，请点击“刷新画面”。', 'error')
    } finally {
      visualFrameBusy = false
    }
  }
  const sendVisualAction = async (action) => {
    if (!repairToken || visualActionBusy) return
    visualActionBusy = true
    try {
      const response = await fetch('/api/v1/bieyanghong-repair/visual/interact', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(action)
      })
      if (!response.ok) throw new Error('VISUAL_INTERACTION_REJECTED')
      const data = (await response.json()).data
      if (data.authenticationDetected) {
        setStatus('美团登录已确认，正在核验001门店并恢复采集播报…')
      }
      await updateVisualFrame()
      await refresh()
    } catch {
      setStatus('本次操作未送达官方页面，请刷新画面后重试。', 'error')
    } finally {
      visualActionBusy = false
    }
  }
  const refresh = async () => {
    if (!repairToken) {
      setStatus('链接无效，请等待系统重新发送授权通知。', 'error')
      return
    }
    try {
      const response = await fetch('/api/v1/bieyanghong-repair/status', {
        headers: headers(), cache: 'no-store'
      })
      if (!response.ok) throw new Error('CHALLENGE_UNAVAILABLE')
      const data = (await response.json()).data
      store.textContent = data.hotelCode + ' · ' + data.hotelName
      if (data.status === 'WAITING_FOR_CREDENTIALS') {
        showOnly(credentialForm)
        requestCode.disabled = false
        setStatus(
          data.reasonCode === 'BIEYANGHONG_LOGIN_ACCOUNT_REJECTED'
            ? '手机号未通过美团校验，请核对后重试。剩余 ' + data.credentialRequestsRemaining + ' 次。'
            : '请填写当前管理员本人的手机号，并手动发送短信验证码。不需要密码。剩余 ' + data.credentialRequestsRemaining + ' 次。',
          data.reasonCode ? 'error' : ''
        )
      } else if (data.status === 'REQUESTING_CODE') {
        showOnly(null)
        setStatus('正在通过美团官方短信登录入口请求验证码…')
      } else if (data.status === 'WAITING_FOR_CODE') {
        showOnly(codeForm)
        submit.disabled = false
        setStatus('等待短信验证码，剩余 ' + data.attemptsRemaining + ' 次。')
      } else if (data.status === 'WAITING_FOR_INTERACTIVE_VERIFICATION') {
        showOnly(visual)
        setStatus(
          data.reasonCode === 'BIEYANGHONG_ACCOUNT_SELECTION_REQUIRED'
            ? '请在美团官方页面选择本次001门店对应的账号。'
            : '美团要求额外安全验证，请由当前管理员在下方官方页面手动完成。'
        )
        void updateVisualFrame()
      } else if (data.status === 'SUBMITTED' || data.status === 'VERIFYING') {
        showOnly(null)
        setStatus('正在验证登录并重新采集、补发简报，请稍候…')
      } else if (data.status === 'COMPLETE') {
        showOnly(null)
        setStatus('授权修复完成，001简报已重新采集并确认送达。', 'success')
        repairToken = ''
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED') {
        showOnly(null)
        setStatus(
          data.status === 'EXPIRED'
            ? '链接已过期，请等待新的授权通知。'
            : failureMessage(data.reasonCode) + ' 请等待系统重新发起。' + (data.reasonCode ? '（' + data.reasonCode + '）' : ''),
          'error'
        )
      } else {
        showOnly(null)
        setStatus('系统正在准备安全授权链接…')
      }
    } catch {
      showOnly(null)
      setStatus('暂时无法读取授权状态，请稍后刷新页面。', 'error')
    }
  }
  credentialForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const phoneValue = phone.value.trim()
    if (!/^\\d{11}$/.test(phoneValue)) {
      setStatus('请输入11位手机号。', 'error')
      return
    }
    requestCode.disabled = true
    try {
      const pending = fetch('/api/v1/bieyanghong-repair/request-code', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneValue })
      })
      phone.value = ''
      const response = await pending
      if (!response.ok) throw new Error('REQUEST_CODE_REJECTED')
      setStatus('资料已安全提交，正在请求短信验证码…')
      await refresh()
    } catch {
      phone.value = ''
      requestCode.disabled = false
      setStatus('未能发送验证码，请刷新授权状态后重试。', 'error')
    }
  })
  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const value = answer.value.trim()
    if (!/^\\d{4,8}$/.test(value)) {
      setStatus('请输入4至8位数字短信验证码。', 'error')
      return
    }
    submit.disabled = true
    try {
      const response = await fetch('/api/v1/bieyanghong-repair/submit', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value })
      })
      answer.value = ''
      if (!response.ok) throw new Error('SUBMIT_REJECTED')
      setStatus('验证码已安全提交，正在验证…')
      await refresh()
    } catch {
      submit.disabled = false
      setStatus('提交未成功，请刷新授权状态后重试。', 'error')
    }
  })
  vendorScreen.addEventListener('pointerdown', (event) => {
    const rect = vendorScreen.getBoundingClientRect()
    pointerStart = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      at: Date.now()
    }
    vendorScreen.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  })
  vendorScreen.addEventListener('pointerup', (event) => {
    if (!pointerStart) return
    const rect = vendorScreen.getBoundingClientRect()
    const end = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    }
    const start = pointerStart
    pointerStart = null
    const distance = Math.hypot(end.x - start.x, end.y - start.y)
    void sendVisualAction(distance < 0.018
      ? { kind: 'tap', x: end.x, y: end.y }
      : {
          kind: 'drag', fromX: start.x, fromY: start.y,
          toX: end.x, toY: end.y,
          durationMs: Math.max(250, Math.min(1500, Date.now() - start.at))
        })
    event.preventDefault()
  })
  vendorScreen.addEventListener('pointercancel', () => { pointerStart = null })
  visualTextForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const value = visualText.value
    if (!value || value.length > 64) {
      setStatus('请先输入需要发送到官方页面的内容。', 'error')
      return
    }
    visualText.value = ''
    visualTextSend.disabled = true
    await sendVisualAction({ kind: 'text', value: value })
    visualTextSend.disabled = false
  })
  document.querySelectorAll('[data-visual-key]').forEach((button) => {
    button.addEventListener('click', () => {
      void sendVisualAction({ kind: 'key', key: button.dataset.visualKey })
    })
  })
  refreshScreen.addEventListener('click', () => { void updateVisualFrame() })
  void refresh()
  setInterval(() => { if (repairToken) void refresh() }, 1500)
})()`
