let gsGlobals;
try {
  gsGlobals = chrome.extension.getBackgroundPage().gsGlobals;
  if (!gsGlobals) throw new Error();
} catch (e) {
  window.setTimeout(() => window.location.reload(), 1000);
  return;
}

const { documentReadyAndLocalisedAsPromsied } = gsGlobals.gsUtils;
const { getUpdateType, isUpdated } = gsGlobals.gsSession;
const { registerViewGlobal, VIEW_FUNC_UPDATED_TOGGLE } = gsGlobals.gsViews;

const toggleUpdated = () => {
  document.getElementById('updating').style.display = 'none';
  document.getElementById('updated').style.display = 'block';
};

documentReadyAndLocalisedAsPromsied(document).then(function() {
  const versionEl = document.getElementById('updatedVersion');
  versionEl.innerHTML = 'v' + chrome.runtime.getManifest().version;

  document.getElementById('sessionManagerLink').onclick = function(e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.extension.getURL('history.html') });
  };

  const updateType = getUpdateType();
  if (updateType === 'major') {
    document.getElementById('patchMessage').style.display = 'none';
    document.getElementById('minorUpdateDetail').style.display = 'none';
  } else if (updateType === 'minor') {
    document.getElementById('patchMessage').style.display = 'none';
    document.getElementById('majorUpdateDetail').style.display = 'none';
  } else {
    document.getElementById('updateDetail').style.display = 'none';
  }

  if (isUpdated()) {
    toggleUpdated();
  }
});

registerViewGlobal(window, VIEW_FUNC_UPDATED_TOGGLE, toggleUpdated);
