// Sign-in with wallet for the builder dashboard.
// 1. GET  /v1/auth/nonce?address=0x…  → a human-readable message containing a one-time nonce
// 2. Wallet signs the message (free, no gas)
// 3. POST /v1/auth/verify {message, signature} → a session token (HMAC-signed, 7 days)
import crypto from "node:crypto";
import { getAddress, verifyMessage } from "ethers";

const NONCE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_S = 7 * 24 * 3600;

export class Auth {
  constructor(secret, { chainId, domain = "apptochain dashboard" } = {}) {
    if (!secret || secret.length < 16) throw new Error("SESSION_SECRET must be at least 16 characters");
    this.secret = secret;
    this.chainId = chainId;
    this.domain = domain;
    this.nonces = new Map(); // nonce -> { address, exp }
  }

  issue(addressInput) {
    const address = getAddress(addressInput);
    const nonce = crypto.randomBytes(12).toString("hex");
    const now = Date.now();
    for (const [n, v] of this.nonces) if (v.exp < now) this.nonces.delete(n);
    this.nonces.set(nonce, { address, exp: now + NONCE_TTL_MS });
    const message = [
      `Sign in to the ${this.domain}.`,
      ``,
      `Address: ${address}`,
      `Chain ID: ${this.chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      ``,
      `This signature is free and does not move funds.`,
    ].join("\n");
    return { message, nonce };
  }

  verify(message, signature) {
    const nonce = /Nonce: ([0-9a-f]+)/.exec(message || "")?.[1];
    const claimed = /Address: (0x[0-9a-fA-F]{40})/.exec(message || "")?.[1];
    const entry = nonce && this.nonces.get(nonce);
    if (!entry || entry.exp < Date.now()) throw new Error("Sign-in expired, please try again");
    if (!claimed || getAddress(claimed) !== entry.address) throw new Error("Message does not match the requested address");
    let recovered;
    try { recovered = verifyMessage(message, signature); } catch { throw new Error("Invalid signature"); }
    if (recovered !== entry.address) throw new Error("Signature is not from this address");
    this.nonces.delete(nonce); // one-time use
    return this.sign({ sub: entry.address, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S });
  }

  sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = crypto.createHmac("sha256", this.secret).update(body).digest("base64url");
    return { token: `${body}.${mac}`, address: payload.sub, expiresAt: new Date(payload.exp * 1000).toISOString() };
  }

  /** Returns the checksummed address for a valid token, or null. */
  check(token) {
    if (!token || !token.includes(".")) return null;
    const [body, mac] = token.split(".");
    const expected = crypto.createHmac("sha256", this.secret).update(body).digest("base64url");
    const a = Buffer.from(mac), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, "base64url").toString());
      if (!p.sub || p.exp < Date.now() / 1000) return null;
      return getAddress(p.sub);
    } catch {
      return null;
    }
  }
}
