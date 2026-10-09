// The rule catalogue, in the order reports list it. docs/rules.md defines
// what each one means.

import type { Rule } from '@regmark/core';
import hiddenText from './content/hidden-text.ts';
import instructionLike from './content/instruction-like.ts';
import invisibleChars from './content/invisible-chars.ts';
import availabilityMismatch from './parity/availability-mismatch.ts';
import identityGtinInvalid from './parity/identity-gtin-invalid.ts';
import identityUnmatched from './parity/identity-unmatched.ts';
import policyReturnMissing from './parity/policy-return-missing.ts';
import priceCurrencyAmbiguous from './parity/price-currency-ambiguous.ts';
import priceMismatch from './parity/price-mismatch.ts';
import priceSaleExpired from './parity/price-sale-expired.ts';
import priceTaxBasis from './parity/price-tax-basis.ts';
import shippingMismatch from './parity/shipping-mismatch.ts';
import shippingUndisclosed from './parity/shipping-undisclosed.ts';
import variantMissing from './parity/variant-missing.ts';
import variantUnpurchasable from './parity/variant-unpurchasable.ts';

export const parityRules: readonly Rule[] = [
  priceMismatch,
  priceCurrencyAmbiguous,
  priceTaxBasis,
  priceSaleExpired,
  availabilityMismatch,
  variantMissing,
  variantUnpurchasable,
  shippingMismatch,
  shippingUndisclosed,
  identityUnmatched,
  identityGtinInvalid,
  policyReturnMissing,
];

export const contentRules: readonly Rule[] = [hiddenText, instructionLike, invisibleChars];

export const allRules: readonly Rule[] = [...parityRules, ...contentRules];
