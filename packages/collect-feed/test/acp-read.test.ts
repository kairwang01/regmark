// Telling the formats of an ACP feed apart, from the text and never from a
// file name, and refusing the ones the protocol does not use.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CollectResult } from '@regmark/core';
import { parseFeed } from '../src/index.ts';
import { ACP_URL, FETCHED_AT, jsonl, MUG, NOW } from './support.ts';

const parse = (body: string): CollectResult => parseFeed(body, ACP_URL, FETCHED_AT, NOW, { surface: 'acp' });
const ids = (result: CollectResult) => result.sightings.map((s) => s.ids.aliases?.[0]);

/** The whole feed refused with one parse-error on the acp surface. */
function refused(body: string, message: RegExp): void {
  const result = parse(body);
  assert.deepStrictEqual(result.sightings, []);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.surface, 'acp');
  assert.equal(result.issues[0]!.code, 'parse-error');
  assert.equal(result.issues[0]!.locator, ACP_URL);
  assert.match(result.issues[0]!.message, message);
}

const PRODUCT = {
  id: 'prod_classic_tee',
  title: 'Classic Tee',
  url: 'https://merchant.example/products/classic-tee',
  variants: [{ id: 'sku124-red-m', title: 'Classic Tee - Red / Medium', price: { amount: 1999, currency: 'USD' } }],
};

describe('ACP feed formats', () => {
  it('reads JSON Lines, skipping blank lines and accepting CRLF', () => {
    const body = `\r\n${JSON.stringify(MUG)}\r\n\r\n${JSON.stringify({ ...MUG, item_id: 'MUG-2' })}\r\n`;
    const result = parse(body);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(ids(result), ['MUG-350-BLUE', 'MUG-2']);
  });

  it('reads a one-record file, and a file with a byte order mark', () => {
    assert.deepStrictEqual(ids(parse(JSON.stringify(MUG))), ['MUG-350-BLUE']);
    assert.deepStrictEqual(ids(parse(`﻿${jsonl(MUG)}`)), ['MUG-350-BLUE']);
  });

  it('reports a line that is not a JSON object, and reads the others', () => {
    const body = [JSON.stringify(MUG), '{"item_id": "BROKEN",', '["an", "array"]', '42', JSON.stringify({ ...MUG, item_id: 'MUG-5' })].join('\n');
    const result = parse(body);
    assert.deepStrictEqual(ids(result), ['MUG-350-BLUE', 'MUG-5']);
    assert.deepStrictEqual(
      result.issues.map((i) => [i.code, i.locator]),
      [
        ['feed-line-unreadable', `${ACP_URL}#line[2]`],
        ['feed-line-unreadable', `${ACP_URL}#line[3]`],
        ['feed-line-unreadable', `${ACP_URL}#line[4]`],
      ],
    );
    assert.match(result.issues[0]!.message, /^line 2 is not JSON: /);
    assert.equal(result.issues[1]!.message, 'line 3 is not a JSON object');
  });

  it('reads products.jsonl, one Product with its variants per line', () => {
    const result = parse(jsonl(PRODUCT, { ...PRODUCT, id: 'prod_2', variants: [{ id: 'v-2', title: 'Two', url: 'https://merchant.example/products/two' }] }));
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(ids(result), ['sku124-red-m', 'v-2']);
  });

  it('reads a {"products": [...]} document, pretty-printed and with target_country beside it', () => {
    const body = JSON.stringify({ target_country: 'US', products: [PRODUCT] }, null, 2);
    const result = parse(body);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(ids(result), ['sku124-red-m']);
  });

  it('reports a product in the document that is not an object', () => {
    const result = parse(JSON.stringify({ products: [PRODUCT, 'prod_2'] }));
    assert.deepStrictEqual(ids(result), ['sku124-red-m']);
    assert.deepStrictEqual(result.issues, [{ surface: 'acp', code: 'feed-item-incomplete', message: 'product 2 is not an object', locator: `${ACP_URL}#product[2]` }]);
  });

  it('reads comma-separated text with quoted commas, quotes and newlines', () => {
    const csv = [
      'item_id,title,description,url,brand,seller_name,image_url,price,availability',
      'C-1,"Mug, ""large""","Two lines,\nof text",https://example.com/c-1,B,S,https://example.com/c.jpg,18.00 USD,in_stock',
    ].join('\r\n');
    const result = parse(csv);
    assert.deepStrictEqual(result.issues, []);
    assert.equal(result.sightings[0]!.title, 'Mug, "large"');
  });

  it('reads tab-separated text, with header names in any case', () => {
    const tsv = ['Item_ID\tTitle\tDescription\tURL\tBrand\tSeller_Name\tImage_URL\tPrice\tAvailability', 'T-1\tMug\tD\thttps://example.com/t-1\tB\tS\thttps://example.com/t.jpg\t18.00 USD\tin_stock'].join('\n');
    const result = parse(tsv);
    assert.deepStrictEqual(result.issues, []);
    assert.deepStrictEqual(ids(result), ['T-1']);
  });

  it('refuses a CSV or TSV header that names no page or no item', () => {
    refused('item_id,title,price\nA,Mug,1.00 USD', /neither a url column \(OpenAI format\) nor a link column/);
    refused('title,url,price\nMug,https://example.com/a,1.00 USD', /has a url column but no item_id column/);
    refused('item_id\tlink\tprice\nA\thttps://example.com/a\t1.00 USD', /Google-compatible profile has a link column but no id column/);
  });

  it('refuses an unterminated quoted cell', () => {
    refused('item_id,url\nA,"https://example.com/a', /comma-separated feed has an unterminated quoted cell/);
  });

  it('refuses XML, which is a Google feed and not an ACP one', () => {
    refused('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>', /XML, which is not an ACP feed format/);
  });

  it('refuses a JSON array, which no ACP format uses', () => {
    refused(JSON.stringify([MUG]), /JSON array, which is not an ACP feed format/);
  });

  it('refuses Parquet, which is not read, and says what to export instead', () => {
    refused('PAR1\u0015\u0004binary', /Parquet, which is not read; export it as JSON Lines, CSV or TSV/);
  });

  it('refuses an empty feed', () => {
    refused('', /feed is empty/);
    refused('\n  \n', /feed is empty/);
  });
});
