# <img src="/src/img/icon48.png" align="absmiddle"> TabsLazyLoad + The Great Suspender

## On browser startup all the tabs are kept suspended thus no exessive RAM is consumed and no network is used to preload unnecessary tabs. Repeats original loading behavior of opera 45. 

### [Download crx file](https://github.com/ekonoval/TabsLazyLoad_thegreatsuspender/raw/master/tabsLazyLoad.crx)

Almost all description is copied from original [TheGreatSuspender](https://github.com/deanoemcke/thegreatsuspender/) repository.

### Settings example <img src="/descr/settings.png" align="absmiddle">

### Read this if you have lost tabs from your browser

I have written a guide for how to recover your lost tabs here: https://github.com/deanoemcke/thegreatsuspender/issues/526

Please contribute if you have any extra insight on alternative methods for tab recovery.

### Welcome

"The Great Suspender" is a free and open-source Google Chrome extension for people who find that chrome is consuming too much system resource or suffer from frequent chrome crashing. Once installed and enabled, this extension will automatically *suspend* tabs that have not been used for a while, freeing up memory and cpu that the tab was consuming.

If you have suggestions or problems using the extension, please [submit a bug or a feature request](https://github.com/deanoemcke/thegreatsuspender/issues/).


### Install as an extension from source

1. Download the latest available version and unarchive to your preferred location (whichever suits you).
2. Using **Google Chrome** browser, navigate to chrome://extensions/ and enable "Developer mode" in the upper right corner.
3. Using **Opera** browser, navigate to opera://extensions/ and enable "Developer mode" in the upper right corner. You also need to install [Install Chrome Extensions](https://addons.opera.com/uk/extensions/details/download-chrome-extension-9/)
4. Click on the <kbd>Load unpacked extension...</kbd> button.
5. Browse to the src directory of the downloaded, unarchived release and confirm.

If you have completed the above steps, the "welcome" page will open indicating successful installation of the extension.

### Build from github

Dependencies: openssl, npm.

Clone the repository and run these commands:
```
npm install
npm run generate-key
npm run build
```

It should say:
```
Done, without errors.
```

The extension in crx format will be inside the build/crx/ directory. You can drag it into [extensions] (chrome://extensions) to install locally.

### License

This work is licensed under a GNU GENERAL PUBLIC LICENSE (v2)

### Shoutouts

This package uses the [html2canvas](https://github.com/niklasvh/html2canvas) library written by Niklas von Hertzen.  
It also uses the indexedDb wrapper [db.js](https://github.com/aaronpowell/db.js) written by Aaron Powell.  
Thank you also to [BrowserStack](https://www.browserstack.com) for providing free chrome testing tools.
