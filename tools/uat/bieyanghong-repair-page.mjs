export const renderBieyanghongRepairPage = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>别样红简报授权修复</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17332d;background:#f3f0e8}body{margin:0;padding:24px}main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d8d4c8;border-radius:22px;padding:24px;box-shadow:0 14px 36px rgba(20,44,38,.08)}h1{font-size:25px;margin:0 0 10px}.hint{color:#61706c;line-height:1.7}.store{margin:18px 0;padding:14px;border-radius:14px;background:#f4f8f5;font-weight:700}button{width:100%;margin-top:14px;padding:15px;border:0;border-radius:12px;background:#176b52;color:#fff;font-size:17px;font-weight:700}button:disabled{background:#9aaba5}.status{margin-top:16px;padding:12px;border-radius:12px;background:#f7f4eb;line-height:1.55}.error{color:#9e2c22;background:#fff0ed}.success{color:#126044;background:#eaf7f0}.hidden{display:none}.trust{margin:18px 0;padding:15px;border:1px solid #d5ddd8;border-radius:14px;background:#f7faf8}.trust strong{display:block;margin-bottom:6px}.foot{margin-top:18px;color:#78837f;font-size:13px;line-height:1.7}@media(max-width:520px){body{padding:12px}main{padding:18px}}
  </style>
  <script src="/api/v1/bieyanghong-repair/client.js" defer></script>
</head>
<body>
<main>
  <h1>别样红简报授权修复</h1>
  <p class="hint">请由本次处理管理员打开专属窗口，直接在美团官方登录页面完成账号、密码、短信或安全验证。不要转发本链接，也不要由多人同时操作。</p>
  <div id="store" class="store">正在读取门店信息…</div>
  <div class="trust"><strong>官方登录目标</strong>https://pms.meituan.com<br><span class="hint">专属窗口连接001门店的云端隔离浏览器；登录成功后仅保存美团会话用于该门店采集。</span></div>
  <button id="open-official" class="hidden" type="button">打开美团官网登录窗口</button>
  <div id="status" class="status">正在连接云端服务…</div>
  <p class="foot">链接仅限001门店试点，10分钟内有效；官方窗口最多启动2次。输入仅在本次加密会话中转交美团官方页面，不保存、不回显、不写入日志，到期立即清除。罗盘门店仍使用原修复方式。</p>
