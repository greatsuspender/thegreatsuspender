
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
                        renderedTabs[curProc.tabs[i]] = renderedTabs[curProc.tabs[i]] || {cur: 0, old: 1};
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
            totalOld = 0,
            totalCur = 0,
            oldMem = 0,
            curMem = 0,
            curTab,
            tabKey,
            state,
            i;

        html += '<table>';
        html += '<tr>';
        html += '<th>oldMem</th>';
        html += '<th>curMem</th>';
        html += '<th>key</th>';
        html += '<th>state</th>';
        html += '<th>title</th>';
        html += '</tr>';

        for (i = 0; i < tabs.length; i++) {

            curTab = tabs[i];
            tabKey = curTab.id + '_' + curTab.windowId;
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

            html += '<tr>';

            if (renderedTabs[curTab.id]) {
                if (state !== 'requested' && state !== 'inProgress' && state !== 'confirmed' && state !== 'suspended') {
                    renderedTabs[curTab.id].old = renderedTabs[curTab.id].cur;
                }
                oldMem = renderedTabs[curTab.id].old || oldMem;
                curMem = renderedTabs[curTab.id].cur || curMem;

                html += '<td>' + oldMem + '</td>';
                html += '<td>' + curMem + '</td>';

            } else {
                html += '<td>?</td>';
                html += '<td>?</td>';
            }
            html += '<td>' + tabKey + '</td>';
            html += '<td>' + state + '</td>';
            html += '<td>' + curTab.title + '</td>';
            html += '</tr>';

            totalOld += oldMem;
            totalCur += curMem;
        }

        html += '<tr>';
        html += '<td>' + totalOld + '</td>';
        html += '<td>' + totalCur + '</td>';
        html += '<td></td>';
        html += '<td></td>';
        html += '</tr>';
        html += '</table>';

        html += '<span>ProgressQueue length: ' + tgs.progressQueueLength + '</span>';

        return html;
    }

    window.onload = function() {

        chrome.processes.onUpdatedWithMemory.addListener(function(processes) {

            chrome.tabs.query({}, function(tabs) {
                var html = '';
                html += generateMemStats(processes);
                html += '<br />';
                html += generateTabStats(tabs);
                document.getElementById('gsProfiler').innerHTML = html;
            });

        });
    };
}());
