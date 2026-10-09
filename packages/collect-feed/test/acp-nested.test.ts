// The protocol's own Product and Variant model, as the ACP Feed API and
// products.jsonl carry it. The product below is the repository's example
// upsert (examples/2026-04-17/examples.feed.json), cut to one product.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CollectResult, Sighting } from '@regmark/core';
import { parseFeed } from '../src/index.ts';
import { ACP_URL, acpObservation, FETCHED_AT, jsonl, NOW } from './support.ts';

const parse = (body: string): CollectResult => parseFeed(body, ACP_URL, FETCHED_AT, NOW, { surface: 'acp' });

const AT = `${ACP_URL}#product[id="prod_classic_tee"]/variant[id="sku124-red-m"]`;

const VARIANT = {
  id: 'sku124-red-m',
  title: 'Classic Tee - Red / Medium',
  url: 'https://merchant.com/products/classic-tee?variant=sku124-red-m',
  barcodes: [{ type: 'GTIN', value: '00012345600029' }],
  price: { amount: 1999, currency: 'USD' },
  availability: { available: false, status: 'out_of_stock' },
  variant_options: [
    { name: 'Color', value: 'Red' },
    { name: 'Size', value: 'Medium' },
  ],
  seller: { name: 'Example Merchant' },
  marketplace: { name: 'Example Marketplace' },
};

const product = (variants: object[], rest: object = {}) => ({
  id: 'prod_classic_tee',
  title: 'Classic Tee',
  description: { plain: 'A classic cotton tee with a soft feel and relaxed fit.' },
  url: 'https://merchant.com/products/classic-tee',
  media: [{ type: 'image', url: 'https://cdn.merchant.com/products/classic-tee/main.jpg', alt_text: 'Classic Tee front view' }],
  variants,
  ...rest,
});

/** The one sighting of a one-variant product, with no issues. */
function only(variant: object): Sighting {
  const result = parse(jsonl(product([variant])));
  assert.deepStrictEqual(result.issues, []);
  assert.equal(result.sightings.length, 1);
  return result.sightings[0]!;
}

const codes = (result: CollectResult) => result.issues.map((i) => `${i.code} ${i.locator}`);

describe('ACP Product and Variant records', () => {
  it('reads the spec example into a variant sighting grouped by its product', () => {
    assert.deepStrictEqual(only(VARIANT), {
      surface: 'acp',
      scope: 'variant',
      ids: {
        aliases: ['sku124-red-m'],
        groupId: 'prod_classic_tee',
        url: 'https://merchant.com/products/classic-tee?variant=sku124-red-m',
        gtin: '00012345600029',
        options: { Color: 'Red', Size: 'Medium' },
      },
      title: 'Classic Tee - Red / Medium',
      price: acpObservation({ units: 199900, currency: 'USD' }, '{"amount":1999,"currency":"USD"}', `${AT}/price`),
      availability: acpObservation('out_of_stock', '{"available":false,"status":"out_of_stock"}', `${AT}/availability`),
    });
  });

  it('reads one sighting per variant, in order', () => {
    const result = parse(jsonl(product([VARIANT, { ...VARIANT, id: 'sku124-red-l', title: 'Classic Tee - Red / Large' }])));
    assert.deepStrictEqual(result.sightings.map((s) => [s.ids.aliases, s.ids.groupId]), [
      [['sku124-red-m'], 'prod_classic_tee'],
      [['sku124-red-l'], 'prod_classic_tee'],
    ]);
  });

  it("takes the product's url for a variant that has none", () => {
    const { url: _, ...rest } = VARIANT;
    assert.equal(only(rest).ids.url, 'https://merchant.com/products/classic-tee');
  });
});

