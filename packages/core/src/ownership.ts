// Proving that whoever runs the tool controls the shop it is pointed at.
//
// Reading public pages needs no permission: it is what a browser does. The
// checkout probe is different. It creates a cart on someone's server, which
// writes to their database and can hold stock. So before any request that
// changes state, the operator has to show control of the shop, in one of two
// ways: a file on the site, or a DNS record.
//
// The token is chosen by the operator and given to the tool at run time. It
// is not a secret from the public (the file is world-readable); it is a
// statement only the site's owner can make.

import { timingSafeEqual } from 'node:crypto';
import dns from 'node:dns';
import type { Fetcher } from './types.ts';

export const OWNERSHIP_PATH = '/.well-known/regmark.txt';
export const OWNERSHIP_DNS_LABEL = '_regmark';
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export type Ownership = { verified: boolean; method?: 'file' | 'dns'; detail: string };

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type ResolveTxt = (hostname: string) => Promise<string[][]>;

export async function verifyOwnership(
  store: URL,
  token: string | undefined,
  fetcher: Pick<Fetcher, 'get'>,
  resolveTxt: ResolveTxt = (h) => dns.promises.resolveTxt(h),
): Promise<Ownership> {
  if (!token) return { verified: false, detail: 'no ownership token was given' };
  if (!TOKEN.test(token)) return { verified: false, detail: 'the ownership token must be 16 to 128 characters of A-Z, a-z, 0-9, _ or -' };
  const expected = `regmark-verify=${token}`;

  let fileDetail: string;
  try {
    const res = await fetcher.get(new URL(OWNERSHIP_PATH, store).href);
    // The response must come from the shop itself, not from wherever it redirected to.
    const sameOrigin = new URL(res.url).origin === store.origin;
    if (res.status === 200 && sameOrigin && res.body.split(/\r?\n/).some((line) => same(line.trim(), expected))) {
      return { verified: true, method: 'file', detail: `${OWNERSHIP_PATH} carries the token` };
    }
    fileDetail = res.status === 200 ? `${OWNERSHIP_PATH} does not carry the token` : `${OWNERSHIP_PATH} answered ${res.status}`;
  } catch (err) {
    fileDetail = `${OWNERSHIP_PATH} could not be read (${(err as Error).message})`;
  }

  try {
    const records = await resolveTxt(`${OWNERSHIP_DNS_LABEL}.${store.hostname}`);
    if (records.some((chunks) => same(chunks.join('').trim(), expected))) {
      return { verified: true, method: 'dns', detail: `TXT ${OWNERSHIP_DNS_LABEL}.${store.hostname} carries the token` };
    }
  } catch {
    // No record is the ordinary case.
  }
  return { verified: false, detail: `${fileDetail}; no matching TXT record at ${OWNERSHIP_DNS_LABEL}.${store.hostname}` };
}
