/**
 * Shared Web Crypto helpers for webhook conventions. Copied algorithms —
 * the CLI kernel never imports kernels/ts (E4). Every failure is `false`.
 */
function rawKey(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function hmacSha256(secret: string, data: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, rawKey(data));
}

export function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function timingEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let acc = 0;
  for (let i = 0; i < left.length; i += 1) acc |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return acc === 0;
}

export function asBytes(raw: string | Uint8Array): Uint8Array {
  return typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
}
