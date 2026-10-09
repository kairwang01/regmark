import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonLd } from '../src/jsonld.ts';

const PAGE = 'https://shop.example/p/tee/';
const FETCHED = '2026-10-09T08:00:00Z';

/** One ld+json script per block, serialised the way a shop would embed it. */
function page(...blocks: unknown[]): string {
  const scripts = blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`);
  return `<!doctype html><html><head>${scripts.join('\n')}</head><body><h1>Linen Tee</h1></body></html>`;
}

function run(html: string) {
  return extractJsonLd(html, PAGE, FETCHED);
}

describe('extractJsonLd: a single product', () => {
  it('reads one Offer with a SKU as a variant sighting', () => {
    const { sightings, issues } = run(
      page({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Linen Tee',
        brand: { '@type': 'Brand', name: 'Acme' },
        offers: {
          '@type': 'Offer',
          sku: 'TEE-BLU-M',
          price: '39.00',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: '/p/tee/blue-m',
        },
      }),
    );
    assert.deepEqual(issues, []);
    assert.equal(sightings.length, 1);
    const s = sightings[0]!;
    assert.equal(s.surface, 'jsonld');
    assert.equal(s.scope, 'variant');
    assert.equal(s.title, 'Linen Tee');
    assert.equal(s.ids.sku, 'TEE-BLU-M');
    assert.equal(s.ids.brand, 'Acme');
    assert.equal(s.ids.url, 'https://shop.example/p/tee/blue-m');
    assert.deepEqual(s.price?.value, { units: 390000, currency: 'USD' });
    assert.equal(s.price?.raw, '39.00');
    assert.equal(s.price?.surface, 'jsonld');
    assert.equal(s.price?.fetchedAt, FETCHED);
    assert.equal(s.price?.locator, `${PAGE}#jsonld[0]/offers/price`);
    assert.equal(s.availability?.value, 'in_stock');
    assert.equal(s.availability?.locator, `${PAGE}#jsonld[0]/offers/availability`);
  });

  it('gives a product-scope sighting when the product has no identifiers', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Linen Tee',
        offers: { '@type': 'Offer', price: '39.00', priceCurrency: 'USD' },
      }),
    );
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.scope, 'product');
    assert.equal(sightings[0]!.ids.sku, undefined);
    assert.equal(sightings[0]!.ids.gtin, undefined);
    assert.equal(sightings[0]!.ids.url, PAGE);
  });

  it('gives one sighting per Offer when offers is an array with their own SKUs', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Linen Tee',
        offers: [
          { '@type': 'Offer', sku: 'TEE-BLU-M', price: '39.00', priceCurrency: 'USD' },
          { '@type': 'Offer', sku: 'TEE-BLU-L', price: '39.00', priceCurrency: 'USD' },
          { '@type': 'Offer', sku: 'TEE-BLU-XL', price: '41.00', priceCurrency: 'USD' },
        ],
      }),
    );
    assert.deepEqual(
      sightings.map((s) => s.ids.sku),
      ['TEE-BLU-M', 'TEE-BLU-L', 'TEE-BLU-XL'],
    );
    assert.equal(sightings[2]!.price?.value.units, 410000);
    assert.equal(sightings[2]!.price?.locator, `${PAGE}#jsonld[0]/offers/2/price`);
  });

  it('gives no sighting for a Product without offers', () => {
    const { sightings, issues } = run(page({ '@type': 'Product', name: 'Linen Tee' }));
    assert.deepEqual(sightings, []);
    assert.deepEqual(issues, []);
  });
});

