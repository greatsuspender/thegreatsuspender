/*global chrome */
(function() {
  'use strict';

  var gsAnalytics = chrome.extension.getBackgroundPage().gsAnalytics;
  var gsUtils = chrome.extension.getBackgroundPage().gsUtils;

  gsUtils.documentReadyAndLocalisedAsPromsied(document).then(function() {
    var shortcutsEl = document.getElementById('keyboardShortcuts');
    var configureShortcutsEl = document.getElementById('configureShortcuts');

    var notSetMessage = chrome.i18n.getMessage('js_shortcuts_not_set');
    var groupingKeys = [
      '2-toggle-temp-whitelist-tab',
      '2b-unsuspend-selected-tabs',
      '4-unsuspend-active-window',
    ];

    //populate keyboard shortcuts
    chrome.commands.getAll(function(commands) {
      commands.forEach(function(command) {
        if (command.name !== '_execute_browser_action') {
          var shortcut =
            command.shortcut !== ''
              ? command.shortcut
              : '(' + notSetMessage + ')';
          var removeMargin = !groupingKeys.includes(command.name);
          var style = removeMargin ? '"margin: 0 0 2px;"' : '';
          shortcutsEl.innerHTML +=
            '<p style=' +
            style +
            '>' +
            command.description +
            ': ' +
            shortcut +
            '</p>';
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
