export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/

export function isValidUsername(name: string): boolean {
  return USERNAME_REGEX.test(name)
}
