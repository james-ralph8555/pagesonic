/**
 * Vitest setup file for SolidJS testing
 * This file runs before each test file
 */

// Mock Web Speech API for TTS tests
class MockSpeechSynthesisUtterance {
  text = ''
  lang = ''
  voice: SpeechSynthesisVoice | null = null
  volume = 1
  rate = 1
  pitch = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
  onpause: (() => void) | null = null
  onresume: (() => void) | null = null
  onboundary: ((event: SpeechSynthesisEvent) => void) | null = null
}

class MockSpeechSynthesis {
  pending = false
  speaking = false
  paused = false
  voices: SpeechSynthesisVoice[] = []

  cancel() {
    this.speaking = false
    this.paused = false
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices
  }

  pause() {
    if (this.speaking) {
      this.paused = true
    }
  }

  resume() {
    this.paused = false
  }

  speak(_utterance: SpeechSynthesisUtterance) {
    this.speaking = true
  }
}

// Set up mocks before tests run
if (typeof window !== 'undefined') {
  window.speechSynthesis = new MockSpeechSynthesis() as unknown as SpeechSynthesis
  // @ts-ignore - Mocking for tests
  window.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance
}

// Suppress console output in tests unless needed
// Uncomment to enable console during test debugging:
// global.console = { ...console }
