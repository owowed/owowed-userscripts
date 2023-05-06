// ==UserScript==
// @name         Pixiv Download Artwork
// @description  A userscript that adds a button, that can download the current artwork, with customizable filename.
// @version      1.1.8
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
// @grant        GM_getValue
// @grant        GM_setValue
// @license      LGPL-3.0
// @updateURL    https://github.com/owowed/owowed-userscripts/raw/main/pixiv-download-artwork.user.js
// @downloadURL  https://github.com/owowed/owowed-userscripts/raw/main/pixiv-download-artwork.user.js
// ==/UserScript==

/*
    "@match *://www.pixiv.net/*" is for adding download for user who navigated from pixiv homepage to pixiv artwork page
    pixiv changes their webpage by javascript, not by redirecting to a new page
*/

GM_addStyle(`
    #oxi-artwork-toolbar {
        display: flex;
        flex-flow: column;
    }
    #oxi-artwork-toolbar > * {
        margin-bottom: 7px;
    }
    #oxi-artwork-toolbar > label:has(+ *) {
        margin-bottom: 2px;
    }
    #oxi-artwork-part-select {
        width: 140px;
    }
    #oxi-artwork-download-btn {
        width: fit-content;
        height: fit-content;
    }
    #oxi-image-filename-textarea {
        width: 640px;
        font-family: monospace;
    }
`)

let artworkDescriptor,
    artworkToolbar,
    artworkSelectedHref,
    /*
        There are few variables available in the filename to use:
            %artworkId% - Artwork Pixiv id
            %artworkTitle% - Artwork title 
            %artworkAuthorName% - Author name
            %artworkAuthorId% - Author Pixiv id
            %artworkCreationDate% - Artwork creation date that is shown in the webpage
            %artworkPartNum% - Artwork part number when downloading from multiple artworks (if you download the first artwork, then it will be "0")
            %imageFileExtension% - Image file type taken from the URL (the file extension does not include dot)
            %artworkLikeCount% - Artwork's like count
            %artworkBookmarkCount% - Artwork's bookmark count
            %artworkViewCount% - Artwork's view count
            %imageDateFromUrlPath% - Image creation date that is shown in the URL path (may not be correct, the hour time is +1 off)
            %imageOriginalFilename% - Image original filename that is shown in the URL path
            %webLang% - The website's language when you visit the artwork (taken from the URL path)
    */
    imageFilename = GM_getValue("image_filename") ?? "%artworkTitle% by %artworkAuthorName% #%artworkPartNum% [pixiv %artworkId%].%imageFileExtension%",
    lastSelectedArtworkPartNum,
    downloadAllArtwork,
    artworkPartsHref = [];

async function getMasterImageUrl() {
    const masterImageElem = await waitForElement("figure > div a");
    return masterImageElem.href;
}

function getHighResolutionImageUrl(url) {
    return url
        .replace("-master", "-original")
        .replace(/_master\d+\.(jpg)?$/, ".$1");
}

async function getFilenameFormatData({ imageUrl }) {
    const formatData = {};

    // Artwork Id
    formatData.artworkId = window.location.href.split("works/")[1];

    // Artwork Descriptor (cached element)
    artworkDescriptor ??= await waitForElement("figcaption:has(h1, footer)");

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

    // Artwork Selected Part Number
    formatData.artworkPartNum = lastSelectedArtworkPartNum;
    
    // Image File Extension
    formatData.imageFileExtension = imageUrl.split(".").at(-1);

    // Artwork Like, Bookmark, View Count
    const parseIntSafe = (i) => parseInt(i.textContent.replace(/[^\d]/g, ""));
    formatData.artworkLikeCount = await waitForElementByParent(artworkDescriptor, "[title=Like]")
        .then(parseIntSafe);
    formatData.artworkBookmarkCount = await waitForElementByParent(artworkDescriptor, "[title=Bookmarks]")
        .then(parseIntSafe);
    formatData.artworkViewCount = await waitForElementByParent(artworkDescriptor, "[title=Views]")
        .then(parseIntSafe);

    // Image Date from Image's URL path
    formatData.imageDateFromUrlPath = imageUrl
        .split("/img/")[1]
        .split("/").slice(0, -1).join("/");
    
    // Image Original Name from Image's URL path
    formatData.imageOriginalFilename = imageUrl.split("/").at(-1);

    // Website's Languange from URL path
    formatData.webLang = window.location.href.split("/")[3];

    return formatData;
}

