/*global chrome */

(function () {

    'use strict';

    var readyStateCheckInterval = window.setInterval(function () {
        if (document.readyState === 'complete') {

            window.clearInterval(readyStateCheckInterval);
            var optionEls = document.getElementsByClassName('option'),
                shortcutsEl = document.getElementById('keyboardShortcuts'),
                configureShortcutsEl = document.getElementById('configureShortcuts');

            //populate keyboard shortcuts
            chrome.commands.getAll(function (commands) {
                commands.forEach(function (command) {
                    if (command.name !== '_execute_browser_action') {
                        shortcutsEl.innerHTML += '<span>' + command.description + ': ' + command.shortcut + '</span><br />';
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
