/*global chrome, tgs, gsAnalytics, gsUtils, gsStorage */
(function(global) {
  'use strict';

  try {
    chrome.extension.getBackgroundPage().tgs.setViewGlobals(global, 'debug');
  } catch (e) {
    window.setTimeout(() => window.location.reload(), 1000);
    return;
  }

  var currentTabs = {};

  function generateTabInfo(info) {
    // console.log(info.tabId, info);
    var timerStr =
      info && info.timerUp && info && info.timerUp !== '-'
        ? new Date(info.timerUp).toLocaleString()
        : '-';
    var html = '',
      windowId = info && info.windowId ? info.windowId : '?',
      tabId = info && info.tabId ? info.tabId : '?',
      tabTitle = info && info.tab ? gsUtils.htmlEncode(info.tab.title) : '?',
      tabTimer = timerStr,
      tabStatus = info ? info.status : '?';

    html += '<tr>';
    html += '<td>' + windowId + '</td>';
    html += '<td>' + tabId + '</td>';
    html +=
      '<td style="max-width:700px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' +
      tabTitle +
      '</td>';
    html += '<td>' + tabTimer + '</td>';
    html += '<td>' + tabStatus + '</td>';
    html += '</tr>';

    return html;
  }

  function fetchInfo() {
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(curTab, i, tabs) {
        currentTabs[tabs[i].id] = tabs[i];

        tgs.getDebugInfo(curTab.id, function(debugInfo) {
          var html,
            tableEl = document.getElementById('gsProfilerBody');

          debugInfo.tab = curTab;

          html = generateTabInfo(debugInfo);
          tableEl.innerHTML = tableEl.innerHTML + html;
        });
      });
    });
  }

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    fetchInfo();

    document.getElementById(
      'toggleDebugInfo'
    ).innerHTML = gsUtils.isDebugInfo();
    document.getElementById('toggleDebugInfo').onclick = function(e) {
      gsUtils.setDebugInfo(!gsUtils.isDebugInfo());
      document.getElementById(
        'toggleDebugInfo'
      ).innerHTML = gsUtils.isDebugInfo();
    };

    document.getElementById(
      'toggleDebugError'
    ).innerHTML = gsUtils.isDebugError();
    document.getElementById('toggleDebugError').onclick = function(e) {
      gsUtils.setDebugError(!gsUtils.isDebugError());
      document.getElementById(
        'toggleDebugError'
      ).innerHTML = gsUtils.isDebugError();
    };

    let discardInPlaceOfSuspend = gsStorage.getOption(
      gsStorage.DISCARD_IN_PLACE_OF_SUSPEND
    );
    document.getElementById(
      'toggleDiscardInPlaceOfSuspend'
    ).innerHTML = discardInPlaceOfSuspend;
    document.getElementById('toggleDiscardInPlaceOfSuspend').onclick = function(
      e
    ) {
      gsStorage.setOptionAndSync(
        gsStorage.DISCARD_IN_PLACE_OF_SUSPEND,
        !discardInPlaceOfSuspend
      );
      document.getElementById(
        'toggleDiscardInPlaceOfSuspend'
      ).innerHTML = !discardInPlaceOfSuspend;
    };

    let useAlternateScreenCaptureLib = gsStorage.getOption(
      gsStorage.USE_ALT_SCREEN_CAPTURE_LIB
    );
    document.getElementById(
      'toggleUseAlternateScreenCaptureLib'
    ).innerHTML = useAlternateScreenCaptureLib;
    document.getElementById(
      'toggleUseAlternateScreenCaptureLib'
    ).onclick = function(e) {
      gsStorage.setOptionAndSync(
        gsStorage.USE_ALT_SCREEN_CAPTURE_LIB,
        !useAlternateScreenCaptureLib
      );
      document.getElementById(
        'toggleUseAlternateScreenCaptureLib'
      ).innerHTML = !useAlternateScreenCaptureLib;
    };

    var extensionsUrl = `chrome://extensions/?id=${chrome.runtime.id}`;
    document
      .getElementById('backgroundPage')
      .setAttribute('href', extensionsUrl);
    document.getElementById('backgroundPage').onclick = function() {
      chrome.tabs.create({ url: extensionsUrl });
    };

    /*
        chrome.processes.onUpdatedWithMemory.addListener(function (processes) {
            chrome.tabs.query({}, function (tabs) {
                var html = '';
                html += generateMemStats(processes);
                html += '<br />';
                html += generateTabStats(tabs);
                document.getElementById('gsProfiler').innerHTML = html;
            });
        });
        */
  });
  gsAnalytics.reportPageView('debug.html');
})(this);
