import { env } from "../lib/env.js";

// Verify a Google Sign-In ID token (a JWT the frontend gets from Google Identity
// Services). We use Google's tokeninfo endpoint, which validates the signature
// and expiry for us; we then check the audience is OUR client id and the email
// is verified. Good enough for login volumes and needs no key management.

export interface GoogleIdentity {
  email: string;
  name?: string;
  picture?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!env.GOOGLE_CLIENT_ID) throw new Error("Google sign-in is not configured");
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) throw new Error("Invalid Google token");
  const p = (await res.json()) as {
    iss?: string;
    aud?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
    exp?: string | number;
  };
  if (p.iss !== "accounts.google.com" && p.iss !== "https://accounts.google.com") {
    throw new Error("Untrusted Google token issuer");
  }
  if (p.aud !== env.GOOGLE_CLIENT_ID) throw new Error("Google token audience mismatch");
  const verified = p.email_verified === true || p.email_verified === "true";
  if (!p.email || !verified) throw new Error("Google email not verified");
  if (p.exp && Number(p.exp) * 1000 < Date.now()) throw new Error("Google token expired");
  return { email: p.email.toLowerCase(), name: p.name, picture: p.picture };
}
