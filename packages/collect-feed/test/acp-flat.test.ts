// OpenAI's flat file-upload format, read as the acp surface. The records are
// shaped like the examples in https://developers.openai.com/commerce/specs/file-upload/products

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CollectResult, Sighting } from '@regmark/core';
import { type FeedOptions, parseFeed } from '../src/index.ts';
import { ACP_URL, acpAt, acpObservation, FETCHED_AT, jsonl, MUG, NOW } from './support.ts';

const USD = (units: number) => ({ units, currency: 'USD' });

const parse = (body: string, options: FeedOptions = {}, url = ACP_URL): CollectResult =>
  parseFeed(body, url, FETCHED_AT, NOW, { surface: 'acp', ...options });

/** The one sighting of a one-record feed, with no issues. */
function only(record: object): Sighting {
  const result = parse(jsonl(record));
  assert.deepStrictEqual(result.issues, []);
  assert.equal(result.sightings.length, 1);
  return result.sightings[0]!;
}

const codes = (result: CollectResult) => result.issues.map((i) => `${i.code} ${i.locator}`);

describe('ACP flat records: the spec examples', () => {
  it('reads the minimal record into a variant sighting on the acp surface', () => {
    const result = parse(jsonl(MUG));
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings, [
      {
        surface: 'acp',
        scope: 'variant',
        ids: { aliases: ['MUG-350-BLUE'], url: 'https://example.com/products/mug-blue', brand: 'Northline' },
        title: 'Blue ceramic mug, 350 mL',
        price: acpObservation(USD(180000), '18.00 USD', acpAt('MUG-350-BLUE', 'price')),
        availability: acpObservation('in_stock', 'in_stock', acpAt('MUG-350-BLUE', 'availability')),
      },
    ]);
  });

  it('reads the variant-group example: one group, options from variant_dict, stock per row', () => {
    const shoe = {
      ...MUG,
      group_id: 'TRAIL',
      listing_has_variations: true,
      offer_id: 'northline-TRAIL-BLK-10',
      title: 'Trail running shoes — black, size 10',
      url: 'https://example.com/products/trail?color=black&size=10',
      seller_name: 'Northline Outdoor',
      price: '79.99 USD',
    };
    const result = parse(
      jsonl(
        { ...shoe, item_id: 'TRAIL-BLK-10', variant_dict: { color: 'Black', size: '10' }, availability: 'in_stock' },
        { ...shoe, item_id: 'TRAIL-BLK-11', variant_dict: { color: 'Black', size: '11' }, availability: 'out_of_stock' },
      ),
    );
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(
      result.sightings.map((s) => [s.ids.aliases, s.ids.groupId, s.ids.options, s.availability?.value]),
      [
        [['TRAIL-BLK-10'], 'TRAIL', { color: 'Black', size: '10' }, 'in_stock'],
        [['TRAIL-BLK-11'], 'TRAIL', { color: 'Black', size: '11' }, 'out_of_stock'],
      ],
    );
    // An offer id is the seller's, not an identity another surface shares.
    assert.deepStrictEqual(result.sightings[0]!.ids.aliases, ['TRAIL-BLK-10']);
  });

  it('reads the comma-separated example from the Ads guide', () => {
    const csv = [
      'item_id,title,description,url,brand,image_url,price,availability,seller_name,seller_url,return_policy,target_countries,store_country,is_eligible_search,is_eligible_checkout,is_ads_eligible',
      'SKU-001,Trail Running Shoe,Lightweight trail shoe for daily runs,https://example.com/products/sku-001,Acme,https://example.com/images/sku-001.jpg,89.00 USD,in_stock,Acme,https://example.com,https://example.com/returns,US,US,true,false,true',
    ].join('\n');
    const result = parse(csv, {}, 'https://shop.example/feeds/acp.csv');
    assert.deepStrictEqual(result.issues, []);
    const s = result.sightings[0]!;
    assert.deepStrictEqual(s.price?.value, USD(890000));
    assert.equal(s.price?.locator, acpAt('SKU-001', 'price', 'https://shop.example/feeds/acp.csv'));
    // A policy URL alone states a policy; it says nothing about whether returns are accepted.
    assert.deepStrictEqual(s.returnPolicy?.value, { present: true, url: 'https://example.com/returns' });
  });
});

