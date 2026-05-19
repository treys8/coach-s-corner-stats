// SHA-256 of a file buffer, hex-encoded. Used by stats + schedule upload
// flows to dedupe re-uploads of the same file (browser retry, refresh after
// a partial network failure). The server keys an idempotency check on the
// hash so a second call with the same content is a no-op.
//
// Runs in the browser via WebCrypto. The same hash is computed server-side
// (in Postgres) is intentionally NOT done — we don't want the server to
// trust client-claimed content; the row stored in csv_uploads /
// schedule_uploads records the hash the client supplied so a future audit
// can detect mismatches.

export async function hashFileBuffer(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
