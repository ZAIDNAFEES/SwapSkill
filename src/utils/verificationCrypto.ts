import {
  VerificationEncryptedEnvelope,
  VerificationSensitiveDossier,
} from "./verificationAdmin";

// RSA-OAEP-2048 Public Key (SPKI DER Base64) — encrypts session AES keys in browser/APK.
// Matching PKCS8 Private Key lives exclusively on the authenticated backend (/api/admin/verification/decrypt).
const ADMIN_RSA_PUBLIC_SPKI_B64 =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmqVnYj/0JX32FTTMDhIcFS+7iHK61VkKjSQAHk9HuYs0aM0zw5rzOvytWYwAya+wh6F1Yie6jFhmQCxA/0V8HfaF7j4tV8txYTAMbRYNq+ejvkgKZjcgq0Wl/4aWB8AYYup6BQqYZeElEOuZfgoFqzTSeTQIqk4ag0CLGqbEmz3AjTLEqptZvteeoUyaEbvs+VRLClFLz7bFtm07bh2v7mO5L5O6N7nkJXrtWVX+aU/AyD0/hJSpXNY026pQ3OjZtsAThk9hC6t1cr6RnQz7nehpJ34byFzGra6zwu4mYdczq2ZMZNeGX7vAr4kRuIm2mdbS9wCpxueOEIX35B+kDQIDAQAB";

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let cachedPublicKey: CryptoKey | null = null;

async function getAdminRsaPublicKey(): Promise<CryptoKey> {
  if (cachedPublicKey) return cachedPublicKey;
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Web Crypto encryption is unavailable in this environment.");
  }
  const spkiBytes = base64ToUint8Array(ADMIN_RSA_PUBLIC_SPKI_B64);
  cachedPublicKey = await window.crypto.subtle.importKey(
    "spki",
    spkiBytes.buffer as ArrayBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"]
  );
  return cachedPublicKey;
}

/**
 * Encrypts the complete user verification dossier client-side using a fresh
 * AES-256-GCM symmetric key + random 96-bit IV, then wraps the AES key using
 * the Admin's RSA-OAEP-2048 public key and attaches a SHA-256 integrity digest.
 */
export async function encryptVerificationDossier(
  dossier: VerificationSensitiveDossier
): Promise<VerificationEncryptedEnvelope> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Secure browser encryption (WebCrypto) is required to submit verification.");
  }

  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(dossier));

  // 1. Integrity digest of plaintext JSON
  const digestBuf = await window.crypto.subtle.digest("SHA-256", plaintextBytes);
  const sha256 = arrayBufferToHex(digestBuf);

  // 2. Fresh 256-bit AES-GCM key + 96-bit IV
  const aesKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // 3. Encrypt payload with AES-256-GCM (includes 128-bit authentication tag)
  const ciphertextBuf = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintextBytes
  );

  // 4. Wrap raw AES-256 key with Admin's RSA-OAEP-2048 Public Key
  const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
  const rsaPublicKey = await getAdminRsaPublicKey();
  const wrappedKeyBuf = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaPublicKey,
    rawAesKey
  );

  return {
    v: 1,
    alg: "RSA-OAEP-SHA256+AES-256-GCM",
    encryptedKey: arrayBufferToBase64(wrappedKeyBuf),
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertextBuf),
    sha256,
  };
}