describe('ACP Product and Variant records: price', () => {
  it('reads list_price as the price before any discount', () => {
    const s = only({ ...VARIANT, price: { amount: 1599, currency: 'USD' }, list_price: { amount: 1999, currency: 'USD' } });
    assert.deepStrictEqual(s.price?.value, { units: 159900, currency: 'USD' });
    assert.deepStrictEqual(s.listPrice, acpObservation({ units: 199900, currency: 'USD' }, '{"amount":1999,"currency":"USD"}', `${AT}/list_price`));
  });

  it("scales minor units by the currency's own exponent", () => {
    assert.deepStrictEqual(only({ ...VARIANT, price: { amount: 1500, currency: 'JPY' } }).price?.value, { units: 15000000, currency: 'JPY' });
    assert.deepStrictEqual(only({ ...VARIANT, price: { amount: 1500, currency: 'KWD' } }).price?.value, { units: 15000, currency: 'KWD' });
    assert.deepStrictEqual(only({ ...VARIANT, price: { amount: 0, currency: 'usd' } }).price?.value, { units: 0, currency: 'USD' });
  });

  it('reports a price that is not whole minor units with a currency, and leaves it out', () => {
    for (const price of [{ amount: 1999 }, { amount: 19.99, currency: 'USD' }, { amount: '1999', currency: 'USD' }, { amount: -1, currency: 'USD' }, { amount: 1999, currency: 'US$' }, '19.99 USD']) {
      const result = parse(jsonl(product([{ ...VARIANT, price }])));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${AT}/price`], JSON.stringify(price));
      assert.equal(result.sightings[0]!.price, undefined);
    }
  });

  it('states no price when the variant gives none', () => {
    const { price: _, ...rest } = VARIANT;
    assert.equal(only(rest).price, undefined);
    assert.equal(only({ ...VARIANT, price: null }).price, undefined);
  });
});

describe('ACP Product and Variant records: availability', () => {
  const availability = (value: unknown) => only({ ...VARIANT, availability: value }).availability?.value;

  it('reads the status the protocol names', () => {
    assert.equal(availability({ status: 'in_stock' }), 'in_stock');
    assert.equal(availability({ status: 'limited_stock', available: true }), 'in_stock');
    assert.equal(availability({ status: 'backorder' }), 'backorder');
    assert.equal(availability({ status: 'preorder' }), 'preorder');
    assert.equal(availability({ status: 'discontinued', available: false }), 'discontinued');
  });

  it('reads available alone as in or out of stock', () => {
    assert.equal(availability({ available: true }), 'in_stock');
    assert.equal(availability({ available: false }), 'out_of_stock');
  });

  it('falls back to available, without a report, for a status the protocol does not list: the list is open', () => {
    assert.equal(availability({ available: true, status: 'ships_in_3_days' }), 'in_stock');
  });

  it('reports a status it does not know when available does not settle it', () => {
    const result = parse(jsonl(product([{ ...VARIANT, availability: { status: 'ships_in_3_days' } }])));
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${AT}/availability`]);
    assert.equal(result.sightings[0]!.availability, undefined);
  });

  it('lets available decide when the status disagrees about buying: the schema makes it the signal', () => {
    const cases: [unknown, string][] = [
      [{ available: false, status: 'in_stock' }, 'out_of_stock'],
      // A pre-order that is not open yet cannot be bought now.
      [{ available: false, status: 'preorder' }, 'out_of_stock'],
      [{ available: true, status: 'out_of_stock' }, 'in_stock'],
      // The last of a discontinued line, still on sale.
      [{ available: true, status: 'discontinued' }, 'in_stock'],
    ];
    for (const [value, expected] of cases) {
      const result = parse(jsonl(product([{ ...VARIANT, availability: value }])));
      assert.deepStrictEqual(codes(result), [], JSON.stringify(value));
      assert.equal(result.sightings[0]!.availability?.value, expected, JSON.stringify(value));
    }
  });

  it('keeps a status that refines what available says', () => {
    assert.equal(availability({ available: true, status: 'backorder' }), 'backorder');
    assert.equal(availability({ available: true, status: 'preorder' }), 'preorder');
    assert.equal(availability({ available: false, status: 'out_of_stock' }), 'out_of_stock');
  });

  it('reports an availability that is not the object the model defines', () => {
    for (const value of ['in_stock', { available: 'yes' }]) {
      const result = parse(jsonl(product([{ ...VARIANT, availability: value }])));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${AT}/availability`]);
    }
  });

  it('states no availability when the variant gives none', () => {
    assert.equal(availability(undefined), undefined);
    assert.equal(availability({}), undefined);
    assert.equal(availability({ available: null }), undefined);
  });
});

describe('ACP Product and Variant records: identity', () => {
  it('takes the GTIN from the first barcode of a GTIN, UPC or EAN type, and nothing from an ISBN', () => {
    const gtin = (barcodes: unknown) => only({ ...VARIANT, barcodes }).ids.gtin;
    assert.equal(gtin([{ type: 'UPC', value: '012345678905' }]), '012345678905');
    assert.equal(gtin([{ type: 'ean13', value: '4006381333931' }, { type: 'GTIN', value: '00012345600029' }]), '4006381333931');
    assert.equal(gtin([{ type: 'ISBN', value: '0306406152' }]), undefined);
    assert.equal(gtin([]), undefined);
  });

  it('reports a variant option that is not a name and a value, and keeps the others', () => {
    const result = parse(jsonl(product([{ ...VARIANT, variant_options: [{ name: 'Color', value: 'Red' }, { name: 'Size' }] }])));
    assert.deepStrictEqual(result.sightings[0]!.ids.options, { Color: 'Red' });
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${AT}/variant_options[2]`]);
  });

  it('reports variant_options that are not a list', () => {
    const result = parse(jsonl(product([{ ...VARIANT, variant_options: { Color: 'Red' } }])));
    assert.equal(result.sightings[0]!.ids.options, undefined);
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${AT}/variant_options`]);
  });

  it('reports a product with no id, and gives no sighting for any of its variants', () => {
    const result = parse(jsonl({ ...product([VARIANT]), id: '' }));
    assert.deepStrictEqual(result.sightings, []);
    assert.deepStrictEqual(result.issues, [{ surface: 'acp', code: 'feed-item-incomplete', message: 'line 1 has no id', locator: `${ACP_URL}#line[1]` }]);
  });

  it('reports a product in a document whose variants are not a list', () => {
    const result = parse(JSON.stringify({ products: [{ id: 'prod_1', variants: 'none' }] }));
    assert.deepStrictEqual(result.sightings, []);
    assert.deepStrictEqual(codes(result), [`feed-item-incomplete ${ACP_URL}#product[id="prod_1"]`]);
  });

  it('reports a variant with no id, and reads its siblings', () => {
    const { id: _, ...rest } = VARIANT;
    const result = parse(jsonl(product([rest, { ...VARIANT, id: 'sku124-red-l' }])));
    assert.deepStrictEqual(result.sightings.map((s) => s.ids.aliases), [['sku124-red-l']]);
    assert.deepStrictEqual(codes(result), [`feed-item-incomplete ${ACP_URL}#product[id="prod_classic_tee"]/variant[1]`]);
  });

  it('reports a variant with no url when its product has none either', () => {
    const { url: _, ...rest } = VARIANT;
    const result = parse(jsonl(product([rest], { url: undefined })));
    assert.deepStrictEqual(result.sightings, []);
    assert.deepStrictEqual(codes(result), [`feed-item-incomplete ${AT}`]);
  });

  it("reports a variant with no title, and names it after its product", () => {
    const { title: _, ...rest } = VARIANT;
    const result = parse(jsonl(product([rest])));
    assert.deepStrictEqual(codes(result), [`feed-item-incomplete ${AT}`]);
    assert.equal(result.sightings[0]!.title, 'Classic Tee');
  });
});

