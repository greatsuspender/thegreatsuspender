/* global chrome, XMLHttpRequest */
(function () {
    'use strict';

    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

    gsUtils.documentReadyAsPromsied(document).then(function () {

        var versionEl = document.getElementById('updatedVersion');
        versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;
    });
}());
