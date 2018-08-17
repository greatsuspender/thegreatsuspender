/*global chrome */
(function() {
  'use strict';

  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var shortcutsEl = document.getElementById('keyboardShortcuts'),
      configureShortcutsEl = document.getElementById('configureShortcuts'),
      count = 0;

    //populate keyboard shortcuts
    chrome.commands.getAll(function(commands) {
      commands.forEach(function(command) {
        if (command.name !== '_execute_browser_action') {
          var shortcut =
            command.shortcut !== ''
              ? command.shortcut
              : '(' + chrome.i18n.getMessage('js_shortcuts_not_set') + ')';
          var style = count % 2 === 0 ? '"margin: 0 0 2px;"' : '';
          shortcutsEl.innerHTML +=
            '<p style=' +
            style +
            '>' +
            command.description +
            ': ' +
            shortcut +
            '</p>';
          count++;
        }
      });
    });

    //listener for configureShortcuts
    configureShortcutsEl.onclick = function(e) {
      chrome.tabs.update({ url: 'chrome://extensions/configureCommands' });
    };
  });

  gsAnalytics.reportPageView('shortcuts.html');
})();