describe('ACP flat records: price and sale', () => {
  it('takes a valid sale as the price and the regular price as the list price', () => {
    const s = only({ ...MUG, price: '79.99 USD', sale_price: '59.99 USD' });
    assert.deepStrictEqual(s.price, acpObservation(USD(599900), '59.99 USD', acpAt('MUG-350-BLUE', 'sale_price')));
    assert.deepStrictEqual(s.listPrice, acpObservation(USD(799900), '79.99 USD', acpAt('MUG-350-BLUE', 'price')));
    assert.equal(s.priceValidUntil, undefined);
  });

  it('keeps the sale as the price after its window has ended: in this format dates schedule nothing', () => {
    const window = '2026-09-01T00:00:00Z/2026-09-07T23:59:59Z';
    const s = only({ ...MUG, price: '79.99 USD', sale_price: '59.99 USD', sale_price_effective_date: window });
    assert.deepStrictEqual(s.price?.value, USD(599900));
    // The end it states is kept, for price.sale-expired to judge.
    assert.deepStrictEqual(s.priceValidUntil, acpObservation('2026-09-07T23:59:59.000Z', window, acpAt('MUG-350-BLUE', 'sale_price_effective_date')));
  });

  it('keeps a date-only end as the date, which counts to the end of that UTC day', () => {
    const s = only({ ...MUG, price: '79.99 USD', sale_price: '59.99 USD', sale_price_effective_date: '2026-10-01/2026-10-07' });
    assert.equal(s.priceValidUntil?.value, '2026-10-07');
  });

  it('reads offsets with and without a colon, and seconds left out', () => {
    const s = only({ ...MUG, price: '79.99 USD', sale_price: '59.99 USD', sale_price_effective_date: '2026-10-01T09:00+0100/2026-10-07T23:59-05:00' });
    assert.equal(s.priceValidUntil?.value, '2026-10-08T04:59:00.000Z');
  });

  it('reports a window it cannot read, and still takes the sale', () => {
    for (const window of ['2026-10-07', '2026-10-07T00:00:00Z/2026-10-01T00:00:00Z', '2026-10-01T09:00/2026-10-07T09:00', '2026-02-30/2026-03-02']) {
      const result = parse(jsonl({ ...MUG, price: '79.99 USD', sale_price: '59.99 USD', sale_price_effective_date: window }));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'sale_price_effective_date')}`], window);
      assert.deepStrictEqual(result.sightings[0]!.price?.value, USD(599900));
      assert.equal(result.sightings[0]!.priceValidUntil, undefined);
    }
  });

  it('ignores a window when there is no sale, as the format does', () => {
    const s = only({ ...MUG, sale_price_effective_date: 'not a window' });
    assert.equal(s.priceValidUntil, undefined);
    assert.deepStrictEqual(s.price?.value, USD(180000));
  });

  it('does not use a sale that is not below the price, not above zero, or in another currency', () => {
    for (const sale of ['18.00 USD', '19.00 USD', '0.00 USD', '15.00 CAD']) {
      const result = parse(jsonl({ ...MUG, sale_price: sale }));
      assert.deepStrictEqual(codes(result), [`feed-field-ignored ${acpAt('MUG-350-BLUE', 'sale_price')}`], sale);
      assert.match(result.issues[0]!.message, /so the regular price is shown$/);
      assert.deepStrictEqual(result.sightings[0]!.price, acpObservation(USD(180000), '18.00 USD', acpAt('MUG-350-BLUE', 'price')));
      assert.equal(result.sightings[0]!.listPrice, undefined);
    }
  });

  it('reads money only in the spec form, and reports the rest', () => {
    for (const price of ['$18.00', '18,00 USD', '1,299.00 USD', '1.8e1 USD', 'USD 18.00', '18.00USD', '-18.00 USD']) {
      const result = parse(jsonl({ ...MUG, price }));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'price')}`], price);
      assert.equal(result.sightings[0]!.price, undefined, price);
    }
  });

  it('accepts a lower-case currency code, and leaves a missing one for price.currency-ambiguous', () => {
    assert.deepStrictEqual(only({ ...MUG, price: '18.00 usd' }).price?.value, USD(180000));
    assert.deepStrictEqual(only({ ...MUG, price: '18.00' }).price?.value, { units: 180000, currency: null });
    assert.deepStrictEqual(only({ ...MUG, price: 18 }).price, acpObservation({ units: 180000, currency: null }, '18', acpAt('MUG-350-BLUE', 'price')));
  });

  it('fills a missing currency from defaultCurrency, and never overrides a stated one', () => {
    const result = parse(jsonl({ ...MUG, price: '18.00' }, { ...MUG, item_id: 'MUG-2', price: '18.00 EUR' }), { defaultCurrency: 'CAD' });
    assert.deepStrictEqual(result.sightings.map((s) => s.price?.value.currency), ['CAD', 'EUR']);
  });

  it('reports an amount too large to hold exactly', () => {
    const result = parse(jsonl({ ...MUG, price: '99999999999999999 USD' }));
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'price')}`]);
  });
});

describe('ACP flat records: availability', () => {
  it('maps the OpenAI spelling pre_order to preorder', () => {
    assert.equal(only({ ...MUG, availability: 'pre_order' }).availability?.value, 'preorder');
    assert.equal(only({ ...MUG, availability: 'backorder' }).availability?.value, 'backorder');
    assert.equal(only({ ...MUG, availability: 'OUT_OF_STOCK' }).availability?.value, 'out_of_stock');
  });

  it('keeps unknown as unknown, a statement that asserts nothing', () => {
    assert.deepStrictEqual(only({ ...MUG, availability: 'unknown' }).availability, acpObservation('unknown', 'unknown', acpAt('MUG-350-BLUE', 'availability')));
  });

  it('reports a value the format does not accept, the Google spelling preorder among them', () => {
    for (const availability of ['preorder', 'in stock', 'available', 'limited_stock']) {
      const result = parse(jsonl({ ...MUG, availability }));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'availability')}`], availability);
      assert.match(result.issues[0]!.message, /an agent rejects the row$/);
      assert.equal(result.sightings[0]!.availability, undefined);
    }
  });
});