describe('extractJsonLd: where the Product sits', () => {
  it('finds a Product inside @graph among other node types', () => {
    const { sightings } = run(
      page({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Shop', url: 'https://shop.example/' },
          { '@type': 'BreadcrumbList', itemListElement: [] },
          {
            '@type': 'Product',
            name: 'Linen Tee',
            offers: { '@type': 'Offer', price: '39.00', priceCurrency: 'USD', availability: 'OutOfStock' },
          },
        ],
      }),
    );
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.availability?.value, 'out_of_stock');
    assert.equal(sightings[0]!.availability?.locator, `${PAGE}#jsonld[0]/@graph/2/offers/availability`);
  });

  it('walks a top-level array', () => {
    const { sightings } = run(
      page([
        { '@type': 'WebPage', name: 'Linen Tee' },
        { '@type': 'Product', name: 'Linen Tee', offers: { '@type': 'Offer', price: '12', priceCurrency: 'USD' } },
      ]),
    );
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.price?.locator, `${PAGE}#jsonld[0]/1/offers/price`);
  });

  it('accepts @type as an array', () => {
    const { sightings } = run(
      page({ '@type': ['Product', 'Thing'], name: 'Linen Tee', offers: { '@type': 'Offer', price: '12', priceCurrency: 'USD' } }),
    );
    assert.equal(sightings.length, 1);
  });

  it('accepts @type as a full schema.org IRI and as a prefixed name', () => {
    const iri = run(page({ '@type': 'https://schema.org/Product', name: 'A', offers: { '@type': 'Offer', price: '1', priceCurrency: 'USD' } }));
    const prefixed = run(page({ '@type': 'schema:Product', name: 'B', offers: { '@type': 'Offer', price: '2', priceCurrency: 'USD' } }));
    assert.equal(iri.sightings.length, 1);
    assert.equal(prefixed.sightings.length, 1);
  });

  it('matches the script type attribute case-insensitively', () => {
    const html = `<script TYPE=" Application/LD+JSON ">${JSON.stringify({ '@type': 'Product', name: 'X', offers: { price: '5', priceCurrency: 'USD' } })}</script>`;
    assert.equal(run(html).sightings.length, 1);
  });

  it('returns empty arrays for a page without JSON-LD', () => {
    const { sightings, issues } = run('<html><head><script>var a = 1;</script></head><body>Hi</body></html>');
    assert.deepEqual(sightings, []);
    assert.deepEqual(issues, []);
  });
});

describe('extractJsonLd: ProductGroup', () => {
  const group = {
    '@type': 'ProductGroup',
    name: 'Linen Tee',
    brand: { '@type': 'Brand', name: 'Acme' },
    url: 'https://shop.example/p/tee',
    productGroupID: 'TEE-1',
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      merchantReturnDays: 30,
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    },
    hasVariant: [
      {
        '@type': 'Product',
        sku: 'TEE-BLU-M',
        color: 'Blue',
        size: 'M',
        offers: { '@type': 'Offer', price: '39.00', priceCurrency: 'USD' },
      },
      {
        '@type': 'Product',
        name: 'Linen Tee Green',
        sku: 'TEE-GRN-S',
        color: 'Green',
        size: 'S',
        offers: { '@type': 'Offer', price: '41.00', priceCurrency: 'USD' },
      },
    ],
  };

  it('gives one variant sighting per variant, with group id, options and group fallbacks', () => {
    const { sightings } = run(page(group));
    assert.equal(sightings.length, 2);
    const blue = sightings[0]!;
    const green = sightings[1]!;

    assert.equal(blue.scope, 'variant');
    assert.equal(blue.ids.groupId, 'TEE-1');
    assert.deepEqual(blue.ids.options, { color: 'Blue', size: 'M' });
    assert.equal(blue.title, 'Linen Tee', 'title falls back to the group name');
    assert.equal(blue.ids.brand, 'Acme', 'brand falls back to the group');
    assert.equal(blue.ids.url, 'https://shop.example/p/tee', 'url falls back to the group');
    assert.deepEqual(blue.returnPolicy?.value, { present: true, days: 30 });
    assert.equal(blue.returnPolicy?.locator, `${PAGE}#jsonld[0]/hasMerchantReturnPolicy`, 'the policy is read from the group');

    assert.equal(green.title, 'Linen Tee Green', 'the variant name wins over the group name');
    assert.deepEqual(green.ids.options, { color: 'Green', size: 'S' });
    assert.equal(green.price?.value.units, 410000);
    assert.equal(green.price?.locator, `${PAGE}#jsonld[0]/hasVariant/1/offers/price`);
  });

  it('gives nothing for a ProductGroup without hasVariant', () => {
    const { sightings } = run(page({ '@type': 'ProductGroup', name: 'Linen Tee', productGroupID: 'TEE-1' }));
    assert.deepEqual(sightings, []);
  });
});

