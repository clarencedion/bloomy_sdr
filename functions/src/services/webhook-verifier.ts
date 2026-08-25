import crypto from "node:crypto";

export type HmacVerifyOptions = {
  algorithm?: "sha256" | "sha1" | "sha512";
  encoding?: "hex" | "base64";
  headerPrefix?: string;
};

/**
 * Verifies a cryptographic HMAC signature against a raw webhook body and secret.
 * Implements constant-time comparison to protect against timing attacks (REQ-060).
 */
export function verifyHmacSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
  options: HmacVerifyOptions = {}
): boolean {
  if (!signatureHeader || !secret || !rawBody) {
    return false;
  }

  const { algorithm = "sha256", encoding = "hex", headerPrefix } = options;

  let cleanSignature = signatureHeader.trim();

  // Strip prefix like "sha256=" if present
  if (headerPrefix && cleanSignature.toLowerCase().startsWith(headerPrefix.toLowerCase())) {
    cleanSignature = cleanSignature.slice(headerPrefix.length).trim();
  } else if (cleanSignature.includes("=")) {
    // Generic prefix stripping (e.g. "sha256=abcdef...")
    const parts = cleanSignature.split("=");
    if (parts.length === 2 && ["sha256", "sha1", "sha512", "hmac-sha256"].includes(parts[0].toLowerCase())) {
      cleanSignature = parts[1].trim();
    }
  }

  try {
    const computedHmac = crypto
      .createHmac(algorithm, secret)
      .update(rawBody)
      .digest(encoding);

    const computedBuffer = Buffer.from(computedHmac, encoding === "base64" ? "base64" : "hex");
    const signatureBuffer = Buffer.from(cleanSignature, encoding === "base64" ? "base64" : "hex");

    if (computedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Validates Microsoft Graph webhook subscription handshakes and notifications.
 */
export function verifyMicrosoftGraphWebhook(
  validationToken?: string | null,
  clientState?: string | null,
  expectedClientState?: string | null
): { isValid: boolean; responseToken?: string } {
  if (validationToken) {
    return { isValid: true, responseToken: validationToken };
  }

  if (expectedClientState) {
    const isValid = Boolean(clientState && clientState === expectedClientState);
    return { isValid };
  }

  return { isValid: true };
}
