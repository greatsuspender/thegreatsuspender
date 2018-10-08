/*global chrome */
(function() {
  'use strict';
  if (!chrome.extension.getBackgroundPage() || !chrome.extension.getBackgroundPage().gsUtils) {
    window.setTimeout(() => location.replace(location.href), 1000);
    return;
  }

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
    chrome.commands.getAll((commands) => {
      commands.forEach((command) => {
        if (command.name !== '_execute_browser_action') {
          const shortcut =
            command.shortcut !== ''
              ? command.shortcut
              : '(' + notSetMessage + ')';
          var removeMargin = !groupingKeys.includes(command.name);
          var style = removeMargin ? '"margin: 0 0 2px;"' : '"margin: 0 0 20px;"';
          shortcutsEl.innerHTML +=
            `<div style=${style}>${command.description}</div>
            <div${!command.shortcut && ' class="lesserText"'}>${shortcut}</div>`
        }
      });
    });

    //listener for configureShortcuts
    configureShortcutsEl.onclick = function(e) {
      chrome.tabs.update({ url: 'chrome://extensions/shortcuts' });
    };
  });

  gsAnalytics.reportPageView('shortcuts.html');
})();
