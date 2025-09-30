import { Component, JSX, createSignal, onCleanup, onMount } from 'solid-js'

type DropdownItem = {
  value: string
  label: string
  disabled?: boolean
}

type Align = 'start' | 'end'

export const GlassDropdownButton: Component<{
  icon: JSX.Element
  ariaLabel: string
  title?: string
  items: DropdownItem[]
  onSelect: (value: string) => void
  disabled?: boolean
  align?: Align
  class?: string
  selectedValue?: string
  containerClass?: string
}> = (props) => {
  const [open, setOpen] = createSignal(false)
  let rootEl: HTMLDivElement | undefined

  const close = () => setOpen(false)
  const toggle = () => { if (!props.disabled) setOpen(v => !v) }

  const onDocClick = (e: MouseEvent) => {
    if (!rootEl) return
    const target = e.target as Node
    if (!rootEl.contains(target)) close()
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  onMount(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
  })

  onCleanup(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
  })

  const renderItems = () => props.items.map(item => {
    const isActive = props.selectedValue === item.value
    return (
      <button
        class={"glass-menu-item" + (isActive ? ' active' : '') + (item.disabled ? ' disabled' : '')}
        aria-selected={isActive}
        disabled={item.disabled}
        onClick={() => {
          if (item.disabled) return
          props.onSelect(item.value)
          close()
        }}
      >{item.label}</button>
    )
  })

  return (
    <div ref={rootEl} class={"dropdown" + (props.containerClass ? ` ${props.containerClass}` : '')}>
      <button
        type="button"
        class={(props.class || 'rail-btn') + (props.disabled ? ' disabled' : '')}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={props.ariaLabel}
        title={props.title || props.ariaLabel}
        disabled={props.disabled}
        onClick={toggle}
      >
        {props.icon}
      </button>
      {open() && (
        <div
          class={"glass-menu " + (props.align === 'end' ? 'align-end' : 'align-start')}
          role="menu"
        >
          {renderItems()}
        </div>
      )}
    </div>
  )
}
