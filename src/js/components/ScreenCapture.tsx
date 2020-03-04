import { h, Fragment } from 'preact';

// export const getPreviewUri = async suspendedUrl => {
//     const originalUrl = getOriginalUrlFromSuspendedUrl(suspendedUrl);
//     const preview = await fetchPreviewImage(originalUrl);
//     let previewUri = null;
//     if (
//       preview &&
//       preview.img &&
//       preview.img !== null &&
//       preview.img !== 'data:,' &&
//       preview.img.length > 10000
//     ) {
//       previewUri = preview.img;
//     }
//     return previewUri;
//   };

//   export const buildImagePreview = (_document, tab, previewUri) => {
//     return new Promise(resolve => {
//       const previewEl = _document.createElement('div');
//       const bodyEl = _document.getElementsByTagName('body')[0];
//       previewEl.setAttribute('id', 'gsPreviewContainer');
//       previewEl.classList.add('gsPreviewContainer');
//       previewEl.innerHTML = _document.getElementById('previewTemplate').innerHTML;
//       const unsuspendTabHandler = buildUnsuspendTabHandler(_document, tab);
//       previewEl.onclick = unsuspendTabHandler;
//       localiseHtml(previewEl);
//       bodyEl.appendChild(previewEl);

//       const previewImgEl = _document.getElementById('gsPreviewImg');
//       const onLoadedHandler = function() {
//         previewImgEl.removeEventListener('load', onLoadedHandler);
//         previewImgEl.removeEventListener('error', onLoadedHandler);
//         resolve();
//       };
//       previewImgEl.setAttribute('src', previewUri);
//       previewImgEl.addEventListener('load', onLoadedHandler);
//       previewImgEl.addEventListener('error', onLoadedHandler);
//     });
//   };

export default (previewUri: string): preact.JSX.Element => {
  return <img src={previewUri} />;
};
