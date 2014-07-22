
(function() {

    'use strict';

    var currentTabs = {};

    function generateTabInfo(info) {

        var html = '',
            tabTitle = info && info.tab ? info.tab.title : 'unknown',
            tabTimer = info ? info.timerUp : -1,
            tabStatus = info ? info.status : 'unknown';

        html += '<tr>';
        html += '<td style="max-width:800px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + tabTitle + '</td>';
        html += '<td>' + tabTimer + '</td>';
        html += '<td>' + tabStatus + '</td>';
        html += '</tr>';

        return html;
    }

    function fetchInfo() {

        chrome.tabs.query({}, function(tabs) {

            for (var i = 0; i < tabs.length; i++) {
                currentTabs[tabs[i].id] = tabs[i];
                chrome.runtime.sendMessage({action: 'requestTabInfo', tab: tabs[i]});
            }
        });
    }

    window.onload = function() {

        fetchInfo();

        chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
            if (request.action === 'confirmTabInfo' && request.info) {

                if (typeof(request.info) === 'object') {

                    var html = '',
                        tab = currentTabs[request.info.tabId],
                        tableEl = document.getElementById('gsProfilerBody');

                    request.info.tab = tab;

                    html = generateTabInfo(request.info);
                    tableEl.innerHTML = tableEl.innerHTML + html;
                }
            }
        });

        //handler for refresh
        document.getElementById('refreshProfiler').onclick = function(e) {
            document.getElementById('gsProfilerBody').innerHTML = '';
            fetchInfo();
        };

        /*chrome.processes.onUpdatedWithMemory.addListener(function(processes) {

            chrome.tabs.query({}, function(tabs) {
                var html = '';
                html += generateMemStats(processes);
                html += '<br />';
                html += generateTabStats(tabs);
                document.getElementById('gsProfiler').innerHTML = html;
            });

        });*/
    };
}());
