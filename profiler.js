
(function() {

    'use strict';

    var currentTabs = {},
        tabResponses = {},
        tabKeys = [];

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

    function fetchInfo(table) {

        var html = '',
            key = '',
            i,
            tab;

        table.innerHTML = '';

        tabKeys.sort();
        for (i = 0; i < tabKeys.length; i++) {
            if (tabKeys[i] !== key) {
                key = tabKeys[i];
                html = generateTabInfo(tabResponses[key]);
                table.innerHTML = table.innerHTML + html;
            }
        }
        tabResponses = {};
        tabKeys = [];

        chrome.tabs.query({}, function(tabs) {
            for (i = 0; i < tabs.length; i++) {

                tab = tabs[i];
                currentTabs[tab.id] = tab;
                tabKeys.push(tab.id);
                chrome.runtime.sendMessage({action: 'requestTabInfo', tab: tab});
            }
        });
    }

    window.onload = function() {

        var table = document.getElementById('gsProfilerBody');
        setInterval(function() {
            fetchInfo(table);
        }, 3000);

        fetchInfo(table);

        chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
            if (request.action === 'confirmTabInfo' && request.info) {

                if (typeof(request.info) === 'object') {

                    var tab = currentTabs[request.info.tabId];
                    request.info.tab = tab;
                    tabResponses[tab.id] = request.info;
                }
            }
        });

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
