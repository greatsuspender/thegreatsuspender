module.exports = function(grunt) {

    require('time-grunt')(grunt);

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        manifest: grunt.file.readJSON('src/manifest.json'),
        copy: {
            main: {
                expand: true,
                src: 'src/**',
                dest: 'build/tgut-temp/',
            },
        },
        'string-replace': {
            locales: {
                files: {
                    'build/tgut-temp/src/_locales/': 'build/tgut-temp/src/_locales/**',
                },
                options: {
                    replacements: [{
                        pattern: /The Great Suspender/ig,
                        replacement: 'The Great Update Tester'
                    }]
                }
            },
            notice: {
                files: {
                    'build/tgut-temp/src/js/': 'build/tgut-temp/src/js/background.js',
                },
                options: {
                    replacements: [{
                        pattern: /greatsuspender\.github\.io\/notice\.json/,
                        replacement: 'greatsuspender.github.io/notice-tgut.json'
                    }]
                }
            }
        },
        crx: {
            tgsPublic: {
                src: [
                    "src/**/*",
                    "!**/html2canvas.js",
                    "!**/Thumbs.db"
                ],
                dest: "build/<%= pkg.name %>-<%= manifest.version %>-dev.zip",
            },
            tgsPrivate: {
                src: [
                    "src/**/*",
                    "!**/html2canvas.js",
                    "!**/Thumbs.db"
                ],
                dest: "build/<%= pkg.name %>-<%= manifest.version %>-dev.crx",
                options: {
                    "privateKey": "key.pem"
                }
            },
            tgutPublic: {
                src: [
                    "build/tgut-temp/src/**/*",
                    "!**/html2canvas.js",
                    "!**/Thumbs.db"
                ],
                dest: "build/tgut-<%= manifest.version %>-dev.zip"
            },
            tgutPrivate: {
                src: [
                    "build/tgut-temp/src/**/*",
                    "!**/html2canvas.js",
                    "!**/Thumbs.db"
                ],
                dest: "build/tgut-<%= manifest.version %>-dev.crx",
                options: {
                    "privateKey": "key.pem"
                }
            }
        },
        clean: ['build/tgut-temp/']
    });

    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-string-replace');
    grunt.loadNpmTasks('grunt-crx');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.registerTask('default', ['crx:tgsPublic', 'crx:tgsPrivate']);
    grunt.registerTask('tgut', ['copy', 'string-replace:locales', 'string-replace:notice', 'crx:tgutPublic', 'crx:tgutPrivate', 'clean']);
};

