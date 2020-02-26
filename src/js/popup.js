let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const {
  warning,
  STATUS_UNKNOWN,
  STATUS_LOADING,
  STATUS_SUSPENDED,
  STATUS_SPECIAL,
  STATUS_BLOCKED_FILE,
  STATUS_WHITELISTED,
  STATUS_NORMAL,
  STATUS_ACTIVE,
  STATUS_FORMINPUT,
  STATUS_CHARGING,
  STATUS_NEVER,
  STATUS_NOCONNECTIVITY,
  STATUS_PINNED,
  STATUS_TEMPWHITELIST,
  STATUS_AUDIBLE,
  documentReadyAndLocalisedAsPromsied,
} = gsGlobals.gsUtils;
const { getOption, THEME } = gsGlobals.gsStorage;
const { isInitialising } = gsGlobals.gsSession;
const {
  getActiveTabStatus,
  requestToggleTempWhitelistStateOfHighlightedTab,
  unwhitelistHighlightedTab,
  promptForFilePermissions,
  unsuspendHighlightedTab,
  suspendHighlightedTab,
  suspendAllTabs,
  unsuspendAllTabs,
  suspendSelectedTabs,
  unsuspendSelectedTabs,
  whitelistHighlightedTab,
} = gsGlobals.gsTgs;

let globalActionElListener;

const getTabStatus = function(retriesRemaining, callback) {
  getActiveTabStatus(function(status) {
    if (status !== STATUS_UNKNOWN && status !== STATUS_LOADING) {
      callback(status);
    } else if (retriesRemaining === 0) {
      callback(status);
    } else {
      let timeout = 1000;
      if (!isInitialising()) {
        retriesRemaining--;
        timeout = 200;
      }
      setTimeout(function() {
        getTabStatus(retriesRemaining, callback);
      }, timeout);
    }
  });
};
function getTabStatusAsPromise(retries, allowTransientStates) {
  return new Promise(function(resolve) {
    getTabStatus(retries, function(status) {
      if (
        !allowTransientStates &&
        (status === STATUS_UNKNOWN || status === STATUS_LOADING)
      ) {
        status = 'error';
      }
      resolve(status);
    });
  });
}
function getSelectedTabsAsPromise() {
  return new Promise(function(resolve) {
    chrome.tabs.query({ highlighted: true, lastFocusedWindow: true }, function(
      tabs
    ) {
      resolve(tabs);
    });
  });
}

Promise.all([
  documentReadyAndLocalisedAsPromsied(document),
  getTabStatusAsPromise(0, true),
  getSelectedTabsAsPromise(),
]).then(function([domLoadedEvent, initialTabStatus, selectedTabs]) {
  setSuspendSelectedVisibility(selectedTabs);
  setStatus(initialTabStatus);
  showPopupContents();
  addClickHandlers();

  if (
    initialTabStatus === STATUS_UNKNOWN ||
    initialTabStatus === STATUS_LOADING
  ) {
    getTabStatusAsPromise(50, false).then(function(finalTabStatus) {
      setStatus(finalTabStatus);
    });
  }
});

function setSuspendCurrentVisibility(tabStatus) {
  const suspendOneVisible = ![
    STATUS_SUSPENDED,
    STATUS_SPECIAL,
    STATUS_BLOCKED_FILE,
    STATUS_UNKNOWN,
  ].includes(tabStatus);
  const whitelistVisible = ![
    STATUS_WHITELISTED,
    STATUS_SPECIAL,
    STATUS_BLOCKED_FILE,
    STATUS_UNKNOWN,
  ].includes(tabStatus);
  const unsuspendVisible = false; //[STATUS_SUSPENDED].includes(tabStatus);

  if (suspendOneVisible) {
    document.getElementById('suspendOne').style.display = 'block';
  } else {
    document.getElementById('suspendOne').style.display = 'none';
  }

  if (whitelistVisible) {
    document.getElementById('whitelistPage').style.display = 'block';
    document.getElementById('whitelistDomain').style.display = 'block';
  } else {
    document.getElementById('whitelistPage').style.display = 'none';
    document.getElementById('whitelistDomain').style.display = 'none';
  }

  if (suspendOneVisible || whitelistVisible) {
    document.getElementById('optsCurrent').style.display = 'block';
  } else {
    document.getElementById('optsCurrent').style.display = 'none';
  }

  if (unsuspendVisible) {
    document.getElementById('unsuspendOne').style.display = 'block';
  } else {
    document.getElementById('unsuspendOne').style.display = 'none';
  }
}