describe('extractJsonLd: AggregateOffer', () => {
  it('gives a product-scope price when lowPrice and highPrice are equal', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Enamel Mug',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '12.00',
          highPrice: '12.00',
          priceCurrency: 'GBP',
          offerCount: 3,
          availability: 'https://schema.org/InStock',
        },
      }),
    );
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.scope, 'product');
    assert.deepEqual(sightings[0]!.price?.value, { units: 120000, currency: 'GBP' });
    assert.equal(sightings[0]!.price?.locator, `${PAGE}#jsonld[0]/offers/lowPrice`);
    assert.equal(sightings[0]!.availability?.value, 'in_stock');
  });

  it('gives no price when lowPrice and highPrice differ', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Enamel Mug',
        offers: { '@type': 'AggregateOffer', lowPrice: '12.00', highPrice: '18.00', priceCurrency: 'GBP', offerCount: 2 },
      }),
    );
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.scope, 'product');
    assert.equal(sightings[0]!.price, undefined);
  });

  it('reads each nested offer, falling back to the aggregate currency', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Enamel Mug',
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'EUR',
          offers: [
            { '@type': 'Offer', sku: 'MUG-1', price: '10,00' },
            { '@type': 'Offer', sku: 'MUG-2', price: '12,50', priceCurrency: 'USD' },
          ],
        },
      }),
    );
    assert.equal(sightings.length, 2);
    assert.deepEqual(sightings[0]!.price?.value, { units: 100000, currency: 'EUR' });
    assert.equal(sightings[0]!.price?.locator, `${PAGE}#jsonld[0]/offers/offers/0/price`);
    assert.deepEqual(sightings[1]!.price?.value, { units: 125000, currency: 'USD' });
    assert.equal(sightings[1]!.scope, 'variant');
  });
});

describe('extractJsonLd: prices', () => {
  it('reads a numeric price', () => {
    const { sightings } = run(page({ '@type': 'Product', name: 'Tee', offers: { price: 39.5, priceCurrency: 'USD' } }));
    assert.deepEqual(sightings[0]!.price?.value, { units: 395000, currency: 'USD' });
    assert.equal(sightings[0]!.price?.raw, '39.5');
  });

  it('reads a comma decimal price with its currency', () => {
    const { sightings } = run(page({ '@type': 'Product', name: 'Tee', offers: { price: '39,00', priceCurrency: 'EUR' } }));
    assert.deepEqual(sightings[0]!.price?.value, { units: 390000, currency: 'EUR' });
    assert.equal(sightings[0]!.price?.raw, '39,00');
  });

  it('uses priceSpecification when there is no price, and routes ListPrice to listPrice', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        offers: {
          '@type': 'Offer',
          priceCurrency: 'CAD',
          priceSpecification: [
            { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/ListPrice', price: '59.00' },
            { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/SalePrice', price: '45.00' },
          ],
        },
      }),
    );
    const s = sightings[0]!;
    assert.deepEqual(s.price?.value, { units: 450000, currency: 'CAD' });
    assert.equal(s.price?.locator, `${PAGE}#jsonld[0]/offers/priceSpecification/1/price`);
    assert.deepEqual(s.listPrice?.value, { units: 590000, currency: 'CAD' });
    assert.equal(s.listPrice?.locator, `${PAGE}#jsonld[0]/offers/priceSpecification/0/price`);
  });

  it('takes the currency from the specification when the offer has none', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        offers: { priceSpecification: { price: '20', priceCurrency: 'AUD' } },
      }),
    );
    assert.deepEqual(sightings[0]!.price?.value, { units: 200000, currency: 'AUD' });
  });

  it('gives null currency when no priceCurrency is stated', () => {
    const { sightings } = run(page({ '@type': 'Product', name: 'Tee', offers: { price: '39.00' } }));
    assert.deepEqual(sightings[0]!.price?.value, { units: 390000, currency: null });
  });

  it('omits the price when the text is not one amount', () => {
    const { sightings } = run(page({ '@type': 'Product', name: 'Tee', offers: { price: 'free', priceCurrency: 'USD' } }));
    assert.equal(sightings[0]!.price, undefined);
  });

  it('reads a priceValidUntil unchanged', () => {
    const { sightings } = run(
      page({ '@type': 'Product', name: 'Tee', offers: { price: '39.00', priceCurrency: 'USD', priceValidUntil: '2026-12-31' } }),
    );
    assert.equal(sightings[0]!.priceValidUntil?.value, '2026-12-31');
    assert.equal(sightings[0]!.priceValidUntil?.raw, '2026-12-31');
  });
});

