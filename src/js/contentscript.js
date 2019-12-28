/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ლ(ಠ益ಠლ)
 */
(function() {
  'use strict';

  let isFormListenerInitialised = false;
  let isReceivingFormInput = false;
  let isIgnoreForms = false;
  let tempWhitelist = false;

  function formInputListener() {
    if (!isReceivingFormInput && !tempWhitelist) {
      if (event.keyCode >= 48 && event.keyCode <= 90 && event.target.tagName) {
        if (
          event.target.tagName.toUpperCase() === 'INPUT' ||
          event.target.tagName.toUpperCase() === 'TEXTAREA' ||
          event.target.tagName.toUpperCase() === 'FORM' ||
          event.target.isContentEditable === true ||
          event.target.type === 'application/pdf'
        ) {
          isReceivingFormInput = true;
          if (!isBackgroundConnectable()) {
            return false;
          }
          chrome.runtime.sendMessage(buildReportTabStatePayload());
        }
      }
    }
  }

  function initFormInputListener() {
    if (isFormListenerInitialised) {
      return;
    }
    window.addEventListener('keydown', formInputListener);
    isFormListenerInitialised = true;
  }

  function init() {
    const hasProperty = (obj, key) => {
      return typeof obj[key] !== 'undefined';
    };

    //listen for background events
    chrome.runtime.onMessage.addListener(function(
      request,
      sender,
      sendResponse
    ) {
      if (hasProperty(request, 'action')) {
        if (request.action === 'requestInfo') {
          sendResponse(buildReportTabStatePayload());
          return false;
        }
      }

      if (hasProperty(request, 'scrollPos')) {
        if (request.scrollPos !== '' && request.scrollPos !== '0') {
          document.body.scrollTop = request.scrollPos;
          document.documentElement.scrollTop = request.scrollPos;
        }
      }
      if (hasProperty(request, 'ignoreForms')) {
        isIgnoreForms = request.ignoreForms;
        if (isIgnoreForms) {
          initFormInputListener();
        }
        isReceivingFormInput = isReceivingFormInput && isIgnoreForms;
      }
      if (hasProperty(request, 'tempWhitelist')) {
        if (isReceivingFormInput && !request.tempWhitelist) {
          isReceivingFormInput = false;
        }
        tempWhitelist = request.tempWhitelist;
      }
      sendResponse(buildReportTabStatePayload());
      return false;
    });
  }

  function waitForRuntimeReady(retries) {
    retries = retries || 0;
    return new Promise(r => r(chrome.runtime)).then(chromeRuntime => {
      if (chromeRuntime) {
        return Promise.resolve();
      }
      if (retries > 3) {
        return Promise.reject('Failed waiting for chrome.runtime');
      }
      retries += 1;
      return new Promise(r => window.setTimeout(r, 500)).then(() =>
        waitForRuntimeReady(retries)
      );
    });
  }

  function isBackgroundConnectable() {
    try {
      const port = chrome.runtime.connect();
      if (port) {
        port.disconnect();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function buildReportTabStatePayload() {
    return {
      action: 'reportTabState',
      status:
        isIgnoreForms && isReceivingFormInput
          ? 'formInput'
          : tempWhitelist
          ? 'tempWhitelist'
          : 'normal',
      scrollPos:
        document.body.scrollTop || document.documentElement.scrollTop || 0,
    };
  }

  waitForRuntimeReady()
    .then(init)
    .catch(e => {
      // eslint-disable-next-line no-console
      console.error(e);
      setTimeout(() => {
        init();
      }, 200);
    });
})();
