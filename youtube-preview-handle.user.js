// ==UserScript==
// @name         Youtube Preview Handle
// @description  A userscript that will add/preview YouTube username handle on the right side of a YouTube channel name. Will work across video channel name, homepage, YouTube post, and more.
// @version      1.0.0
// @namespace    owowed.moe
// @author       owowed <island@owowed.moe>
// @homepage     https://github.com/owowed/owowed-userscripts
// @supportURL   https://github.com/owowed/owowed-userscripts/issues
// @match        *://www.youtube.com/*
// @require      https://github.com/owowed/userscript-common/raw/main/mutation-observer.js
// @grant        GM_addStyle
// @license      LGPL-3.0
// @updateURL    https://github.com/owowed/owowed-userscripts/raw/main/youtube-preview-handle.user.js
// @downloadURL  https://github.com/owowed/owowed-userscripts/raw/main/youtube-preview-handle.user.js
// ==/UserScript==

void function main() {
    // Add custom CSS styles for the preview handle
    GM_addStyle(`
    .yt-preview-handle ytd-channel-name ytd-badge-supported-renderer {
        margin-right: 5px;
    }
    .yt-preview-handle ytd-channel-name #container {
        width: auto;
        overflow: unset;
    }
    ytd-channel-name ytd-badge-supported-renderer[hidden] + .ohandle {
        margin-left: 5px;
    }

    ytd-post-renderer #header #author {
        white-space: nowrap;
    }
    
    .ytd-preview-handle ytd-backstage-post-renderer #author-text {
        white-space: nowrap;
    }
    ytd-backstage-post-renderer .ohandle {
        line-height: 1.8rem;
        margin-right: 5px;
    }

    :where(
        #author-text .ohandle,
        ytd-post-renderer .ohandle,
        ytd-backstage-post-renderer .ohandle,
        ytd-comment-renderer .ohandle,
        #channel-info > .ohandle
    ) {
        margin: 0 4px 0 0;
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
        font-size: 1.2rem;
    }

    #channel-info > .ohandle {
        margin: 2px 0;
    }
    #channel-info > #title {
        margin-bottom: 0;
    }
    
    .yt-preview-handle .ohandle,
    ytd-channel-name a.ohandle.yt-simple-endpoint,
    ytd-comment-renderer a.ohandle.yt-simple-endpoint.yt-formatted-string {
        color: var(--yt-spec-text-secondary) !important;
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
    }
    :is(.yt-preview-handle .ohandle,
    ytd-channel-name .ohandle,
    ytd-comment-renderer .ohandle):hover {
        filter: brightness(1.4) !important;
    }
    `);

    document.body.classList.add("yt-preview-handle");

    makeMutationObserver({
        target: document.body,
        childList: true,
        subtree: true
    }, () => {
        const windowPathname = window.location.pathname;
        applyPatcher(
            "ytd-channel-name:has(a):not(.ytd-reel-player-header-renderer)",
            YtdChannelHandlePatcher
        );
        applyPatcher(
            "#author-text",
            AuthorTextHandlePatcher
        );
        if (windowPathname.startsWith("/c/")
            || windowPathname.startsWith("/channel/")
            || windowPathname.startsWith("/@")) {
            applyPatcher(
                "ytd-grid-channel-renderer #channel-info",
                ChannelInfoHandlePatcher
            );
        }
    });
}();

function applyPatcher(selector, patcher) {
    const handleContainer = document.querySelectorAll(selector);
        
    for (const elem of handleContainer) {
        if (elem.previewHandlePatched) continue;

        new patcher(elem);
    }
}

class HandlePatcher {
    container = null;
    anchor = null;
    patched = false;
    handleElement = null;
    handle = "...";
    href = null;
    observer = null;
    observerAbortController = null;

    constructor(container, anchor) {
        this.container = container;
        this.anchor = anchor;
        this.href = anchor.href;
        this.patch();
    }