describe('extractJsonLd: availability', () => {
  const cases: Array<[string, string | null]> = [
    ['InStock', 'in_stock'],
    ['https://schema.org/LimitedAvailability', 'in_stock'],
    ['OnlineOnly', 'in_stock'],
    ['OutOfStock', 'out_of_stock'],
    ['https://schema.org/SoldOut', 'out_of_stock'],
    ['InStoreOnly', 'out_of_stock'],
    ['PreOrder', 'preorder'],
    ['http://schema.org/PreSale', 'preorder'],
    ['BackOrder', 'backorder'],
    ['Discontinued', 'discontinued'],
    ['Maybe', null],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${input} to ${expected ?? 'no observation'}`, () => {
      const { sightings } = run(page({ '@type': 'Product', name: 'Tee', offers: { price: '1', priceCurrency: 'USD', availability: input } }));
      assert.equal(sightings[0]!.availability?.value, expected ?? undefined);
      if (expected !== null) assert.equal(sightings[0]!.availability?.raw, input);
    });
  }
});

describe('extractJsonLd: shipping', () => {
  it('reads a zero rate as free', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        offers: {
          price: '39.00',
          priceCurrency: 'USD',
          shippingDetails: {
            '@type': 'OfferShippingDetails',
            shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'USD' },
            shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'ca' },
          },
        },
      }),
    );
    const shipping = sightings[0]!.shipping;
    assert.deepEqual(shipping?.value, { free: true, cost: { units: 0, currency: 'USD' }, country: 'CA' });
    assert.equal(shipping?.raw, '0');
    assert.equal(shipping?.locator, `${PAGE}#jsonld[0]/offers/shippingDetails/shippingRate/value`);
  });

  it('reads a paid rate as not free', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        offers: {
          price: '39.00',
          priceCurrency: 'USD',
          shippingDetails: [{ '@type': 'OfferShippingDetails', shippingRate: { '@type': 'MonetaryAmount', value: '6.20', currency: 'USD' } }],
        },
      }),
    );
    assert.deepEqual(sightings[0]!.shipping?.value, { free: false, cost: { units: 62000, currency: 'USD' } });
  });

  it('omits the quote when min and max rates differ', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        offers: {
          price: '39.00',
          priceCurrency: 'USD',
          shippingDetails: { shippingRate: { minValue: 4, maxValue: 9, currency: 'USD' } },
        },
      }),
    );
    assert.equal(sightings[0]!.shipping, undefined);
  });
});

describe('extractJsonLd: return policies', () => {
  it('reads hasMerchantReturnPolicy on the offer', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        offers: {
          price: '39.00',
          priceCurrency: 'USD',
          hasMerchantReturnPolicy: { merchantReturnDays: 14, merchantReturnLink: 'https://shop.example/returns' },
        },
      }),
    );
    assert.deepEqual(sightings[0]!.returnPolicy?.value, { present: true, days: 14, url: 'https://shop.example/returns' });
  });

  it('falls back to hasMerchantReturnPolicy on the product', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        hasMerchantReturnPolicy: { merchantReturnDays: 30 },
        offers: { price: '39.00', priceCurrency: 'USD' },
      }),
    );
    assert.deepEqual(sightings[0]!.returnPolicy?.value, { present: true, days: 30 });
    assert.equal(sightings[0]!.returnPolicy?.locator, `${PAGE}#jsonld[0]/hasMerchantReturnPolicy`);
  });

  it('reads a not-permitted category as present with zero days', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        offers: {
          price: '39.00',
          priceCurrency: 'USD',
          hasMerchantReturnPolicy: { returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' },
        },
      }),
    );
    assert.deepEqual(sightings[0]!.returnPolicy?.value, { present: true, days: 0 });
  });
});

describe('extractJsonLd: identifiers', () => {
  it('reads gtin13 given as a number, keeping its text', () => {
    const { sightings } = run(
      page({ '@type': 'Product', name: 'Tee', gtin13: 4006381333931, offers: { price: '39.00', priceCurrency: 'USD' } }),
    );
    assert.equal(sightings[0]!.ids.gtin, '4006381333931');
    assert.equal(sightings[0]!.scope, 'variant');
  });

  it('prefers gtin on the offer over the product', () => {
    const { sightings } = run(
      page({
        '@type': 'Product',
        name: 'Tee',
        gtin12: '012345678905',
        offers: { gtin: '4006381333931', price: '39.00', priceCurrency: 'USD' },
      }),
    );
    assert.equal(sightings[0]!.ids.gtin, '4006381333931');
  });
});

describe('extractJsonLd: malformed input', () => {
  it('records one issue for invalid JSON and still reads the next script', () => {
    const html = [
      '<script type="application/ld+json">{ "@type": "Product", </script>',
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'Tee',
        offers: { '@type': 'Offer', price: '39.00', priceCurrency: 'USD' },
      })}</script>`,
    ].join('\n');
    const { sightings, issues } = run(html);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.surface, 'jsonld');
    assert.equal(issues[0]!.code, 'parse-error');
    assert.equal(issues[0]!.locator, `${PAGE}#jsonld[0]`);
    assert.equal(sightings.length, 1);
    assert.equal(sightings[0]!.price?.locator, `${PAGE}#jsonld[1]/offers/price`);
  });
});

