export function shouldDismissSwipe(dx: number, dy: number, width: number, duration: number) {
  if (dx <= 0 || dx < Math.abs(dy) * 1.5) return false
  return dx >= Math.min(110, width * .32) || (dx >= 52 && duration > 0 && dx / duration > .55)
}
