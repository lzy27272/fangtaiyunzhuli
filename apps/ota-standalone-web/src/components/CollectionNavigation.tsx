import { Icon } from './ConsoleUi'

export function CollectionNavigation() {
  return (
    <details
      className="collection-navigation"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.open = false
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.currentTarget.open) {
          event.preventDefault()
          event.currentTarget.open = false
          event.currentTarget.querySelector('summary')?.focus()
        }
      }}
    >
      <summary><Icon name="refresh" />采集<Icon name="chevron" size={14} /></summary>
      <div className="collection-submenu">
        <a href="https://www.sfgzt.cn/ota-collector/">
          云端采集<Icon name="arrow" size={16} />
        </a>
      </div>
    </details>
  )
}
