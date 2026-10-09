import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cookieHeader, keepCookies } from '../src/cookies.ts';
import type { CookieJar } from '../src/cookies.ts';

const NOW = new Date('2026-10-09T12:00:00.000Z');

function jarAfter(...headers: (string | undefined)[]): CookieJar {
  const jar: CookieJar = new Map();
  for (const header of headers) keepCookies(jar, header, NOW);
  return jar;
}

test('several Set-Cookie headers, one per line, each keep their name and value and drop their attributes', () => {
  const jar = jarAfter('cart=c1; path=/; expires=Fri, 23 Oct 2026 12:00:00 GMT; SameSite=Lax\n_shopify_essential=:AZ1:; path=/; HttpOnly');
  assert.deepEqual([...jar], [['cart', 'c1'], ['_shopify_essential', ':AZ1:']]);
  assert.equal(cookieHeader(jar), 'cart=c1; _shopify_essential=:AZ1:');
});

test('a value containing "=" keeps everything after the first one', () => {
  assert.deepEqual([...jarAfter('cart=Z2NwOjAx%3Fkey%3D0d99==; path=/')], [['cart', 'Z2NwOjAx%3Fkey%3D0d99==']]);
});

test('a cookie set again replaces its value and keeps its place', () => {
  const jar = jarAfter('a=1\nb=2', 'a=3');
  assert.equal(cookieHeader(jar), 'a=3; b=2');
});

test('Max-Age=0, a negative Max-Age and a past Expires each remove the cookie', () => {
  const jar = jarAfter('a=1\nb=2\nc=3\nd=4', 'a=; Max-Age=0\nb=x; Max-Age=-1\nc=; expires=Thu, 01 Jan 1970 00:00:00 GMT');
  assert.equal(cookieHeader(jar), 'd=4');
});

test('Max-Age wins over Expires, in either order', () => {
  const jar = jarAfter(
    'kept=1; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=600\ngone=1; Max-Age=0; expires=Sat, 09 Oct 2027 12:00:00 GMT',
  );
  assert.deepEqual([...jar], [['kept', '1']]);
});

test('an expiry in the future, or one that does not read as a date, keeps the cookie', () => {
  const jar = jarAfter('a=1; expires=Sat, 09 Oct 2027 12:00:00 GMT\nb=2; expires=someday\nc=3; Max-Age=soon');
  assert.equal(cookieHeader(jar), 'a=1; b=2; c=3');
});

test('a quoted value is kept with its quotes, as it must be sent back', () => {
  assert.equal(cookieHeader(jarAfter('q="v 1"', 'r="v1"')), 'r="v1"');
});

test('lines that are not cookies are ignored, and leave the jar as it was', () => {
  const jar = jarAfter('a=1', 'not a cookie\n=nameless\nbad name=1\nsemi=a"b\nnul=a\u0000b\n\n  ');
  assert.equal(cookieHeader(jar), 'a=1');
});

test('removing a cookie the jar never had changes nothing', () => {
  assert.equal(cookieHeader(jarAfter('a=1', 'b=; Max-Age=0')), 'a=1');
});

test('no Set-Cookie header and an empty jar give no Cookie header', () => {
  assert.equal(cookieHeader(jarAfter(undefined)), undefined);
  assert.equal(cookieHeader(jarAfter('a=1', 'a=; Max-Age=0')), undefined);
});
