import { env } from "cloudflare:workers"

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export function isValidProfileChangeCode(value: string | null) {
  const expected = (env as unknown as { PROFILE_CHANGE_CODE?: string }).PROFILE_CHANGE_CODE
  return Boolean(
    value
    && typeof expected === "string"
    && expected.length >= 8
    && safeEqual(value, expected),
  )
}
