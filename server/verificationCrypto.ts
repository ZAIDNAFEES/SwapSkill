import crypto from "crypto";

// Server-only PKCS8 DER RSA-2048 Private Key (never bundled into client/APK).
// Can be overridden via process.env.VERIFICATION_RSA_PRIVATE_KEY (PEM or base64 DER).
const FALLBACK_PRIVATE_PKCS8_B64 =
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCapWdiP/QlffYVNMwOEhwVL7uIcrrVWQqNJAAeT0e5izRozTPDmvM6/K1ZjADJr7CHoXViJ7qMWGZALED/RXwd9oXuPi1Xy3FhMAxtFg2r56O+SApmNyCrRaX/hpYHwBhi6noFCphl4SUQ65l+CgWrNNJ5NAiqThqDQIsapsSbPcCNMsSqm1m+156hTJoRu+z5VEsKUUvPtsW2bTtuHa/uY7kvk7o3ueQleu1ZVf5pT8DIPT+ElKlc1jTbqlDc6Nm2wBOGT2ELq3VyvpGdDPud6GknfhvIXMatrrPC7iZh1zOrZkxk14Zfu8CviRG4ibaZ1tL3AKnG544QhffkH6QNAgMBAAECggEAPU6HPrb11gsqjFui7Y0WXvvOT5iUItIq0atM9LcfSxo5i7aV59y8wky7eD19bndc91f1zhTL6ql818Hzfn+QZdx+WeWCWkTHzOyccH6GqviovF2Y6c6+/8cbuMIlJitsP4KPHwKFShZIeH2+Gu5kMuw86FnNeZ5++juTKdylIplpFuigKuCxnLR7qjOxhZHwCoUJ7QT3mwbBqZAjPE2heDl+dPvYRtYeTRd2Fszr+kni5rm6tQHSIwsOBMwLP6CCRpwsGi9Ao3kvV6moGLWuAod5aKRCOmlRZ05YvY/pI6K3QeQGPwCCuUS3xueKthXvx+ERIV0hWuffs/FdDYM8jQKBgQDaM0S2RSR+x29aQ738sKIO434ywOu8BmrrRgoLZl9l5YiKC9lSD6EDI3YycKv1OOUKeb+8PY4XyVhtVnaEYjy8MbJn+PpiIL9xbcaYry0dacY0bi0GI76jX3q14XgTtDbPR4gljMuQPq2EMt5kiYvKB9RebgoILVSOj0l0GsozewKBgQC1b6PAV8yOE6fqhAz1CsBnJBVeZIs0hky+PtO5ihCqXMcOj0ZIUtZO7gnIeW341yCIwiSK6BLTJswNxrTyOwqwUt2oVhw+AGTmAfGUdfYcGbE6XmSsno/4egX+7RJowvhnQuVLSAhRguUjMnfCFhD93WOmCztmjGNe7TBnsh3MFwKBgAIgo9ffHrb5vNU1eeG/2ySoBS/7f5DqwxoeKbTov59fuJAYA3twWZKNQvbE8HhIoLsUatEsDHmg5fLS9/7cclknZuTqoY5ZYWR6vIf6lUcHI/6Y4GmB6bbwFGM3mpMem7YzrVkoYUe7xLdYQ6DZUnqazvBIxGJGBuAI959hL32HAoGAc3M0eaHksctkH+Ai9pH+2CKnzkagJa4Hi08jHn7yF9WtfGBC0qaTY+ooI37RMXSCaUNQSWte/ylC0slMPo6/QG+aSBFzKyjJC2rVNCjTkBHxKjkCSq0i43OR+SMVgb/+nIZ+rSaK1IM8Fud4OPIdocyMKg4foCNY4ACBupomR8UCgYEAnBGMoDKnGeEI0sAtu+Fz/XBEpYiWmVXoThHMlxXKbuWzPXLOFHtzLnUc0pxkrEy+lgJ2S9BDVLQmdMz7jFPSfNBLh67ZePgI+/R6avpuzSEh5OUEgG9u1TqvDF8Sz71SRypOygeaNErgtptQ2WtUs3bs+qdeSuEkIgk/fyubIC8=";

export interface EncryptedEnvelopeInput {
  v?: number;
  alg?: string;
  encryptedKey: string;
  iv: string;
  ciphertext: string;
  sha256?: string;
}

function getServerPrivateKey(): crypto.KeyObject {
  const envKey = process.env.VERIFICATION_RSA_PRIVATE_KEY?.trim();
  if (envKey) {
    if (envKey.includes("BEGIN PRIVATE KEY")) {
      return crypto.createPrivateKey({
        key: envKey.replace(/\\n/g, "\n"),
        format: "pem",
      });
    }
    return crypto.createPrivateKey({
      key: Buffer.from(envKey, "base64"),
      format: "der",
      type: "pkcs8",
    });
  }

  return crypto.createPrivateKey({
    key: Buffer.from(FALLBACK_PRIVATE_PKCS8_B64, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function decryptVerificationEnvelope(envelope: EncryptedEnvelopeInput): {
  dossier: any;
  integrityVerified: boolean;
} {
  if (!envelope || !envelope.encryptedKey || !envelope.iv || !envelope.ciphertext) {
    throw new Error("Malformed encrypted verification envelope.");
  }

  const privateKey = getServerPrivateKey();

  // 1. Unwrap 256-bit AES session key using RSA-OAEP SHA-256
  const aesKeyBytes = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(envelope.encryptedKey, "base64")
  );

  // 2. Web Crypto AES-GCM appends the 16-byte auth tag to the end of ciphertext
  const ivBytes = Buffer.from(envelope.iv, "base64");
  const combined = Buffer.from(envelope.ciphertext, "base64");
  if (combined.length < 17) {
    throw new Error("Invalid AES-GCM ciphertext length.");
  }

  const tagLength = 16;
  const encryptedBytes = combined.subarray(0, combined.length - tagLength);
  const authTag = combined.subarray(combined.length - tagLength);

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKeyBytes, ivBytes);
  decipher.setAuthTag(authTag);

  const plaintextBuf = Buffer.concat([
    decipher.update(encryptedBytes),
    decipher.final(),
  ]);

  const computedHash = crypto.createHash("sha256").update(plaintextBuf).digest("hex");
  const integrityVerified = envelope.sha256
    ? computedHash.toLowerCase() === envelope.sha256.toLowerCase()
    : true;

  const dossier = JSON.parse(plaintextBuf.toString("utf8"));
  return { dossier, integrityVerified };
}
