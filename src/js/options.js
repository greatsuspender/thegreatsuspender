let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const {
  performPostSaveUpdates,
  cleanupWhitelist,
  documentReadyAndLocalisedAsPromsied,
  debounce,
  isSuspendedTab,
  isSuspendedUrl,
  getOriginalUrl,
  checkWhiteList,
} = gsGlobals.gsUtils;
const {
  getOption,
  setOptionAndSync,
  SCREEN_CAPTURE,
  SCREEN_CAPTURE_FORCE,
  SUSPEND_IN_PLACE_OF_DISCARD,
  IGNORE_WHEN_OFFLINE,
  IGNORE_WHEN_CHARGING,
  UNSUSPEND_ON_FOCUS,
  IGNORE_PINNED,
  IGNORE_FORMS,
  IGNORE_AUDIO,
  IGNORE_ACTIVE_TABS,
  IGNORE_CACHE,
  ADD_CONTEXT,
  SYNC_SETTINGS,
  SUSPEND_TIME,
  THEME,
  WHITELIST,
} = gsGlobals.gsStorage;
const { tabsQuery } = gsGlobals.gsChrome;
const { reportPageView } = gsGlobals.gsAnalytics;
const { registerViewGlobal, VIEW_FUNC_OPTIONS_REINIT } = gsGlobals.gsViews;

const elementPrefMap = {
  preview: SCREEN_CAPTURE,
  forceScreenCapture: SCREEN_CAPTURE_FORCE,
  suspendInPlaceOfDiscard: SUSPEND_IN_PLACE_OF_DISCARD,
  onlineCheck: IGNORE_WHEN_OFFLINE,
  batteryCheck: IGNORE_WHEN_CHARGING,
  unsuspendOnFocus: UNSUSPEND_ON_FOCUS,
  dontSuspendPinned: IGNORE_PINNED,
  dontSuspendForms: IGNORE_FORMS,
  dontSuspendAudio: IGNORE_AUDIO,
  dontSuspendActiveTabs: IGNORE_ACTIVE_TABS,
  ignoreCache: IGNORE_CACHE,
  addContextMenu: ADD_CONTEXT,
  syncSettings: SYNC_SETTINGS,
  timeToSuspend: SUSPEND_TIME,
  theme: THEME,
  whitelist: WHITELIST,
};

//populate settings from synced storage
const initSettings = () => {
  const optionEls = document.getElementsByClassName('option');

  for (let i = 0; i < optionEls.length; i++) {
    const element = optionEls[i];
    const pref = elementPrefMap[element.id];
    populateOption(element, getOption(pref));
  }

  setForceScreenCaptureVisibility(getOption(SCREEN_CAPTURE) !== '0');
  setAutoSuspendOptionsVisibility(parseFloat(getOption(SUSPEND_TIME)) > 0);
  setSyncNoteVisibility(!getOption(SYNC_SETTINGS));

  const searchParams = new URL(location.href).searchParams;
  if (searchParams.has('firstTime')) {
    document.querySelector('.welcome-message').classList.remove('reallyHidden');
    document.querySelector('#options-heading').classList.add('reallyHidden');
  }
};

function selectComboBox(element, key) {
  for (let i = 0; i < element.children.length; i += 1) {
    const child = element.children[i];
    if (child.value === key) {
      child.selected = 'true';
      break;
    }
  }
}

function populateOption(element, value) {
  if (
    element.tagName === 'INPUT' &&
    element.hasAttribute('type') &&
    element.getAttribute('type') === 'checkbox'
  ) {
    element.checked = value;
  } else if (element.tagName === 'SELECT') {
    selectComboBox(element, value);
  } else if (element.tagName === 'TEXTAREA') {
    element.value = value;
  }
}

function getOptionValue(element) {
  if (
    element.tagName === 'INPUT' &&
    element.hasAttribute('type') &&
    element.getAttribute('type') === 'checkbox'
  ) {
    return element.checked;
  }
  if (element.tagName === 'SELECT') {
    return element.children[element.selectedIndex].value;
  }
  if (element.tagName === 'TEXTAREA') {
    return element.value;
  }
}

