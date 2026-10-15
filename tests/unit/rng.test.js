import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashSeed, normalizeSeed } from '../../src/core/rng.js';

test('same seed produces the same stream', () => {
  const a = createRng(1234);
  const b = createRng(1234);
  const left = Array.from({ length: 32 }, () => a.next());
  const right = Array.from({ length: 32 }, () => b.next());
  assert.deepEqual(left, right);
});

test('different seeds diverge', () => {
  const a = createRng(1234);
  const b = createRng(1235);
  const left = Array.from({ length: 16 }, () => a.next());
  const right = Array.from({ length: 16 }, () => b.next());
  assert.notDeepEqual(left, right);
});

test('values stay in range', () => {
  const rng = createRng(99);
  for (let i = 0; i < 2000; i++) {
    const value = rng.next();
    assert.ok(value >= 0 && value < 1, `next() out of range: ${value}`);
    const ranged = rng.range(-5, 5);
    assert.ok(ranged >= -5 && ranged < 5, `range() out of range: ${ranged}`);
    const int = rng.int(0, 3);
    assert.ok(Number.isInteger(int) && int >= 0 && int <= 3, `int() out of range: ${int}`);
  }
});

test('word seeds hash deterministically and stay in uint32', () => {
  assert.equal(hashSeed('emberdark'), hashSeed('emberdark'));
  assert.notEqual(hashSeed('emberdark'), hashSeed('emberdark '));
  for (const word of ['emberdark', 'roshar', '', '42', 'ünicode']) {
    const hashed = hashSeed(word);
    assert.ok(hashed >= 0 && hashed <= 0xffffffff, `${word} -> ${hashed}`);
  }
});

test('normalizeSeed accepts numbers, numeric strings, words and junk', () => {
  assert.equal(normalizeSeed(42), 42);
  assert.equal(normalizeSeed('42'), 42);
  assert.equal(normalizeSeed('-42'), 42);
  assert.equal(normalizeSeed(2.9), 2);
  assert.equal(normalizeSeed('emberdark'), hashSeed('emberdark'));
  assert.equal(normalizeSeed(undefined), hashSeed(0));
  assert.equal(normalizeSeed(Number.NaN), hashSeed('NaN'));
});

test('getState reflects consumed randomness', () => {
  const rng = createRng(7);
  const before = rng.getState();
  rng.next();
  assert.notEqual(rng.getState(), before);
});
