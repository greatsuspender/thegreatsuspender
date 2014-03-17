
(function() {

    'use strict';

    window.onload = function() {

        var curWindowId = 0;
        chrome.windows.getCurrent(function(window) {
            curWindowId = window.id;
        });

        chrome.processes.onUpdatedWithMemory.addListener(function(processes) {

            var tgs = chrome.extension.getBackgroundPage().tgs,
                html = '',
                totalMem = 0,
                totalCpu = 0,
                curProc,
                key,
                i;

            html += '<table>';
            html += '<tr>';
            html += '<th>mem</th>';
            html += '<th>cpu</th>';
            html += '<th>type</th>';
            html += '<th>state</th>';
            html += '<th>title</th>';
            html += '</tr>';

            for (key in processes) {
                if (processes.hasOwnProperty(key)) {

                    curProc = processes[key];;

                    html += '<tr>';
                    html += '<td>' + Math.floor(curProc.privateMemory / (1024 * 1024)) + '</td>';
                    html += '<td>' + curProc.cpu + '%</td>';
                    html += '<td>' + curProc.type + '</td>';

                    if (curProc.type === 'renderer') {
                        var tabKey = curProc.tabs[0] + '_' + curWindowId,
                            state = '';

                        if (!tgs.suspendedTabs[tabKey]) {
                            state = '???';
                        } else if (tgs.checkWhiteList(tgs.suspendedTabs[tabKey].url)) {
                            state = 'whitelisted';
                        } else if (tgs.isTempWhitelisted(tgs.suspendedTabs[tabKey])) {
                            state = 'tempWhitelisted';
                        } else if (tgs.isPinnedTab(tgs.suspendedTabs[tabKey])) {
                            state = 'pinned';
                        } else if (tgs.isSpecialTab(tgs.suspendedTabs[tabKey])) {
                            state = 'special';
                        } else {
                            state = tgs.suspendedList[tabKey];
                        }
                        html += '<td>' + state + '</td>';
                    } else {
                        html += '<td></td>';
                    }
                    html += '<td>' + curProc.title + '</td>';
                    html += '</tr>';

                    if (curProc.tabs.length > 1) {

                        for (i = 0; i < curProc.tabs.length; i++) {
                            var tabKey = curProc.tabs[i] + '_' + curWindowId;

                            if (!tgs.suspendedTabs[tabKey]) {
                                continue;
                            }
                            html += '<tr>';
                            html += '<td></td>';
                            html += '<td></td>';
                            html += '<td></td>';
                            html += '<td>' + tgs.suspendedList[tabKey] + '</td>';
                            html += '<td>' + tgs.suspendedTabs[tabKey].title + '</td>';
                            html += '</tr>';
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

            document.getElementById('gsProfiler').innerHTML = html;
        });
    };
}());
