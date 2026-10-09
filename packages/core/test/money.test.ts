import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney, fromMinor, minorUnitOf, money, parseAllMoney, parseMoney, sameMoney } from '../src/index.ts';

test('money() reads plain decimals exactly', () => {
  assert.deepEqual(money('39.00', 'usd'), { units: 390000, currency: 'USD' });
  assert.deepEqual(money('39', null), { units: 390000, currency: null });
  assert.deepEqual(money(0.1 + 0.2, 'EUR'), { units: 3000, currency: 'EUR' });
  assert.deepEqual(money('19.99995', 'USD'), { units: 200000, currency: 'USD' });
  assert.throws(() => money('39,00', 'EUR'));
  assert.throws(() => money('$39', 'USD'));
});

test('fromMinor() follows the currency minor unit', () => {
  assert.deepEqual(fromMinor('3900', 2, 'USD'), { units: 390000, currency: 'USD' });
  assert.deepEqual(fromMinor('3900', 0, 'JPY'), { units: 39000000, currency: 'JPY' });
  assert.deepEqual(fromMinor(12345, 3, 'KWD'), { units: 123450, currency: 'KWD' });
  assert.equal(fromMinor('39.00', 2, 'USD'), null);
});

const cases: Array<[string, string | null, number, string | null]> = [
  // raw, hint currency, expected units, expected currency
  ['39.00', null, 390000, null],
  ['$39.00', null, 390000, null],
  ['$39.00', 'USD', 390000, 'USD'],
  ['$39.00', 'CAD', 390000, 'CAD'],
  ['US$39', null, 390000, 'USD'],
  ['CA$ 39.50', 'USD', 395000, 'CAD'],
  ['39,00 €', null, 390000, 'EUR'],
  ['€ 1.299,00', null, 12990000, 'EUR'],
  ['1,299.00 USD', null, 12990000, 'USD'],
  ['USD 1,299', null, 12990000, 'USD'],
  ['1.299', 'EUR', 12990000, 'EUR'],
  ['1 299,50 kr', 'SEK', 12995000, 'SEK'],
  ["CHF 1'299.50", null, 12995000, 'CHF'],
  ['£0.99', null, 9900, 'GBP'],
  ['0,5', 'EUR', 5000, 'EUR'],
  ['1,5', 'EUR', 15000, 'EUR'],
  ['12.345 KWD', null, 123450, 'KWD'],
  ['¥3,900', 'JPY', 39000000, 'JPY'],
  ['¥3,900', null, 39000000, null],
  ['1,234,567', null, 12345670000, null],
  ['Price: 45', 'USD', 450000, 'USD'],
];

for (const [raw, hint, units, currency] of cases) {
  test(`parseMoney(${JSON.stringify(raw)}${hint ? `, ${hint}` : ''}) → ${units / 10000} ${currency ?? '?'}`, () => {
    assert.deepEqual(parseMoney(raw, { currency: hint }), { units, currency });
  });
}

test('parseMoney() returns null when there is no number', () => {
  assert.equal(parseMoney('Call for price'), null);
  assert.equal(parseMoney(''), null);
});

test('parseAllMoney() returns every amount in order', () => {
  assert.deepEqual(
    parseAllMoney('$45.00 $39.00', { currency: 'USD' }).map((m) => m.units),
    [450000, 390000],
  );
});

test('sameMoney() compares amounts, and currencies only when both are known', () => {
  assert.ok(sameMoney(money('39.00', 'USD'), money('39', 'USD')));
  assert.ok(sameMoney(money('39.00', 'USD'), money('39.00', null)));
  assert.ok(!sameMoney(money('39.00', 'USD'), money('39.00', 'CAD')));
  assert.ok(!sameMoney(money('39.00', 'USD'), money('39.01', 'USD')));
  assert.ok(sameMoney(money('39.00', 'USD'), money('39.01', 'USD'), 100));
});

test('formatMoney() keeps two decimals and adds more only when needed', () => {
  assert.equal(formatMoney(money('39', 'USD')), '39.00 USD');
  assert.equal(formatMoney(money('1299.5', null)), '1299.50');
  assert.equal(formatMoney(money('12.345', 'KWD')), '12.345 KWD');
  assert.equal(formatMoney(money('0.0001', 'USD')), '0.0001 USD');
});

test('minorUnitOf() follows ISO 4217, including the less common zero- and four-digit currencies', () => {
  for (const code of ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']) {
    assert.equal(minorUnitOf(code), 0, code);
  }
  for (const code of ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']) assert.equal(minorUnitOf(code), 3, code);
  assert.equal(minorUnitOf('CLF'), 4);
  assert.equal(minorUnitOf('UYW'), 4);
  assert.equal(minorUnitOf('USD'), 2);
  // 5000 in Rwandan francs' minor units is 5,000 francs, as the page says.
  assert.ok(sameMoney(fromMinor(5000, minorUnitOf('RWF'), 'RWF')!, parseMoney('RWF 5,000')!));
});
