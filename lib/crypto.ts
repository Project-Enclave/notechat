import { createHash, randomBytes, timingSafeEqual } from 'crypto'

const ITERATIONS = 200_000
const KEY_LEN = 32
const DIGEST = 'sha256'
const SALT_BYTES = 16

/**
 * Hash a password using PBKDF2 + random salt.
 * Returns "<salt_hex>:<hash_hex>" — store the whole string.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  return new Promise((resolve, reject) => {
    const { pbkdf2 } = require('crypto')
    pbkdf2(password, salt, ITERATIONS, KEY_LEN, DIGEST, (err: Error | null, key: Buffer) => {
      if (err) return reject(err)
      resolve(salt.toString('hex') + ':' + key.toString('hex'))
    })
  })
}

/**
 * Verify a password against a stored "<salt_hex>:<hash_hex>" string.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  return new Promise((resolve, reject) => {
    const { pbkdf2 } = require('crypto')
    pbkdf2(password, salt, ITERATIONS, KEY_LEN, DIGEST, (err: Error | null, key: Buffer) => {
      if (err) return reject(err)
      try {
        resolve(timingSafeEqual(key, Buffer.from(hashHex, 'hex')))
      } catch {
        resolve(false)
      }
    })
  })
}