</main>
</body>
</html>`

export const renderBieyanghongRepairClientScript = () => `(() => {
  let repairToken = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const store = document.getElementById('store')
  const openOfficial = document.getElementById('open-official')
  const status = document.getElementById('status')
  const headers = () => ({ Authorization: 'Repair ' + repairToken })
  const setStatus = (message, kind = '') => {
    status.textContent = message
    status.className = 'status' + (kind ? ' ' + kind : '')
  }
  const failureMessage = (reasonCode) => ({
    BIEYANGHONG_LOGIN_FORM_UNAVAILABLE: '美团官网登录页面未能完整加载。',
    BIEYANGHONG_AUTHENTICATION_NOT_COMPLETED: '美团登录未建立有效会话。',
    BIEYANGHONG_VISUAL_INTERACTION_LIMIT_REACHED: '本次官方窗口的安全操作次数已用尽。',
    BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE: '本次云端官方登录窗口已经失效。'
  }[reasonCode] || '本次授权未完成。')
  const refresh = async () => {
    if (!repairToken) {
      openOfficial.classList.add('hidden')
      setStatus('链接无效，请等待系统重新发送授权通知。', 'error')
      return
    }
    try {
      const response = await fetch('/api/v1/bieyanghong-repair/status', { headers: headers(), cache: 'no-store' })
      if (!response.ok) throw new Error('CHALLENGE_UNAVAILABLE')
      const data = (await response.json()).data
      store.textContent = data.hotelCode + ' · ' + data.hotelName
      if (data.status === 'WAITING_FOR_CREDENTIALS') {
        openOfficial.classList.remove('hidden')
        openOfficial.disabled = false
        setStatus('请点击按钮，在专属窗口内直接完成美团官网登录。剩余可启动 ' + data.credentialRequestsRemaining + ' 次。')
      } else if (data.status === 'OPENING_OFFICIAL_LOGIN') {
        openOfficial.classList.add('hidden')
        setStatus('正在启动001门店的美团官网登录窗口…')
      } else if (data.status === 'WAITING_FOR_INTERACTIVE_VERIFICATION') {
        openOfficial.classList.remove('hidden')
        openOfficial.disabled = false
        openOfficial.textContent = '返回美团官网登录窗口'
        setStatus('美团官网登录窗口已就绪，请在窗口内完成登录。')
      } else if (data.status === 'SUBMITTED' || data.status === 'VERIFYING') {
        openOfficial.classList.add('hidden')
        setStatus('登录已确认，正在重新采集并补发001简报…')
      } else if (data.status === 'COMPLETE') {
        openOfficial.classList.add('hidden')
        setStatus('授权修复完成，001简报已重新采集并确认送达。', 'success')
        repairToken = ''
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED') {
        openOfficial.classList.add('hidden')
        setStatus(data.status === 'EXPIRED' ? '链接已过期，请等待新的授权通知。' : failureMessage(data.reasonCode) + ' 请等待系统重新发起。' + (data.reasonCode ? '（' + data.reasonCode + '）' : ''), 'error')
      } else {
        openOfficial.classList.add('hidden')
        setStatus('系统正在准备安全授权链接…')
      }
    } catch {
      openOfficial.classList.add('hidden')
      setStatus('暂时无法读取授权状态，请稍后刷新页面。', 'error')
    }
  }
  openOfficial.addEventListener('click', () => {
    if (!repairToken) return
    const popup = window.open('/api/v1/bieyanghong-repair/official#' + repairToken, 'bieyanghongOfficialLogin', 'popup=yes,width=1180,height=820,resizable=yes,scrollbars=yes')
    if (!popup) {
      setStatus('当前浏览器不支持独立弹窗，正在进入美团官网登录窗口…')
      location.assign('/api/v1/bieyanghong-repair/official#' + repairToken)
      return
    }
    popup.opener = null
    openOfficial.textContent = '返回美团官网登录窗口'
    setStatus('美团官网登录窗口已打开，请在该窗口内完成登录。')
  })
  void refresh()
  setInterval(() => { if (repairToken) void refresh() }, 1500)
})()`

export const renderBieyanghongOfficialLoginPage = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>美团官网登录 · 001</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17332d;background:#e9eee9}*{box-sizing:border-box}body{margin:0}.bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border-bottom:1px solid #cad4ce}.lock{color:#176b52;font-weight:800}.origin{font-size:14px;color:#51635d}.state{margin-left:auto;font-size:14px}.shell{max-width:1280px;margin:0 auto;padding:14px}.interaction-toolbar{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0}.interaction-toolbar button,.tools button,.keys button{border:0;border-radius:9px;background:#176b52;color:#fff;font-weight:700;padding:12px 10px}.interaction-toolbar button.active{background:#ff5a00}.screen{overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;border:1px solid #879d93;border-radius:12px;background:#dce4df;min-height:360px;box-shadow:0 10px 28px rgba(20,44,38,.12)}.screen img{display:block;width:100%;max-width:none;height:auto;object-fit:contain;touch-action:none;user-select:none;-webkit-user-drag:none}.screen.pan-mode img{touch-action:pan-x pan-y;cursor:grab}.tools{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:10px;padding:10px;background:#fff;border:1px solid #cad4ce;border-radius:12px}.tools input{width:100%;font-size:18px;padding:12px;border:1px solid #9baba4;border-radius:9px}.keys{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px}.hint,.message{line-height:1.55}.hint{color:#61706c;font-size:13px}.message{padding:10px 12px;margin:10px 0;border-radius:10px;background:#fff8e8}.error{color:#9e2c22;background:#fff0ed}.success{color:#126044;background:#eaf7f0}.hidden{display:none}@media(max-width:620px){.bar{align-items:flex-start;flex-wrap:wrap}.state{margin-left:0;width:100%}.shell{padding:8px}.interaction-toolbar{grid-template-columns:repeat(3,1fr)}.screen{min-height:260px}.tools{grid-template-columns:1fr}.tools button{width:100%}.keys{grid-template-columns:repeat(3,1fr)}}
  </style>
  <script src="/api/v1/bieyanghong-repair/official.js" defer></script>
</head>
<body>
  <header class="bar"><span class="lock">安全连接</span><span class="origin">美团官方：pms.meituan.com</span><span id="state" class="state">正在启动…</span></header>
  <main class="shell">
    <div id="message" class="message">正在连接001门店的专属官方登录会话…</div>
    <div id="interaction-toolbar" class="interaction-toolbar hidden">
      <button id="pan-mode" type="button">移动画面</button><button id="operate-mode" type="button">操作官网</button><button id="locate-login" type="button">定位登录区</button><button id="zoom-out" type="button">缩小</button><button id="zoom-in" type="button">放大</button>
    </div>
    <div id="screen" class="screen hidden"><img id="vendor-screen" alt="美团官方登录页面" draggable="false"></div>
    <form id="account-form" class="tools hidden" autocomplete="off">
      <input id="account-value" type="text" inputmode="text" maxlength="64" autocomplete="off" aria-label="账号或手机号" placeholder="先点上方账号/手机号框，再在这里输入">
      <button id="account-send" type="submit">发送账号/手机号</button>
    </form>
    <form id="secret-form" class="tools hidden" autocomplete="off">
      <input id="secret-value" type="password" inputmode="text" maxlength="64" autocomplete="off" aria-label="密码或验证码" placeholder="先点上方密码/验证码框，再在这里输入">
      <button id="secret-send" type="submit">发送密码/验证码</button>
    </form>
    <div id="keys" class="keys hidden">
      <button type="button" data-key="Backspace">退格</button><button type="button" data-key="Tab">下一项</button><button type="button" data-key="Enter">确认</button><button type="button" data-key="Escape">返回</button><button id="refresh-screen" type="button">刷新画面</button>
    </div>
    <p class="hint">手机操作：先选“移动画面”或“定位登录区”查看右侧登录框；再选“操作官网”点中官方输入框、勾选协议或点击“发送验证码”。账号/手机号用第一栏发送，密码/验证码用遮蔽的第二栏发送；发送后立即清空，画面和输入均不保存。</p>
  </main>
</body>
</html>`

