import { h, Fragment } from 'preact';

import { FALLBACK_CHROME_FAVICON_META } from '../gsFavicon';
import { FaviconMeta } from '../actions/suspendTab';

export default ({
  url,
  faviconMeta = FALLBACK_CHROME_FAVICON_META,
  title,
}: {
  url: string;
  faviconMeta: FaviconMeta;
  title: string;
}): preact.JSX.Element => {
  return (
    <Fragment>
      <title>{title}</title>
      <link rel="icon" href={faviconMeta.transparentDataUrl} />
      <a href={url}>{url}</a>
    </Fragment>
  );
};
