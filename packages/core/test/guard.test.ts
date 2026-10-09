import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ipLiteral, isPublicAddress } from '../src/index.ts';

test('isPublicAddress() refuses every private, loopback, link-local and reserved range', () => {
  const refused = [
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1',
    'not-an-ip', '',
  ];
  for (const a of refused) assert.equal(isPublicAddress(a), false, a);
});

test('isPublicAddress() accepts ordinary public addresses', () => {
  for (const a of ['1.1.1.1', '8.8.8.8', '43.172.86.173', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
    assert.equal(isPublicAddress(a), true, a);
  }
});

test('ipLiteral() recognises literals, bracketed or not', () => {
  assert.equal(ipLiteral('127.0.0.1'), '127.0.0.1');
  assert.equal(ipLiteral('[::1]'), '::1');
  assert.equal(ipLiteral('shop.example'), null);
});