export const renderBieyanghongOfficialLoginClientScript = () => `(() => {
  let repairToken = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const state = document.getElementById('state')
  const message = document.getElementById('message')
  const interactionToolbar = document.getElementById('interaction-toolbar')
  const screen = document.getElementById('screen')
  const vendorScreen = document.getElementById('vendor-screen')
  const panMode = document.getElementById('pan-mode')
  const operateMode = document.getElementById('operate-mode')
  const locateLogin = document.getElementById('locate-login')
  const zoomOut = document.getElementById('zoom-out')
  const zoomIn = document.getElementById('zoom-in')
  const accountForm = document.getElementById('account-form')
  const accountValue = document.getElementById('account-value')
  const accountSend = document.getElementById('account-send')
  const secretForm = document.getElementById('secret-form')
  const secretValue = document.getElementById('secret-value')
  const secretSend = document.getElementById('secret-send')
  const keys = document.getElementById('keys')
  const refreshScreen = document.getElementById('refresh-screen')
  let frameBusy = false
  let actionTail = Promise.resolve()
  let frameUrl = ''
  let pointerStart = null
  let started = false
  let frameLoadedOnce = false
  let interactionMode = innerWidth <= 620 ? 'pan' : 'operate'
  let zoomPercent = innerWidth <= 620 ? 200 : 100
  const headers = () => ({ Authorization: 'Repair ' + repairToken })
  const setMessage = (value, kind = '') => {
    message.textContent = value
    message.className = 'message' + (kind ? ' ' + kind : '')
  }
  const showOfficial = (visible) => {
    interactionToolbar.classList.toggle('hidden', !visible)
    screen.classList.toggle('hidden', !visible)
    accountForm.classList.toggle('hidden', !visible)
    secretForm.classList.toggle('hidden', !visible)
    keys.classList.toggle('hidden', !visible)
  }
  const applyInteractionMode = (nextMode, announce = true) => {
    interactionMode = nextMode === 'operate' ? 'operate' : 'pan'
    screen.classList.toggle('pan-mode', interactionMode === 'pan')
    panMode.classList.toggle('active', interactionMode === 'pan')
    operateMode.classList.toggle('active', interactionMode === 'operate')
    if (announce) setMessage(interactionMode === 'pan'
      ? '移动画面模式：可左右滑动查看完整登录区。'
      : '操作官网模式：可点按、勾选或拖动美团官方页面。')
  }
  const setZoom = (nextPercent) => {
    const previousWidth = Math.max(1, screen.scrollWidth)
    const centerRatio = (screen.scrollLeft + screen.clientWidth / 2) / previousWidth
    zoomPercent = Math.max(100, Math.min(300, nextPercent))
    vendorScreen.style.width = zoomPercent + '%'
    requestAnimationFrame(() => {
      screen.scrollLeft = Math.max(0, centerRatio * screen.scrollWidth - screen.clientWidth / 2)
    })
  }
  const focusLoginArea = () => {
    applyInteractionMode('pan', false)
    requestAnimationFrame(() => {
      screen.scrollLeft = Math.max(0, screen.scrollWidth - screen.clientWidth)
      screen.scrollTop = 0
      setMessage('已定位右侧登录区；查看后请选择“操作官网”再点击输入框或发送验证码。')
    })
  }
  vendorScreen.style.width = zoomPercent + '%'
  applyInteractionMode(interactionMode, false)
  const loadFrame = async () => {
    if (!repairToken || frameBusy || screen.classList.contains('hidden')) return
    frameBusy = true
    try {
      const response = await fetch('/api/v1/bieyanghong-repair/visual/frame', { headers: headers(), cache: 'no-store' })
      if (response.status === 202) {
        setMessage('美团登录已确认，正在核验门店并恢复采集播报…', 'success')
        await refresh()
        return
      }
      if (!response.ok || !(response.headers.get('content-type') || '').includes('image/png')) throw new Error('FRAME')
      const nextUrl = URL.createObjectURL(await response.blob())
      vendorScreen.src = nextUrl
      await vendorScreen.decode().catch(() => {})
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ))
      if (!frameLoadedOnce && innerWidth <= 620) {
        screen.scrollLeft = Math.max(0, screen.scrollWidth - screen.clientWidth)
      }
      frameLoadedOnce = true
      if (frameUrl) URL.revokeObjectURL(frameUrl)
      frameUrl = nextUrl
    } catch {
      setMessage('官方页面画面暂时未更新，请点击“刷新画面”。', 'error')
    } finally {
      frameBusy = false
    }
  }
  const sendAction = (action) => {
    if (!repairToken) return Promise.resolve()
    const operation = actionTail.catch(() => {}).then(async () => {
      try {
        const response = await fetch('/api/v1/bieyanghong-repair/visual/interact', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(action) })
        if (!response.ok) throw new Error('ACTION')
        const data = (await response.json()).data
        if (data.authenticationDetected) setMessage('美团登录已确认，正在恢复001采集播报…', 'success')
        await loadFrame()
        await refresh()
      } catch {
        setMessage('本次操作未送达官方页面，请刷新画面后重试。', 'error')
      }
    })
    actionTail = operation
    return operation
  }
  const begin = async () => {
    if (started) return
    started = true
    const response = await fetch('/api/v1/bieyanghong-repair/official/start', { method: 'POST', headers: headers() })
    if (!response.ok) {
      started = false
      if (response.status !== 409) throw new Error('START')
    }
  }
  const refresh = async () => {
    if (!repairToken) {
      showOfficial(false); state.textContent = '链接无效'; setMessage('授权链接无效或已被移除。', 'error'); return
    }
    try {
      const response = await fetch('/api/v1/bieyanghong-repair/status', { headers: headers(), cache: 'no-store' })
      if (!response.ok) throw new Error('STATUS')
      const data = (await response.json()).data
      if (data.status === 'WAITING_FOR_CREDENTIALS') {
        showOfficial(false); state.textContent = '正在启动'; setMessage('正在启动001门店的美团官网登录会话…'); await begin()
      } else if (data.status === 'OPENING_OFFICIAL_LOGIN') {
        showOfficial(false); state.textContent = '加载官方页面'; setMessage('美团官方页面正在加载，请稍候…')
      } else if (data.status === 'WAITING_FOR_INTERACTIVE_VERIFICATION') {
        showOfficial(true); state.textContent = '001 · 官方登录中'; setMessage('请直接在下方美团官方页面完成登录。'); void loadFrame()
      } else if (data.status === 'VERIFYING' || data.status === 'SUBMITTED') {
        showOfficial(false); state.textContent = '正在核验'; setMessage('登录已确认，正在重新采集并补发001简报…')
      } else if (data.status === 'COMPLETE') {
        showOfficial(false); state.textContent = '已完成'; setMessage('授权修复完成，001简报已确认送达。可关闭此窗口。', 'success'); repairToken = ''
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED') {
        showOfficial(false); state.textContent = '未完成'; setMessage(data.status === 'EXPIRED' ? '链接已过期，请等待新的授权通知。' : '本次授权未完成，请等待系统重新发起。' + (data.reasonCode ? '（' + data.reasonCode + '）' : ''), 'error')
      }
    } catch {
      state.textContent = '连接异常'; setMessage('暂时无法连接授权服务，请稍后刷新本窗口。', 'error')
    }
  }
  vendorScreen.addEventListener('pointerdown', (event) => {
    if (interactionMode !== 'operate') return
    const rect = vendorScreen.getBoundingClientRect()
    pointerStart = { x: Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)), y: Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)), at: Date.now() }
    vendorScreen.setPointerCapture?.(event.pointerId); event.preventDefault()
  })
  vendorScreen.addEventListener('pointerup', (event) => {
    if (interactionMode !== 'operate') return
    if (!pointerStart) return
    const rect = vendorScreen.getBoundingClientRect()
    const end = { x: Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)), y: Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)) }
    const start = pointerStart; pointerStart = null
    const distance = Math.hypot(end.x-start.x,end.y-start.y)
    void sendAction(distance < .018 ? { kind:'tap',x:end.x,y:end.y } : { kind:'drag',fromX:start.x,fromY:start.y,toX:end.x,toY:end.y,durationMs:Math.max(250,Math.min(2000,Date.now()-start.at)) })
    event.preventDefault()
  })
  vendorScreen.addEventListener('pointercancel', () => { pointerStart = null })
  const sendTypedValue = async ({ event, input, button }) => {
    event.preventDefault(); const value = input.value
    if (!value || value.length > 64) { setMessage('请先点选官方输入框，再输入内容。', 'error'); return }
    input.value = ''; button.disabled = true
    await sendAction({ kind:'text',value:value }); button.disabled = false
  }
  accountForm.addEventListener('submit', (event) => sendTypedValue({ event, input: accountValue, button: accountSend }))
  secretForm.addEventListener('submit', (event) => sendTypedValue({ event, input: secretValue, button: secretSend }))
  panMode.addEventListener('click', () => applyInteractionMode('pan'))
  operateMode.addEventListener('click', () => applyInteractionMode('operate'))
  locateLogin.addEventListener('click', focusLoginArea)
  zoomOut.addEventListener('click', () => setZoom(zoomPercent - 50))
  zoomIn.addEventListener('click', () => setZoom(zoomPercent + 50))
  document.querySelectorAll('[data-key]').forEach((button) => button.addEventListener('click', () => { void sendAction({kind:'key',key:button.dataset.key}) }))
  refreshScreen.addEventListener('click', () => { void loadFrame() })
  void refresh()
  setInterval(() => { if (repairToken) void refresh() }, 1200)
})()`
