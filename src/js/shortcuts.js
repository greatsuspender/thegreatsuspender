let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const {
  formatHotkeyString,
  documentReadyAndLocalisedAsPromsied,
} = gsGlobals.gsUtils;
const { reportPageView } = gsGlobals.gsAnalytics;

documentReadyAndLocalisedAsPromsied(document).then(function() {
  const shortcutsEl = document.getElementById('keyboardShortcuts');
  const configureShortcutsEl = document.getElementById('configureShortcuts');

  const notSetMessage = chrome.i18n.getMessage('js_shortcuts_not_set');
  const groupingKeys = [
    '2-toggle-temp-whitelist-tab',
    '2b-unsuspend-selected-tabs',
    '4-unsuspend-active-window',
  ];

  //populate keyboard shortcuts
  chrome.commands.getAll(commands => {
    commands.forEach(command => {
      if (command.name !== '_execute_browser_action') {
        const shortcut =
          command.shortcut !== ''
            ? formatHotkeyString(command.shortcut)
            : '(' + notSetMessage + ')';
        const addMarginBottom = groupingKeys.includes(command.name);
        shortcutsEl.innerHTML += `<div ${
          addMarginBottom ? ' class="bottomMargin"' : ''
        }>${command.description}</div>
            <div class="${
              command.shortcut ? 'hotkeyCommand' : 'lesserText'
            }">${shortcut}</div>`;
      }
    });
  });

  //listener for configureShortcuts
  configureShortcutsEl.onclick = function(e) {
    chrome.tabs.update({ url: 'chrome://extensions/shortcuts' });
  };
});

reportPageView('shortcuts.html');
