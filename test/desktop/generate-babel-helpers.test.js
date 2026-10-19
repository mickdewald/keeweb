const assert = require('assert');
const test = require('node:test');
const vm = require('vm');

const { generateHelpersSource } = require('../../scripts/generate-babel-helpers');

test('generates the Babel external helper API with transitive dependencies', () => {
    const source = generateHelpersSource();
    assert.strictEqual(generateHelpersSource(), source);

    const sandbox = { self: {} };
    vm.runInNewContext(source, sandbox);

    const helpers = sandbox.self.babelHelpers;
    const [first, second] = helpers.slicedToArray(new Set(['first', 'second']), 2);

    assert.strictEqual(first, 'first');
    assert.strictEqual(second, 'second');
    assert.deepStrictEqual(Array.from(helpers.toConsumableArray(new Set([1, 2]))), [1, 2]);
    assert.strictEqual(helpers.defineProperty({}, 'answer', 42).answer, 42);
    assert.strictEqual(helpers.typeof(Symbol.iterator), 'symbol');
});
