import * as gsTgs from './gsTgs';
import * as gsStorage from './gsStorage';
import * as gsAnalytics from './gsAnalytics';
import * as gsFavicon from './gsFavicon';
import * as gsTabSuspendManager from './gsTabSuspendManager';
import * as gsTabCheckManager from './gsTabCheckManager';
import * as gsIndexedDb from './gsIndexedDb';
import * as gsSession from './gsSession';
import * as gsMessages from './gsMessages';
import * as gsUtils from './gsUtils';
import * as gsChrome from './gsChrome';
import * as gsSuspendedTab from './gsSuspendedTab';
import * as gsTabState from './gsTabState';
import * as gsViews from './gsViews';
import * as gsHistoryItems from './gsHistoryItems';
import * as gsHistoryUtils from './gsHistoryUtils';

export default {
  gsTgs: { ...gsTgs },
  gsAnalytics: { ...gsAnalytics },
  gsFavicon: { ...gsFavicon },
  gsTabSuspendManager: { ...gsTabSuspendManager },
  gsTabCheckManager: { ...gsTabCheckManager },
  gsIndexedDb: { ...gsIndexedDb },
  gsSession: { ...gsSession },
  gsMessages: { ...gsMessages },
  gsUtils: { ...gsUtils },
  gsChrome: { ...gsChrome },
  gsSuspendedTab: { ...gsSuspendedTab },
  gsTabState: { ...gsTabState },
  gsViews: { ...gsViews },
  gsStorage: { ...gsStorage },
  gsHistoryItems: { ...gsHistoryItems },
  gsHistoryUtils: { ...gsHistoryUtils },
};
