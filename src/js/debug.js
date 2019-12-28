let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const {
  error,
  warning,
  isNormalTab,
  htmlEncode,
  documentReadyAndLocalisedAsPromsied,
  isDebugInfo,
  setDebugInfo,
  isDebugError,
  setDebugError,
  isSuspendedTab,
  getRootUrl,
  STATUS_UNKNOWN,
} = gsGlobals.gsUtils;
const { generateChromeFavIconUrlFromUrl } = gsGlobals.gsFavicon;
const {
  getOption,
  setOptionAndSync,
  DISCARD_IN_PLACE_OF_SUSPEND,
  USE_ALT_SCREEN_CAPTURE_LIB,
} = gsGlobals.gsStorage;
const { tabsQuery, tabsUpdate } = gsGlobals.gsChrome;
const { getTabStatePropForTabId, STATE_TIMER_DETAILS } = gsGlobals.gsTabState;
const { reportPageView } = gsGlobals.gsAnalytics;
const { sendRequestInfoToContentScript } = gsGlobals.gsMessages;

const { calculateTabStatus } = gsGlobals.gsTgs;

const currentTabs = {};

function getDebugInfo(tabId, callback) {
  const timerDetails = getTabStatePropForTabId(tabId, STATE_TIMER_DETAILS);
  const info = {
    windowId: '',
    tabId: '',
    status: STATUS_UNKNOWN,
    timerUp: timerDetails ? timerDetails.suspendDateTime : '-',
  };

  chrome.tabs.get(tabId, function(tab) {
    if (chrome.runtime.lastError) {
      error(tabId, chrome.runtime.lastError);
      callback(info);
      return;
    }

    info.windowId = tab.windowId;
    info.tabId = tab.id;
    if (isNormalTab(tab, true)) {
      sendRequestInfoToContentScript(tab.id, function(error, tabInfo) {
        if (error) {
          warning(tab.id, 'Failed to getDebugInfo', error);
        }
        if (tabInfo) {
          calculateTabStatus(tab, tabInfo.status, function(status) {
            info.status = status;
            callback(info);
          });
        } else {
          callback(info);
        }
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      calculateTabStatus(tab, null, function(status) {
        info.status = status;
        callback(info);
      });
    }
  });
}

function generateTabInfo(info) {
  // console.log(info.tabId, info);
  const timerStr =
    info && info.timerUp && info && info.timerUp !== '-'
      ? new Date(info.timerUp).toLocaleString()
      : '-';
  let html = '';
  let favicon = info && info.tab ? info.tab.favIconUrl : '';
  const windowId = info && info.windowId ? info.windowId : '?';
  const tabId = info && info.tabId ? info.tabId : '?';
  const tabIndex = info && info.tab ? info.tab.index : '?';
  const tabTitle = info && info.tab ? htmlEncode(info.tab.title) : '?';
  const tabTimer = timerStr;
  const tabStatus = info ? info.status : '?';

  favicon =
    favicon && favicon.indexOf('data') === 0
      ? favicon
      : generateChromeFavIconUrlFromUrl(info.tab.url);

  html += '<tr>';
  html += '<td>' + windowId + '</td>';
  html += '<td>' + tabId + '</td>';
  html += '<td>' + tabIndex + '</td>';
  html += '<td><img src=' + favicon + '></td>';
  html += '<td>' + tabTitle + '</td>';
  html += '<td>' + tabTimer + '</td>';
  html += '<td>' + tabStatus + '</td>';
  html += '</tr>';

  return html;
}

async function fetchInfo() {
  const tabs = await tabsQuery();
  const debugInfoPromises = [];
  for (const [i, curTab] of tabs.entries()) {
    currentTabs[tabs[i].id] = tabs[i];
    debugInfoPromises.push(
      new Promise(r =>
        getDebugInfo(curTab.id, o => {
          o.tab = curTab;
          r(o);
        })
      )
    );
  }
  const debugInfos = await Promise.all(debugInfoPromises);
  for (const debugInfo of debugInfos) {
    const tableEl = document.getElementById('gsProfilerBody');
    const html = generateTabInfo(debugInfo);
    tableEl.innerHTML = tableEl.innerHTML + html;
  }
}

function addFlagHtml(elementId, getterFn, setterFn) {
  document.getElementById(elementId).innerHTML = getterFn();
  document.getElementById(elementId).onclick = function() {
    const newVal = !getterFn();
    setterFn(newVal);
    document.getElementById(elementId).innerHTML = newVal;
  };
}

documentReadyAndLocalisedAsPromsied(document).then(async function() {
  await fetchInfo();
  addFlagHtml(
    'toggleDebugInfo',
    () => isDebugInfo(),
    newVal => setDebugInfo(newVal)
  );
  addFlagHtml(
    'toggleDebugError',
    () => isDebugError(),
    newVal => setDebugError(newVal)
  );
  addFlagHtml(
    'toggleDiscardInPlaceOfSuspend',
    () => getOption(DISCARD_IN_PLACE_OF_SUSPEND),
    newVal => {
      setOptionAndSync(DISCARD_IN_PLACE_OF_SUSPEND, newVal);
    }
  );
  addFlagHtml(
    'toggleUseAlternateScreenCaptureLib',
    () => getOption(USE_ALT_SCREEN_CAPTURE_LIB),
    newVal => {
      setOptionAndSync(USE_ALT_SCREEN_CAPTURE_LIB, newVal);
    }
  );
  document.getElementById('claimSuspendedTabs').onclick = async function() {
    const tabs = await tabsQuery();
    for (const tab of tabs) {
      if (isSuspendedTab(tab, true) && tab.url.indexOf(chrome.runtime.id) < 0) {
        const newUrl = tab.url.replace(getRootUrl(tab.url), chrome.runtime.id);
        await tabsUpdate(tab.id, { url: newUrl });
      }
    }
  };

  const extensionsUrl = `chrome://extensions/?id=${chrome.runtime.id}`;
  document.getElementById('backgroundPage').setAttribute('href', extensionsUrl);
  document.getElementById('backgroundPage').onclick = function() {
    chrome.tabs.create({ url: extensionsUrl });
  };

  /*
        chrome.processes.onUpdatedWithMemory.addListener(function (processes) {
            chrome.tabs.query({}, function (tabs) {
                var html = '';
                html += generateMemStats(processes);
                html += '<br />';
                html += generateTabStats(tabs);
                document.getElementById('gsProfiler').innerHTML = html;
            });
        });
        */
});
reportPageView('debug.html');
