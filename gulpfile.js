var gulp = require('gulp');
var jslint = require('gulp-jslint');

gulp.task('jslint', function () {
    gulp.src(['background.js', 'contentscript.js', 'gsUtils.js', 'history.js',
             'options.js', 'popup.js', 'previewscript.js', 'profiler.js',
             'suspended.js'])
        .pipe(jslint({
            browser: true,
            todo: true,
            devel: true,

            errorsOnly: true
        }))
        .on('error', function (err) {
            console.error(String(err));
        })
});

gulp.task('default', ['jslint']);