function formatFilename(filename, formatData) {
    for (const [k, v] of Object.entries(formatData)) {
        filename = filename.replace(`%${k}%`, v);
    }
    return filename;
}

async function addImageFilenameTextarea() {
    const imageFilenameTextarea = document.createElement("textarea");

    if (GM_getValue("image_filename") == undefined) {
        GM_setValue("image_filename", imageFilename);
    }

    imageFilenameTextarea.id = "oxi-image-filename-textarea";
    imageFilenameTextarea.value = GM_getValue("image_filename");
    imageFilenameTextarea.placeholder = "Enter image filename...";
    imageFilenameTextarea.spellcheck = false;
    imageFilenameTextarea.title = `There are few variables available in the filename to use:
        %artworkId% - Artwork Pixiv id
        %artworkTitle% - Artwork title 
        %artworkAuthorName% - Author name
        %artworkAuthorId% - Author Pixiv id
        %artworkCreationDate% - Artwork creation date that is shown in the webpage
        %artworkPartNum% - Artwork part number when downloading from multiple artworks (if you download the first artwork, then it will be "0")
        %imageFileExtension% - Image file type taken from the URL (the file extension does not include dot)
        %artworkLikeCount% - Artwork's like count
        %artworkBookmarkCount% - Artwork's bookmark count
        %artworkViewCount% - Artwork's view count
        %imageDateFromUrlPath% - Image creation date that is shown in the URL path (may not be correct, the hour time is +1 off)
        %imageOriginalFilename% - Image original filename that is shown in the URL path
        %webLang% - The website's language when you visit the artwork (taken from the URL path)`;

    imageFilenameTextarea.addEventListener("keyup", () => {
        imageFilename = imageFilenameTextarea.value;
        GM_setValue("image_filename", imageFilename);
    });
    imageFilenameTextarea.addEventListener("change", () => {
        imageFilename = imageFilenameTextarea.value;
        GM_setValue("image_filename", imageFilename);
    });

    const textareaLabel = document.createElement("label");
    textareaLabel.textContent = "Image Filename Format:"

    artworkToolbar.append(textareaLabel);
    artworkToolbar.append(imageFilenameTextarea);
}

async function addArtworkSelector({ event, abortSignal }) {
    const label = document.createElement("label");

    label.textContent = "Artwork Part:";
    
    const artworkPartSelect = document.createElement("select");

    artworkPartSelect.id = "oxi-artwork-part-select";

    artworkToolbar.append(label);
    artworkToolbar.append(artworkPartSelect);

    let abortController = new AbortController;
    
    update({ abortSignal: abortController.signal });

    event.addEventListener("artwork-change", async () => {
        if (abortSignal.aborted) return;
        abortController.abort();
        abortController = new AbortController;
        update({ abortSignal: abortController.signal });
    });

    async function update({ abortSignal }) {
        const artworkPresentationContainer = await waitForElement("main > section figure");

        makeMutationObserver({ target: artworkPresentationContainer, childList: true, abortSignal }, () => {
            setTimeout(() => {
                optionsUpdate({ artworkPresentationContainer });
            }, 1000);
        });

        optionsUpdate({ artworkPresentationContainer });
    }

    function optionsUpdate({ artworkPresentationContainer }) {
        const artworkPresentation = artworkPresentationContainer.children[0];
        const artworkParts = artworkPresentation.querySelectorAll("a:has(> img)");

        artworkPartSelect.innerHTML = "";
        artworkPartsHref = [];
        lastSelectedArtworkPartNum = 0;
        downloadAllArtwork = false;
        
        for (let i = 0; i < artworkParts.length; i++) {
            const option = document.createElement("option");
            artworkPartsHref.push(artworkParts[i].href);
            option.value = artworkParts[i].href;
            option.textContent = `Artwork #${i}`;
            artworkPartSelect.appendChild(option);
        }

        if (artworkParts.length > 1) {
            const allArtworkOption = document.createElement("option");
    
            allArtworkOption.textContent = "All Artwork Parts (Bulk)";
            allArtworkOption.value = "all-artwork";
    
            artworkPartSelect.append(allArtworkOption);
        }

        artworkPartSelect.addEventListener("change", () => {
            if (artworkPartSelect.value == "all-artwork") {
                downloadAllArtwork = true;
            }
            else {
                downloadAllArtwork = false;
                artworkSelectedHref = artworkPartSelect.value;
                lastSelectedArtworkPartNum = artworkPartSelect.value
                    .split("/").at(-1)
                    .match(/\d+_p(\d+)/)[1];
            }
        });
    }
}

