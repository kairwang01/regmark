import { defineRule } from '@regmark/core';
import type { Observation, ReturnPolicy } from '@regmark/core';
import { isReal } from './real.ts';

const states = (o: Observation<ReturnPolicy>): boolean => o.value.present === true;

export default defineRule({
  id: 'policy.return-missing',
  severity: 'info',
  summary: 'No surface gives a return policy for the product in a form a machine can read.',
  needsAny: ['platform', 'checkout'],
  check(product) {
    if (!product.variants.some(isReal)) return [];
    const stated =
      product.variants.some((v) => v.returnPolicy.some(states)) ||
      product.productLevel.some((s) => s.returnPolicy !== undefined && states(s.returnPolicy));
    if (stated) return [];
    return [
      {
        rule: 'policy.return-missing',
        severity: 'info',
        message: 'no surface gives a return policy a machine can read',
        product: product.key,
      },
    ];
  },
});
