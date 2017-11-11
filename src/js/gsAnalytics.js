/*global ga, gsStorage */

var gsAnalytics = (function () { // eslint-disable-line no-unused-vars
    'use strict';

    function reportPageView(pageName) {
        ga('send', 'pageview', pageName);
    }
    function reportEvent(category, action, value) {
        ga('send', 'event', category, action, value);
    }
    function updateDimensions() {
        ga('set', 'dimension1', chrome.runtime.getManifest().version + '');
        ga('set', 'dimension2', gsStorage.getOption(gsStorage.SCREEN_CAPTURE) + '');
        ga('set', 'dimension3', gsStorage.getOption(gsStorage.SUSPEND_TIME) + '');
        ga('set', 'dimension4', gsStorage.getOption(gsStorage.NO_NAG) + '');
        ga('set', 'dimension5', gsStorage.fetchNoticeVersion() + '');
    }

    return {
        reportPageView: reportPageView,
        reportEvent: reportEvent,
        updateDimensions: updateDimensions,
    };
}());

(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
    (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
    m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
})(window,document,'script','https://www.google-analytics.com/analytics.js','ga');

ga('create', 'UA-52338347-1', 'auto');
ga('set', 'checkProtocolTask', function (){});
ga('require', 'displayfeatures');

gsAnalytics.updateDimensions();
gsAnalytics.reportPageView('background.html');
