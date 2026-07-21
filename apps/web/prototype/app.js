const views = {
  organization: {
    title: '组织与权限',
    copy: '集团 → 区域 → 门店 → 部门 → 岗位 → 员工',
    cards: ['24 家门店', '816 名员工', '52 个岗位定义', '一人多岗 18 人'],
  },
  work: {
    title: '岗位工作数据',
    copy: '员工、主管、店长的结构化工作入口',
    cards: ['前台每日工作记录', '客房巡检记录', '前厅班组日报', '店总每日管理记录'],
  },
  metrics: {
    title: '经营数据',
    copy: '收入、入住率、ADR、RevPAR、OTA评分与成本',
    cards: ['今日收入 ¥86,240', '入住率 87.6%', 'ADR ¥628', 'OTA 4.91'],
  },
}

function showView(name) {
  document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button.dataset.view === name))
  document.getElementById('dashboard-view').hidden = name !== 'dashboard'
  document.getElementById('standards-view').hidden = name !== 'standards'
  document.getElementById('foundation-view').hidden = !views[name]
  if (views[name]) {
    const view = views[name]
    document.getElementById('foundation-title').textContent = view.title
    document.getElementById('foundation-copy').textContent = view.copy
    document.getElementById('foundation-cards').innerHTML = view.cards.map((card, index) =>
      `<article class="panel feature-card"><i>${String(index + 1).padStart(2, '0')}</i><strong>${card}</strong><span>已接入基础数据模型</span></article>`
    ).join('')
  }
}

document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)))

document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
  const role = button.dataset.role
  document.querySelectorAll('[data-role]').forEach(item => item.classList.toggle('active', item === button))
  const isCeo = role === 'CEO'
  document.getElementById('dashboard-title').textContent = isCeo ? '集团管理驾驶舱' : '杭州中心店 · 店总驾驶舱'
  document.getElementById('user-name').textContent = isCeo ? '集团CEO' : '赵晨'
  document.getElementById('user-scope').textContent = isCeo ? '集团视角' : '杭州中心店'
  document.getElementById('stat-one-label').textContent = isCeo ? '运营门店' : '今日收入'
  document.getElementById('stat-one-value').textContent = isCeo ? '24' : '¥86,240'
  document.getElementById('stat-one-hint').textContent = isCeo ? '4个区域 · 2个品牌' : '较昨日 +3.2%'
  document.getElementById('work-total').textContent = isCeo ? '386' : '31/34'
  document.getElementById('work-hint').textContent = isCeo ? '集团完成率 91.6%' : '岗位完成率 91.2%'
  document.getElementById('stat-four-label').textContent = isCeo ? '经营数据完整率' : 'OTA评分'
  document.getElementById('stat-four-value').textContent = isCeo ? '96.8%' : '4.91'
  document.getElementById('hotel-table-title').textContent = isCeo ? '门店关键指标' : '本店经营指标'
  document.querySelectorAll('.ceo-only').forEach(row => row.hidden = !isCeo)
}))

document.getElementById('create-standard').addEventListener('click', () => {
  document.getElementById('create-notice').hidden = false
})

const initial = new URLSearchParams(window.location.search)
if (initial.get('view')) showView(initial.get('view'))
if (initial.get('role') === 'gm') document.querySelector('[data-role="店总"]').click()
