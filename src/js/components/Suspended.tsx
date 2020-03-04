declare const _url: string;

import { h } from 'preact';
import { browser } from 'webextension-polyfill-ts';

import styles from '../../css/suspended.css';

import ScreenCapture from './Screencapture';

import {
  SuspendProps,
  KEYBOARD_SHORTCUTS_PREFIX,
  INTERNAL_MSG_URL,
} from '../actions/suspendTab';

import { FALLBACK_CHROME_FAVICON_META } from '../gsFavicon';

import {
  log,
  warning,
  htmlEncode,
  getCleanUrl,
  localiseHtml,
  getOriginalUrlFromSuspendedUrl,
  getScrollPositionFromSuspendedUrl,
} from '../gsUtils';
import { getSessionId } from '../gsSession';
import { getFaviconMetaData } from '../gsFavicon';
import {
  setTabStatePropForTabId,
  getTabStatePropForTabId,
} from '../gsTabState';
import { getSettings, THEME, SCREEN_CAPTURE } from '../gsStorage';
import { fetchPreviewImage } from '../gsIndexedDb';

import { unsuspendTab, isCurrentFocusedTab } from '../gsTgs';

import snoozyAsleep from '../../img/snoozy_tab.svg';
import snoozyAwake from '../../img/snoozy_tab_awake.svg';
import { getSuspensionToggleHotkey } from '../helpers/extensionState';

export default ({
  url,
  scrollPos = 0,
  title,
  faviconMeta = FALLBACK_CHROME_FAVICON_META,
  previewMode,
  theme,
}: SuspendProps): preact.JSX.Element => {
  const preventPropagation = (e: Event): void => {
    e.stopPropagation();
  };

  const handleUnsuspendTab = (e: Event): void => {
    if (document.body.classList.contains('img-preview-mode')) {
      document.querySelector('.refreshSpinner')?.classList.add('spinner');
    } else {
      document.body.classList.add('waking');
      document.querySelector('.snoozySpinner')?.classList.add('spinner');
    }
  };

  console.log('initialising..');

  // const originalUrl = getOriginalUrlFromSuspendedUrl(suspendedUrl);

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

  const suspensionToggleHotkey = getSuspensionToggleHotkey();
  const command = suspensionToggleHotkey
    ? `(${suspensionToggleHotkey})`
    : browser.i18n.getMessage('js_suspended_hotkey_to_reload');

  // // Set scrollPosition (must come after showing page contents)
  // const scrollPosition = getScrollPositionFromSuspendedUrl(suspendedUrl);
  // setScrollPosition(tabView.document, scrollPosition, previewMode);
  // setTabStatePropForTabId(tab.id, STATE_SCROLL_POS, scrollPosition);
  // // const whitelisted = checkWhiteList(originalUrl);

  return (
    <html>
      <head>
        {/* <meta charSet="UTF-8" /> */}
        {/* <title>{title}</title>
        <link rel="icon" href={faviconMeta.transparentDataUrl} /> */}
        <style>{styles.toString()}</style>
      </head>
      <body
        class={isDarkTheme ? 'dark' : ''}
        style={{ overflow: previewOverflow }}
      >
        <div id="gsTopBar" class="gsTopBar">
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
            <span id="gsTopBarTitle" class="gsTopBarTitle">
              {title}
            </span>
          </div>
          <div class="hideOverflow">
            <a id="gsTopBarUrl" class="gsTopBarUrl" href={url} target="_parent">
              {getCleanUrl(url)}
            </a>
          </div>
        </div>

        <a class="suspendedMsg" href={url} target="_parent">
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
              <span class="hotkeyWrapper">
                {suspensionToggleHotkey ? (
                  <span class="hotkeyCommand">{command}</span>
                ) : (
                  <a
                    class="setKeyboardShortcut"
                    target="#"
                    href={`${INTERNAL_MSG_URL}${KEYBOARD_SHORTCUTS_PREFIX}`}
                  >
                    {command}
                  </a>
                )}
              </span>
            </div>
          </div>
        </a>
        <div class="watermark">The Great Suspender</div>

        <div class="refreshSpinner"></div>

        {/* prettier-ignore */}
        <script>
          {/* const _scrollPos = '{scrollPos}';
          const _url = '{url}'; */}
          document.querySelector('.gsTopBarUrl').onclick = {handleUnsuspendTab};
          document.querySelector('.suspendedMsg').onclick = {handleUnsuspendTab};
          const el = document.querySelector('.setKeyboardShortcut');
          if (el) el.onclick = {preventPropagation};
        </script>
      </body>
    </html>
  );
};
