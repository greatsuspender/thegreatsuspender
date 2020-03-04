declare const _iframePrefix: string;
declare const _gsArgs: string;

import { h, Fragment } from 'preact';

import { generateEncodedQueryString } from '../gsUtils';
import { FALLBACK_CHROME_FAVICON_META } from '../gsFavicon';
import {
  FaviconMeta,
  SuspendedProps,
  INTERNAL_MSG_URL,
  SUSPENDED_IFRAME_PREFIX,
} from '../actions/suspendTab';

export default (
  suspendedProps: SuspendedProps,
  faviconMeta: FaviconMeta = FALLBACK_CHROME_FAVICON_META
): preact.JSX.Element => {
  const setSource = (): void => {
    if (!document.hidden) {
      document
        .querySelector('iframe')
        ?.setAttribute('src', _iframePrefix + _gsArgs);
    }
  };

  const iframePrefix = `${INTERNAL_MSG_URL}${SUSPENDED_IFRAME_PREFIX}`;
  const gsArgs = generateEncodedQueryString(suspendedProps);

  return (
    <Fragment>
      <title>{suspendedProps.t}</title>
      <link rel="icon" href={faviconMeta.transparentDataUrl} />
      <iframe
        // src={iframeSrcString}
        style="position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;"
      ></iframe>

      {/* prettier-ignore */}
      <script>
        const _iframePrefix = '{iframePrefix}';
        const _gsArgs = '{gsArgs}';
        const _setSource = {setSource};
        _setSource();
        document.addEventListener('visibilitychange', _setSource);
      </script>
    </Fragment>
  );
};
