declare const _url: string;

import { h } from 'preact';
import { browser } from 'webextension-polyfill-ts';

import styles from '../../css/suspended.css';

import ScreenCapture from './Screencapture';

import {
  SuspendProps,
  UNSUSPEND_URL_PREFIX,
  SUSPENDED_DATAURL_PREFIX,
  SUSPENDED_METADATA_PREFIX,
  SUSPENDED_METADATA_SUFFIX,
} from '../actions/suspendTab';

import { FALLBACK_CHROME_FAVICON_META } from '../gsFavicon';

import {
  log,
  warning,
  htmlEncode,
  getCleanUrl,
  localiseHtml,
  getOriginalUrl,
  getSuspendedScrollPosition,
} from '../gsUtils';
import { getSessionId } from '../gsSession';
import { getFaviconMetaData } from '../gsFavicon';
import {
  STATE_SHOW_NAG,
  STATE_SUSPEND_REASON,
  setTabStatePropForTabId,
  getTabStatePropForTabId,
} from '../gsTabState';
import { getSettings, NO_NAG, THEME, SCREEN_CAPTURE } from '../gsStorage';
import { fetchPreviewImage } from '../gsIndexedDb';
import {
  registerViewGlobal,
  VIEW_FUNC_SUSPENDED_TAB_UPDATE_COMMAND,
} from '../gsViews';

import {
  unsuspendTab,
  isCurrentFocusedTab,
  getSuspensionToggleHotkey,
} from '../gsTgs';

import snoozyAsleep from '../../img/snoozy_tab.svg';
import snoozyAwake from '../../img/snoozy_tab_awake.svg';

