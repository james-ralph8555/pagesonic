/**
 * Example store test for SolidJS
 * This demonstrates testing patterns for SolidJS stores and reactivity
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createStore, produce } from 'solid-js/store'

/**
 * Example store for testing
 * In real tests, import your actual stores like:
 * import { usePDFStore } from '../pdf'
 */
interface TestState {
  items: string[]
  selectedId: string | null
  count: number
}

function createTestStore() {
  const [state, setState] = createStore<TestState>({
    items: [],
    selectedId: null,
    count: 0,
  })

  return {
    get state() {
      return state
    },
    addItem: (item: string) => {
      setState('items', items => [...items, item])
    },
    removeItem: (index: number) => {
      setState('items', items => items.filter((_, i) => i !== index))
    },
    setSelected: (id: string | null) => {
      setState('selectedId', id)
    },
    increment: () => {
      setState('count', c => c + 1)
    },
  }
}

describe('Store Testing Example', () => {
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    store = createTestStore()
  })

  it('should initialize with default state', () => {
    expect(store.state.items).toEqual([])
    expect(store.state.selectedId).toBeNull()
    expect(store.state.count).toBe(0)
  })

  it('should add items to the store', () => {
    store.addItem('item1')
    expect(store.state.items).toEqual(['item1'])

    store.addItem('item2')
    expect(store.state.items).toEqual(['item1', 'item2'])
  })

  it('should remove items from the store', () => {
    store.addItem('item1')
    store.addItem('item2')
    store.addItem('item3')

    store.removeItem(1)
    expect(store.state.items).toEqual(['item1', 'item3'])
  })

  it('should update selected ID', () => {
    store.setSelected('abc123')
    expect(store.state.selectedId).toBe('abc123')

    store.setSelected(null)
    expect(store.state.selectedId).toBeNull()
  })

  it('should increment count', () => {
    expect(store.state.count).toBe(0)

    store.increment()
    expect(store.state.count).toBe(1)

    store.increment()
    store.increment()
    expect(store.state.count).toBe(3)
  })

  it('should handle complex state updates with produce', () => {
    interface NestedState {
      users: Array<{ id: string; name: string; active: boolean }>
    }

    const [nestedState, setNestedState] = createStore<NestedState>({
      users: [
        { id: '1', name: 'Alice', active: true },
        { id: '2', name: 'Bob', active: false },
      ],
    })

    setNestedState(
      produce((draft) => {
        const user = draft.users.find(u => u.id === '2')
        if (user) user.active = true
      })
    )

    expect(nestedState.users[1].active).toBe(true)
  })
})
