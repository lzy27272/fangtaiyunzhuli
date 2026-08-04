export const renderLuopanRepairPage = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>罗盘简报自动修复</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#17332d;background:#f3f0e8}body{margin:0;padding:24px}main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #d8d4c8;border-radius:22px;padding:24px;box-shadow:0 14px 36px rgba(20,44,38,.08)}h1{font-size:25px;margin:0 0 10px}.hint{color:#61706c;line-height:1.6}.store{margin:18px 0;padding:14px;border-radius:14px;background:#f4f8f5;font-weight:700}.captcha{display:block;width:180px;min-height:54px;object-fit:contain;border:1px solid #cad3cf;border-radius:10px;background:#f5f5f5;margin:14px 0}label{display:block;font-weight:700;margin:12px 0 8px}input{box-sizing:border-box;width:100%;font-size:20px;letter-spacing:4px;padding:13px;border:1px solid #aebbb6;border-radius:12px;text-transform:none}button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#176b52;color:#fff;font-size:17px;font-weight:700}button:disabled{background:#9aaba5}.status{margin-top:16px;padding:12px;border-radius:12px;background:#f7f4eb;line-height:1.55}.error{color:#9e2c22;background:#fff0ed}.success{color:#126044;background:#eaf7f0}.hidden{display:none}.foot{margin-top:18px;color:#78837f;font-size:13px;line-height:1.6}
  </style>
  <script src="/api/v1/luopan-repair/client.js" defer></script>
</head>
<body>
<main>
  <h1>罗盘简报自动修复</h1>
  <p class="hint">请核对门店后输入图片中的验证码。系统不会在此页面展示 PMS 账号、密码或 Cookie。</p>
  <div id="store" class="store">正在读取门店信息…</div>
  <form id="form" class="hidden" autocomplete="off">
    <img id="captcha" class="captcha" alt="罗盘登录验证码">
    <label for="answer">验证码</label>
    <input id="answer" name="captcha" inputmode="text" minlength="4" maxlength="8" required autocomplete="off" autocapitalize="off">
    <button id="submit" type="submit">提交并自动修复</button>
  </form>
  <div id="status" class="status">正在连接云端服务…</div>
  <p class="foot">链接仅限当前门店，10分钟内有效，最多提交3次。修复完成以云端重新采集并取得企业微信 DELIVERED 记录为准。</p>
</main>
</body>
</html>`

export const renderLuopanRepairClientScript = () => `(() => {
  let repairToken = location.hash.slice(1)
  history.replaceState(null, '', location.pathname)
  const store = document.getElementById('store')
  const form = document.getElementById('form')
  const captcha = document.getElementById('captcha')
  const answer = document.getElementById('answer')
  const submit = document.getElementById('submit')
  const status = document.getElementById('status')
  let lastCaptchaKey = ''
  let objectUrl = null
  const headers = () => ({ Authorization: 'Repair ' + repairToken })
  const setStatus = (message, kind = '') => {
    status.textContent = message
    status.className = 'status' + (kind ? ' ' + kind : '')
  }
  const loadCaptcha = async (key) => {
    if (lastCaptchaKey === key) return
    const response = await fetch('/api/v1/luopan-repair/captcha', {
      headers: headers(), cache: 'no-store'
    })
    if (!response.ok) throw new Error('CAPTCHA_UNAVAILABLE')
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = URL.createObjectURL(await response.blob())
    captcha.src = objectUrl
    lastCaptchaKey = key
  }
  const refresh = async () => {
    if (!repairToken) {
      setStatus('链接无效，请等待系统重新发送修复通知。', 'error')
      return
    }
    try {
      const response = await fetch('/api/v1/luopan-repair/status', {
        headers: headers(), cache: 'no-store'
      })
      if (!response.ok) throw new Error('CHALLENGE_UNAVAILABLE')
      const data = (await response.json()).data
      store.textContent = data.hotelCode + ' · ' + data.hotelName
      if (data.status === 'WAITING_FOR_CAPTCHA') {
        await loadCaptcha(data.updatedAt)
        form.classList.remove('hidden')
        submit.disabled = false
        setStatus('等待填写验证码，剩余 ' + data.attemptsRemaining + ' 次。')
      } else if (data.status === 'SUBMITTED' || data.status === 'VERIFYING') {
        form.classList.add('hidden')
        setStatus('正在验证并重新采集、补发简报，请稍候…')
      } else if (data.status === 'COMPLETE') {
        form.classList.add('hidden')
        setStatus('修复完成，简报已重新采集并确认送达。', 'success')
        repairToken = ''
      } else if (data.status === 'FAILED' || data.status === 'EXPIRED') {
        form.classList.add('hidden')
        setStatus(data.status === 'EXPIRED' ? '链接已过期，请等待新的修复通知。' : '本次修复未完成，系统会发送新的处理通知。', 'error')
      } else {
        form.classList.add('hidden')
        setStatus('系统正在准备验证码…')
      }
    } catch {
      form.classList.add('hidden')
      setStatus('暂时无法读取修复状态，请稍后刷新页面。', 'error')
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const value = answer.value.trim()
    if (!/^[a-zA-Z0-9]{4,8}$/.test(value)) {
      setStatus('请输入图片中的4至8位字母或数字。', 'error')
      return
    }
    submit.disabled = true
    try {
      const response = await fetch('/api/v1/luopan-repair/submit', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ captcha: value })
      })
      answer.value = ''
      if (!response.ok) throw new Error('SUBMIT_REJECTED')
      setStatus('验证码已安全提交，正在验证…')
      await refresh()
    } catch {
      submit.disabled = false
      setStatus('提交未成功，请刷新验证码状态后重试。', 'error')
    }
  })
  void refresh()
  setInterval(() => { if (repairToken) void refresh() }, 1500)
})()`
