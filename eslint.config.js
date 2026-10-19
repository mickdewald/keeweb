const babelParser = require('@babel/eslint-parser');
const espree = require('espree');
const babelPlugin = require('@babel/eslint-plugin').default;
const globals = require('globals');
const importPlugin = require('eslint-plugin-import-x');
const nPlugin = require('eslint-plugin-n');
const prettierPlugin = require('eslint-plugin-prettier');
const promisePlugin = require('eslint-plugin-promise');

const baseRules = {
    'import-x/no-commonjs': ['error'],
    'semi': ['error', 'always'],
    'camelcase': [
        'error',
        {
            'properties': 'always',
            'ignoreDestructuring': false,
            'ignoreImports': false,
            'ignoreGlobals': false
        }
    ],
    'no-console': ['error'],
    'no-alert': ['error'],
    'no-debugger': ['error'],
    'prefer-arrow-callback': ['error'],
    'no-var': ['error'],
    'prefer-const': ['error', { 'destructuring': 'all', 'ignoreReadBeforeAssign': false }],
    'strict': ['error', 'never'],
    'no-new-object': ['error'],
    'object-shorthand': ['error'],
    'no-array-constructor': ['error'],
    'array-callback-return': ['error', { 'allowImplicit': false, 'checkForEach': false }],
    'no-eval': ['error'],
    'no-implied-eval': ['error'],
    'no-new-func': ['error'],
    'prefer-rest-params': ['error'],
    'prefer-spread': ['error'],
    'no-useless-constructor': ['error'],
    'no-dupe-class-members': ['error'],
    'no-duplicate-imports': ['error'],
    'eqeqeq': ['error', 'always', { 'null': 'ignore' }],
    'no-unneeded-ternary': ['error', { 'defaultAssignment': false }],
    'curly': ['error', 'multi-line'],
    'prettier/prettier': ['error'],
    'no-restricted-syntax': [
        'error',
        { 'selector': 'ExportDefaultDeclaration', 'message': 'Prefer named exports' }
    ],
    'import-x/no-relative-parent-imports': ['error'],
    'import-x/first': ['error'],
    'import-x/no-default-export': ['error'],
    'babel/no-unused-expressions': ['error'],
    'constructor-super': ['error'],
    'for-direction': ['error'],
    'getter-return': ['error'],
    'no-async-promise-executor': ['error'],
    'no-case-declarations': ['error'],
    'no-class-assign': ['error'],
    'no-compare-neg-zero': ['error'],
    'no-cond-assign': ['error'],
    'no-const-assign': ['error'],
    'no-constant-condition': ['error', { 'checkLoops': false }],
    'no-control-regex': ['error'],
    'no-delete-var': ['error'],
    'no-dupe-args': ['error'],
    'no-dupe-else-if': ['error'],
    'no-dupe-keys': ['error'],
    'no-duplicate-case': ['error'],
    'no-empty-character-class': ['error'],
    'no-empty-pattern': ['error'],
    'no-ex-assign': ['error'],
    'no-extra-boolean-cast': ['error'],
    'no-fallthrough': ['error'],
    'no-func-assign': ['error'],
    'no-global-assign': ['error'],
    'no-import-assign': ['error'],
    'no-inner-declarations': ['error'],
    'no-invalid-regexp': ['error'],
    'no-irregular-whitespace': ['error'],
    'no-misleading-character-class': ['error'],
    'no-new-symbol': ['error'],
    'no-obj-calls': ['error'],
    'no-octal': ['error'],
    'no-prototype-builtins': ['error'],
    'no-redeclare': ['error', { 'builtinGlobals': false }],
    'no-regex-spaces': ['error'],
    'no-self-assign': ['error', { 'props': true }],
    'no-setter-return': ['error'],
    'no-shadow-restricted-names': ['error'],
    'no-sparse-arrays': ['error'],
    'no-this-before-super': ['error'],
    'no-undef': ['error'],
    'no-unreachable': ['error'],
    'no-unsafe-finally': ['error'],
    'no-unsafe-negation': ['error'],
    'no-unused-labels': ['error'],
    'no-unused-vars': [
        'error',
        { 'args': 'none', 'caughtErrors': 'none', 'ignoreRestSiblings': true, 'vars': 'all' }
    ],
    'no-useless-catch': ['error'],
    'no-with': ['error'],
    'require-yield': ['error'],
    'use-isnan': ['error', { 'enforceForSwitchCase': true, 'enforceForIndexOf': true }],
    'valid-typeof': ['error', { 'requireStringLiterals': true }],
    'accessor-pairs': [
        'error',
        { 'setWithoutGet': true, 'enforceForClassMembers': true, 'getWithoutSet': false }
    ],
    'default-case-last': ['error'],
    'dot-notation': ['error', { 'allowKeywords': true, 'allowPattern': '' }],
    'lines-between-class-members': ['error', 'always', { 'exceptAfterSingleLine': true }],
    'new-cap': ['error', { 'newIsCap': true, 'capIsNew': false, 'properties': true }],
    'no-caller': ['error'],
    'no-useless-backreference': ['error'],
    'no-extend-native': ['error'],
    'no-extra-bind': ['error'],
    'no-iterator': ['error'],
    'no-labels': ['error', { 'allowLoop': false, 'allowSwitch': false }],
    'no-lone-blocks': ['error'],
    'no-loss-of-precision': ['error'],
    'no-multi-str': ['error'],
    'no-new': ['error'],
    'no-new-wrappers': ['error'],
    'no-octal-escape': ['error'],
    'no-proto': ['error'],
    'no-return-assign': ['error', 'except-parens'],
    'no-self-compare': ['error'],
    'no-sequences': ['error'],
    'no-template-curly-in-string': ['error'],
    'no-undef-init': ['error'],
    'no-unmodified-loop-condition': ['error'],
    'no-unreachable-loop': ['error'],
    'no-use-before-define': ['error', { 'functions': false, 'classes': false, 'variables': false }],
    'no-useless-call': ['error'],
    'no-useless-computed-key': ['error'],
    'no-useless-rename': ['error'],
    'no-useless-return': ['error'],
    'no-void': ['error'],
    'prefer-regex-literals': ['error', { 'disallowRedundantWrapping': true }],
    'spaced-comment': [
        'error',
        'always',
        {
            'line': { 'markers': ['*package', '!', '/', ',', '='] },
            'block': {
                'balanced': true,
                'markers': ['*package', '!', ',', ':', '::', 'flow-include'],
                'exceptions': ['*']
            }
        }
    ],
    'symbol-description': ['error'],
    'yoda': ['error', 'never'],
    'import-x/export': ['error'],
    'import-x/no-absolute-path': ['error', { 'esmodule': true, 'commonjs': true, 'amd': false }],
    'import-x/no-duplicates': ['error'],
    'import-x/no-named-default': ['error'],
    'n/handle-callback-err': ['error', '^(err|error)$'],
    'n/no-callback-literal': ['error'],
    'n/no-deprecated-api': ['error'],
    'n/no-exports-assign': ['error'],
    'n/no-new-require': ['error'],
    'n/no-path-concat': ['error'],
    'n/process-exit-as-throw': ['error'],
    'promise/param-names': ['error']
};
const baseGlobals = { ...globals.node, ...globals.browser, _: 'writable', $: 'writable' };
const installerDisabledGlobals = Object.fromEntries(
    Object.keys(baseGlobals).map((name) => [name, 'off'])
);