describe('ACP flat records: identity', () => {
  it('reads id and sku as names for item_id', () => {
    const { item_id: _, ...rest } = MUG;
    assert.deepStrictEqual(only({ ...rest, id: 'A-1' }).ids.aliases, ['A-1']);
    assert.deepStrictEqual(only({ ...rest, sku: 'S-1' }).ids.aliases, ['S-1']);
  });

  it('keeps an id as text, leading zeros and all, and a JSON number as the digits it has', () => {
    assert.deepStrictEqual(only({ ...MUG, item_id: '00042' }).ids.aliases, ['00042']);
    assert.deepStrictEqual(only({ ...MUG, item_id: 42, gtin: 9506000134352 }).ids, {
      aliases: ['42'],
      url: MUG.url,
      gtin: '9506000134352',
      brand: 'Northline',
    });
  });

  it('lets item_id win over id, and says so when they differ', () => {
    const result = parse(jsonl({ ...MUG, id: 'OTHER' }));
    assert.deepStrictEqual(result.sightings[0]!.ids.aliases, ['MUG-350-BLUE']);
    assert.deepStrictEqual(codes(result), [`feed-field-ignored ${acpAt('MUG-350-BLUE', 'id')}`]);
    assert.deepStrictEqual(parse(jsonl({ ...MUG, id: 'MUG-350-BLUE' })).issues, []);
  });

  it('passes the GTIN and MPN on as written; identity.gtin-invalid judges the GTIN', () => {
    const s = only({ ...MUG, gtin: '09506000134352', mpn: 'NL-TRAIL-10-BLK' });
    assert.equal(s.ids.gtin, '09506000134352');
    assert.equal(s.ids.mpn, 'NL-TRAIL-10-BLK');
    assert.equal(only({ ...MUG, gtin: '123' }).ids.gtin, '123');
  });

  it('gives no group for a group_id equal to the item_id, which establishes none', () => {
    assert.equal(only({ ...MUG, group_id: 'MUG-350-BLUE' }).ids.groupId, undefined);
    assert.equal(only({ ...MUG, item_group_id: 'MUGS' }).ids.groupId, 'MUGS');
  });

  it('reports a record with no item id, and gives no sighting', () => {
    const { item_id: _, ...rest } = MUG;
    const result = parse(jsonl(rest));
    assert.deepStrictEqual(result.sightings, []);
    assert.deepStrictEqual(result.issues, [{ surface: 'acp', code: 'feed-item-incomplete', message: 'line 1 has no item_id', locator: `${ACP_URL}#line[1]` }]);
  });

  it('reports a record with no url, and gives no sighting', () => {
    const { url: _, ...rest } = MUG;
    const result = parse(jsonl(rest));
    assert.deepStrictEqual(result.sightings, []);
    assert.deepStrictEqual(codes(result), [`feed-item-incomplete ${ACP_URL}#item[id="MUG-350-BLUE"]`]);
  });

  it('resolves a relative url against the feed', () => {
    assert.equal(only({ ...MUG, url: '/products/mug-blue' }).ids.url, 'https://shop.example/products/mug-blue');
  });

  it('reports a field that holds an object where text belongs', () => {
    const result = parse(jsonl({ ...MUG, title: { en: 'Mug' } }));
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'title')}`]);
    assert.equal(result.sightings[0]!.title, undefined);
  });
});

describe('ACP flat records: required fields', () => {
  it('reports the required fields a record lacks, and still reads what it has', () => {
    const { seller_name: _s, image_url: _i, description: _d, ...rest } = MUG;
    const result = parse(jsonl(rest));
    assert.deepStrictEqual(result.issues, [
      {
        surface: 'acp',
        code: 'feed-item-incomplete',
        message: 'item "MUG-350-BLUE" has no description, seller_name, image_url, which the format requires; an agent rejects the row',
        locator: `${ACP_URL}#item[id="MUG-350-BLUE"]`,
      },
    ]);
    assert.deepStrictEqual(result.sightings[0]!.price?.value, USD(180000));
  });

  it('counts an empty string and a JSON null as missing', () => {
    const result = parse(jsonl({ ...MUG, brand: '', seller_name: null }));
    assert.match(result.issues[0]!.message, /has no brand, seller_name,/);
    assert.equal(result.sightings[0]!.ids.brand, undefined);
  });
});

