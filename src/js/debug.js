/*global chrome */
(function() {
  'use strict';

  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;
  var gsStorage = chrome.extension.getBackgroundPage().gsStorage;
  var tgs = chrome.extension.getBackgroundPage().tgs;
  var currentTabs = {};

  function generateTabInfo(info) {
    console.log(info.tabId, info);
    var html = '',
      windowId = info && info.windowId ? info.windowId : '?',
      tabId = info && info.tabId ? info.tabId : '?',
      tabTitle = info && info.tab ? gsUtils.htmlEncode(info.tab.title) : '?',
      tabTimer = info && info.timerUp ? info.timerUp : '-',
      tabStatus = info ? info.status : '?';

    html += '<tr>';
    html += '<td>' + windowId + '</td>';
    html += '<td>' + tabId + '</td>';
    html +=
      '<td style="max-width:800px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' +
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
          if (chrome.runtime.lastError) {
            gsUtils.error('debug', chrome.runtime.lastError);
          }

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

    let toggleDiscardAfterSuspend = gsStorage.getOption(
      gsStorage.DISCARD_AFTER_SUSPEND
    );
    document.getElementById(
      'toggleDiscardAfterSuspend'
    ).innerHTML = toggleDiscardAfterSuspend;
    document.getElementById('toggleDiscardAfterSuspend').onclick = function(e) {
      gsStorage.setOption(
        gsStorage.DISCARD_AFTER_SUSPEND,
        !toggleDiscardAfterSuspend
      );
      document.getElementById(
        'toggleDiscardAfterSuspend'
      ).innerHTML = !toggleDiscardAfterSuspend;
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
      gsStorage.setOption(
        gsStorage.DISCARD_IN_PLACE_OF_SUSPEND,
        !discardInPlaceOfSuspend
      );
      document.getElementById(
        'toggleDiscardInPlaceOfSuspend'
      ).innerHTML = !discardInPlaceOfSuspend;
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
})();