function setSuspendSelectedVisibility(selectedTabs) {
  if (selectedTabs && selectedTabs.length > 1) {
    document.getElementById('optsSelected').style.display = 'block';
  } else {
    document.getElementById('optsSelected').style.display = 'none';
  }
}

function setStatus(status) {
  setSuspendCurrentVisibility(status);

  let statusDetail = '';
  //  statusIconClass = '';

  // Update status icon and text
  if (status === STATUS_NORMAL || status === STATUS_ACTIVE) {
    statusDetail =
      chrome.i18n.getMessage('js_popup_normal') +
      " <a href='#'>" +
      chrome.i18n.getMessage('js_popup_normal_pause') +
      '</a>';
    //    statusIconClass = 'fa fa-clock-o';
  } else if (status === STATUS_SUSPENDED) {
    // statusDetail =
    //   chrome.i18n.getMessage('js_popup_suspended') +
    //   " <a href='#'>" +
    //   chrome.i18n.getMessage('js_popup_suspended_pause') +
    //   '</a>';
    statusDetail = chrome.i18n.getMessage('js_popup_suspended');
    //    statusIconClass = 'fa fa-pause';
  } else if (status === STATUS_NEVER) {
    statusDetail = chrome.i18n.getMessage('js_popup_never');
    //    statusIconClass = 'fa fa-ban';
  } else if (status === STATUS_SPECIAL) {
    statusDetail = chrome.i18n.getMessage('js_popup_special');
    //    statusIconClass = 'fa fa-remove';
  } else if (status === STATUS_WHITELISTED) {
    statusDetail =
      chrome.i18n.getMessage('js_popup_whitelisted') +
      " <a href='#'>" +
      chrome.i18n.getMessage('js_popup_whitelisted_remove') +
      '</a>';
    //    statusIconClass = 'fa fa-check';
  } else if (status === STATUS_AUDIBLE) {
    statusDetail = chrome.i18n.getMessage('js_popup_audible');
    //    statusIconClass = 'fa fa-volume-up';
  } else if (status === STATUS_FORMINPUT) {
    statusDetail =
      chrome.i18n.getMessage('js_popup_form_input') +
      " <a href='#'>" +
      chrome.i18n.getMessage('js_popup_form_input_unpause') +
      '</a>';
    //    statusIconClass = 'fa fa-edit';
  } else if (status === STATUS_PINNED) {
    statusDetail = chrome.i18n.getMessage('js_popup_pinned'); //  statusIconClass = 'fa fa-thumb-tack';
  } else if (status === STATUS_TEMPWHITELIST) {
    statusDetail =
      chrome.i18n.getMessage('js_popup_temp_whitelist') +
      " <a href='#'>" +
      chrome.i18n.getMessage('js_popup_temp_whitelist_unpause') +
      '</a>';
    //    statusIconClass = 'fa fa-pause';
  } else if (status === STATUS_NOCONNECTIVITY) {
    statusDetail = chrome.i18n.getMessage('js_popup_no_connectivity');
    //    statusIconClass = 'fa fa-plane';
  } else if (status === STATUS_CHARGING) {
    statusDetail = chrome.i18n.getMessage('js_popup_charging');
    //    statusIconClass = 'fa fa-plug';
  } else if (status === STATUS_BLOCKED_FILE) {
    statusDetail =
      chrome.i18n.getMessage('js_popup_blockedFile') +
      " <a href='#'>" +
      chrome.i18n.getMessage('js_popup_blockedFile_enable') +
      '</a>';
    //    statusIconClass = 'fa fa-exclamation-triangle';
  } else if (status === STATUS_LOADING || status === STATUS_UNKNOWN) {
    if (isInitialising()) {
      statusDetail = chrome.i18n.getMessage('js_popup_initialising');
    } else {
      statusDetail = chrome.i18n.getMessage('js_popup_unknown');
    }
    //    statusIconClass = 'fa fa-circle-o-notch';
  } else if (status === 'error') {
    statusDetail = chrome.i18n.getMessage('js_popup_error');
    //    statusIconClass = 'fa fa-exclamation-triangle';
  } else {
    warning('popup', 'Could not process tab status of: ' + status);
  }
  document.getElementById('statusDetail').innerHTML = statusDetail;
  //  document.getElementById('statusIcon').className = statusIconClass;
  // if (status === STATUS_UNKNOWN || status === STATUS_LOADING) {
  //     document.getElementById('statusIcon').classList.add('fa-spin');
  // }

  document.getElementById('header').classList.remove('willSuspend');
  if (status === STATUS_NORMAL || status === STATUS_ACTIVE) {
    document.getElementById('header').classList.add('willSuspend');
  }
  if (status === STATUS_BLOCKED_FILE) {
    document.getElementById('header').classList.add('blockedFile');
  }

  // Update action handler
  const actionEl = document.getElementsByTagName('a')[0];
  if (actionEl) {
    let anderFunc;
    if (status === STATUS_NORMAL || status === STATUS_ACTIVE) {
      anderFunc = requestToggleTempWhitelistStateOfHighlightedTab;
    } else if (status === STATUS_SUSPENDED) {
      anderFunc = requestToggleTempWhitelistStateOfHighlightedTab;
    } else if (status === STATUS_WHITELISTED) {
      anderFunc = unwhitelistHighlightedTab;
    } else if (status === STATUS_FORMINPUT || status === STATUS_TEMPWHITELIST) {
      anderFunc = requestToggleTempWhitelistStateOfHighlightedTab;
    } else if (status === STATUS_BLOCKED_FILE) {
      anderFunc = promptForFilePermissions;
    }

    if (globalActionElListener) {
      actionEl.removeEventListener('click', globalActionElListener);
    }
    if (anderFunc) {
      globalActionElListener = function() {
        anderFunc(function(newTabStatus) {
          setStatus(newTabStatus);
        });
        // window.close();
      };
      actionEl.addEventListener('click', globalActionElListener);
    }
  }
}

