const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextProp, SMALL, MEDIUM } = require('../src/main/services/prop-service.cjs');

test('Props: +10 first until 95; +30 only at 85 or below once the +10s are gone', () => {
  assert.equal(nextProp(95, { [SMALL]: 5, [MEDIUM]: 5 }), null);
  assert.equal(nextProp(94, { [SMALL]: 5, [MEDIUM]: 5 }), SMALL, '94 still gets a +10 (waste is fine)');
  assert.equal(nextProp(60, { [SMALL]: 5, [MEDIUM]: 5 }), SMALL, '+10 has priority');
  assert.equal(nextProp(85, { [SMALL]: 0, [MEDIUM]: 5 }), MEDIUM);
  assert.equal(nextProp(86, { [SMALL]: 0, [MEDIUM]: 5 }), null, 'no +30 above 85');
  assert.equal(nextProp(50, { [SMALL]: 0, [MEDIUM]: 0 }), null);
});
