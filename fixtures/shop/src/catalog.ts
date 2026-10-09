// What is true about the fixture shop.
//
// Both shops, the clean one and the misprinted one, sell this catalogue at
// these prices. Everything else in this package is a way of saying it, and
// the misprinted shop says some of it wrong.
//
// This file deliberately imports nothing from the tool under test: a
// yardstick that leans on the thing it measures proves little.

export const CURRENCY = 'USD';

/** Flat rate to the US, free once the cart reaches `freeFrom`. */
export const SHIPPING = { country: 'US', flat: '6.20', freeFrom: '100.00' } as const;

export const RETURN_DAYS = 30;

/** Served at /.well-known/regmark.txt so the checkout probe can be exercised. */
export const OWNERSHIP_TOKEN = 'fixture_0123456789abcdef';

/** How long a running sale still has to go, in days, counted from the shop's clock. */
export const SALE_DAYS_LEFT = 60;

export type TruthVariant = {
  sku: string;
  gtin: string;
  mpn: string;
  options: Record<string, string>;
  /** What the checkout charges for one unit. */
  price: string;
  /** The regular price, set only while the product is on sale. */
  listPrice: string | null;
  inStock: boolean;
  /** The backend id of this variant. For a simple product it equals the product id. */
  wooId: number;
};

export type TruthProduct = {
  slug: string;
  title: string;
  brand: string;
  wooId: number;
  /**
   * How the page writes its JSON-LD. Real shops use all three, so the page
   * collector has to cope with all three:
   *   single  one Product with one Offer
   *   offers  one Product with an array of Offers
   *   group   a ProductGroup with hasVariant
   */
  jsonldShape: 'single' | 'offers' | 'group';
  description: string;
  reviews: string[];
  variants: TruthVariant[];
};

/** A GTIN-13 from its first twelve digits. */
function gtin13(base: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + String((10 - (sum % 10)) % 10);
}

type VariantSeed = { sku: string; options?: Record<string, string>; inStock?: boolean };

function product(
  wooId: number,
  slug: string,
  title: string,
  jsonldShape: TruthProduct['jsonldShape'],
  price: string,
  listPrice: string | null,
  description: string,
  reviews: string[],
  seeds: VariantSeed[],
): TruthProduct {
  const simple = seeds.length === 1 && !seeds[0]!.options;
  return {
    slug,
    title,
    brand: 'Northfold',
    wooId,
    jsonldShape,
    description,
    reviews,
    variants: seeds.map((seed, i) => {
      const id = simple ? wooId : wooId + i + 1;
      return {
        sku: seed.sku,
        gtin: gtin13(`40063810${String(id).padStart(4, '0')}`),
        mpn: `NF-${seed.sku}`,
        options: seed.options ?? {},
        price,
        listPrice,
        inStock: seed.inStock ?? true,
        wooId: id,
      };
    }),
  };
}

export const CATALOG: readonly TruthProduct[] = [
  product(100, 'classic-tee', 'Classic Tee', 'group', '39.00', '45.00', 'A midweight cotton tee, cut straight and washed once before it ships.', ['Fits as described. I bought two.'], [
    { sku: 'TEE-BLU-S', options: { Size: 'S' } },
    { sku: 'TEE-BLU-M', options: { Size: 'M' } },
    { sku: 'TEE-BLU-L', options: { Size: 'L' } },
  ]),
  product(200, 'canvas-tote', 'Canvas Tote', 'single', '24.00', null, 'Heavy natural canvas with a flat base. Holds a week of groceries.', ['Sturdier than it looks in the photos.'], [{ sku: 'TOTE-NAT' }]),
  product(300, 'wool-beanie', 'Wool Beanie', 'offers', '28.00', null, 'Ribbed merino, one size. Warm without being bulky.', ['Kept its shape after a winter of daily wear.'], [
    { sku: 'BEANIE-GRY', options: { Color: 'Grey' } },
    { sku: 'BEANIE-NVY', options: { Color: 'Navy' }, inStock: false },
  ]),
  product(400, 'trail-socks', 'Trail Socks, 3 Pack', 'group', '12.00', null, 'Cushioned crew socks for long days on foot.', ['No blisters on a three day hike.'], [
    { sku: 'SOCK-S', options: { Size: 'S' } },
    { sku: 'SOCK-M', options: { Size: 'M' } },
    { sku: 'SOCK-L', options: { Size: 'L' }, inStock: false },
  ]),
  product(500, 'enamel-mug', 'Enamel Mug', 'single', '16.00', null, 'White enamel over steel, 350 ml. Fine on a camp stove.', ['Chipped once and still going.'], [{ sku: 'MUG-WHT' }]),
  product(600, 'field-cap', 'Field Cap', 'offers', '22.00', null, 'Six panel cotton cap with an adjustable strap.', ['Good cap, true to colour.'], [
    { sku: 'CAP-RED', options: { Color: 'Red' } },
    { sku: 'CAP-BLK', options: { Color: 'Black' } },
  ]),
  product(700, 'rain-shell', 'Rain Shell', 'group', '129.00', '159.00', 'A packable three layer shell with taped seams.', ['Dry through an afternoon of steady rain.'], [
    { sku: 'SHELL-M', options: { Size: 'M' } },
    { sku: 'SHELL-L', options: { Size: 'L' } },
  ]),
  product(800, 'desk-lamp', 'Brass Desk Lamp', 'single', '89.00', null, 'Solid brass arm and shade, with a fabric cord.', ['Heavier than expected, in a good way.'], [{ sku: 'LAMP-BRS' }]),
  product(900, 'leather-belt', 'Leather Belt', 'group', '48.00', null, 'Vegetable tanned leather, 32 mm wide, solid buckle.', ['Has darkened nicely over a year.'], [
    { sku: 'BELT-32', options: { Size: '32' } },
    { sku: 'BELT-34', options: { Size: '34' } },
    { sku: 'BELT-36', options: { Size: '36' } },
  ]),
  product(1000, 'linen-apron', 'Linen Apron', 'single', '34.00', null, 'Washed linen with crossed straps and two pockets.', ['Soft from the first wash.'], [{ sku: 'APRON-OAT' }]),
];
