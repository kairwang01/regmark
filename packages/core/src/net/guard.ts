// Keeping the tool from being pointed at things it should not reach.
//
// Regmark fetches URLs it reads out of other people's pages: a feed link, a
// redirect target, a product URL in a sitemap. Any of those can name an
// internal address. Without this file, auditing a hostile shop from inside a
// company network would let that shop make requests to the network's own
// services, cloud metadata endpoints included.

import dns from 'node:dns';
import net from 'node:net';

const blocked = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, where cloud metadata lives
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
] as const) {
  blocked.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [
  ['::', 96], // unspecified, loopback and deprecated IPv4-compatible addresses
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(prefix, bits, 'ipv6');
}

/** The IPv4 address carried inside an IPv4-mapped or NAT64 IPv6 address, if there is one. */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True only for an address on the public internet. Anything unparseable is not public. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  // DNS answers need not use compressed notation. Canonicalise before
  // inspecting translation prefixes so expanded NAT64 addresses cannot hide
  // a private IPv4 destination. Scoped literals are never internet targets.
  let canonical: string;
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return false;
  }
  const v4 = embeddedIPv4(canonical);
  if (v4) return isPublicAddress(v4);
  return !blocked.check(canonical, 'ipv6');
}

export class PrivateAddressError extends Error {
  readonly code = 'private-address';
  constructor(host: string, address: string) {
    super(`${host} resolves to ${address}, which is not a public address`);
    this.name = 'PrivateAddressError';
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/**
 * A drop-in for dns.lookup that fails when ANY resolved address is not
 * public. It is handed to http.request as its `lookup` option, so the check
 * runs on the very addresses the socket is about to connect to. Checking
 * first and connecting afterwards would leave a gap in which a second DNS
 * answer could differ from the one that was checked.
 */
export function guardedLookup(hostname: string, options: dns.LookupOptions | number | LookupCallback, callback?: LookupCallback): void {
  const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
  const opts: dns.LookupOptions = typeof options === 'object' ? options : typeof options === 'number' ? { family: options } : {};
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad) return cb(new PrivateAddressError(hostname, bad.address));
    if (list.length === 0) return cb(Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' }));
    if (opts.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

/**
 * For hosts written as an IP literal, where no lookup happens at all.
 * Returns the literal when the host is one, else null.
 */
export function ipLiteral(hostname: string): string | null {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return net.isIP(bare) ? bare : null;
}