async function addDownloadButton() {
    const downloadBtn = document.createElement("button");

    downloadBtn.id = "oxi-artwork-download-btn";
    downloadBtn.textContent = "Download Artwork";
    downloadBtn.addEventListener("click", async () => {
        if (downloadAllArtwork) {
            let partNum = 0;
            for (const artworkHref of artworkPartsHref) {
                const downloadOptions = {
                    name: formatFilename(imageFilename, {
                        ...await getFilenameFormatData({ imageUrl: artworkSelectedHref }),
                        artworkPartNum: partNum
                    }),
                    url: artworkHref,
                    saveAs: false,
                    headers: {
                        Referer: "https://www.pixiv.net/"
                    }
                };
                GM_download(downloadOptions);
                partNum++;
            }
        }
        else {
            const downloadOptions = {
                name: formatFilename(imageFilename, await getFilenameFormatData({ imageUrl: artworkSelectedHref })),
                url: artworkSelectedHref,
                saveAs: false,
                headers: {
                    Referer: "https://www.pixiv.net/"
                }
            };
            GM_download(downloadOptions);
        }
    });

    artworkToolbar.appendChild(downloadBtn);

    return downloadBtn;
}

async function pageInit({ event, abortSignal }) {
    artworkDescriptor = await waitForElement("figcaption:has(h1, footer)");
    artworkToolbar = document.createElement("div");
    const footerElem = await waitForElementByParent(artworkDescriptor, "footer");
    
    artworkToolbar.id = "oxi-artwork-toolbar";
    artworkToolbar.hidden = true;

    document.body.appendChild(artworkToolbar);

    setTimeout(() => {
        footerElem.insertAdjacentElement("beforebegin", artworkToolbar);
        artworkToolbar.hidden = false;
    }, 1000);

    event.addEventListener("artwork-change", () => {
        if (abortSignal.aborted) return;
        footerElem.insertAdjacentElement("beforebegin", artworkToolbar);
    });

    artworkSelectedHref = await getMasterImageUrl();
}

void async function main() {
    const charcoal = await waitForElement(".charcoal-token");
    const charcoalpage = await waitForElementByParent(charcoal, ":scope > div");

    /*
        this "charcoalpage" element contains the "header" and "main content"
        the "main content" gets replaced by other element whether the user navigate to other pages
    */

    const pageEventTarget = new EventTarget;
    let abortController = new AbortController;

    payload({ abortSignal: abortController.signal });

    // this will execute function when the user navigates to other page when the "main content" (or any other elements inside "charcoalpage") gets replaced
    // after user nagivate to artwork page, if the user keep navigating to other artwork page, then this wont get executed, unless if the user navigate to different page (like main page)
    makeMutationObserver({ target: charcoalpage, childList: true }, () => {
        abortController.abort();
        abortController = new AbortController;
        payload({ abortSignal: abortController.signal });
        pageEventTarget.dispatchEvent(new Event("page-change"));
    });

    async function payload({ abortSignal }) {
        const modules = [
            pageInit,
            addArtworkSelector,
            addImageFilenameTextarea,
            addDownloadButton
        ];
        if (window.location.href.includes("/artworks/")) {
            for (const module of modules) {
                await module({ event: pageEventTarget, abortSignal });
            }

            const artworkPanel = await waitForElement("div:has(> figure, > figcaption)");
            // this function will execute when the user navigate from an artwork page to another artwork page
            makeMutationObserver({ target: artworkPanel, childList: true, abortSignal }, () => {
                pageEventTarget.dispatchEvent(new Event("artwork-change"));
            });
        }
    }
}();

function dbg(...obj) {
    console.debug(GM_info.name, ...obj)
    return obj.at(-1)
}