describe('ACP Product and Variant records: returns', () => {
  it("reads the seller's refund_policy link as a stated return policy", () => {
    const seller = {
      name: 'Example Merchant',
      links: [
        { type: 'shipping_policy', url: 'https://merchant.com/policies/shipping' },
        { type: 'refund_policy', title: 'Refund Policy', url: 'https://merchant.com/policies/refunds' },
      ],
    };
    assert.deepStrictEqual(
      only({ ...VARIANT, seller }).returnPolicy,
      acpObservation(
        { present: true, url: 'https://merchant.com/policies/refunds' },
        '{"type":"refund_policy","title":"Refund Policy","url":"https://merchant.com/policies/refunds"}',
        `${AT}/seller/links[2]`,
      ),
    );
  });

  it('states no return policy from other links, or from none', () => {
    assert.equal(only({ ...VARIANT, seller: { name: 'X', links: [{ type: 'faq', url: 'https://merchant.com/faq' }] } }).returnPolicy, undefined);
    assert.equal(only(VARIANT).returnPolicy, undefined);
  });

  it('reports a refund_policy link that is not an http or https URL', () => {
    const result = parse(jsonl(product([{ ...VARIANT, seller: { links: [{ type: 'refund_policy', url: 'mailto:help@merchant.com' }] } }])));
    assert.equal(result.sightings[0]!.returnPolicy, undefined);
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${AT}/seller/links[1]`]);
  });
});

describe('ACP Product and Variant records: values a reader must survive', () => {
  // Written as text: the test cannot build such a line with JSON.stringify either.
  const deep = '['.repeat(20_000) + ']'.repeat(20_000);

  it('reads a variant whose availability carries a value nested deeper than it can be shown', () => {
    const line = jsonl(product([{ ...VARIANT, availability: { available: true, extra: 'DEEP' } }])).replace('"DEEP"', deep);
    const result = parse(line);
    assert.equal(result.sightings[0]!.availability?.value, 'in_stock');
    assert.equal(result.sightings[0]!.availability?.raw, '{"available":true}');
  });

  it('reports a price nested deeper than it can be shown, without stopping', () => {
    const line = jsonl(product([{ ...VARIANT, price: 'DEEP' }])).replace('"DEEP"', deep);
    const result = parse(line);
    assert.equal(result.sightings[0]!.price, undefined);
    assert.match(result.issues[0]!.message, /^price \[a value nested too deeply to show\] is not/);
  });
});
