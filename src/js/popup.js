/*global chrome */
(function () {
    'use strict';

    var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
    var tgs = chrome.extension.getBackgroundPage().tgs;
    var globalActionElListener;

    var retries = 0;
    var getTabStatus = function (callback) {
        tgs.requestTabInfo(false, function (info) {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError.message);
            }
            if (info && info.status !== 'unknown') {
                callback(info.status);
            } else if (retries < (5 * 10)) { //10 seconds
                if (retries === 0 && document.getElementById('loadBar')) {
                    document.getElementById('loadBar').style.display = 'block';
                }
                retries++;
                setTimeout(function () {
                    getTabStatus(callback);
                }, 200);
            } else {
                window.close();
            }
        });
    };
    var tabStatusAsPromised = new Promise(function (resolve, reject) {
        getTabStatus(resolve);
    });
    var selectedTabsAsPromised = new Promise(function (resolve, reject) {
        chrome.tabs.query({highlighted: true, lastFocusedWindow: true}, function (tabs) {
            resolve(tabs);
        });
    });



    Promise.all([gsUtils.documentReadyAsPromsied(document), tabStatusAsPromised, selectedTabsAsPromised])
        .then(function ([domLoadedEvent, tabStatus, selectedTabs]) {

            setSuspendAllVisibility(tabStatus);
            setSuspendSelectedVisibility(selectedTabs);

            setStatus(tabStatus);
            showPopupContents();
            addClickHandlers();
        });

    function setSuspendAllVisibility(tabStatus) {

        var suspendOneVisible = (tabStatus !== 'suspended' && tabStatus !== 'special' && tabStatus !== 'unknown'),
            whitelistVisible = (tabStatus !== 'whitelisted' && tabStatus !== 'special'),
            pauseVisible = (tabStatus === 'normal');

        if (suspendOneVisible) {
            document.getElementById('suspendOne').style.display = 'block';
        } else {
            document.getElementById('suspendOne').style.display = 'none';
        }

        if (whitelistVisible) {
            document.getElementById('whitelist').style.display = 'block';
        } else {
            document.getElementById('whitelist').style.display = 'none';
        }

        if (pauseVisible) {
            document.getElementById('tempWhitelist').style.display = 'block';
        } else {
            document.getElementById('tempWhitelist').style.display = 'none';
        }

        if (suspendOneVisible || whitelistVisible || pauseVisible) {
            document.getElementById('optsCurrent').style.display = 'block';
        } else {
            document.getElementById('optsCurrent').style.display = 'none';
        }
    }

    function setSuspendSelectedVisibility(selectedTabs) {
        if (selectedTabs && selectedTabs.length > 1) {
            document.getElementById('optsSelected').style.display = 'block';
        } else {
            document.getElementById('optsSelected').style.display = 'none';
        }
    }

    function setStatus(status) {
        var statusDetail = '',
            statusIconClass = '';

        // Update status icon and text
        if (status === 'normal') {
            statusDetail = 'Tab will be suspended automatically.';
            statusIconClass = 'fa fa-clock-o';

        } else if (status === 'suspended') {
            statusDetail = 'Tab suspended. <a href="#">Unsuspend</a>';
            statusIconClass = 'fa fa-pause';

        } else if (status === 'never') {
            statusDetail = 'Automatic tab suspension disabled.';
            statusIconClass = 'fa fa-ban';

        } else if (status === 'special') {
            statusDetail = 'Tab cannot be suspended.';
            statusIconClass = 'fa fa-remove';

        } else if (status === 'whitelisted') {
            statusDetail = 'Site whitelisted. <a href="#">Remove from whitelist</a>';
            statusIconClass = 'fa fa-check';

        } else if (status === 'audible') {
            statusDetail = 'Tab is playing audio.';
            statusIconClass = 'fa fa-volume-up';

        } else if (status === 'formInput') {
            statusDetail = 'Tab is receiving form input. <a href="#">Unpause</a>';
            statusIconClass = 'fa fa-edit';

        } else if (status === 'pinned') {
            statusDetail = 'Tab has been pinned.';
            statusIconClass = 'fa fa-thumb-tack';

        } else if (status === 'tempWhitelist') {
            statusDetail = 'Tab suspension paused. <a href="#">Unpause</a>';
            statusIconClass = 'fa fa-pause';

        } else if (status === 'noConnectivity') {
            statusDetail = 'No network connection.';
            statusIconClass = 'fa fa-pause';

        } else if (status === 'charging') {
            statusDetail = 'Connected to power source.';
            statusIconClass = 'fa fa-pause';
        } else {
            console.log('Could not process tab status of: ' + status);
        }
        document.getElementById('statusDetail').innerHTML = statusDetail;
        document.getElementById('statusIcon').className = statusIconClass;

        // Update action handler
        var actionEl = document.getElementsByTagName('a')[0];
        if (actionEl) {

            var tgsHanderFunc;
            if (status === 'suspended') {
                tgsHanderFunc = tgs.unsuspendHighlightedTab;

            } else if (status === 'whitelisted') {
                tgsHanderFunc = tgs.unwhitelistHighlightedTab;

            } else if (status === 'formInput' || status === 'tempWhitelist') {
                tgsHanderFunc = tgs.undoTemporarilyWhitelistHighlightedTab;
            }

            if (globalActionElListener) {
                actionEl.removeEventListener('click', globalActionElListener);
            }
            if (tgsHanderFunc) {
                globalActionElListener = function (e) {
                    tgsHanderFunc();
                    tgs.updateIcon('normal');
                    window.close();
                };
                actionEl.addEventListener('click', globalActionElListener);
            }
        }
    }

    function showPopupContents() {
        setTimeout(function () {
            document.getElementById('loadBar').style.display = 'none';
            document.getElementById('header').style.display = 'block';
            document.getElementById('popupContent').style.display = 'block';
            setTimeout(function () {
                document.getElementById('popupContent').style.opacity = 1;
            }, 50);
        }, 200);
    }

    function addClickHandlers() {
        document.getElementById('suspendOne').addEventListener('click', function (e) {
            tgs.suspendHighlightedTab();
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function (e) {
            tgs.suspendAllTabs();
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function (e) {
            tgs.unsuspendAllTabs();
            window.close();
        });
        document.getElementById('suspendSelected').addEventListener('click', function (e) {
            tgs.suspendSelectedTabs();
            window.close();
        });
        document.getElementById('unsuspendSelected').addEventListener('click', function (e) {
            tgs.unsuspendSelectedTabs();
            window.close();
        });
        document.getElementById('whitelist').addEventListener('click', function (e) {
            tgs.whitelistHighlightedTab();
            tgs.updateIcon();
            window.close();
        });
        document.getElementById('tempWhitelist').addEventListener('click', function (e) {
            tgs.temporarilyWhitelistHighlightedTab();
            tgs.updateIcon();
            window.close();
        });
        document.getElementById('settingsLink').addEventListener('click', function (e) {
            chrome.tabs.create({
                url: chrome.extension.getURL('options.html')
            });
            window.close();
        });
    }
}());