    async renewHandle() {
        if (this.href.includes("/channel/")) {
            this.handle = await getHandleFromChannelPage(this.href);
        }
        else {
            this.handle = getHandleFromHref(this.href);
        }
    }

    initHandleElement() {
        this.handleElement = document.createElement("a");
        this.handleElement.className = "ohandle yt-simple-endpoint style-scope yt-formatted-string";
        this.updateHandleElement("...", ".");
    }

    updateHandleElement(handle, href) {
        this.handleElement.textContent = this.handleElement.title = handle;
        this.handleElement.href = href;
    }

    startObserver() {
        if (this.observerAbortController) this.observerAbortController.abort();
        this.observerAbortController = new AbortController();
        makeMutationObserver({
            target: this.anchor,
            attributes: true,
            attributeFilter: ["href"],
            signal: this.observerAbortController.signal
        }, () => this.update());
    }

    patch() {
        this.initHandleElement();
        this.update();
        this.startObserver();
        this.hookHandleElement();
        this.patched = this.container.previewHandlePatched = true;
    }

    async update() {
        this.updateHandleElement("...", ".");
        if (this.anchor) this.href = this.anchor.href;
        await this.renewHandle().catch(i => this.observerAbortController.abort());
        this.updateHandleElement(this.handle, this.href);
    }

    hookHandleElement() {
        throw TypeError("this method must be implemented in derived class");
    }
}

class YtdChannelHandlePatcher extends HandlePatcher {
    constructor(container) {
        super(container, container.querySelector("a"));
    }

    hookHandleElement() {
        this.container.append(this.handleElement);        
    }
}

class AuthorTextHandlePatcher extends HandlePatcher {
    constructor (container) {
        super(container, container);
    }

    hookHandleElement() {
        const ytPostOrCommentTimestamp = this.container.parentElement.parentElement.querySelector(".published-time-text, #published-time-text")
        if (ytPostOrCommentTimestamp) {
            ytPostOrCommentTimestamp.insertAdjacentElement("beforebegin", this.handleElement);
        }
        else {
            this.container.insertAdjacentElement("afterend", this.handleElement);
        }
    }
}

class ChannelInfoHandlePatcher extends HandlePatcher {
    constructor (container) {
        super(container, container);
    }

    hookHandleElement() {
        this.container.querySelector("#title").insertAdjacentElement("afterend", this.handleElement);
    }
}

function getHandleFromHref(href) {
    if (href.includes("/@")) {
        return "@" + href.split("@")[1];
    }
    else if (href.includes("/channel/")) {
        return href.split("/channel/")[1];
    }
    else if (href.includes("/c/")) {
        return "/c/" + href.split("/c/")[1];
    }
    else return href;
}

async function getHandleFromChannelPage(href) {
    const controller = new AbortController();
    const fetchOptions = {
        transformStream: i => i.pipeThrough(new TextDecoderStream()),
        signal: controller.signal
    };

    let accumulatedText = "";

    for await (const chunk of fetchChunks(href, fetchOptions)) {
        accumulatedText += chunk;

        const splitText = accumulatedText.split(/ytInitialData ?=/)[1];

        if (splitText?.includes(";</script>")) {
            const ytInitialDataStr = splitText.split(";</script>")[0];       
            const ytInitialData = JSON.parse(ytInitialDataStr);
            controller.abort();

            return getHandleFromHref(ytInitialData.metadata.channelMetadataRenderer.vanityChannelUrl);
        }
    }
}

async function* fetchChunks(url, { transformStream, signal, ...fetchOptions } = {}) {
    const response = await fetch(url, { signal, ...fetchOptions });

    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const reader = transformStream(response.body).getReader();
    
    try {
        while (true) {
            signal?.throwIfAborted();

            const { done, value } = await reader.read();
            
            if (done) {
                break;
            }
            
            yield value;
        }
    }
    finally {
        reader.releaseLock();
    }
}