describe('ACP flat records: search eligibility', () => {
  it('lists a row kept out of search, but reads none of its facts and reports nothing', () => {
    const { description: _, ...rest } = MUG;
    const result = parse(jsonl({ ...rest, is_eligible_search: false, gtin: '09506000134352', shipping_price: '5.00 USD' }));
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings, [
      {
        surface: 'acp',
        scope: 'variant',
        ids: { aliases: ['MUG-350-BLUE'], url: MUG.url, gtin: '09506000134352', brand: 'Northline' },
        title: MUG.title,
      },
    ]);
  });

  it('reads the flag as the lowercase word in a CSV cell', () => {
    const csv = ['item_id,title,description,url,brand,seller_name,image_url,price,availability,is_eligible_search', 'A,T,D,https://example.com/a,B,S,https://example.com/a.jpg,1.00 USD,in_stock,false'].join('\n');
    assert.equal(parse(csv).sightings[0]!.price, undefined);
  });

  it('lets enable_search win over is_eligible_search', () => {
    const result = parse(jsonl({ ...MUG, enable_search: true, is_eligible_search: false }));
    assert.deepStrictEqual(result.sightings[0]!.price?.value, USD(180000));
    assert.deepStrictEqual(codes(result), [`feed-field-ignored ${acpAt('MUG-350-BLUE', 'is_eligible_search')}`]);
  });

  it('reads a row with search on, or not stated, in full', () => {
    assert.ok(only({ ...MUG, is_eligible_search: true }).price);
    assert.ok(only({ ...MUG, is_eligible_search: null }).price);
    assert.ok(only({ ...MUG, is_eligible_checkout: false }).price);
  });

  it('reports a flag that is not true or false, and reads the row as the default, searchable', () => {
    const result = parse(jsonl({ ...MUG, is_eligible_search: 'FALSE' }));
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'is_eligible_search')}`]);
    assert.ok(result.sightings[0]!.price);
  });
});

describe('ACP flat records: variant options', () => {
  const grouped = { ...MUG, group_id: 'MUGS', listing_has_variations: true };

  it('reads variant_dict written as JSON in a CSV cell', () => {
    const csv = [
      'item_id,group_id,listing_has_variations,variant_dict,title,description,url,brand,seller_name,image_url,price,availability',
      'M-BLU,MUGS,true,"{""color"":""Blue""}",Mug,D,https://example.com/mug,B,S,https://example.com/m.jpg,18.00 USD,in_stock',
    ].join('\n');
    const result = parse(csv);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(result.sightings[0]!.ids.options, { color: 'Blue' });
  });

  it('ignores variant_dict, and says so, unless the row is a listed variation of a group', () => {
    for (const record of [
      { ...MUG, group_id: 'MUGS', variant_dict: { color: 'Blue' } },
      { ...MUG, listing_has_variations: true, variant_dict: { color: 'Blue' } },
      { ...MUG, group_id: 'MUG-350-BLUE', listing_has_variations: true, variant_dict: { color: 'Blue' } },
    ]) {
      const result = parse(jsonl(record));
      assert.equal(result.sightings[0]!.ids.options, undefined);
      assert.deepStrictEqual(codes(result), [`feed-field-ignored ${acpAt('MUG-350-BLUE', 'variant_dict')}`]);
    }
  });

  it('reports a variant_dict that is not an object of text values', () => {
    for (const dict of ['{"color":', '["Blue"]', { color: 3 }, { '': 'Blue' }]) {
      const result = parse(jsonl({ ...grouped, variant_dict: dict }));
      assert.equal(result.sightings[0]!.ids.options, undefined);
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'variant_dict')}`], JSON.stringify(dict));
    }
  });

  it('reads the older Custom_variant pairs when there is no variant_dict', () => {
    const s = only({ ...grouped, Custom_variant1_category: 'Color', Custom_variant1_option: 'Blue', custom_variant2_category: 'Size', custom_variant2_option: '350 mL' });
    assert.deepStrictEqual(s.ids.options, { Color: 'Blue', Size: '350 mL' });
  });

  it('does not fall back to the older pairs from an explicit empty variant_dict', () => {
    const s = only({ ...grouped, variant_dict: {}, Custom_variant1_category: 'Color', Custom_variant1_option: 'Blue' });
    assert.equal(s.ids.options, undefined);
  });

  it('does not take flat attributes such as size as options in the OpenAI format', () => {
    assert.equal(only({ ...grouped, size: '350 mL', color: 'Blue' }).ids.options, undefined);
  });
});

