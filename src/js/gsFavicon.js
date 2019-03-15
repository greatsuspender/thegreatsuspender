/*global gsUtils, gsIndexedDb */
// eslint-disable-next-line no-unused-vars
var gsFavicon = (function() {
  'use strict';

  // const GOOGLE_S2_URL = 'https://www.google.com/s2/favicons?domain_url=';
  const FALLBACK_CHROME_FAVICON_META = {
    favIconUrl: 'chrome://favicon/size/16@2x/fallbackChromeFaviconMeta',
    isDark: true,
    normalisedDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVQ4T2NkoBAwIuuPior6j8O8xmXLljVgk8MwYNmyZdgMfcjAwLAAmyFEGfDv3z9FJiamA9gMIcoAkKsiIiIUsBlClAHofkf2JkED0DWDAnrUgOEfBsRkTpzpgBjN6GoA24V1Efr1zoAAAAAASUVORK5CYII=',
    transparentDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVQ4T2NkoBAwIuuPioqqx2YeExPTwSVLlhzAJodhwLJlyxrRDWVkZPzIyMh4AZshRBnAxsY28ffv3wnYDCHKAJCrEhISBLAZQpQB6H5H9iZBA9A1gwJ61IDhHwbEZE6c6YAYzehqAAmQeBHM42eMAAAAAElFTkSuQmCC',
  };

  const _defaultFaviconFingerprintById = {};
  let _defaultChromeFaviconMeta;

  async function initAsPromised() {
    await addFaviconDefaults();
    gsUtils.log('gsFavicon', 'init successful');
  }

  async function addFaviconDefaults() {
    // Generate a list of potential 'default' favicons so we can avoid caching
    // anything that matches these defaults
    const defaultIconUrls = [
      generateChromeFavIconUrlFromUrl('http://chromeDefaultFavicon'),
      generateChromeFavIconUrlFromUrl('chromeDefaultFavicon'),
      chrome.extension.getURL('img/ic_suspendy_16x16.png'),
      chrome.extension.getURL('img/chromeDefaultFavicon.png'),
      chrome.extension.getURL('img/chromeDefaultFaviconSml.png'),
      chrome.extension.getURL('img/chromeDevDefaultFavicon.png'),
      chrome.extension.getURL('img/chromeDevDefaultFaviconSml.png'),
    ];

    const faviconPromises = [];
    for (let i = 0; i < defaultIconUrls.length; i += 1) {
      const iconUrl = defaultIconUrls[i];
      faviconPromises.push(
        new Promise(async resolve => {
          const faviconMeta = await addDefaultFaviconMeta(iconUrl);
          if (faviconMeta) {
            gsUtils.log(
              'gsFavicon',
              `Successfully built default faviconMeta for url: ${iconUrl}`,
              faviconMeta
            );
          } else {
            gsUtils.warning(
              'gsFavicon',
              `Failed to build faviconMeta for url: ${iconUrl}`
            );
          }
          // Set the first url as the default favicon
          if (i === 0) {
            _defaultChromeFaviconMeta =
              faviconMeta || FALLBACK_CHROME_FAVICON_META;
            gsUtils.log(
              'gsFavicon',
              'Set _defaultChromeFaviconMeta',
              _defaultChromeFaviconMeta
            );
          }
          resolve();
        })
      );
    }
    await Promise.all(faviconPromises);
  }

  async function addDefaultFaviconMeta(url) {
    let faviconMeta;
    try {
      faviconMeta = await gsUtils.executeWithRetries(
        buildFaviconMetaData,
        [url],
        4,
        0
      );
    } catch (e) {
      gsUtils.warning('gsFavicon', e);
    }
    addFaviconMetaToDefaultFingerprints(faviconMeta, url);
    return faviconMeta;
  }

  async function addFaviconMetaToDefaultFingerprints(faviconMeta, id) {
    _defaultFaviconFingerprintById[id] = await createImageFingerprint(
      faviconMeta.normalisedDataUrl
    );
    _defaultFaviconFingerprintById[
      id + 'Transparent'
    ] = await createImageFingerprint(faviconMeta.transparentDataUrl);
  }

  function generateChromeFavIconUrlFromUrl(url) {
    return 'chrome://favicon/size/16@2x/' + url;
  }

  async function getFaviconMetaData(tab) {
    if (gsUtils.isFileTab(tab)) {
      return _defaultChromeFaviconMeta;
    }

    // First try to fetch from cache
    let originalUrl = tab.url;
    if (gsUtils.isSuspendedTab(tab)) {
      originalUrl = gsUtils.getOriginalUrl(tab.url);
    }
    let faviconMeta = await getCachedFaviconMetaData(originalUrl);
    if (faviconMeta) {
      // gsUtils.log(
      //   tab.id,
      //   'Found favicon cache hit for url: ' + originalUrl,
      //   faviconMeta
      // );
      return faviconMeta;
    }

    // Else try to build from chrome's favicon cache
    faviconMeta = await buildFaviconMetaFromChromeFaviconCache(originalUrl);
    if (faviconMeta) {
      gsUtils.log(
        tab.id,
        'Saving faviconMeta from chrome://favicon into cache',
        faviconMeta
      );
      // Save to tgs favicon cache
      await saveFaviconMetaDataToCache(originalUrl, faviconMeta);
      return faviconMeta;
    }

    // Else try to build from tab.favIconUrl
    gsUtils.log(
      tab.id,
      'No entry in chrome favicon cache for url: ' + originalUrl
    );
    if (
      tab.favIconUrl &&
      tab.favIconUrl !== chrome.extension.getURL('img/ic_suspendy_16x16.png')
    ) {
      faviconMeta = await buildFaviconMetaFromTabFavIconUrl(tab.favIconUrl);
      if (faviconMeta) {
        gsUtils.log(
          tab.id,
          'Built faviconMeta from tab.favIconUrl',
          faviconMeta
        );
        return faviconMeta;
      }
    }

    // Else try to fetch from google
    // if (fallbackToGoogle) {
    //   const rootUrl = encodeURIComponent(gsUtils.getRootUrl(originalUrl));
    //   const tabFavIconUrl = GOOGLE_S2_URL + rootUrl;
    //   //TODO: Handle reject case below
    //   faviconMeta = await buildFaviconMetaData(tabFavIconUrl, 5000);
    //   faviconMetaValid = await isFaviconMetaValid(faviconMeta);
    //   if (faviconMetaValid) {
    //     gsUtils.log(
    //       tab.id,
    //       'Built faviconMeta from google.com/s2 service',
    //       faviconMeta
    //     );
    //     return faviconMeta;
    //   }
    // }

    // Else return the default chrome favicon
    gsUtils.log(tab.id, 'Failed to build faviconMeta. Using default icon');
    return _defaultChromeFaviconMeta;
  }

  async function buildFaviconMetaFromChromeFaviconCache(url) {
    const chromeFavIconUrl = generateChromeFavIconUrlFromUrl(url);
    gsUtils.log(
      'gsFavicon',
      `Building faviconMeta from url: ${chromeFavIconUrl}`
    );
    try {
      const faviconMeta = await buildFaviconMetaData(chromeFavIconUrl);
      const faviconMetaValid = await isFaviconMetaValid(faviconMeta);
      if (faviconMetaValid) {
        return faviconMeta;
      }
    } catch (e) {
      gsUtils.warning('gsUtils', e);
    }
    return null;
  }

  async function buildFaviconMetaFromTabFavIconUrl(favIconUrl) {
    try {
      const faviconMeta = await buildFaviconMetaData(favIconUrl);
      const faviconMetaValid = await isFaviconMetaValid(faviconMeta);
      if (faviconMetaValid) {
        return faviconMeta;
      }
    } catch (e) {
      gsUtils.warning('gsUtils', e);
    }
    return null;
  }

  async function getCachedFaviconMetaData(url) {
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    let faviconMetaData = await gsIndexedDb.fetchFaviconMeta(fullUrl);
    if (!faviconMetaData) {
      const rootUrl = gsUtils.getRootUrl(url, false, false);
      faviconMetaData = await gsIndexedDb.fetchFaviconMeta(rootUrl);
    }
    return faviconMetaData || null;
  }

  async function saveFaviconMetaDataToCache(url, faviconMeta) {
    const fullUrl = gsUtils.getRootUrl(url, true, false);
    const rootUrl = gsUtils.getRootUrl(url, false, false);
    gsUtils.log(
      'gsFavicon',
      'Saving favicon cache entry for: ' + fullUrl,
      faviconMeta
    );
    await gsIndexedDb.addFaviconMeta(fullUrl, Object.assign({}, faviconMeta));
    await gsIndexedDb.addFaviconMeta(rootUrl, Object.assign({}, faviconMeta));
  }

  // dont use this function as it causes rate limit issues
  // eslint-disable-next-line no-unused-vars
  // function fetchFallbackFaviconDataUrl(url) {
  //   return new Promise(resolve => {
  //     let imageLoaded = false;
  //
  //     const rootUrl = gsUtils.encodeString(gsUtils.getRootUrl(url));
  //     const requestUrl = GOOGLE_S2_URL + rootUrl;
  //
  //     const xmlHTTP = new XMLHttpRequest();
  //     xmlHTTP.open('GET', requestUrl, true);
  //
  //     xmlHTTP.responseType = 'arraybuffer';
  //     xmlHTTP.onload = function(e) {
  //       imageLoaded = true;
  //       const arr = new Uint8Array(xmlHTTP.response);
  //       const raw = String.fromCharCode.apply(null, arr);
  //       const b64 = btoa(raw);
  //       const dataUrl = 'data:image/png;base64,' + b64;
  //       resolve(dataUrl);
  //     };
  //     xmlHTTP.send();
  //     setTimeout(() => {
  //       if (!imageLoaded) {
  //         gsUtils.log('gsFavicon', 'Failed to load image from: ' + url);
  //         resolve(null);
  //       }
  //     }, 3000);
  //   });
  // }

  async function isFaviconMetaValid(faviconMeta) {
    if (
      !faviconMeta ||
      faviconMeta.normalisedDataUrl === 'data:,' ||
      faviconMeta.transparentDataUrl === 'data:,'
    ) {
      return false;
    }
    const normalisedFingerprint = await createImageFingerprint(
      faviconMeta.normalisedDataUrl
    );
    const transparentFingerprint = await createImageFingerprint(
      faviconMeta.transparentDataUrl
    );

    for (let id of Object.keys(_defaultFaviconFingerprintById)) {
      const defaultFaviconFingerprint = _defaultFaviconFingerprintById[id];
      if (
        normalisedFingerprint === defaultFaviconFingerprint ||
        transparentFingerprint === defaultFaviconFingerprint
      ) {
        gsUtils.log(
          'gsFavicon',
          'FaviconMeta not valid as it matches fingerprint of default favicon: ' +
            id,
          faviconMeta
        );
        return false;
      }
    }
    return true;
  }

  // Turns the img into a 16x16 black and white dataUrl
  function createImageFingerprint(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = async function() {
        const canvas = window.document.createElement('canvas');
        const context = canvas.getContext('2d');
        const threshold = 80;

        canvas.width = 16;
        canvas.height = 16;
        context.drawImage(img, 0, 0, 16, 16);

        const imageData = context.getImageData(0, 0, 16, 16);
        for (var i = 0; i < imageData.data.length; i += 4) {
          var luma = Math.floor(
            imageData.data[i] * 0.3 +
              imageData.data[i + 1] * 0.59 +
              imageData.data[i + 2] * 0.11
          );
          imageData.data[i] = imageData.data[i + 1] = imageData.data[i + 2] =
            luma > threshold ? 255 : 0;
          imageData.data[i + 3] = 255;
        }
        context.putImageData(imageData, 0, 0);
        const fingerprintDataUrl = canvas.toDataURL('image/png');
        resolve(fingerprintDataUrl);
      };
      img.src = dataUrl;
    });
  }

  function buildFaviconMetaData(url) {
    const timeout = 5 * 1000;
    return new Promise((resolve, reject) => {
      const img = new Image();
      // 12-16-2018 ::: @CollinChaffin ::: Anonymous declaration required to prevent terminating cross origin security errors
      // 12-16-2018 ::: @CollinChaffin ::: http://bit.ly/2BolEqx
      // 12-16-2018 ::: @CollinChaffin ::: https://bugs.chromium.org/p/chromium/issues/detail?id=409090#c23
      // 12-16-2018 ::: @CollinChaffin ::: https://bugs.chromium.org/p/chromium/issues/detail?id=718352#c10
      img.crossOrigin = 'Anonymous';
      let imageLoaded = false;

      img.onload = () => {
        imageLoaded = true;

        let canvas;
        let context;
        canvas = window.document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);

        let imageData;
        try {
          imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        } catch (e) {
          reject(e);
          return;
        }

        const origDataArray = imageData.data;
        const normalisedDataArray = new Uint8ClampedArray(origDataArray);
        const transparentDataArray = new Uint8ClampedArray(origDataArray);

        let r, g, b, a;
        let fuzzy = 0.1;
        let light = 0;
        let dark = 0;
        let maxAlpha = 0;
        let maxRgb = 0;

        for (let x = 0; x < origDataArray.length; x += 4) {
          r = origDataArray[x];
          g = origDataArray[x + 1];
          b = origDataArray[x + 2];
          a = origDataArray[x + 3];

          let localMaxRgb = Math.max(Math.max(r, g), b);
          if (localMaxRgb < 128 || a < 128) dark++;
          else light++;
          maxAlpha = Math.max(a, maxAlpha);
          maxRgb = Math.max(localMaxRgb, maxRgb);
        }

        //saftey check to make sure image is not completely transparent
        if (maxAlpha === 0) {
          reject(
            'Aborting favicon generation as image is completely transparent. url: ' +
              url
          );
          return;
        }

        const darkLightDiff = (light - dark) / (canvas.width * canvas.height);
        const isDark = darkLightDiff + fuzzy < 0;
        const normaliserMultiple = 1 / (maxAlpha / 255);

        for (let x = 0; x < origDataArray.length; x += 4) {
          a = origDataArray[x + 3];
          normalisedDataArray[x + 3] = parseInt(a * normaliserMultiple, 10);
        }
        for (let x = 0; x < normalisedDataArray.length; x += 4) {
          a = normalisedDataArray[x + 3];
          transparentDataArray[x + 3] = parseInt(a * 0.5, 10);
        }

        imageData.data.set(normalisedDataArray);
        context.putImageData(imageData, 0, 0);
        const normalisedDataUrl = canvas.toDataURL('image/png');

        imageData.data.set(transparentDataArray);
        context.putImageData(imageData, 0, 0);
        const transparentDataUrl = canvas.toDataURL('image/png');

        const faviconMetaData = {
          favIconUrl: url,
          isDark,
          normalisedDataUrl,
          transparentDataUrl,
        };
        resolve(faviconMetaData);
      };
      img.src = url;
      setTimeout(() => {
        if (!imageLoaded) {
          reject('Failed to load img.src of: ' + url);
        }
      }, timeout);
    });
  }

  return {
    initAsPromised,
    getFaviconMetaData,
    generateChromeFavIconUrlFromUrl,
    buildFaviconMetaFromChromeFaviconCache,
    saveFaviconMetaDataToCache,
  };
})();
