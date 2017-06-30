/*global chrome */

'use strict';

(function () {

    function setStatus(status) {
        var statusDetail = '',
            statusIconClass = '',
            message;

        if (status === 'normal') {
            statusDetail = 'Tab will be suspended automatically.';
            statusIconClass = 'fa fa-clock-o';

        } else if (status === 'special') {
            statusDetail = 'Tab cannot be suspended.';
            statusIconClass = 'fa fa-remove';

        } else if (status === 'suspended') {
            statusDetail = 'Tab suspended. <a href="#">Unsuspend</a>';
            statusIconClass = 'fa fa-pause';
            message = 'unsuspendOne';

        } else if (status === 'whitelisted') {
            statusDetail = 'Site whitelisted. <a href="#">Remove from whitelist</a>';
            statusIconClass = 'fa fa-check';
            message = 'removeWhitelist';

        } else if (status === 'audible') {
            statusDetail = 'Tab is playing audio.';
            statusIconClass = 'fa fa-volume-up';

        } else if (status === 'formInput') {
            statusDetail = 'Tab is receiving form input. <a href="#">Unpause</a>';
            statusIconClass = 'fa fa-edit';
            message = 'undoTempWhitelist';

        } else if (status === 'pinned') {
            statusDetail = 'Tab has been pinned.';
            statusIconClass = 'fa fa-thumb-tack';

        } else if (status === 'tempWhitelist') {
            statusDetail = 'Tab suspension paused. <a href="#">Unpause</a>';
            statusIconClass = 'fa fa-pause';
            message = 'undoTempWhitelist';

        } else if (status === 'never') {
            statusDetail = 'Automatic tab suspension disabled.';
            statusIconClass = 'fa fa-ban';

        } else if (status === 'noConnectivity') {
            statusDetail = 'No network connection.';
            statusIconClass = 'fa fa-pause';

        } else if (status === 'charging') {
            statusDetail = 'Connected to power source.';
            statusIconClass = 'fa fa-pause';
        }

        if (document.getElementsByTagName('a')[0]) {
            document.getElementsByTagName('a')[0].removeEventListener('click');
        }

        document.getElementById('statusDetail').innerHTML = statusDetail;
        document.getElementById('statusIcon').className = statusIconClass;

        if (message) {
            document.getElementsByTagName('a')[0].addEventListener('click', function (e) {
                chrome.runtime.sendMessage({ action: message });
                chrome.extension.getBackgroundPage().tgs.updateIcon('normal');
                window.close();
            });
        }
    }

    function setSuspendAllVisibility(tabStatus) {

      var suspendOneVisible = (tabStatus === 'suspended' || tabStatus === 'special' || tabStatus === 'unknown') ? false : true,
        whitelistVisible = (tabStatus !== 'whitelisted' && tabStatus !== 'special') ? true : false,
        pauseVisible = (tabStatus === 'normal') ? true : false;

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
            chrome.runtime.sendMessage({ action: 'suspendOne' });
            window.close();
        });
        document.getElementById('suspendAll').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'suspendAll' });
            window.close();
        });
        document.getElementById('unsuspendAll').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'unsuspendAll' });
            window.close();
        });
        document.getElementById('suspendSelected').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'suspendSelected' });
            window.close();
        });
        document.getElementById('unsuspendSelected').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'unsuspendSelected' });
            window.close();
        });
        document.getElementById('whitelist').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'whitelist' });
            chrome.extension.getBackgroundPage().tgs.updateIcon(false);
            window.close();
        });
        document.getElementById('tempWhitelist').addEventListener('click', function (e) {
            chrome.runtime.sendMessage({ action: 'tempWhitelist' });
            chrome.extension.getBackgroundPage().tgs.updateIcon(false);
            window.close();
        });
        document.getElementById('settingsLink').addEventListener('click', function (e) {
            chrome.tabs.create({
              url: chrome.extension.getURL('options.html')
            });
            window.close();
        });
    }


    var domContentLoadedAsPromsied = new Promise(function (resolve, reject) {
        document.addEventListener('DOMContentLoaded', resolve);
    });
    var getTabStatus = function (callback) {
        chrome.extension.getBackgroundPage().tgs.requestTabInfo(false, function (info) {
            if (info && info.status !== 'unknown') {
                callback(info.status);
            } else {
                document.getElementById('loadBar').style.display = 'block';
                setTimeout(function() {
                    getTabStatus(callback);
                }, 200);
            }
        });
    };
    var tabStatusAsPromised = new Promise(function (resolve, reject) {
        getTabStatus(resolve)
    });
    var selectedTabsAsPromised = new Promise(function (resolve, reject) {
      chrome.tabs.query({highlighted: true, lastFocusedWindow: true}, function (tabs) {
        resolve(tabs);
      });
    });

    Promise.all([domContentLoadedAsPromsied, tabStatusAsPromised, selectedTabsAsPromised])
      .then(function ([domLoadedEvent, tabStatus, selectedTabs]) {

        setSuspendAllVisibility(tabStatus);
        setSuspendSelectedVisibility(selectedTabs);

        setStatus(tabStatus);
        showPopupContents();
        addClickHandlers();
      });
}());