function setForceScreenCaptureVisibility(visible) {
  if (visible) {
    document.getElementById('forceScreenCaptureContainer').style.display =
      'block';
  } else {
    document.getElementById('forceScreenCaptureContainer').style.display =
      'none';
  }
}

function setSyncNoteVisibility(visible) {
  if (visible) {
    document.getElementById('syncNote').style.display = 'block';
  } else {
    document.getElementById('syncNote').style.display = 'none';
  }
}

function setAutoSuspendOptionsVisibility(visible) {
  Array.prototype.forEach.call(
    document.getElementsByClassName('autoSuspendOption'),
    function(el) {
      if (visible) {
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }
  );
}

function handleChange(element) {
  return function() {
    const pref = elementPrefMap[element.id];

    //add specific screen element listeners
    if (pref === SCREEN_CAPTURE) {
      setForceScreenCaptureVisibility(getOptionValue(element) !== '0');
    } else if (pref === SUSPEND_TIME) {
      const interval = getOptionValue(element);
      setAutoSuspendOptionsVisibility(interval > 0);
    } else if (pref === SYNC_SETTINGS) {
      // we only really want to show this on load. not on toggle
      if (getOptionValue(element)) {
        setSyncNoteVisibility(false);
      }
    }

    const [oldValue, newValue] = saveChange(element);
    if (oldValue !== newValue) {
      const prefKey = elementPrefMap[element.id];
      performPostSaveUpdates(
        [prefKey],
        { [prefKey]: oldValue },
        { [prefKey]: newValue }
      );
    }
  };
}

function saveChange(element) {
  const pref = elementPrefMap[element.id];
  const oldValue = getOption(pref);
  let newValue = getOptionValue(element);

  //clean up whitelist before saving
  if (pref === WHITELIST) {
    newValue = cleanupWhitelist(newValue);
  }

  //save option
  if (oldValue !== newValue) {
    setOptionAndSync(elementPrefMap[element.id], newValue);
  }

  return [oldValue, newValue];
}

documentReadyAndLocalisedAsPromsied(document).then(function() {
  initSettings();

  const optionEls = document.getElementsByClassName('option');

  //add change listeners for all 'option' elements
  for (let i = 0; i < optionEls.length; i++) {
    const element = optionEls[i];
    if (element.tagName === 'TEXTAREA') {
      element.addEventListener(
        'input',
        debounce(handleChange(element), 200),
        false
      );
    } else {
      element.onchange = handleChange(element);
    }
  }

  document.getElementById('testWhitelistBtn').onclick = async e => {
    e.preventDefault();
    const tabs = await tabsQuery();
    const tabUrls = tabs
      .map(tab => (isSuspendedTab(tab) ? getOriginalUrl(tab.url) : tab.url))
      .filter(url => !isSuspendedUrl(url) && checkWhiteList(url))
      .map(url => (url.length > 55 ? url.substr(0, 52) + '...' : url));
    if (tabUrls.length === 0) {
      alert(chrome.i18n.getMessage('js_options_whitelist_no_matches'));
      return;
    }
    const firstUrls = tabUrls.splice(0, 22);
    let alertString = `${chrome.i18n.getMessage(
      'js_options_whitelist_matches_heading'
    )}\n${firstUrls.join('\n')}`;

    if (tabUrls.length > 0) {
      alertString += `\n${chrome.i18n.getMessage(
        'js_options_whitelist_matches_overflow_prefix'
      )} ${tabUrls.length} ${chrome.i18n.getMessage(
        'js_options_whitelist_matches_overflow_suffix'
      )}`;
    }
    alert(alertString);
  };

  //hide incompatible sidebar items if in incognito mode
  if (chrome.extension.inIncognitoContext) {
    Array.prototype.forEach.call(
      document.getElementsByClassName('noIncognito'),
      function(el) {
        el.style.display = 'none';
      }
    );
    window.alert(chrome.i18n.getMessage('js_options_incognito_warning'));
  }
});

registerViewGlobal(window, VIEW_FUNC_OPTIONS_REINIT, initSettings);
reportPageView('options.html');