describe('ACP flat records: shipping', () => {
  it('reads shipping_price as one charge with no country of its own', () => {
    assert.deepStrictEqual(
      only({ ...MUG, shipping_price: '5.00 USD' }).shipping,
      acpObservation({ free: false, cost: USD(50000) }, '5.00 USD', acpAt('MUG-350-BLUE', 'shipping_price')),
    );
    assert.deepStrictEqual(only({ ...MUG, shipping_price: '0.00 USD' }).shipping?.value, { free: true, cost: USD(0) });
  });

  it('says nothing about shipping when shipping_price is left out: that is unknown, not free', () => {
    assert.equal(only(MUG).shipping, undefined);
    assert.equal(only({ ...MUG, shipping_price: '' }).shipping, undefined);
  });

  it('reads the four-position tuple, keeping an empty region', () => {
    assert.deepStrictEqual(
      only({ ...MUG, shipping: 'US::Standard:5.00 USD' }).shipping,
      acpObservation({ free: false, cost: USD(50000), country: 'US' }, 'US::Standard:5.00 USD', acpAt('MUG-350-BLUE', 'shipping')),
    );
  });

  it('reports a tuple that is not exactly four positions with a country', () => {
    for (const tuple of ['US:CA:Overnight:16.00 USD:1:1:2:3', 'US:Standard:5.00 USD', '::Standard:5.00 USD', 'US:ALL:Standard Shipping:3-5:0.00 USD']) {
      const result = parse(jsonl({ ...MUG, shipping: tuple }));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'shipping')}`], tuple);
      assert.equal(result.sightings[0]!.shipping, undefined);
    }
  });

  it('takes shipping_price and ignores the tuple when a row sends both', () => {
    const result = parse(jsonl({ ...MUG, shipping_price: '5.00 USD', shipping: 'US::Express:15.00 USD' }));
    assert.deepStrictEqual(result.sightings[0]!.shipping?.value, { free: false, cost: USD(50000) });
    assert.deepStrictEqual(codes(result), [`feed-field-ignored ${acpAt('MUG-350-BLUE', 'shipping')}`]);
  });
});

describe('ACP flat records: returns', () => {
  it('reads accepted returns with their window and policy', () => {
    const record = { ...MUG, accepts_returns: true, return_deadline_in_days: 30, return_policy: 'https://example.com/returns' };
    assert.deepStrictEqual(
      only(record).returnPolicy,
      acpObservation(
        { present: true, days: 30, url: 'https://example.com/returns' },
        '{"accepts_returns":true,"return_deadline_in_days":30,"return_policy":"https://example.com/returns"}',
        acpAt('MUG-350-BLUE', 'accepts_returns'),
      ),
    );
  });

  it('reads a final sale as a stated policy of no returns', () => {
    assert.deepStrictEqual(only({ ...MUG, accepts_returns: false }).returnPolicy?.value, { present: true, days: 0 });
  });

  it('reads the window from a CSV cell, and lets return_window win when both are given', () => {
    const result = parse(jsonl({ ...MUG, accepts_returns: 'true', return_window: '14', return_deadline_in_days: '30' }));
    assert.deepStrictEqual(result.sightings[0]!.returnPolicy?.value, { present: true, days: 14 });
    assert.deepStrictEqual(codes(result), [`feed-field-ignored ${acpAt('MUG-350-BLUE', 'return_deadline_in_days')}`]);
  });

  it('ignores a window, and says so, unless returns are accepted', () => {
    const result = parse(jsonl({ ...MUG, return_deadline_in_days: 30 }));
    assert.equal(result.sightings[0]!.returnPolicy, undefined);
    assert.deepStrictEqual(codes(result), [`feed-field-ignored ${acpAt('MUG-350-BLUE', 'return_deadline_in_days')}`]);
  });

  it('reports a window that is not a whole number of days above zero', () => {
    for (const days of [0, -3, 1.5, '30 days']) {
      const result = parse(jsonl({ ...MUG, accepts_returns: true, return_deadline_in_days: days }));
      assert.deepStrictEqual(result.sightings[0]!.returnPolicy?.value, { present: true }, String(days));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'return_deadline_in_days')}`]);
    }
  });

  it('drops a policy that is not an http or https URL, and says so', () => {
    const result = parse(jsonl({ ...MUG, return_policy: 'returns.html' }));
    assert.equal(result.sightings[0]!.returnPolicy, undefined);
    assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('MUG-350-BLUE', 'return_policy')}`]);
  });

  it('states no policy when the row says nothing about returns', () => {
    assert.equal(only(MUG).returnPolicy, undefined);
  });
});

describe("ACP flat records: OpenAI's Google-compatible profile", () => {
  const HEADER = 'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\tbrand';
  const row = (cells: Partial<Record<string, string>> = {}): string =>
    HEADER.split('\t')
      .map((name) => cells[name] ?? { id: 'G-1', title: 'Mug', description: 'D', link: 'https://example.com/mug', image_link: 'https://example.com/m.jpg', availability: 'in_stock', price: '18.00 USD', brand: 'B' }[name]!)
      .join('\t');
  const tsv = (header: string, ...rows: string[]) => [header, ...rows].join('\n');

  it('reads a TSV feed with link, not url, in Google spelling', () => {
    const result = parse(tsv(HEADER, row({ availability: 'preorder' })));
    assert.deepStrictEqual(result.issues, []);
    const s = result.sightings[0]!;
    assert.deepStrictEqual(s.ids, { aliases: ['G-1'], url: 'https://example.com/mug', brand: 'B' });
    assert.equal(s.availability?.value, 'preorder');
    assert.equal(s.price?.locator, acpAt('G-1', 'price'));
  });

  it('reports the OpenAI spellings it does not accept', () => {
    for (const availability of ['pre_order', 'unknown']) {
      const result = parse(tsv(HEADER, row({ availability })));
      assert.deepStrictEqual(codes(result), [`feed-field-unreadable ${acpAt('G-1', 'availability')}`], availability);
    }
  });

  it('requires image_link and not seller_name', () => {
    const header = 'id\ttitle\tdescription\tlink\tavailability\tprice\tbrand';
    const result = parse(tsv(header, 'G-1\tMug\tD\thttps://example.com/mug\tin_stock\t18.00 USD\tB'));
    assert.match(result.issues[0]!.message, /has no image_link, which the format requires/);
  });

  it("takes a grouped row's attributes as its options, and an ungrouped row's as nothing", () => {
    const header = `${HEADER}\titem_group_id\tcolor\tsize`;
    const result = parse(tsv(header, `${row()}\tMUGS\tBlue\t350 mL`, `${row({ id: 'G-2' })}\t\tBlue\t350 mL`));
    assert.deepStrictEqual(result.sightings.map((s) => s.ids.options), [{ color: 'Blue', size: '350 mL' }, undefined]);
  });

  it('reads no shipping, returns or search columns, which this profile does not carry', () => {
    const header = `${HEADER}\tshipping\tshipping_price\taccepts_returns\treturn_policy\tis_eligible_search`;
    const result = parse(tsv(header, `${row()}\tUS::Standard:5.00 USD\t5.00 USD\ttrue\thttps://example.com/returns\tfalse`));
    assert.deepStrictEqual(result.issues, []);
    const s = result.sightings[0]!;
    assert.equal(s.shipping, undefined);
    assert.equal(s.returnPolicy, undefined);
    assert.ok(s.price, 'is_eligible_search=false does not opt a row out of this profile');
  });

  it('says that a bad sale rejects the row in this profile', () => {
    const header = `${HEADER}\tsale_price`;
    const result = parse(tsv(header, `${row()}\t20.00 USD`));
    assert.match(result.issues[0]!.message, /the Google-compatible profile rejects the row$/);
  });

  it('reads a comma-separated file in this profile too', () => {
    const csv = ['id,title,description,link,image_link,availability,price,brand', 'G-1,"Mug, blue",D,https://example.com/mug,https://example.com/m.jpg,in_stock,18.00 USD,B'].join('\n');
    const result = parse(csv);
    assert.deepStrictEqual(result.issues, []);
    assert.equal(result.sightings[0]!.title, 'Mug, blue');
  });
});
