/* eslint-env node */

const fs = require('fs-extra');
const path = require('path');

module.exports = function ({ pkg, dt, rootDir, webpackConfig, webpackConfigTest, webpackOptions }) {
    return {
        eslint: {
            app: ['app/scripts/**/*.js'],
            desktop: ['desktop/**/*.js', '!desktop/node_modules/**'],
            build: [
                'Gruntfile.js',
                'grunt.*.js',
                'grunt/**/*.js',
                'build/**/*.js',
                'webpack.config.js'
            ],
            plugins: ['plugins/**/*.js'],
            util: ['util/**/*.js'],
            installer: ['package/osx/installer.js']
        },
        inline: {
            app: {
                src: 'tmp/index.html',
                dest: 'tmp/app.html'
            }
        },
        'csp-hashes': {
            options: {
                algo: 'sha512',
                expected: {
                    style: 1,
                    script: 1
                }
            },
            app: {
                src: 'tmp/app.html',
                dest: 'dist/index.html'
            }
        },
        htmlmin: {
            options: {
                removeComments: true,
                collapseWhitespace: true
            },
            app: {
                files: {
                    'tmp/app.html': 'tmp/app.html'
                }
            }
        },
        'string-replace': {
            'update-manifest': {
                options: {
                    replacements: [
                        {
                            pattern: /"version":\s*".*?"/,
                            replacement: `"version": "${pkg.version}"`
                        },
                        {
                            pattern: /"date":\s*".*?"/,
                            replacement: `"date": "${dt}"`
                        }
                    ]
                },
                files: { 'dist/update.json': 'app/update.json' }
            },
            'service-worker': {
                options: { replacements: [{ pattern: '0.0.0', replacement: pkg.version }] },
                files: { 'dist/service-worker.js': 'app/service-worker.js' }
            },
            'desktop-public-key': {
                options: {
                    replacements: [
                        {
                            pattern: "'@@PUBLIC_KEY_CONTENT'",
                            replacement:
                                '`' +
                                fs
                                    .readFileSync('app/resources/public-key.pem', {
                                        encoding: 'utf8'
                                    })
                                    .trim() +
                                '`'
                        }
                    ]
                },
                files: { 'tmp/desktop/app/main.js': 'desktop/main.js' }
            }
        },
        webpack: {
            app: webpackConfig.config(webpackOptions),
            test: webpackConfigTest
        },
        'webpack-dev-server': {
            options: {
                webpack: webpackConfig.config({
                    ...webpackOptions,
                    mode: 'development',
                    sha: 'dev'
                }),
                publicPath: '/',
                contentBase: [path.resolve(rootDir, 'tmp'), path.resolve(rootDir, 'app/content')],
                progress: false
            },
            js: {
                keepalive: true,
                port: 8085
            }
        }
    };
};
