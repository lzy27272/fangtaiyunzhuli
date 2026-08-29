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
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'self'">
  <title>美团官网登录 · 001</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17332d;background:#fff}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:grid;grid-template-rows:auto minmax(0,1fr);padding-top:env(safe-area-inset-top);background:#fff}.bar{min-height:32px;display:flex;align-items:center;gap:7px;padding:5px max(9px,env(safe-area-inset-right)) 5px max(9px,env(safe-area-inset-left));background:#f5faf7;border-bottom:1px solid #d4ded8;font-size:12px;line-height:1.3;white-space:nowrap}.lock{color:#176b52;font-weight:800}.origin{min-width:0;overflow:hidden;color:#53645e;text-overflow:ellipsis}.state{margin-left:auto;color:#52635d}.workspace{position:relative;min-width:0;min-height:0;background:#fff}.official-frame{display:block;width:100%;height:100%;border:0;background:#fff}.notice{position:absolute;z-index:2;inset:50% auto auto 50%;width:min(88vw,420px);transform:translate(-50%,-50%);padding:15px 18px;border:1px solid #d9dfdb;border-radius:14px;background:rgba(255,255,255,.96);box-shadow:0 12px 32px rgba(20,44,38,.13);text-align:center;line-height:1.65}.notice.error{color:#9e2c22;background:#fff3f1;border-color:#efc7c0}.notice.success{color:#126044;background:#eef9f3;border-color:#bfdfcf}.hidden{display:none}@media(max-width:620px){.bar{min-height:29px;padding-top:4px;padding-bottom:4px;font-size:11px}.notice{width:calc(100vw - 28px);padding:13px 15px;border-radius:12px}}
  </style>
  <script src="/api/v1/bieyanghong-repair/official.js" defer></script>
</head>
<body>
  <header class="bar"><span class="lock">安全连接</span><span class="origin">直接操作美团官方页面，请勿转发</span><span id="state" class="state">正在连接…</span></header>
  <main class="workspace">
    <iframe id="official-frame" class="official-frame hidden" title="美团官方登录页面" referrerpolicy="no-referrer"></iframe>
    <div id="message" class="notice">正在建立001门店的一次性官网登录会话…</div>
  </main>
</body>
</html>`

export const renderBieyanghongOfficialLoginClientScript = () => `(() => {
  let repairToken = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const state = document.getElementById('state')
  const message = document.getElementById('message')
  const officialFrame = document.getElementById('official-frame')
  const noVncUrl = '/api/v1/bieyanghong-repair/novnc/vnc.html?autoconnect=true&resize=scale&shared=false&reconnect=false&path=api%2Fv1%2Fbieyanghong-repair%2Fvnc'
  let finished = false
  let vncSessionActive = false
  const headers = () => ({ Authorization: 'Repair ' + repairToken })
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const setMessage = (value, kind = '') => {
    message.textContent = value
    message.className = 'notice' + (kind ? ' ' + kind : '')
    message.classList.remove('hidden')
  }
  const responseData = async (response) => {
    const payload = await response.json().catch(() => ({}))
    return payload && typeof payload === 'object' && payload.data
      ? payload.data
      : payload
  }
  const fail = (text) => {
    vncSessionActive = false
    officialFrame.classList.add('hidden')
    officialFrame.removeAttribute('src')
    state.textContent = '未完成'
    setMessage(text, 'error')
  }
  const complete = () => {
    if (finished) return
    finished = true
    vncSessionActive = false
    officialFrame.classList.add('hidden')
    officialFrame.removeAttribute('src')
    state.textContent = '已完成'
    setMessage('官网登录已完成，正在恢复001门店的数据采集与播报。此窗口将自动关闭。', 'success')
    repairToken = ''
    setTimeout(() => {
      if (window.WeixinJSBridge && typeof window.WeixinJSBridge.call === 'function') {
        window.WeixinJSBridge.call('closeWindow')
      } else {
        window.close()
      }
      setTimeout(() => {
        if (!window.closed) setMessage('官网登录已完成，请手动关闭此窗口。', 'success')
      }, 450)
    }, 750)
  }
  const waitForInteractiveVerification = async () => {
    while (repairToken && !finished) {
      const response = await fetch('/api/v1/bieyanghong-repair/status', {
        headers: headers(),
        cache: 'no-store'
      })
      if (!response.ok) throw new Error('STATUS')
      const data = await responseData(response) || {}
      if (data.status === 'WAITING_FOR_INTERACTIVE_VERIFICATION') return
      if (data.status === 'COMPLETE') {
        complete()
        return
      }
      if (data.status === 'FAILED' || data.status === 'EXPIRED') {
        throw new Error(data.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED')
      }
      state.textContent = data.status === 'OPENING_OFFICIAL_LOGIN'
        ? '加载官网'
        : '准备会话'
      await sleep(1500)
    }
  }
  const checkUntilComplete = async () => {
    while (vncSessionActive && !finished) {
      await sleep(1500)
      try {
        const response = await fetch('/api/v1/bieyanghong-repair/vnc/check', {
          credentials: 'same-origin',
          cache: 'no-store'
        })
        if (!response.ok) {
          if (response.status >= 500) continue
          throw new Error('CHECK')
        }
        const data = await responseData(response) || {}
        if (
          response.status === 204
          || data.complete === true
          || data.success === true
          || data.authenticated === true
          || data.authenticationDetected === true
          || data.status === 'COMPLETE'
        ) {
          complete()
          return
        }
        if (data.status === 'FAILED' || data.status === 'EXPIRED') {
          throw new Error(data.status)
        }
      } catch (error) {
        if (
          String(error.message) === 'CHECK'
          || String(error.message) === 'FAILED'
          || String(error.message) === 'EXPIRED'
        ) throw error
        state.textContent = '正在重连'
      }
    }
  }
  const run = async () => {
    if (!repairToken) {
      fail('授权链接无效，请等待系统重新发送。')
      return
    }
    try {
      state.textContent = '启动会话'
      const startResponse = await fetch('/api/v1/bieyanghong-repair/official/start', {
        method: 'POST',
        headers: headers()
      })
      if (!startResponse.ok && startResponse.status !== 409) throw new Error('START')
      setMessage('正在加载美团官方登录页面…')
      await waitForInteractiveVerification()
      if (!repairToken || finished) return
      state.textContent = '连接官网'
      const sessionResponse = await fetch('/api/v1/bieyanghong-repair/vnc/session', {
        method: 'POST',
        headers: headers()
      })
      if (!sessionResponse.ok) throw new Error('VNC_SESSION')
      repairToken = ''
      vncSessionActive = true
      officialFrame.src = noVncUrl
      officialFrame.classList.remove('hidden')
      message.classList.add('hidden')
      state.textContent = '001 · 官网登录中'
      await checkUntilComplete()
    } catch (error) {
      if (finished) return
      const reason = String(error.message)
      fail(reason === 'EXPIRED'
        ? '授权链接已过期，请等待系统重新发送。'
        : '暂时无法建立美团官网登录会话，请关闭窗口后使用最新链接重试。')
    }
  }
  void run()
})()`
