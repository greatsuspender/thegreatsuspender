/*global chrome */

(function () {

    'use strict';

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);
            var optionEls = document.getElementsByClassName('option'),
                shortcutsEl = document.getElementById('keyboardShortcuts'),
                configureShortcutsEl = document.getElementById('configureShortcuts'),
                count = 0;

            //populate keyboard shortcuts
            chrome.commands.getAll(function (commands) {

                commands.forEach(function (command) {
                    if (command.name !== '_execute_browser_action') {
                        var shortcut = command.shortcut !== '' ? command.shortcut : '(not set)',
                            style = count % 2 === 0 ? '"margin: 0 0 2px;"' : '';
                        shortcutsEl.innerHTML += '<p style=' + style + '>' + command.description + ': ' + shortcut + '</p>';
                        count++;
                    }
                });
            });

            //listener for configureShortcuts
            configureShortcutsEl.onclick = function (e) {
                chrome.tabs.update({url: 'chrome://extensions/configureCommands'});
            };
        }
    }, 50);

}());
