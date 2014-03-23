
(function() {

    'use strict';

    var renderedTabs = {};

    function generateMemStats(processes) {

        var html = '',
            totalMem = 0,
            totalCpu = 0,
            curProc,
            curMem,
            key,
            i;

        html += '<table>';
        html += '<tr>';
        html += '<th>mem</th>';
        html += '<th>cpu</th>';
        html += '<th>type</th>';
        html += '<th>title</th>';
        html += '</tr>';

        for (key in processes) {
            if (processes.hasOwnProperty(key)) {

                curProc = processes[key];
                curMem = Math.floor(curProc.privateMemory / (1024 * 1024));

                html += '<tr>';
                html += '<td>' + curMem + '</td>';
                html += '<td>' + curProc.cpu + '%</td>';
                html += '<td>' + curProc.type + '</td>';
                html += '<td>' + curProc.title + '</td>';
                html += '</tr>';

                if (curProc.type === 'renderer' && curProc.tabs.length > 0) {
                    for (i = 0; i < curProc.tabs.length; i++) {
                        renderedTabs[curProc.tabs[i]] = renderedTabs[curProc.tabs[i]] || {};
                        renderedTabs[curProc.tabs[i]].cur = Math.floor(curMem / curProc.tabs.length);
                    }
                } else if (curProc.title.indexOf('Extension: The Great Suspender') >= 0 && curProc.tabs.length > 0) {
                    for (i = 0; i < curProc.tabs.length; i++) {
                        renderedTabs[curProc.tabs[i]] = renderedTabs[curProc.tabs[i]] || {};
                        renderedTabs[curProc.tabs[i]].cur = Math.floor(curMem / curProc.tabs.length);
                    }
                }

                totalMem += Math.floor(curProc.privateMemory / (1024 * 1024));
                totalCpu += curProc.cpu;
            }
        }
        html += '<tr>';
        html += '<td>' + totalMem + '</td>';
        html += '<td>' + totalCpu + '%</td>';
        html += '<td></td>';
        html += '<td></td>';
        html += '<td></td>';
        html += '</tr>';
        html += '</table>';

        return html;
    }

    function generateTabStats(tabs) {

        var tgs = chrome.extension.getBackgroundPage().tgs,
            html = '',
            totals = {},
            curTab,
            curEntry,
            tabState,
            i,
            j;

        html += '<table>';
        html += '<tr>';
        html += '<th>id</th>';
        html += '<th>state</th>';
        html += '<th>mem</th>';
        html += '<th>title</th>';
        html += '</tr>';

        for (i = 0; i < tabs.length; i++) {

            curTab = tabs[i];

            html += '<tr>';
            html += '<td>' + curTab.id + '</td>';
            html += '<td></td>';
            html += '<td></td>';
            html += '<td>' + curTab.title + '</td>';
            html += '</tr>';

            if (tgs.profileTabs[curTab.id]) {
                for (j = 0; j < tgs.profileTabs[curTab.id].length; j++) {
                    curEntry = tgs.profileTabs[curTab.id][j];
                    html += '<tr>';
                    html += '<td>' + curTab.id + '</td>';
                    html += '<td>' + curEntry.state + '</td>';
                    html += '<td>' + curEntry.mem + '</td>';
                    html += '<td>' + curEntry.title + '</td>';
                    html += '</tr>';
                }
            }
        }

        html += '</table>';

        html += '<span>ProgressQueue length: ' + tgs.progressQueueLength + '</span>';

        return html;
    }

    window.onload = function() {

        setInterval(function() {
            chrome.tabs.query({}, function(tabs) {
                var html = generateTabStats(tabs);
                document.getElementById('gsProfiler').innerHTML = html;
            });
        }, 1000);

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
