// iOS device detection utilities

/**
 * Detects if the current device is running iOS
 */
export const isIOSDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/**
 * Detects if the current device is running iOS Safari
 */
export const isIOSSafari = (): boolean => {
  if (typeof navigator === 'undefined') return false
  
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/.test(navigator.userAgent)
  
  return isIOS && isSafari
}

/**
 * Detects if the current device is running iOS and using WebKit
 */
export const isIOSWebKit = (): boolean => {
  if (typeof navigator === 'undefined') return false
  
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isWebKit = /WebKit/.test(navigator.userAgent)
  
  return isIOS && isWebKit
}

/**
 * Gets iOS version if available
 */
export const getIOSVersion = (): string | null => {
  if (typeof navigator === 'undefined') return null
  
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)_?(\d+)?/)
  if (match && match.length > 1) {
    const major = match[1]
    const minor = match[2] || '0'
    const patch = match[3] || '0'
    return `${major}.${minor}.${patch}`
  }
  
  return null
}

/**
 * Checks if the iOS version supports certain audio features
 */
export const supportsAdvancedAudioFeatures = (): boolean => {
  const version = getIOSVersion()
  if (!version) return false
  
  const [major] = version.split('.').map(Number)
  // iOS 14+ has better WebAudio support
  return major >= 14
}

/**
 * Comprehensive iOS detection with feature support
 */
export const getIOSInfo = () => {
  return {
    isIOS: isIOSDevice(),
    isSafari: isIOSSafari(),
    isWebKit: isIOSWebKit(),
    version: getIOSVersion(),
    supportsAdvancedAudio: supportsAdvancedAudioFeatures(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
  }
}