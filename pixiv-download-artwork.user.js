// ==UserScript==
// @name         Pixiv Download Artwork
// @description  A userscript that adds a button, that can download the current artwork, with customizable filename.
// @version      1.0.2
// @namespace    owowed.moe
// @author       owowed <island@owowed.moe>
// @homepage     https://github.com/owowed/owowed-userscripts
// @supportURL   https://github.com/owowed/owowed-userscripts/issues
// @match        *://www.pixiv.net/*/artworks/*
// @match        *://www.pixiv.net/*
// @require      https://github.com/owowed/userscript-common/raw/main/common.js
// @require      https://github.com/owowed/userscript-common/raw/main/mutation-observer.js
// @require      https://github.com/owowed/userscript-common/raw/main/wait-for-element.js
// @grant        GM_addStyle
// @grant        GM_download
// @license      LGPL-3.0
// @updateURL    https://github.com/owowed/owowed-userscripts/raw/main/pixiv-download-artwork.user.js
// @downloadURL  https://github.com/owowed/owowed-userscripts/raw/main/pixiv-download-artwork.user.js
// ==/UserScript==

/*
    "@match *://www.pixiv.net/*" is for adding download for user who navigated from pixiv homepage to pixiv artwork page
    pixiv changes their webpage by javascript, not by redirecting to a new page
*/

/* --- CONFIG STARTS HERE --- */

/*
    Set the filename
    There are few variables available in the filename to use:
        %artworkId% - Artwork Pixiv id
        %artworkTitle% - Artwork title 
        %artworkAuthorName% - Author name
        %artworkAuthorId% - Author Pixiv id
        %artworkCreationDate% - Artwork creation date that is shown in the webpage
        %imageFileExtension% - Image file type taken from the URL (the file extension does not include dot)
        %artworkLikeCount% - Artwork's like count
        %artworkBookmarkCount% - Artwork's bookmark count
        %artworkViewCount% - Artwork's view count
        %imageDateFromUrlPath% - Image creation date that is shown in the URL path (may not be correct, the hour time is +1 off)
        %imageOriginalFilename% - Image original filename that is shown in the URL path
        %webLang% - The website's language when you saw the artwork (taken from the URL path)
*/
const filenameTemplate = "%artworkTitle% by %artworkAuthorName% [pixiv %artworkId%].%imageFileExtension%";

/*
    Toggle if you want to show "Save As" file prompt when saving an image. This may not work on some Userscript manager.
*/
const imageSaveAs = true;

/* --- CONFIG ENDS HERE --- */

GM_addStyle(`
    #oxi-artwork-download-btn {
        float: right;
    }
`)

async function getMasterImageElem() {
    const masterImageElem = await waitForElement(".gtm-expand-full-size-illust > img");
    return masterImageElem;
}

function getHighResolutionImageUrl(url) {
    return url
        .replace("-master", "-original")
        .replace(/_master\d+\.(jpg)?$/, ".$1");
}

async function getFilenameFormatData({ imageUrl }) {
    const formatData = {};
    /*
    Set the filename
    There are few variables available in the filename to use:
        %artworkId% - Artwork Pixiv id
        %artworkTitle% - Artwork title 
        %artworkAuthorName% - Author name
        %artworkAuthorId% - Author Pixiv id
        %artworkCreationDate% - Artwork creation date that is shown in the webpage
        %imageFileExtension% - Image file type taken from the URL (the file extension does not include dot)
*/
    // Artwork Id
    formatData.artworkId = window.location.href.split("works/")[1];

    // Artwork Descriptor (cached element)
    const artworkDescriptor = await waitForElement("figcaption:has(h1, footer)");

    // Artwork Title
    formatData.artworkTitle = await waitForElementByParent(artworkDescriptor, "h1").then(i => i.textContent);

    // Artwork Author Profile (cached element)
    const authorProfile = await waitForElement("div:has(> button[data-click-label='follow'])");

    // Artwork Author Link (cached element)
    const authorLink = await waitForElementByParent(authorProfile, "a[data-gtm-value]:not(:has(img))");

    // Artwork Author Name
    formatData.artworkAuthorName = await waitForElementByParent(authorLink, ":scope > div")
        .then(i => i.textContent);

    // Artwork Author Id
    formatData.artworkAuthorId = authorLink.href.split("users/")[1];

    // Artwork Creation Date
    formatData.artworkCreationDate = await waitForElementByParent(artworkDescriptor, "[title='Posting date']")
        .then(i => i.textContent);
    
    // Image File Extension
    formatData.imageFileExtension = imageUrl.split(".").at(-1);

    return formatData;
}

function formatFilename(filename, formatData) {
    for (const [k, v] of Object.entries(formatData)) {
        filename = filename.replace(`%${k}%`, v);
    }
    return filename;
}

async function addDownloadButton() {
    const artworkTitleElem = await waitForElement("figcaption:has(footer) h1");
    const downloadBtn = document.createElement("button");

    downloadBtn.id = "oxi-artwork-download-btn";
    downloadBtn.textContent = "Download Artwork";
    downloadBtn.addEventListener("click", async () => {
        const masterImageUrl = await getMasterImageElem().then(i => i.src);
        GM_download({
            name: formatFilename(filenameTemplate, await getFilenameFormatData({ imageUrl: masterImageUrl })),
            url: getHighResolutionImageUrl(masterImageUrl),
            saveAs: imageSaveAs,
            headers: {
                Referer: "https://www.pixiv.net/"
            }
        });
    });

    setTimeout(() => {
        artworkTitleElem.insertAdjacentElement("beforebegin", downloadBtn);
    }, 1000);
    return downloadBtn;
}

function dbg(...obj) {
    console.debug(GM_info.name, ...obj)
    return obj.at(-1)
}

void async function main() {
    const charcoal = await waitForElement(".charcoal-token");
    const charcoalpage = await waitForElementByParent(charcoal, ":scope > div");

    /*
        this "charcoalpage" element contains the "header" and "main content"
        the "main content" gets replaced by other element whether the user navigate to other pages
    */
 
    // this function checks if user navigates to other page when the "main content" (or any other elements inside "charcoalpage") gets replaced
    makeMutationObserver({ target: charcoalpage, childList: true }, () => {
        if (window.location.href.includes("/artworks/")) {
            addDownloadButton();
        }
    });

    if (window.location.href.includes("/artworks/")) {
        addDownloadButton();
    }
}();