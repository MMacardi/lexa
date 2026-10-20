// Cache scope is display-only. Server authorization always comes from the cookie.
export const ACCESS_REVOKED = "onomika-access-revoked";
export const CONNECTION_FAILED = "onomika-connection-failed";
export const SNAPSHOT_KEY = "lexa.accountSnapshot";
export const LOGOUT_PENDING_KEY = "lexa.logoutPending";

let owner = "";
let verified = false;
let revision = 0;
let blockRequests = false;

export const cacheScope = () => ({ owner, verified, revision, blockRequests });

export function setCacheScope(accountId: string, confirmed: boolean) {
  if (owner !== accountId || (verified && !confirmed)) revision++;
  owner = accountId;
  verified = confirmed;
  blockRequests = !!accountId && !confirmed;
}

export function sameScope(accountId: string, token: number) {
  return owner === accountId && revision === token;
}

export class ConnectionError extends Error {
  constructor() { super("Connection unavailable"); }
}