module.exports = [
    { ignores: ['node_modules/**', 'dist/**', 'tmp/**'] },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parser: babelParser,
            parserOptions: {
                requireConfigFile: false,
                ecmaFeatures: { globalReturn: true, impliedStrict: true, jsx: true }
            },
            globals: baseGlobals
        },
        plugins: {
            babel: babelPlugin,
            'import-x': importPlugin,
            n: nPlugin,
            prettier: prettierPlugin,
            promise: promisePlugin
        },
        rules: { ...baseRules, 'n/no-callback-literal': 'off' }
    },
    {
        files: ['desktop/**/*.js'],
        rules: { 'import-x/no-commonjs': 'off' }
    },
    { files: ['desktop/main.js'], languageOptions: { sourceType: 'script' } },
    {
        files: ['Gruntfile.js', 'grunt*.js', 'grunt/**/*.js', 'build/**/*.js', 'webpack.config.js'],
        rules: { 'import-x/no-commonjs': 'off' }
    },
    {
        files: ['plugins/**/*.js', 'util/**/*.js'],
        rules: { 'import-x/no-commonjs': 'off' }
    },
    { files: ['test/**/*.js'], languageOptions: { globals: globals.mocha } },
    {
        files: ['package/osx/installer.js'],
        languageOptions: {
            ecmaVersion: 5,
            sourceType: 'script',
            parser: espree,
            parserOptions: {
                ecmaFeatures: { globalReturn: false, impliedStrict: false, jsx: false }
            },
            globals: { ...installerDisabledGlobals, ...globals.applescript }
        },
        rules: {
            ...Object.fromEntries(Object.keys(baseRules).map((name) => [name, 'off'])),
            'no-console': 'off',
            'no-unused-vars': 'error',
            'no-undef': 'error'
        }
    }
];
