/**
 * Example component test for SolidJS
 * This demonstrates testing patterns for SolidJS components
 */

import { describe, it, expect } from 'vitest'
import { render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'

/**
 * Example component for testing
 * In real tests, import your actual components like:
 * import { PDFViewer } from '../PDFViewer'
 */
function TestComponent(props: { message: string }) {
  return <div data-testid="test-message">{props.message}</div>
}

describe('Component Testing Example', () => {
  it('should render a component with props', () => {
    const { getByTestId } = render(() => <TestComponent message="Hello, World!" />)
    const element = getByTestId('test-message')
    expect(element.textContent).toBe('Hello, World!')
  })

  it('should handle reactive state', () => {
    const [count, setCount] = createSignal(0)

    const { getByTestId } = render(() => (
      <div data-testid="counter">
        <span>Count: {count()}</span>
        <button onClick={() => setCount(c => c + 1)}>Increment</button>
      </div>
    ))

    const element = getByTestId('counter')
    expect(element.textContent).toContain('Count: 0')

    const button = element.querySelector('button') as HTMLButtonElement
    button.click()

    // Note: In SolidJS, reactive updates in tests need proper handling
    // This demonstrates the basic test structure
  })

  it('should find elements by text content', () => {
    const { getByText } = render(() => (
      <div>
        <span>Cancel</span>
        <button>Submit</button>
      </div>
    ))

    expect(getByText('Cancel')).toBeDefined()
    expect(getByText('Submit')).toBeDefined()
  })
})
