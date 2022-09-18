/*
  MV2 - Background page	        MV3 - Service worker
  Can use a persistent page.	  Terminates when not in use.
  Has access to the DOM.	      Doesn't have access to the DOM.
  Can use XMLHttpRequest().	    Must use fetch() to make requests.
  
  REF: https://developer.chrome.com/docs/extensions/mv3/intro/mv3-migration/#background-service-workers
*/

import "js/gsUtils.js"
import "js/gsChrome.js"
import "js/gsStorage.js"
import "js/db.js"
import "js/gsIndexedDb.js"
import "js/gsMessages.js"
import "js/gsSession.js"
import "js/gsTabQueue.js"
import "js/gsTabCheckManager.js"
import "js/gsFavicon.js"
import "js/gsCleanScreencaps.js"
import "js/gsTabSuspendManager.js"
import "js/gsTabDiscardManager.js"
import "js/gsSuspendedTab.js"
import "js/background.js"
