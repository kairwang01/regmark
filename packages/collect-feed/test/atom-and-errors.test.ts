import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseFeed } from '../src/index.ts';
import { FEED_URL, FETCHED_AT, NOW, observation, rss } from './support.ts';

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0">
  <title>Shop</title>
  <entry>
    <id type="text">MUG-1</id>
    <title type="text">Mug &amp; Saucer</title>
    <link rel="self" href="https://shop.example/feeds/self.xml"/>
    <link rel="alternate" href="https://shop.example/p/mug"/>
    <g:price>12.00 USD</g:price>
    <g:availability>preorder</g:availability>
  </entry>
  <entry>
    <g:id>MUG-2</g:id>
    <title>Plain Mug</title>
    <link href="/p/plain-mug"/>
    <g:price>9.00 USD</g:price>
  </entry>
</feed>`;

describe('Atom', () => {
  it('reads entries, element text with attributes, and link href', () => {
    const result = parseFeed(ATOM, 'https://shop.example/feeds/atom.xml', FETCHED_AT, NOW);
    const atomUrl = 'https://shop.example/feeds/atom.xml';
    assert.deepStrictEqual(result.issues, []);
    assert.equal(result.sightings.length, 2);
    const [mug, plain] = result.sightings;
    assert.deepStrictEqual(mug?.ids, { aliases: ['MUG-1'], url: 'https://shop.example/p/mug' });
    assert.equal(mug?.title, 'Mug & Saucer');
    assert.deepStrictEqual(mug?.price, observation({ units: 120000, currency: 'USD' }, '12.00 USD', `${atomUrl}#item[id="MUG-1"]/price`));
    assert.equal(mug?.availability?.value, 'preorder');
    assert.deepStrictEqual(plain?.ids, { aliases: ['MUG-2'], url: 'https://shop.example/p/plain-mug' });
    assert.equal(plain?.price?.value.units, 90000);
  });
});

describe('invalid feeds', () => {
  it('reports broken XML as parse-error with no sightings', () => {
    const result = parseFeed('<rss><channel><item><g:id>A</g:id>', FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.sightings, []);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0]?.surface, 'feed');
    assert.equal(result.issues[0]?.code, 'parse-error');
    assert.equal(result.issues[0]?.locator, FEED_URL);
    assert.equal(typeof result.issues[0]?.message, 'string');
  });

  it('reports XML that is neither RSS nor Atom as parse-error', () => {
    const result = parseFeed('<html><body><p>Not a feed</p></body></html>', FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.sightings, []);
    assert.deepStrictEqual(
      result.issues.map((i) => [i.code, i.locator]),
      [['parse-error', FEED_URL]],
    );
  });

  it('reports an empty body as parse-error', () => {
    const result = parseFeed('  \n', FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(result.sightings, []);
    assert.equal(result.issues[0]?.code, 'parse-error');
  });

  it('skips an item without an id and keeps the others', () => {
    const body = rss(`
      <item><title>No id</title><link>https://shop.example/p/x</link><g:price>1.00 USD</g:price></item>
      <item><g:id>KEEP</g:id><title>Kept</title><link>https://shop.example/p/keep</link><g:price>2.00 USD</g:price></item>`);
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(
      result.sightings.map((s) => s.ids.aliases),
      [['KEEP']],
    );
    assert.deepStrictEqual(result.issues, [
      {
        surface: 'feed',
        code: 'feed-item-incomplete',
        message: 'item 1 has no id',
        locator: `${FEED_URL}#item[1]`,
      },
    ]);
  });

  it('skips an item without a link and keeps the others', () => {
    const body = rss(`
      <item><g:id>NOLINK</g:id><title>No link</title><g:price>1.00 USD</g:price></item>
      <item><g:id>OK</g:id><title>Fine</title><link>https://shop.example/p/ok</link><g:price>2.00 USD</g:price></item>`);
    const result = parseFeed(body, FEED_URL, FETCHED_AT, NOW);
    assert.deepStrictEqual(
      result.sightings.map((s) => s.ids.aliases),
      [['OK']],
    );
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0]?.code, 'feed-item-incomplete');
    assert.equal(result.issues[0]?.locator, `${FEED_URL}#item[id="NOLINK"]`);
  });
});
