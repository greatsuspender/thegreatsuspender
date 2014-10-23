var gulp = require('gulp');
var jslint = require('gulp-jslint');

gulp.task('jslint', function () {
    gulp.src(['**/*.js'])
        .pipe(jslint({
            browser: true,
            plusplus: false,
            sloppy: false,
            todo: true,

            errorsOnly: true
        }))
        .on('error', function (err) {
            console.error(String(err));
        })
});

gulp.task('default', ['jslint']);
