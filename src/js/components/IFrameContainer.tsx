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
  const iframeSrcString = `${INTERNAL_MSG_URL}${SUSPENDED_IFRAME_PREFIX}${generateEncodedQueryString(
    suspendedProps
  )}`;

  //TODO: Use dark theme background colour

  return (
    <Fragment>
      <title>{suspendedProps.t}</title>
      <link rel="icon" href={faviconMeta.transparentDataUrl} />
      <iframe
        src={iframeSrcString}
        style="position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;"
      ></iframe>
    </Fragment>
  );
};
