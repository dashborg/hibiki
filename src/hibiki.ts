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
            let text = textContent(subNode).trim();
            if (text != "") {
                config = JSON.parse(text);
            }
        }
        if (initialData == null && subNode.tag == "hibiki-initialdata") {
            let text = textContent(subNode).trim();
            if (text != "") {
                initialData = JSON.parse(text);
            }
        }
    }
    return {config, initialData};
}

function readHibikiConfigFromOuterHtml(htmlElem : string | HTMLElement) : HibikiConfig {
    let rtn : HibikiConfig = {};
    if (typeof(htmlElem) == "string") {
        return rtn;
    }
    let initHandlerAttr = htmlElem.getAttribute("inithandler");
    if (initHandlerAttr != null) {
        rtn.initHandler = initHandlerAttr;
    }
    if (htmlElem.hasAttribute("nousageimg")) {
        rtn.noUsageImg = true;
    }
    if (htmlElem.hasAttribute("nowelcomemessage")) {
        rtn.noWelcomeMessage = true;
    }
    if (htmlElem.hasAttribute("noconfigmergefromhtml")) {
        rtn.noConfigMergeFromHtml = true;
    }
    if (htmlElem.hasAttribute("nodatamergefromhtml")) {
        rtn.noDataMergeFromHtml = true;
    }
    return rtn;
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
    let configFromOuterHtml = readHibikiConfigFromOuterHtml(html);
    config = merge(config, configFromOuterHtml);
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

function loadTags(opts? : {autoLoad? : boolean}) {
    opts = opts || {};
    let elems = document.querySelectorAll("hibiki, template[hibiki]");
    for (let i=0; i<elems.length; i++) {
        let elem : HTMLElement = elems[i] as HTMLElement;
        if (elem.hasAttribute("loaded")) {
            continue;
        }
        if (opts.autoLoad && elem.hasAttribute("noautoload")) {
            continue;
        }
        elem.setAttribute("loaded", "1");
        if (elem.tagName.toLowerCase() == "template") {
            let siblingNode = document.createElement("div");
            siblingNode.classList.add("hibiki-root");
            elem.parentNode.insertBefore(siblingNode, elem.nextSibling); // insertAfter
            let state = createHibikiState({}, elem, null);
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

document.addEventListener("DOMContentLoaded", () => loadTags({autoLoad: true}));
