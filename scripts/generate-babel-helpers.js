const fs = require('fs');
const path = require('path');

const generator = require('@babel/generator').default;
const helpers = require('@babel/helpers');
const t = require('@babel/types');

const helperNames = ['slicedToArray', 'toConsumableArray', 'defineProperty', 'typeof'];

function helperReference(name) {
    return t.memberExpression(t.identifier('babelHelpers'), t.identifier(name));
}

function generateHelper(name, generatedHelpers) {
    if (generatedHelpers.has(name)) {
        return [];
    }
    generatedHelpers.add(name);

    const dependencies = helpers.getDependencies(name);
    const nodes = dependencies.flatMap((dependency) => generateHelper(dependency, generatedHelpers));
    const helper = helpers.get(name, helperReference, `_${name}`);

    return nodes.concat(helper.nodes);
}

function generateHelpersSource() {
    const generatedHelpers = new Set();
    const nodes = helperNames.flatMap((name) => generateHelper(name, generatedHelpers));
    const source = nodes.map((node) => generator(node).code).join('\n\n');
    const assignments = Array.from(generatedHelpers)
        .map((name) => `babelHelpers.${name} = _${name};`)
        .join('\n');

    return [
        '(function (global) {',
        '  var babelHelpers = global.babelHelpers = {};',
        source,
        assignments,
        "})(typeof global === 'undefined' ? self : global);",
        ''
    ].join('\n');
}

function main() {
    const outputPath = process.argv[2];
    if (!outputPath) {
        throw new Error('Usage: generate-babel-helpers <output-path>');
    }

    fs.writeFileSync(path.resolve(outputPath), generateHelpersSource());
}

if (require.main === module) {
    main();
}

module.exports = { generateHelpersSource };
