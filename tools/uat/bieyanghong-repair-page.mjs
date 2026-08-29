export const renderBieyanghongRepairPage = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>别样红简报授权修复</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17332d;background:#f3f0e8}body{margin:0;padding:24px}main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #d8d4c8;border-radius:22px;padding:24px;box-shadow:0 14px 36px rgba(20,44,38,.08)}h1{font-size:25px;margin:0 0 10px}.hint{color:#61706c;line-height:1.6}.store{margin:18px 0;padding:14px;border-radius:14px;background:#f4f8f5;font-weight:700}label{display:block;font-weight:700;margin:12px 0 8px}input{box-sizing:border-box;width:100%;font-size:22px;letter-spacing:5px;padding:13px;border:1px solid #aebbb6;border-radius:12px}button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#176b52;color:#fff;font-size:17px;font-weight:700}button:disabled{background:#9aaba5}.status{margin-top:16px;padding:12px;border-radius:12px;background:#f7f4eb;line-height:1.55}.error{color:#9e2c22;background:#fff0ed}.success{color:#126044;background:#eaf7f0}.hidden{display:none}.foot{margin-top:18px;color:#78837f;font-size:13px;line-height:1.6}
  </style>
  <script src="/api/v1/bieyanghong-repair/client.js" defer></script>
</head>
<body>
<main>
  <h1>别样红简报授权修复</h1>
  <p class="hint">请由本次处理管理员填写自己的手机号和密码，再手动发送验证码。首次发送后本链接会锁定到本次登录流程，请勿转发或由多人同时操作。</p>
  <div id="store" class="store">正在读取门店信息…</div>
  <form id="credential-form" class="hidden" autocomplete="off">
    <label for="phone">管理员手机号</label>
    <input id="phone" type="tel" inputmode="numeric" pattern="[0-9]*" minlength="11" maxlength="11" required autocomplete="off">
    <label for="password">管理员密码</label>
    <input id="password" type="password" minlength="1" maxlength="256" required autocomplete="off">
    <button id="request-code" type="submit">发送验证码</button>
  </form>
  <form id="code-form" class="hidden" autocomplete="off">
    <label for="answer">短信验证码</label>
    <input id="answer" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required autocomplete="one-time-code">
    <button id="submit" type="submit">授权登录并自动修复</button>
  </form>
  <div id="status" class="status">正在连接云端服务…</div>
  <p class="foot">链接仅限001门店试点，10分钟内有效；账号资料最多提交2次，验证码最多提交3次。手机号、密码和验证码只在本次内存会话中使用，不保存、不回显、不写入日志，到期立即清除。罗盘门店不使用此页面。</p>
</main>
</body>
</html>`

export const renderBieyanghongRepairClientScript = () => `(() => {
  let repairToken = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const store = document.getElementById('store')
  const credentialForm = document.getElementById('credential-form')
  const phone = document.getElementById('phone')
  const password = document.getElementById('password')
  const requestCode = document.getElementById('request-code')
  const codeForm = document.getElementById('code-form')
  const answer = document.getElementById('answer')
  const submit = document.getElementById('submit')
  const status = document.getElementById('status')
  const headers = () => ({ Authorization: 'Repair ' + repairToken })
  const setStatus = (message, kind = '') => {
    status.textContent = message
    status.className = 'status' + (kind ? ' ' + kind : '')
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
        credentialForm.classList.remove('hidden')
        codeForm.classList.add('hidden')
        requestCode.disabled = false
        setStatus(
          data.reasonCode === 'BIEYANGHONG_LOGIN_CREDENTIALS_REJECTED'
            ? '账号或密码未通过美团校验，请核对后重试。剩余 ' + data.credentialRequestsRemaining + ' 次。'
            : '请填写当前管理员本人的手机号和密码，并手动发送验证码。剩余 ' + data.credentialRequestsRemaining + ' 次。',
          data.reasonCode ? 'error' : ''
        )
      } else if (data.status === 'REQUESTING_CODE') {
        credentialForm.classList.add('hidden')
        codeForm.classList.add('hidden')
        setStatus('正在通过美团官方登录页校验账号并请求短信验证码…')
      } else if (data.status === 'WAITING_FOR_CODE') {
        credentialForm.classList.add('hidden')
        codeForm.classList.remove('hidden')
        submit.disabled = false
        setStatus('等待短信验证码，剩余 ' + data.attemptsRemaining + ' 次。')
      } else if (data.status === 'SUBMITTED' || data.status === 'VERIFYING') {
        credentialForm.classList.add('hidden')
        codeForm.classList.add('hidden')
        setStatus('正在验证登录并重新采集、补发简报，请稍候…')
      } else if (data.status === 'COMPLETE') {
        credentialForm.classList.add('hidden')
        codeForm.classList.add('hidden')
        setStatus('授权修复完成，001简报已重新采集并确认送达。', 'success')
        repairToken = ''
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED') {
        credentialForm.classList.add('hidden')
        codeForm.classList.add('hidden')
        setStatus(data.status === 'EXPIRED' ? '链接已过期，请等待新的授权通知。' : '本次授权未完成，请等待系统重新发起。', 'error')
      } else {
        credentialForm.classList.add('hidden')
        codeForm.classList.add('hidden')
        setStatus('系统正在准备安全授权链接…')
      }
    } catch {
      credentialForm.classList.add('hidden')
      codeForm.classList.add('hidden')
      setStatus('暂时无法读取授权状态，请稍后刷新页面。', 'error')
    }
  }
  credentialForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const phoneValue = phone.value.trim()
    const passwordValue = password.value
    if (!/^\\d{11}$/.test(phoneValue) || passwordValue.length < 1) {
      setStatus('请输入11位手机号和登录密码。', 'error')
      return
    }
    requestCode.disabled = true
    try {
      const pending = fetch('/api/v1/bieyanghong-repair/request-code', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneValue, password: passwordValue })
      })
      phone.value = ''
      password.value = ''
      const response = await pending
      if (!response.ok) throw new Error('REQUEST_CODE_REJECTED')
      setStatus('资料已安全提交，正在请求短信验证码…')
      await refresh()
    } catch {
      phone.value = ''
      password.value = ''
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
  void refresh()
  setInterval(() => { if (repairToken) void refresh() }, 1500)
})()`
