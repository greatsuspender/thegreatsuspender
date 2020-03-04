export const VIEW_FUNC_OPTIONS_REINIT = 'viewOptionsReinit';
export const VIEW_FUNC_UPDATED_TOGGLE = 'viewUpdatedToggle';
export const VIEW_FUNC_RECOVERY_REMOVE_TAB = 'viewRecoveryRemoveTab';

export const registerViewGlobal = (view, key, fn) => {
  view.exports = { [key]: fn };
};

export const executeViewGlobal = (tabId, key) => {
  const view = getInternalViewByTabId(tabId);
  if (view && view.exports) {
    view.exports[key]();
  }
};

export const executeViewGlobalsForViewName = (viewName, key) => {
  const views = getInternalViewsByViewName(viewName);
  for (const view of views) {
    if (view && view.exports) {
      view.exports[key]();
    }
  }
  return views;
};

export function getInternalViewByTabId(tabId) {
  const internalViews = chrome.extension.getViews({ tabId: tabId });
  if (internalViews.length === 1) {
    return internalViews[0];
  }
  return null;
}

function getInternalViewsByViewName(viewName) {
  const internalViews = chrome.extension
    .getViews()
    .filter(o => o.location.pathname.indexOf(viewName) >= 0);
  return internalViews;
}
