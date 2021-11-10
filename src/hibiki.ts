import * as React from "react";
import * as mobx from "mobx";
import {parseHtml} from "./html-parser";
import {HibikiState, DataEnvironment} from "./state";
import * as ReactDOM from "react-dom";
import {HibikiRootNode, CORE_LIBRARY} from "./nodes";
import {textContent} from "./utils";
import merge from "lodash/merge";
import type {HibikiNode, HibikiConfig} from "./types";

declare var window : any;

function readHibikiOptsFromHtml(htmlObj : HibikiNode) : {config : HibikiConfig, initialData : any} {
    let config : HibikiConfig = null;
    let initialData : any = null;
    if (htmlObj == null || htmlObj.list == null) {
        return {config, initialData};
    }
    for (let i=0; i<htmlObj.list.length; i++) {
        let subNode = htmlObj.list[i];
        if (config == null && subNode.tag == "hibiki-config") {
            config = JSON.parse(textContent(subNode));
        }
        if (initialData == null && subNode.tag == "hibiki-initialdata") {
            initialData = JSON.parse(textContent(subNode));
        }
    }
    return {config, initialData};
}

let createHibikiState = function createHibikiState(config : HibikiConfig, html : string | HTMLElement, initialData : any) : HibikiState {
    let state = new HibikiState();
    state.ComponentLibrary.addLibrary(CORE_LIBRARY);
    state.ComponentLibrary.importLib("@hibiki/core", null);
    
    config = config || {};
    initialData = initialData || {};
    let htmlObj : HibikiNode = null;
    if (html != null) {
        htmlObj = parseHtml(html);
    }
    state.setHtml(htmlObj);
    let hibikiOpts = readHibikiOptsFromHtml(htmlObj);
    if (!config.noConfigMergeFromHtml) {
        config = merge((hibikiOpts.config ?? {}), config);
    }
    state.setConfig(config);
    if (!config.noDataMergeFromHtml) {
        initialData = merge((hibikiOpts.initialData ?? {}), initialData);
    }
    state.setGlobalData(initialData);
    return state;
}
createHibikiState = mobx.action(createHibikiState);

function render(elem : HTMLElement, state : HibikiState) {
    let renderNode = state.findPage("default");
    let props = {page: "default", node: renderNode, dataenv: state.rootDataenv()};
    let reactElem = React.createElement(HibikiRootNode, props, null);
    ReactDOM.render(reactElem, elem);
}

function loadTags() {
    let elems = document.querySelectorAll("hibiki, template[hibiki]");
    for (let i=0; i<elems.length; i++) {
        let elem : HTMLElement = elems[i] as HTMLElement;
        if (elem.tagName.toLowerCase() == "template") {
            let siblingNode = document.createElement("div");
            siblingNode.classList.add("hibiki-root");
            elem.parentNode.insertBefore(siblingNode, elem.nextSibling); // insertAfter
            let state = createHibikiState({}, elem, {"test": [1,3,5], "color": "purple"});
            render(siblingNode, state);
        }
        else {
            let state = createHibikiState({}, elem, null);
            render(elem, state);
        }
    }
}

window.hibiki = {
    loadTags,
    HibikiState,
    DataEnvironment,
};
