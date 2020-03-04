import { Tabs, browser } from 'webextension-polyfill-ts';
import render from 'preact-render-to-string';

import SuspendedPage from '../components/Suspended';
import PlaceholderPage from '../components/Placeholder';
import IFrameContainerPage from '../components/IFrameContainer';

import {
  buildFaviconMetaFromChromeFaviconCache,
  saveFaviconMetaDataToCache,
  FALLBACK_CHROME_FAVICON_META,
} from '../gsFavicon';

import {
  fetchTabInfo,
  addPreviewImage,
  addSuspendedTabInfo,
} from '../gsIndexedDb';

import { getSettings, NO_NAG, THEME, SCREEN_CAPTURE } from '../gsStorage';
import {
  log,
  encodeString,
  encodeStringForDataUrl,
  generateEncodedQueryString,
  getOriginalUrlFromSuspendedUrl,
  getTitleFromSuspendedUrl,
  getScrollPositionFromSuspendedUrl,
  htmlEncode,
  isSuspendedTab,
} from '../gsUtils';
import { getFaviconMetaData } from '../gsFavicon';
import { setTabStatePropForTabId } from '../gsTabState';
import {
  getScrollPosForTabId,
  setStatusForTabId,
  getFaviconMetaForTabId,
  setFaviconMetaForTabId,
} from '../helpers/tabStates';
import { isCurrentFocusedTab } from '../gsTgs';
import { getSettingsStateHash } from '../helpers/extensionState';

export const DATAURL_PREFIX = 'data:text/html;charset=UTF-8,';
export const INTERNAL_MSG_URL = 'https://thegreatsuspender.com/';
export const KEYBOARD_SHORTCUTS_PREFIX = 'shortcuts?';
export const SUSPENDED_IFRAME_PREFIX = 'iframe?';
export const SUSPEND_URL_PREFIX = 'suspend?';
export const SUSPEND_URL_KEY_DATA = 'data';

export type SuspendQueryStringProps = {
  [SUSPEND_URL_KEY_DATA]: string;
};

export type FaviconMeta = {
  favIconUrl: string;
  isDark: boolean;
  normalisedDataUrl: string;
  transparentDataUrl: string;
};

export type SuspendProps = {
  url: string;
  title: string;
  scrollPos: number;
  faviconMeta: FaviconMeta;
  previewMode: string;
  theme: string;
};

export type SuspendedProps = {
  u: string;
  p: number;
  t: string;
};

// const getPreviewUrl = (url: string): string | undefined => {
//   const previewMode = options[SCREEN_CAPTURE];
//   const preview = await fetchPreviewImage(url);
//   let previewUri = null;
//   if (
//     preview &&
//     preview.img &&
//     preview.img !== null &&
//     preview.img !== 'data:,' &&
//     preview.img.length > 10000
//   ) {
//     previewUri = preview.img;
//   }
// };

export const makeDataUrl: (text: string) => string = text => {
  return `${DATAURL_PREFIX}${encodeStringForDataUrl(text)}`;
};

export const generateIframeContainerDataUrl: (
  suspendedProps: SuspendedProps,
  faviconMeta: FaviconMeta
) => string = (suspendedProps, faviconMeta) => {
  const html = render(IFrameContainerPage(suspendedProps, faviconMeta));
  return makeDataUrl(html);
};

export const generateIframeContentsDataUrl: (
  suspendedProps: SuspendedProps,
  faviconMeta: FaviconMeta
) => string = (suspendedProps, faviconMeta) => {
  const { t: title, u: url, p: scrollPos } = suspendedProps;
  const options = getSettings();

  const previewMode = options[SCREEN_CAPTURE] || '0';
  const theme = options[THEME];

  const suspendedPageHtml = render(
    SuspendedPage({
      title,
      url,
      scrollPos,
      faviconMeta,
      previewMode,
      theme,
    })
  );

  return makeDataUrl(suspendedPageHtml);
};

export const generateSuspendedPropsFromTab: (
  tab: { url: string; title: string },
  scrollPos: number
) => SuspendedProps = (tab, scrollPos) => {
  const url = tab.url || '';
  let title = tab.title || '';
  // Encode any raw html tags that might be used in the title
  if (title.indexOf('<') >= 0) {
    title = htmlEncode(tab.title);
  }
  const suspendedProps: SuspendedProps = {
    u: url,
    p: scrollPos,
    t: title,
  };
  return suspendedProps;
};

export const generateSuspendUrl: (
  tab: { url: string; title: string },
  scrollPos?: number,
  usePlaceholder?: boolean
) => string = (tab, scrollPos = 0, usePlaceholder = false) => {
  const suspendedProps = generateSuspendedPropsFromTab(tab, scrollPos);

  return `${INTERNAL_MSG_URL}${SUSPEND_URL_PREFIX}${generateEncodedQueryString(
    suspendedProps
  )}`;
};

export const fetchYouTubeTimestampContentScript = () => {
  const videoEl: any = document.querySelector(
    'video.video-stream.html5-main-video'
  );
  const timestamp = videoEl ? videoEl.currentTime >> 0 : 0;
  return timestamp;
};

export const generateUrlWithYouTubeTimestamp = async (
  tab: Tabs.Tab
): Promise<string> => {
  if (!tab.url) return '';
  if (tab.url.indexOf('https://www.youtube.com/watch') < 0) {
    return tab.url;
  }

  const timestamp = await browser.tabs.executeScript(tab.id, {
    code: `(${fetchYouTubeTimestampContentScript})();`,
  });
  const youTubeUrl = new URL(tab.url);
  youTubeUrl.searchParams.set('t', timestamp + 's');
  return youTubeUrl.href;
};

export const saveSuspendData = async (tab: Tabs.Tab): Promise<void> => {
  const tabProperties = {
    date: new Date(),
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned,
    index: tab.index,
    windowId: tab.windowId,
  };
  await addSuspendedTabInfo(tabProperties);

  const faviconMeta = await buildFaviconMetaFromChromeFaviconCache(tab.url);
  if (faviconMeta) {
    await saveFaviconMetaDataToCache(tab.url, faviconMeta);
  }
};

export const reinitialiseSuspendedTab: (tab: Tabs.Tab) => void = tab => {
  if (!tab.url || !tab.id || !isSuspendedTab(tab)) {
    return false;
  }

  log(tab.id, 'Initialising suspended tab');

  const scrollPos = getScrollPositionFromSuspendedUrl(tab.url);
  const url = getOriginalUrlFromSuspendedUrl(tab.url);
  const title = getTitleFromSuspendedUrl(tab.url);

  const suspendUrl = generateSuspendUrl({ url, title }, scrollPos);
  browser.tabs.update(tab.id, {
    url: suspendUrl,
  });
};

export const suspendTab: (tab: Tabs.Tab) => Promise<boolean> = async tab => {
  if (!tab.url || !tab.id) {
    return false;
  }

  log(tab.id, 'Suspending tab');

  const timestampedUrl = await generateUrlWithYouTubeTimestamp(tab);
  await saveSuspendData({ ...tab, url: timestampedUrl });

  const scrollPos = getScrollPosForTabId(tab.id);
  const usePlaceholder = !isCurrentFocusedTab(tab);

  const faviconMeta = await getFaviconMetaData(tab);
  setFaviconMetaForTabId(tab.id, faviconMeta);

  const suspendUrl = generateSuspendUrl(
    { title: tab.title || '', url: tab.url || '' },
    scrollPos,
    usePlaceholder
  );
  const updatedTab = await browser.tabs.update(tab.id, {
    url: suspendUrl,
  });

  return updatedTab !== null;
};
