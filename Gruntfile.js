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
            dist: {
                files: {
                    'build/tgut-temp/src/': 'build/tgut-temp/src/*',
                    'build/tgut-temp/src/js/': 'build/tgut-temp/src/js/*',
                },
                options: {
                    replacements: [{
                        pattern: /The Great Suspender/ig,
                        replacement: 'The Great Update Tester'
                    }]
                }
            }
        },
        crx: {
            public: {
                src: [
                    "src/**/*",
                    "!**/html2canvas.js",
                    "!**/Thumbs.db"
                ],
                dest: "build/<%= pkg.name %>-<%= manifest.version %>-dev.zip",
            },
            private: {
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
            tgut: {
                src: [
                    "build/tgut-temp/src/**/*",
                    "!**/html2canvas.js",
                    "!**/Thumbs.db"
                ],
                dest: "build/tgut-<%= manifest.version %>-dev.zip"
            }
        },
        clean: ['build/tgut-temp/']
    });

    grunt.loadNpmTasks('grunt-contrib-copy');
    grunt.loadNpmTasks('grunt-string-replace');
    grunt.loadNpmTasks('grunt-crx');
    grunt.loadNpmTasks('grunt-contrib-clean');
    grunt.registerTask('default', ['crx:public', 'crx:private']);
    grunt.registerTask('tgut', ['copy', 'string-replace', 'crx:tgut', 'clean']);
};

