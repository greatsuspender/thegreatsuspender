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
    chrome.commands.getAll((commands) => {
      commands.forEach((command) => {
        if (command.name !== '_execute_browser_action') {
          const shortcut =
            command.shortcut !== ''
              ? command.shortcut
              : '(' + chrome.i18n.getMessage('js_shortcuts_not_set') + ')';
          const marginStyle = count % 2 === 0 ? ' style="margin: 0 0 20px;"' : '';
          shortcutsEl.innerHTML +=
            `<div${marginStyle}>${command.description}</div>
            <div${!command.shortcut && ' class="lesserText"'}>${shortcut}</div>`
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