function showPopupContents() {
  const theme = getOption(THEME);
  if (theme === 'dark') {
    document.body.classList.add('dark');
  }
  setTimeout(function() {
    document.getElementById('popupContent').style.opacity = 1;
  }, 200);
}

function addClickHandlers() {
  document.getElementById('unsuspendOne').addEventListener('click', function() {
    unsuspendHighlightedTab();
    window.close();
  });
  document.getElementById('suspendOne').addEventListener('click', function() {
    suspendHighlightedTab();
    window.close();
  });
  document.getElementById('suspendAll').addEventListener('click', function() {
    suspendAllTabs(false);
    window.close();
  });
  document.getElementById('unsuspendAll').addEventListener('click', function() {
    unsuspendAllTabs();
    window.close();
  });
  document
    .getElementById('suspendSelected')
    .addEventListener('click', function() {
      suspendSelectedTabs();
      window.close();
    });
  document
    .getElementById('unsuspendSelected')
    .addEventListener('click', function() {
      unsuspendSelectedTabs();
      window.close();
    });
  document
    .getElementById('whitelistDomain')
    .addEventListener('click', function() {
      whitelistHighlightedTab(false);
      setStatus(STATUS_WHITELISTED);
      // window.close();
    });
  document
    .getElementById('whitelistPage')
    .addEventListener('click', function() {
      whitelistHighlightedTab(true);
      setStatus(STATUS_WHITELISTED);
      // window.close();
    });
  document.getElementById('settingsLink').addEventListener('click', function() {
    chrome.tabs.create({
      url: chrome.runtime.getURL('options.html'),
    });
    window.close();
  });
}
