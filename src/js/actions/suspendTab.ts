import { Tabs, browser } from 'webextension-polyfill-ts';
import render from 'preact-render-to-string';

import SuspendedPage from '../components/Suspended';
import PlaceholderPage from '../components/Placeholder';

import {
  buildFaviconMetaFromChromeFaviconCache,
  saveFaviconMetaDataToCache,
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
  encodeString2,
  generateQueryString,
  htmlEncode,
} from '../gsUtils';
import { getFaviconMetaData } from '../gsFavicon';
import { setTabStatePropForTabId } from '../gsTabState';
import { getScrollPosForTabId, setStatusForTabId } from '../helpers/tabStates';
import { isCurrentFocusedTab } from '../gsTgs';

export const UNSUSPEND_URL_PREFIX = 'unsuspend?';
export const SUSPEND_URL_PREFIX = 'suspend?';
export const SUSPEND_URL_KEY_DATA = 'data';
export const SUSPENDED_DATAURL_PREFIX = 'data:text/html;charset=UTF-8,';
export const SUSPENDED_METADATA_PREFIX = '<!--TGS';
export const SUSPENDED_METADATA_SUFFIX = '-->';

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

export const generateDataUrl: (
  tab: Tabs.Tab,
  scrollPos: number,
  usePlaceholder: boolean
) => Promise<string> = async (tab, scrollPos, usePlaceholder) => {
  const url = tab.url || '';
  let title = tab.title || '';
  // Encode any raw html tags that might be used in the title
  console.log('title', title);
  if (title.indexOf('<') >= 0) {
    title = htmlEncode(tab.title);
  }
  console.log('title', title);

  const args: SuspendedProps = { u: url, p: scrollPos, t: title };
  const argsString = JSON.stringify(args);

  const options = getSettings();

  // TODO: Implement settings change hash system for comparison to last rendered suspended page
  // const settingsHash = options.hash();

  const previewMode = options[SCREEN_CAPTURE] || '0';
  const theme = options[THEME];
  const faviconMeta = await getFaviconMetaData(tab);

  const initialisedHtml = render(
    SuspendedPage({
      title,
      url,
      scrollPos,
      faviconMeta,
      previewMode,
      theme,
    })
  );
  const placeholderHtml = render(PlaceholderPage({ url, faviconMeta, title }));

  // const iframeSrcString = browser.runtime.getURL(
  //   `suspended.html?${generateQueryString(args)}`
  // );

  // console.log('iframeSrcString', iframeSrcString);

  // const initialisedHtml = `<iframe src="${iframeSrcString}" style="position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;"></iframe>`;
  // const placeholderHtml = `<iframe style="position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;"></iframe>
  // <a href='${url}'>${url}</a>
  // <script>
  //     const h = () => {
  //         console.log('initialising..');
  //         document.removeEventListener('visibilitychange', h, false);
  //         document.body.innerHTML = ${initialisedHtml};
  //     };
  //     document.addEventListener('visibilitychange', h, false);
  // </script>`;

  // const html = `
  //   <!--${args.join(';')}-->
  //   <title>${title}</title>
  //   <link rel="icon" href=${favicon} />
  // <iframe style="position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;" />
  // <script>
  //   console.log('showing..');
  //   const h = () => {
  //     console.log('hidden', document.hidden);
  //     if (!document.hidden) {
  //       document.querySelector('iframe').setAttribute('src', '${iframeSrcString}');
  //       document.querySelector('body').classList.remove('hide-initially');
  //     }
  //   };
  //   document.addEventListener('visibilitychange', h, false);
  //   </script>
  // `;

  const html = `${SUSPENDED_METADATA_PREFIX}${argsString}${SUSPENDED_METADATA_SUFFIX}
    ${usePlaceholder ? placeholderHtml : initialisedHtml}`;

  return `${SUSPENDED_DATAURL_PREFIX}${encodeString2(html)}`;
  // return `${SUSPENDED_DATAURL_PREFIX}${encodeString(html)}`;
  // return `data:text/html,${encodeString(html)}`;
};

export const generateSuspendUrl: (dataUrl: string) => string = dataUrl => {
  return browser.runtime.getURL(
    `${SUSPEND_URL_PREFIX}${SUSPEND_URL_KEY_DATA}=${dataUrl}`
  );
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

export const suspendTab: (tab: Tabs.Tab) => Promise<boolean> = async tab => {
  if (!tab.url || !tab.id) {
    return false;
  }

  log(tab.id, 'Suspending tab');

  const timestampedUrl = await generateUrlWithYouTubeTimestamp(tab);
  await saveSuspendData({ ...tab, url: timestampedUrl });

  const scrollPos = getScrollPosForTabId(tab.id);
  const usePlaceholder = !isCurrentFocusedTab(tab);
  const dataUrl = await generateDataUrl(tab, scrollPos, usePlaceholder);

  const suspendUrl = generateSuspendUrl(dataUrl);
  const updatedTab = await browser.tabs.update(tab.id, {
    url: suspendUrl,
  });

  return updatedTab !== null;
};
