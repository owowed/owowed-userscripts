// ==UserScript==
// @name         Pixiv Download Artwork
// @description  A userscript that adds a button, that can download the current artwork, with customizable filename.
// @version      1.2.1
// @namespace    owowed.moe
// @author       owowed <island@owowed.moe>
// @homepage     https://github.com/owowed/owowed-userscripts
// @supportURL   https://github.com/owowed/owowed-userscripts/issues
// @match        *://www.pixiv.net/*/artworks/*
// @match        *://www.pixiv.net/*
// @require      https://github.com/owowed/userscript-common/raw/main/common.js
// @require      https://github.com/owowed/userscript-common/raw/main/mutation-observer.js
// @require      https://github.com/owowed/userscript-common/raw/main/wait-for-element.js
// @require      https://code.jquery.com/jquery-3.6.4.slim.min.js
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
    #oxi-artwork-part-selector {
        width: 240px;
    }
    #oxi-artwork-download-btn {
        width: fit-content;
        height: fit-content;
    }
    #oxi-artwork-image-filename {
        width: 640px;
        font-family: monospace;
    }
    #oxi-artwork-download-progress[data-oxi-download-state="downloading"] {
        color: aquamarine;
    }
    #oxi-artwork-download-progress[data-oxi-download-state="complete"] {
        color: darkgoldenrod;
    }
    #oxi-artwork-download-progress[data-oxi-download-state="error"] {
        color: red;
    }
    #oxi-artwork-download-progress[data-oxi-download-state="timeout"] {
        color: palevioletred;
    }
`);

const IMAGE_FILENAME_TOOLTIP_GUIDE = `There are few variables available in the filename to use:
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

const DEFAULT_IMAGE_FILENAME = "%artworkTitle% by %artworkAuthorName% #%artworkPartNum% [pixiv %artworkId%].%imageFileExtension%";

function formatFilename(filename, formatData) {
    for (const [k, v] of Object.entries(formatData)) {
        filename = filename.replace(`%${k}%`, v);
    }
    return filename;
}

