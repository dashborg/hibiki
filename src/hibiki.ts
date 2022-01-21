// Copyright 2021-2022 Dashborg Inc

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import {parseHtml} from "./html-parser";
import {HibikiState, DataEnvironment} from "./state";
import * as ReactDOM from "react-dom";
import {HibikiRootNode, CORE_LIBRARY} from "./nodes";
import {deepTextContent, evalDeepTextContent, isObject, bindLibContext} from "./utils";
import merge from "lodash/merge";
import type {HibikiNode, HibikiConfig, Hibiki, HibikiExtState, ReactClass, LibraryType} from "./types";
import {LocalModule, HttpModule, LibModule, HibikiModule} from "./modules";

declare var window : any;

// @ts-ignore - from webpack DefinePlugin
let BUILD = __HIBIKIBUILD__; let VERSION = __HIBIKIVERSION__;

function errorWithCause(message : string, cause : Error) {
    // @ts-ignore
    throw new Error(message, {cause: cause}); // ES6 error with cause
}

function readHibikiOptsFromHtml(htmlObj : HibikiNode) : {config : HibikiConfig, initialData : any} {
    let config : HibikiConfig = null;
    let initialData : any = null;
    if (htmlObj == null || htmlObj.list == null) {
        return {config, initialData};
    }
    for (let i=0; i<htmlObj.list.length; i++) {
        let subNode = htmlObj.list[i];
        if (config == null && subNode.tag == "hibiki-config") {
            try {
                config = evalDeepTextContent(subNode, true);
            }
            catch (e) {
                throw errorWithCause("Error parsing <hibiki-config> content: " + e.message, e);
            }
        }
        if (initialData == null && subNode.tag == "hibiki-data") {
            try {
                initialData = evalDeepTextContent(subNode, true);
            }
            catch (e) {
                throw errorWithCause("Error parsing <hibiki-data> content: " + e.message, e); 
            }
            if (initialData != null && !isObject(initialData)) {
                initialData = {data: initialData};
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

// TODO handle errors
let createState = function createState(config : HibikiConfig, html : string | HTMLElement, initialData : any) : HibikiExtState {
    let state = new HibikiState();
    state.ComponentLibrary.addLibrary(CORE_LIBRARY);
    
    config = config || {};
    initialData = initialData || {};
    let htmlObj : HibikiNode = null;
    if (html != null) {
        htmlObj = parseHtml(html);
        bindLibContext(htmlObj, "main");
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
    return state.getExtState();
}
createState = mobx.action(createState);

function render(elem : HTMLElement, state : HibikiExtState) {
    let props = {hibikiState: state};
    let reactElem = React.createElement(HibikiRootNode, props, null);
    state.setInitCallback(() => {
        ReactDOM.render(reactElem, elem);
        elem.classList.remove("hibiki-cloak");
    });
    state.initialize(false);
}

function loadTag(elem : HTMLElement) : HibikiExtState {
    if (elem.hasAttribute("loaded")) {
        console.log("Hibiki tag already loaded", elem);
        return;
    }
    elem.setAttribute("loaded", "1");
    if (elem.tagName.toLowerCase() == "template") {
        let forElemId = elem.getAttribute("for");
        let renderNode = null;
        if (forElemId != null) {
            renderNode = document.getElementById(forElemId);
        }
        if (renderNode == null) {
            renderNode = document.createElement("div");
            if (elem.getAttribute("class") != null) {
                renderNode.setAttribute("class", elem.getAttribute("class"));
            }
            if (elem.getAttribute("style") != null) {
                renderNode.setAttribute("style", elem.getAttribute("style"));
            }
            if (elem.parentElement.tagName.toLowerCase() == "head") {
                document.querySelector("body").prepend(renderNode);
            }
            else {
                elem.parentNode.insertBefore(renderNode, elem.nextSibling); // insert after elem
            }
        }
        let state = createState({}, elem, null);
        render(renderNode, state);
        return state;
    }
    else {
        let state = createState({}, elem, null);
        render(elem, state);
        return state;
    }
}

function autoloadTags() {
    let elems = document.querySelectorAll("hibiki, template[hibiki]");
    let htmlElem = document.querySelector("html");
    let bodyElem = document.querySelector("body");
    if (htmlElem.hasAttribute("hibiki") || (bodyElem != null && bodyElem.hasAttribute("hibiki"))) {
        elems = document.querySelectorAll("body");
    }
    for (let i=0; i<elems.length; i++) {
        let elem : HTMLElement = elems[i] as HTMLElement;
        if (elem.hasAttribute("noautoload")) {
            continue;
        }
        let state = loadTag(elem);
        if (elem.hasAttribute("name")) {
            window.Hibiki.States[elem.getAttribute("name")] = state;
        }
        window.HibikiState = state;
    }
}

let LocalHandlers : Record<string, (HibikiRequest) => any> = {};
let LocalReactComponents : mobx.ObservableMap<string, ReactClass> = mobx.observable.map({}, {name: "LocalReactComponents", deep: false});
let LocalNativeComponents : mobx.ObservableMap<string, ReactClass> = mobx.observable.map({}, {name: "LocalNativeComponents", deep: false});

function registerLocalJSHandler(path : string, fn : (HibikiRequest) => any) {
    LocalHandlers[path] = fn;
}

function registerLocalReactComponentImpl(name : string, comp : ReactClass) {
    mobx.action(() => LocalReactComponents.set(name, comp))();
}

function registerLocalNativeComponentImpl(name : string, comp : ReactClass) {
    mobx.action(() => LocalNativeComponents.set(name, comp))();
}

function addLibraryCallback(libName : string, fn : Function) {
    if (window.Hibiki.LibraryCallbacks[libName] == null) {
        window.Hibiki.LibraryCallbacks[libName] = [];
    }
    window.Hibiki.LibraryCallbacks[libName].push(fn);
}

let hibiki : Hibiki = {
    autoloadTags: autoloadTags,
    loadTag: loadTag,
    render: render,
    createState: createState,
    registerLocalJSHandler: registerLocalJSHandler,
    registerLocalReactComponentImpl: registerLocalReactComponentImpl,
    registerLocalNativeComponentImpl: registerLocalNativeComponentImpl,
    addLibraryCallback: addLibraryCallback,
    HibikiReact: HibikiRootNode,
    ModuleRegistry: {
        "local": LocalModule,
        "http": HttpModule,
        "lib": LibModule,
        "hibiki": HibikiModule,
    },
    JSFuncs: {},
    LocalHandlers: LocalHandlers,
    LocalReactComponents: LocalReactComponents,
    LocalNativeComponents: LocalNativeComponents,
    ImportLibs: {
        React: React,
        ReactDOM: ReactDOM,
        mobx: mobx,
        mobxReact: mobxReact,
    },
    LibraryCallbacks: {},
    States: {},
    VERSION: VERSION,
    BUILD: BUILD,
};

window.Hibiki = hibiki;

let hideStyleSheet = document.createElement("style");
hideStyleSheet.innerHTML = ".hibiki-cloak { display: none }";
document.querySelector("head").appendChild(hideStyleSheet);

if (document.readyState == "loading") {
    document.addEventListener("DOMContentLoaded", () => autoloadTags());
}
else {
    autoloadTags();
}

