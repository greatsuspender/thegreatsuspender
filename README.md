# The Marvellous Suspender

[![Crowdin](https://badges.crowdin.net/tms/localized.svg)](https://crowdin.com/project/tms)

"**The Marvellous Suspender**" is a free and open-source Google Chrome extension for people who find that chrome is consuming too much system resource or suffer from frequent chrome crashing. Totally based on the original "[The Great Suspender](https://github.com/greatsuspender/thegreatsuspender)" but without ADS tracking and problems explained [in this GitHub issue](https://github.com/greatsuspender/thegreatsuspender/issues/1263).

Once installed and enabled, this extension will automatically *suspend* tabs that have not been used for a while, freeing up memory and CPU that the tab was consuming.

If you have suggestions or problems using the extension, please [submit a bug or a feature request](https://github.com/gioxx/MarvellousSuspender/issues/).

**If you have lost tabs from your browser** you can read a guide for how to recover them [here](https://github.com/deanoemcke/thegreatsuspender/issues/526
).

## Chrome Web Store

The Marvellous Suspender is [available via the official Chrome Web Store](https://go.gioxx.org/tgs).

For more information on the permissions required for the extension, please refer to this gitHub issue: (https://github.com/greatsuspender/thegreatsuspender/issues/213)

### Install as an extension from source

1. Download the **[latest available version](https://github.com/gioxx/MarvellousSuspender/releases)** and unarchive to your preferred location (whichever suits you).
2. Using **Google Chrome** browser, navigate to chrome://extensions/ and enable "Developer mode" in the upper right corner.
3. Click on the <kbd>Load unpacked extension...</kbd> button.
4. Browse to the src directory of the unarchived folder and confirm.

If you have completed the above steps, the "welcome" page will open indicating successful installation of the extension.

Be sure to unsuspend all suspended tabs before removing any other version of the extension or they will disappear forever!

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

## Contributing to this extension

Contributions are very welcome. Feel free to submit pull requests for new features and bug fixes. For new features, ideally you would raise an issue for the proposed change first so that we can discuss ideas. This will go a long way to ensuring your pull request is accepted.

### Localization (l10n)

Feel free to help me to localize this extension in any language, you can do it using Crowdin connecting to https://crowdin.com/project/tms. If your mothertongue language is not available please "ping me" on [Twitter](https://twitter.com/Gioxx) or [submit a feature request](https://github.com/gioxx/MarvellousSuspender/issues/).

## License

This work is licensed under a GNU GENERAL PUBLIC LICENSE (v2)

### Shoutouts

This package uses the [html2canvas](https://github.com/niklasvh/html2canvas) library written by Niklas von Hertzen.
It also uses the indexedDb wrapper [db.js](https://github.com/aaronpowell/db.js) written by Aaron Powell.
Thank you also to [BrowserStack](https://www.browserstack.com) for providing free chrome testing tools.