async function getFilenameFormatData({ selectedArtworkPart: { index: selectedPartNum, href: imageUrl } }) {
    const formatData = {};

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

    // Artwork Selected Part Number
    formatData.artworkPartNum = selectedPartNum;
    
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

class ToolbarPatch {
    toolbarElem;
    downloadBtnElem;
    imageFilenameElem;
    artworkPartSelectorElem;
    downloadProgressElem;
    
    // artwork-navigate scope
    artworkDescriptor;
    artworkDescriptorFooter;
    artworkContainer;
    selectedArtworkPart;
    bulkDownloadArtworks = false;

    constructor () {
        this.toolbarElem = $("<div>", { id: "oxi-artwork-toolbar", hidden: true })[0];
        this.downloadBtnElem = $("<button>", { id: "oxi-artwork-download-btn", text: "Download Artwork" })
            .on("click", async () => {
                const formatData = await getFilenameFormatData({ selectedArtworkPart: this.selectedArtworkPart });
                let downloadOptions = {
                    saveAs: false,
                    headers: {
                        Referer: "https://www.pixiv.net/"
                    },
                };
                let progressCounter = 0;
                if (!this.bulkDownloadArtworks) {
                    downloadOptions = {
                        ...downloadOptions,
                        name: formatFilename(GM_getValue("image_filename") ?? DEFAULT_IMAGE_FILENAME, formatData),
                        url: this.selectedArtworkPart.href,
                        onload: () => {
                            this.displayDownloadProgress({ state: "complete", text: `Download complete! (${progressCounter} progress)` });
                        },
                        onprogress: () => {
                            progressCounter++;
                            this.displayDownloadProgress({ state: "downloading", text: `Downloading artwork... (${progressCounter} progress)` });
                        },
                        onerror: () => {
                            this.displayDownloadProgress({ state: "error", text: `Download error! Download may be failed or cancelled. (${progressCounter} progress)` });
                        },
                        ontimeout: () => {
                            this.displayDownloadProgress({ state: "timeout", text: `Download timeout error! (${progressCounter} progress)` });
                        }
                    };
                    GM_download(downloadOptions);
                }
                else {
                    const promises = [];
                    const totalArtworkParts = this.getArtworkParts();
                    let downloadCompleteCounter = 0;
                    for (const { index, href } of this.getArtworkParts()) {
                        const downloadPromise = new Promise((resolve, reject) => {
                            downloadOptions = {
                                ...downloadOptions,
                                name: formatFilename(GM_getValue("image_filename") ?? DEFAULT_IMAGE_FILENAME, { ...formatData, artworkPartNum: index }),
                                url: href,
                                onload: () => {
                                    downloadCompleteCounter++;
                                    resolve();
                                },
                                onprogress: () => {
                                    progressCounter++;
                                    this.displayDownloadProgress({ state: "downloading", text: `Downloading artworks... (${downloadCompleteCounter} out of ${totalArtworkParts.length} downloaded artworks, ${progressCounter} total progress)` });
                                },
                                onerror: () => {
                                    reject({ state: "error" });
                                },
                                ontimeout: () => {
                                    reject({ state: "timeout" });
                                }
                            }
                            GM_download(downloadOptions);
                        });
                        promises.push(downloadPromise);
                    }
                    Promise.all(promises)
                        .then(() => {
                            this.displayDownloadProgress({ state: "complete", text: `Download complete! (${downloadCompleteCounter} out of ${totalArtworkParts.length} downloaded artworks, ${progressCounter} total progress)` });
                        })
                        .catch(({ state }) => {
                            if (state == "error") {
                                this.displayDownloadProgress({ state: "error", text: `Download error! Download may be failed or cancelled. (${downloadCompleteCounter} out of ${totalArtworkParts.length} downloaded artworks, ${progressCounter} total progress)` });
                            }
                            else if (state == "timeout") {
                                this.displayDownloadProgress({ state: "timeout", text: `Download timeout error! (${downloadCompleteCounter} out of ${totalArtworkParts.length} downloaded artworks, ${progressCounter} total progress)` });
                            }
                        });
                }
            })[0];
        const imageFilenameLabel = $("<label>", { text: "Image Filename Template:" })[0];
        this.imageFilenameElem = $("<textarea>",
                { id: "oxi-artwork-image-filename",
                    title: IMAGE_FILENAME_TOOLTIP_GUIDE,
                    placeholder: "Enter image filename...",
                    spellcheck: false })
            .val(GM_getValue("image_filename"))
            .on("keyup change", () => {
                GM_setValue("image_filename", this.imageFilenameElem.value)
            })[0];
        const selectorLabel = $("<label>", { text: "Selected Artwork Part:" })[0];
        this.artworkPartSelectorElem = $("<select>", { id: "oxi-artwork-part-selector" })
            .on("input", () => {
                if (this.artworkPartSelectorElem.value == "bulk-download-artworks") {
                    this.bulkDownloadArtworks = true;
                }
                else {
                    const [ index, ...href ] = this.artworkPartSelectorElem.value.split(":");
                    this.selectedArtworkPart = { index: parseInt(index), href: href.join(":") };
                }
            })[0];
        this.downloadProgressElem = $("<div>", { id: "oxi-artwork-download-progress", hidden: true })[0];

        $(this.toolbarElem).append([
            imageFilenameLabel,
            this.imageFilenameElem,
            selectorLabel,
            this.artworkPartSelectorElem,
            this.downloadBtnElem,
            this.downloadProgressElem,
        ]);
    }

    // artwork-navigate scope
    waitArtworkImageLoaded() {
        return new Promise(async (resolve) => {
            const img = await waitForElementByParent(this.artworkContainer, `div > a > img`);
            img.addEventListener("load", () => resolve(true));
            if (img.complete) {
                resolve(true);
            }
        });
    }

    waitMoreThanOneImageLoaded() {
        return new Promise((resolve) => {
            const imageContainer = this.artworkContainer.querySelector("div");

            makeMutationObserver({ target: imageContainer, childList: true, once: true }, () => {
                resolve(true);
            });
        })
    }

    displayDownloadProgress({ state, text }) {
        $(this.downloadProgressElem).attr("data-oxi-download-state", state);
        this.downloadProgressElem.hidden = false;
        this.downloadProgressElem.textContent = text;

        if (state == "complete") {
            setTimeout(() => this.downloadProgressElem.hidden = true, 18_000);
        }
    }

    getArtworkParts() {
        const anchors = this.artworkContainer.querySelectorAll(`div > a`);
        const artworkParts = [];

        let counter = 0;
        for (const anchor of anchors) {
            artworkParts.push({ index: counter, href: anchor.href });
            counter++;
        }

        return artworkParts;
    }

    updateArtworkSelectorOptions(artworkParts) {
        this.artworkPartSelectorElem.innerHTML = "";
        for (const { index, href } of artworkParts) {
            this.artworkPartSelectorElem.append(
                $("<option>", { text: `Artwork #${index}`, value: `${index}:${href}` })[0]
            );
        }
    }

    patch(patcher) {
        const artworkNavigateStartPromise = new Promise((resolve) => {
            patcher.eventTarget.addEventListener("artwork-navigate-start", async () => {
                this.artworkDescriptor = await waitForElement("figcaption:has(h1):has(footer)");
                this.artworkDescriptorFooter = this.artworkDescriptor.querySelector("footer");
                this.artworkContainer = await waitForElement(`figure:has(> div > div > div > a)`);

                await this.waitArtworkImageLoaded();

                this.artworkDescriptorFooter.insertAdjacentElement("beforebegin", this.toolbarElem);
                this.toolbarElem.hidden = false;

                resolve();
            });
        });

        patcher.eventTarget.addEventListener("artwork-navigate", async () => {
            await artworkNavigateStartPromise;
            const artworkParts = this.getArtworkParts();
            this.selectedArtworkPart = artworkParts[0];

            this.updateArtworkSelectorOptions(artworkParts);

            this.artworkPartSelectorElem.append(
                $("<option>", { text: `If there is more than one artwork, click "Show all" button, then other artworks will automatically appear here.`, value: `0:${artworkParts[0].href}`, disabled: true })[0]
            );

            makeMutationObserver({ target: this.artworkContainer, childList: true, once: true }, async () => {
                await this.waitMoreThanOneImageLoaded();
                this.updateArtworkSelectorOptions(this.getArtworkParts());
                this.artworkPartSelectorElem.append(
                    $("<option>", { text: "Bulk Download All Artworks", value: "bulk-download-artworks" })[0]
                );
            });
        });
    }
}

class PixivPatcher {
    eventTarget = new EventTarget;

    constructor () {
        this.#initWholeNavigateEvent();
        this.#initArtworkNavigateEvent();
    }

    async #initWholeNavigateEvent() {
        const charcoalPage = await waitForElement(".charcoal-token > div");

        makeMutationObserver({ target: charcoalPage, childList: true }, () => {
            this.eventTarget.dispatchEvent(new Event("whole-navigate"));
        });

        if (document.readyState == "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                this.eventTarget.dispatchEvent(new Event("whole-navigate"));
            });
        }
        else {
            this.eventTarget.dispatchEvent(new Event("whole-navigate"));
        }
    }
    
    #initArtworkNavigateEvent() {
        this.eventTarget.addEventListener("whole-navigate", async () => {
            if (!window.location.href.includes("/artworks/")) return;

            this.eventTarget.dispatchEvent(new Event("artwork-navigate-start"));
            this.eventTarget.dispatchEvent(new Event("artwork-navigate"));
            
            const artworkPanel = await waitForElement("div:has(> figure):has(> figcaption)");

            const observer = makeMutationObserver({ target: artworkPanel, childList: true }, () => {
                this.eventTarget.dispatchEvent(new Event("artwork-navigate"));
            });

            this.eventTarget.addEventListener("whole-navigate", () => {
                observer.disconnect();
                this.eventTarget.addEventListener("artwork-navigate-end");
            }, { once: true });
        });
    }

    addPatches(patches) {
        for (const patch of patches) {
            patch.patch(this);
        }
    }
}

void async function main() {
    const patcher = new PixivPatcher;

    patcher.addPatches([
        new ToolbarPatch
    ]);
}();

function dbg(...obj) {
    console.debug("[pixiv download artwork userscript debug]", ...obj);
    return obj.at(-1);
}
