/*global window, document, chrome, console, gsStorage */

(function () {

	"use strict";

	var gsSuspendedMap = {};

	window.onload = function () {
		document.getElementById('resuspendLink').addEventListener("click", function (event) {

			var i;
			for (i in gsSuspendedMap) {
				if (gsSuspendedMap.hasOwnProperty(i)) {
					chrome.tabs.create({active: false, url: gsStorage.generateSuspendedUrl(gsSuspendedMap[i].url)});
				}
			}
		});
		document.getElementById('unsuspendLink').addEventListener("click", function (event) {

			var i;
			for (i in gsSuspendedMap) {
				if (gsSuspendedMap.hasOwnProperty(i)) {
					chrome.tabs.create({active: false, url: gsSuspendedMap[i].url});
					gsSuspendedMap[i].state = 'unsuspended';
					gsStorage.saveTabToHistory(gsSuspendedMap[i].url, gsSuspendedMap[i]);
				}
			}
		});
		document.getElementById('clearLink').addEventListener("click", function (event) {

			var i;
			for (i in gsSuspendedMap) {
				if (gsSuspendedMap.hasOwnProperty(i)) {
					gsSuspendedMap[i].state = 'unsuspended';
					gsStorage.saveTabToHistory(gsSuspendedMap[i].url, gsSuspendedMap[i]);
				}
			}
			chrome.tabs.getCurrent(function (tab) {
				chrome.tabs.remove(tab.id);
			});

		});
		document.getElementById('historyLink').addEventListener("click", function (event) {
			chrome.tabs.create({url: chrome.extension.getURL("history.html")});
		});


		var gsHistory = gsStorage.fetchGsHistory(),
			openTabs = {};

		chrome.tabs.query({}, function (tabs) {

			var i,
	            linksList = document.getElementById('recoveryLinks'),
	            listImg,
	            listLink,
	            curUrl;

			for (i in tabs) {
				if (tabs.hasOwnProperty(i)) {
					if (tabs[i].url.indexOf('suspended.html') < 0) {
						openTabs[tabs[i].url] = true;
					}
				}
			}

			for (i in gsHistory) {
				if (gsHistory.hasOwnProperty(i)
						&& gsHistory[i].state === 'suspended'
						&& typeof (openTabs[gsHistory[i].url]) === 'undefined'
						&& typeof (gsSuspendedMap[gsHistory[i].url]) === 'undefined') {
					gsSuspendedMap[gsHistory[i].url] = gsHistory[i];

					listImg = document.createElement("img");
                    listImg.setAttribute('src', 'chrome://favicon/' + gsHistory[i].url);
                    listImg.setAttribute('height', '16px');
                    listImg.setAttribute('width', '16px');
                    linksList.appendChild(listImg);
                    listLink = document.createElement('a');
                    listLink.setAttribute('href', gsHistory[i].url);
                    listLink.setAttribute('target', '_blank');
                    listLink.innerHTML = gsHistory[i].title;
                    linksList.appendChild(listLink);
                    linksList.appendChild(document.createElement("br"));

				}
			}

		});


	};

}());