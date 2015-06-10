module.exports = function(grunt) {

    require('time-grunt')(grunt);

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        manifest: grunt.file.readJSON('src/manifest.json'),
        crx: {
            dev: {
                src: [
                    "src/**/*",
                    "!**/html2canvas.js",
                    "!**/Thumbs.db"
                ],
                dest: "build/crx/<%= pkg.name %>-<%= manifest.version %>-dev.crx",
                zipDest: "build/zip/<%= pkg.name %>-<%= manifest.version %>-dev.zip",
                options: {
                    "privateKey": "key.pem"
                }
            }
        }
    });

    grunt.loadNpmTasks('grunt-crx');
    grunt.registerTask('default', ['crx']);
};

