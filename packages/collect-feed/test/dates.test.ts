import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRfc3339, parseRfc822, readDate } from '../src/dates.ts';

const at = (iso: string) => Date.parse(iso);

describe('RFC 822 dates', () => {
  it('reads the form RSS and HTTP write', () => {
    assert.equal(parseRfc822('Wed, 30 Sep 2026 08:00:00 GMT'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc822('Wed, 30 Sep 2026 08:00:00 +0000'), at('2026-09-30T08:00:00Z'));
  });

  it('applies a numeric offset and the US zone names', () => {
    assert.equal(parseRfc822('Wed, 30 Sep 2026 10:00:00 +0200'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc822('Wed, 30 Sep 2026 03:00:00 -0530'), at('2026-09-30T08:30:00Z'));
    assert.equal(parseRfc822('Wed, 30 Sep 2026 03:00:00 EST'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc822('Wed, 30 Sep 2026 01:00:00 PDT'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc822('30 Sep 2026 08:00:00 UT'), at('2026-09-30T08:00:00Z'));
  });

  it('takes the day name and the seconds as optional, and names in any case', () => {
    assert.equal(parseRfc822('30 Sep 2026 08:00 GMT'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc822('wed, 30 SEP 2026 08:00:00 gmt'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc822('  Wed, 1 Oct 2026 08:00:00 GMT  '), at('2026-10-01T08:00:00Z'));
  });

  it('reads a two-digit year as RFC 2822 says', () => {
    assert.equal(parseRfc822('Wed, 30 Sep 26 08:00:00 GMT'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc822('Thu, 30 Sep 99 08:00:00 GMT'), at('1999-09-30T08:00:00Z'));
  });

  it('does not check the day name against the date', () => {
    assert.equal(parseRfc822('Mon, 30 Sep 2026 08:00:00 GMT'), at('2026-09-30T08:00:00Z'));
  });

  it('refuses a time without a zone, which could be in any zone', () => {
    assert.equal(parseRfc822('Wed, 30 Sep 2026 08:00:00'), undefined);
  });

  it('refuses dates that do not exist instead of rolling them over', () => {
    assert.equal(parseRfc822('31 Sep 2026 08:00:00 GMT'), undefined);
    assert.equal(parseRfc822('29 Feb 2026 08:00:00 GMT'), undefined);
    assert.equal(parseRfc822('30 Sep 2026 24:00:00 GMT'), undefined);
    assert.equal(parseRfc822('30 Sep 2026 08:60:00 GMT'), undefined);
    assert.equal(parseRfc822('0 Sep 2026 08:00:00 GMT'), undefined);
    assert.equal(parseRfc822('30 Sep 0026 08:00:00 GMT'), undefined);
  });

  it('accepts 29 February in a leap year', () => {
    assert.equal(parseRfc822('29 Feb 2028 08:00:00 GMT'), at('2028-02-29T08:00:00Z'));
  });

  it('refuses unknown names, military zones and other formats', () => {
    for (const text of [
      'Foo, 30 Sep 2026 08:00:00 GMT',
      '30 Sept 2026 08:00:00 GMT',
      '30 Sep 2026 08:00:00 A',
      '30 Sep 2026 08:00:00 CET',
      '30 Sep 2026 08:00:00 +2400',
      '30 Sep 2026 08:00:00 +0260',
      '2026-09-30T08:00:00Z',
      'Sep 30 2026',
      'Wed Sep 30 08:00:00 2026',
      'yesterday',
      '',
    ]) {
      assert.equal(parseRfc822(text), undefined, text);
    }
  });
});

describe('RFC 3339 dates', () => {
  it('reads UTC and offsets', () => {
    assert.equal(parseRfc3339('2026-09-30T08:00:00Z'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc3339('2026-09-30T10:00:00+02:00'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc3339('2026-09-30T03:00:00-05:00'), at('2026-09-30T08:00:00Z'));
  });

  it('takes a lower-case t and z, a space for the T, and cuts fractions to milliseconds', () => {
    assert.equal(parseRfc3339('2026-09-30t08:00:00z'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc3339('2026-09-30 08:00:00Z'), at('2026-09-30T08:00:00Z'));
    assert.equal(parseRfc3339('2026-09-30T08:00:00.1234567Z'), at('2026-09-30T08:00:00.123Z'));
    assert.equal(parseRfc3339('2026-09-30T08:00:00.5Z'), at('2026-09-30T08:00:00.500Z'));
  });

  it('refuses a time without an offset, a bare date and a date that does not exist', () => {
    for (const text of [
      '2026-09-30T08:00:00',
      '2026-09-30',
      '2026-02-31T08:00:00Z',
      '2026-13-01T08:00:00Z',
      '2026-09-30T24:00:00Z',
      '2026-09-30T08:00Z',
      '2026-09-30T08:00:00+24:00',
      '2026-09-30T08:00:00+0200',
      'Wed, 30 Sep 2026 08:00:00 GMT',
    ]) {
      assert.equal(parseRfc3339(text), undefined, text);
    }
  });
});

describe('readDate', () => {
  it('returns an ISO 8601 instant in UTC for the syntax named', () => {
    assert.equal(readDate({ text: 'Wed, 30 Sep 2026 10:00:00 +0200', syntax: 'rfc822' }), '2026-09-30T08:00:00.000Z');
    assert.equal(readDate({ text: '2026-09-30T10:00:00+02:00', syntax: 'rfc3339' }), '2026-09-30T08:00:00.000Z');
  });

  it('does not read one syntax as the other', () => {
    assert.equal(readDate({ text: '2026-09-30T08:00:00Z', syntax: 'rfc822' }), undefined);
    assert.equal(readDate({ text: 'Wed, 30 Sep 2026 08:00:00 GMT', syntax: 'rfc3339' }), undefined);
  });
});