describe('extractJsonLd: locators and raw text', () => {
  it('gives exact JSON pointers for three different shapes', () => {
    const html = page(
      {
        '@type': 'Product',
        name: 'Tee',
        offers: [
          { sku: 'A', price: '1', priceCurrency: 'USD' },
          { sku: 'B', price: '2', priceCurrency: 'USD' },
        ],
      },
      {
        '@graph': [
          { '@type': 'WebPage' },
          { '@type': 'WebPage' },
          { '@type': 'Product', name: 'Tee', offers: [{ availability: 'InStock' }] },
        ],
      },
      {
        '@type': 'ProductGroup',
        name: 'Tee',
        hasVariant: [
          { '@type': 'Product', sku: 'C', offers: { price: '3', priceCurrency: 'USD' } },
          { '@type': 'Product', sku: 'D', offers: { price: '4', priceCurrency: 'USD' } },
        ],
      },
    );
    const { sightings } = run(html);
    const locators = sightings.flatMap((s) => [s.price?.locator, s.availability?.locator]).filter(Boolean);
    assert.ok(locators.includes(`${PAGE}#jsonld[0]/offers/1/price`));
    assert.ok(locators.includes(`${PAGE}#jsonld[1]/@graph/2/offers/0/availability`));
    assert.ok(locators.includes(`${PAGE}#jsonld[2]/hasVariant/1/offers/price`));
  });

  it('keeps the source text in raw, unmodified', () => {
    const { sightings } = run(
      page({ '@type': 'Product', name: 'Tee', offers: { price: '$39.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } }),
    );
    assert.equal(sightings[0]!.price?.raw, '$39.00');
    assert.equal(sightings[0]!.availability?.raw, 'https://schema.org/InStock');
  });
});

describe('identifiers when a product has several offers', () => {
  it('a product-level SKU is not handed to each of several offers', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Tee',
    sku: 'PARENT',
    gtin13: '4006381333931',
    offers: [
      { '@type': 'Offer', price: '19.00', priceCurrency: 'USD', url: 'https://shop.example/products/tee?variant=111' },
      { '@type': 'Offer', price: '29.00', priceCurrency: 'USD', url: 'https://shop.example/products/tee?variant=222' },
    ],
  })}</script>`;
  const { sightings } = extractJsonLd(html, 'https://shop.example/products/tee', '2026-10-09T00:00:00.000Z');
  assert.equal(sightings.length, 2);
  assert.deepEqual(sightings.map((s) => s.ids.sku), [undefined, undefined]);
  assert.deepEqual(sightings.map((s) => s.ids.gtin), [undefined, undefined]);
  assert.deepEqual(sightings.map((s) => s.ids.aliases), [['111'], ['222']]);
  assert.deepEqual(sightings.map((s) => s.scope), ['variant', 'variant']);
});

  it('a product-level SKU still applies when there is exactly one offer', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Mug',
    sku: 'MUG-WHT',
    offers: { '@type': 'Offer', price: '16.00', priceCurrency: 'USD' },
  })}</script>`;
  const { sightings } = extractJsonLd(html, 'https://shop.example/product/mug/', '2026-10-09T00:00:00.000Z');
  assert.equal(sightings[0]!.ids.sku, 'MUG-WHT');
});

  it('WooCommerce attribute parameters in an offer URL become options', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'Beanie',
    offers: [{ '@type': 'Offer', sku: 'BEANIE-NVY', price: '28.00', priceCurrency: 'USD', url: 'https://shop.example/product/beanie/?attribute_pa_color=navy' }],
  })}</script>`;
  const { sightings } = extractJsonLd(html, 'https://shop.example/product/beanie/', '2026-10-09T00:00:00.000Z');
  assert.deepEqual(sightings[0]!.ids.options, { attribute_pa_color: 'navy' });
  assert.equal(sightings[0]!.ids.aliases, undefined);
});
});

describe('extractJsonLd: products that are not the page’s own', () => {
  it('leaves out a list of related products and the products a Product points to', () => {
    const own = { '@type': 'Product', name: 'Linen Tee', sku: 'TEE', offers: { '@type': 'Offer', price: '39.00', priceCurrency: 'USD' } };
    const related = {
      '@type': 'ItemList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: { '@type': 'Product', name: 'Mug', offers: { '@type': 'Offer', price: '16.00', priceCurrency: 'USD' } } },
      ],
    };
    const pointing = { ...own, isRelatedTo: { '@type': 'Product', name: 'Cap', offers: { '@type': 'Offer', price: '22.00', priceCurrency: 'USD' } } };
    const { sightings } = run(page(related, pointing));
    assert.deepEqual(sightings.map((s) => s.price?.raw), ['39.00']);
  });
});