export default ({
  url,
  scrollPos = 0,
  title,
  faviconMeta = FALLBACK_CHROME_FAVICON_META,
  previewMode,
  theme,
}: SuspendProps): preact.JSX.Element => {
  // const handleBlockedClick = (e: Event): void => {
  //   e.stopPropagation();
  // };

  const unsuspendUrl = `${browser.runtime.getURL(UNSUSPEND_URL_PREFIX)}`;

  const handleUnsuspendTab = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    // if (e.which === 1) {
    if (document.body.classList.contains('img-preview-mode')) {
      document.querySelector('.refreshSpinner')?.classList.add('spinner');
    } else {
      document.body.classList.add('waking');
      document.querySelector('.snoozySpinner')?.classList.add('spinner');
    }
    // const url = new URL(_unsuspendUrl);
    // url.searchParams.append('p', _scrollPos);
    // url.searchParams.append('u', _url);
    // window.location.href = url.href;
    window.location.href = _url;
    // }
  };

  const handleUnload = () => {
    console.log('Unload triggered');
  };

  console.log('initialising..');

  // const originalUrl = getOriginalUrl(suspendedUrl);

  // // Add event listeners
  // setUnloadTabHandler(tabView.window, tab);

  // if (previewMode !== '0') {
  //   <div
  //     id="gsPreviewContainer"
  //     class="gsPreviewContainer"
  //     onclick={handleUnsuspendTab}
  //   >
  //     <div id="gsPreviewImg" class="gsPreviewImg">
  //       {/* {ScreenCapture(previewUri)} */}
  //     </div>
  //   </div>;
  //   _document.getElementById('gsPreviewContainer').style.display = 'none';
  //   _document.getElementById('suspendedMsg').style.display = 'flex';
  //   _document.body.classList.remove('img-preview-mode');
  // } else {
  //   _document.querySelector('.watermark').onclick = () => {
  //     chrome.tabs.create({ url: chrome.runtime.getURL('about.html') });
  //   };
  //   _document.getElementById('gsPreviewContainer').style.display = 'block';
  //   _document.getElementById('suspendedMsg').style.display = 'none';
  //   _document.body.classList.add('img-preview-mode');
  // }

  const previewOverflow = previewMode === '2' ? 'auto' : 'hidden';
  const isDarkTheme = theme === 'dark';
  const isLowContrastFavicon = faviconMeta.isDark;

  // // Set showNag
  // if (!options[NO_NAG] && (showNag === undefined || showNag === null)) {
  //   //show dude and donate link (randomly 1 of 20 times)
  //   showNag = Math.random() > 0.95;
  // }
  // setTabStatePropForTabId(tab.id, STATE_SHOW_NAG, showNag);

  // if (showNag) {
  //   queueDonationPopup(tabView.window, tabView.document, tab.active, tab.id);
  // }

  // // Set command
  // const suspensionToggleHotkey = await getSuspensionToggleHotkey();
  // setCommand(tabView.document, suspensionToggleHotkey);
  // export const setCommand = (_document, command) => {
  //   const hotkeyEl = _document.getElementById('hotkeyWrapper');
  //   if (command) {
  //     hotkeyEl.innerHTML = '<span class="hotkeyCommand">(' + command + ')</span>';
  //   } else {
  //     const reloadString = chrome.i18n.getMessage(
  //       'js_suspended_hotkey_to_reload'
  //     );
  //     hotkeyEl.innerHTML = `<a id="setKeyboardShortcut" href="#">${reloadString}</a>`;
  //   }
  // };

  // // Set reason
  // const suspendReasonInt = getTabStatePropForTabId(
  //   tab.id,
  //   STATE_SUSPEND_REASON
  // );
  // let suspendReason = null;
  // if (suspendReasonInt === 3) {
  //   suspendReason = chrome.i18n.getMessage('js_suspended_low_memory');
  // }
  // setReason(tabView.document, suspendReason);

  // // Set scrollPosition (must come after showing page contents)
  // const scrollPosition = getSuspendedScrollPosition(suspendedUrl);
  // setScrollPosition(tabView.document, scrollPosition, previewMode);
  // setTabStatePropForTabId(tab.id, STATE_SCROLL_POS, scrollPosition);
  // // const whitelisted = checkWhiteList(originalUrl);

  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <title>{title}</title>
        <link rel="icon" href={faviconMeta.transparentDataUrl} />
        <style>{styles.toString()}</style>
      </head>
      <body
        class={isDarkTheme ? 'dark' : ''}
        style={{ overflow: previewOverflow }}
      >
        <script type="text/html" id="donateTemplate">
          <link
            id="donateCss"
            rel="stylesheet"
            type="text/css"
            href="css/donate.css"
          />
          <img
            id="dudePopup"
            src={browser.extension.getURL('img/suspendy-guy.png')}
          />
          <div id="donateBubble" class="donateBubble">
            <p
              class="donate-text"
              data-i18n="__MSG_html_suspended_donation_question__"
            ></p>
            <div id="donateButtons" class="donateButtons" />
          </div>
        </script>

        <script type="text/html" id="toastTemplate">
          <div class="toast-content">
            <h1 data-i18n="__MSG_html_suspended_toast_not_connected__"></h1>
            <p data-i18n="__MSG_html_suspended_toast_reload_disabled__"></p>
          </div>
        </script>

        <div id="gsTopBar" class="gsTopBar" onClick={() => alert('here!')}>
          <div id="gsTopBarTitleWrap" class="hideOverflow gsTopBarTitleWrap">
            <div
              id="faviconWrap"
              class={`faviconWrap ${
                isDarkTheme && isLowContrastFavicon
                  ? 'faviconWrapLowContrast'
                  : ''
              }`}
            >
              <img
                id="gsTopBarImg"
                class="gsTopBarImg"
                src={faviconMeta.normalisedDataUrl}
              />
            </div>
            <span
              id="gsTopBarTitle"
              class="gsTopBarTitle"
              // onmousedown={handleBlockedClick}
            >
              {title}
            </span>
          </div>
          <div class="hideOverflow">
            <a
              id="gsTopBarUrl"
              class="gsTopBarUrl"
              href={url}
              // onmousedown={handleBlockedClick
              onClick={handleUnsuspendTab}
            >
              {getCleanUrl(url)}
            </a>
          </div>
        </div>

        <div class="suspendedMsg" onClick={handleUnsuspendTab}>
          <div class="snoozyWrapper">
            <div
              class="snoozyAsleep"
              dangerouslySetInnerHTML={{ __html: snoozyAsleep }}
            />
            <div
              class="snoozyAwake"
              dangerouslySetInnerHTML={{ __html: snoozyAwake }}
            />
            <div class="snoozySpinner"></div>
          </div>
          <div class="suspendedTextWrap">
            <div class="suspendedMsg-instr">
              <div data-i18n="__MSG_html_suspended_click_to_reload__"></div>
            </div>
            <div class="suspendedMsg-shortcut">
              <span class="hotkeyWrapper"></span>
            </div>
          </div>
        </div>
        <div class="watermark">The Great Suspender</div>

        <div class="refreshSpinner"></div>

        {/* prettier-ignore */}
        <script>
          const _unsuspendUrl = '{unsuspendUrl}';
          const _scrollPos = '{scrollPos}';
          const _url = '{url}';
          window.addEventListener('beforeunload', {handleUnload});
          document.querySelector('.gsTopBarUrl').onclick = {handleUnsuspendTab};
          document.querySelector('.gsTopBar').onmousedown = {handleUnsuspendTab};
          document.querySelector('.suspendedMsg').onclick = {handleUnsuspendTab};
        </script>
      </body>
    </html>
  );
};
