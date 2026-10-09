import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sample } from '../src/audit.ts';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

test('returns every item, in order, when there are no more than n', () => {
  assert.deepEqual(sample(['a', 'b', 'c'], 3, 1), ['a', 'b', 'c']);
  assert.deepEqual(sample(['a', 'b'], 5, 1), ['a', 'b']);
  assert.deepEqual(sample([], 5, 1), []);
});

test('returns exactly n distinct items, in their original relative order', () => {
  const items = range(100);
  for (const seed of [1, 2, 3, 42, 2026]) {
    const picked = sample(items, 10, seed);
    assert.equal(picked.length, 10);
    assert.equal(new Set(picked).size, 10, 'no item twice');
    assert.deepEqual(picked, [...picked].sort((a, b) => a - b), `seed ${seed} keeps the original order`);
    assert.ok(picked.every((i) => items.includes(i)));
  }
});

test('the same seed gives the same sample', () => {
  const items = range(100);
  assert.deepEqual(sample(items, 10, 7), sample(items, 10, 7));
});

test('two different seeds give different samples of a 100-item list (seeds 1 and 2)', () => {
  // Checked for seeds 1 and 2 with n = 10: the samples differ.
  assert.notDeepEqual(sample(range(100), 10, 1), sample(range(100), 10, 2));
});

test('does not mutate its input', () => {
  const items = ['x', 'y', 'z', 'w', 'v'];
  const copy = [...items];
  sample(items, 2, 9);
  sample(items, 10, 9);
  assert.deepEqual(items, copy);
});

test('over many seeds every item of a 10-item list is picked at least once when n is 3', () => {
  const items = range(10);
  const seen = new Set<number>();
  for (let seed = 1; seed <= 200; seed++) {
    for (const i of sample(items, 3, seed)) seen.add(i);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
});
