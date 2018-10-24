/*global chrome */
/*
 * The Great Suspender
 * Copyright (C) 2017 Dean Oemcke
 * Available under GNU GENERAL PUBLIC LICENSE v2
 * http://github.com/deanoemcke/thegreatsuspender
 * ლ(ಠ益ಠლ)
*/
(function() {
  'use strict';

  var isInitialised = false,
    isFormListenerInitialised = false,
    isReceivingFormInput = false,
    isIgnoreForms = false,
    tempWhitelist = false;

  function suspendTab(suspendedUrl) {
    window.location.replace(suspendedUrl);
  }

  function initFormInputListener() {
    if (isFormListenerInitialised) {
      return;
    }
    window.addEventListener('keydown', function(event) {
      if (!isReceivingFormInput && !tempWhitelist) {
        if (
          event.keyCode >= 48 &&
          event.keyCode <= 90 &&
          event.target.tagName
        ) {
          if (
            event.target.tagName.toUpperCase() === 'INPUT' ||
            event.target.tagName.toUpperCase() === 'TEXTAREA' ||
            event.target.tagName.toUpperCase() === 'FORM' ||
            event.target.isContentEditable === true
          ) {
            isReceivingFormInput = true;
            chrome.runtime.sendMessage(buildReportTabStatePayload());
          }
        }
      }
    });
    isFormListenerInitialised = true;
  }

  //listen for background events
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (
      request.hasOwnProperty('action') &&
      request.action === 'confirmTabSuspend' &&
      request.suspendedUrl
    ) {
      sendResponse();
      suspendTab(request.suspendedUrl);
      return false;
    }

    if (
      request.hasOwnProperty('action') &&
      request.action === 'initialiseContentScript'
    ) {
      isInitialised = true;
    }

    if (request.hasOwnProperty('scrollPos')) {
      if (request.scrollPos !== '' && request.scrollPos !== '0') {
        document.body.scrollTop = request.scrollPos;
        document.documentElement.scrollTop = request.scrollPos;
      }
    }
    if (request.hasOwnProperty('ignoreForms')) {
      isIgnoreForms = request.ignoreForms;
      if (isIgnoreForms) {
        initFormInputListener();
      }
      isReceivingFormInput = isReceivingFormInput && isIgnoreForms;
    }
    if (request.hasOwnProperty('tempWhitelist')) {
      if (isReceivingFormInput && !request.tempWhitelist) {
        isReceivingFormInput = false;
      }
      tempWhitelist = request.tempWhitelist;
    }
    sendResponse(buildReportTabStatePayload());
    return false;
  });

  function buildReportTabStatePayload() {
    return {
      action: 'reportTabState',
      isInitialised: isInitialised,
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
})();
