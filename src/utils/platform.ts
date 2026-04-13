/** True for iPhone / iPad / iPod (all iOS browsers use WebKit; Chrome is a shell). */
export function isLikelyIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPhone|iPod/i.test(navigator.userAgent)) return true
  if (/iPad/i.test(navigator.userAgent)) return true
  // iPadOS 13+ desktop mode
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true
  return false
}
