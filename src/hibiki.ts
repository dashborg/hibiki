// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import * as DataCtx from "./datactx";
import {sprintf} from "sprintf-js";
import {parseHtml} from "./html-parser";
import {HibikiState, DataEnvironment} from "./state";
import * as ReactDOM from "react-dom";
import {HibikiRootNode, CORE_LIBRARY} from "./nodes";
import {deepTextContent, evalDeepTextContent, isObject, bindLibContext, callHook} from "./utils";
import merge from "lodash/merge";
import type {HibikiConfig, Hibiki, HibikiExtState, ReactClass, LibraryType, HibikiGlobalConfig} from "./types";
import type {HibikiNode} from "./html-parser";
import {LocalModule, HttpModule, LibModule} from "./modules";
import {HibikiModule} from "./hibiki-module";
import * as DBCtxModule from "./dbctx";

declare var window : any;

// @ts-ignore - from webpack DefinePlugin
let BUILD = __HIBIKIBUILD__; let VERSION = __HIBIKIVERSION__;

const DEFAULT_LIBRARY_ROOT = "https://cdn.hibikihtml.com/libs/";

function errorWithCause(message : string, cause : Error) {
    // @ts-ignore
    throw new Error(message, {cause: cause}); // ES6 error with cause
}


function getGlobalConfig() : HibikiGlobalConfig {
    let rtn : HibikiGlobalConfig = {
        noUsagePing: false,
        noWelcomeMessage: false,
        libraryRoot: DEFAULT_LIBRARY_ROOT,
        useDevLibraryBuilds: false,
        preRenderHook: null,
        postRenderHook: null,
    };
    if (window.HibikiGlobalConfig != null && typeof(window.HibikiGlobalConfig) === "object") {
        rtn = Object.assign(rtn, window.HibikiGlobalConfig);
    }
    return rtn;
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
    if (htmlElem.hasAttribute("noconfigmergefromhtml")) {
        rtn.noConfigMergeFromHtml = true;
    }
    if (htmlElem.hasAttribute("nodatamergefromhtml")) {
        rtn.noDataMergeFromHtml = true;
    }
    if (htmlElem.hasAttribute("name")) {
        rtn.stateName = htmlElem.getAttribute("name");
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
    if (state.getStateName() != null) {
        window.Hibiki.States[state.getStateName()] = state;
    }
    return state.getExtState();
}
createState = mobx.action(createState);

function render(elem : HTMLElement, state : HibikiExtState) {
    let parentHtmlTag = elem.parentElement.tagName.toLowerCase();
    let props = {hibikiState: state, parentHtmlTag: parentHtmlTag, htmlElem: elem};
    let reactElem = React.createElement(HibikiRootNode, props, null);
    let gc = getGlobalConfig();
    if (gc.preRenderHook != null) {
        callHook("preRenderHook", gc.preRenderHook, state, elem);
    }
    state.setInitCallback(() => {
        ReactDOM.render(reactElem, elem);
        elem.classList.remove("hibiki-cloak");
    });
    state.initialize(false);
}

function loadTag(elem : HTMLElement) : HibikiExtState {
    if (elem.hasAttribute("loaded")) {
        console.log("Hibiki tag already loaded", elem);
        return null;
    }
    elem.setAttribute("loaded", "1");
    if (elem.tagName.toLowerCase() === "body") {
        console.log("Hibiki cannot render directly into <body> tag, create a tag under <body> to render to");
        return null;
    }
    if (elem.tagName.toLowerCase() === "template") {
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

function autoloadTags() : void {
    let elems = document.querySelectorAll("hibiki, template[hibiki]");
    for (let i=0; i<elems.length; i++) {
        let elem : HTMLElement = elems[i] as HTMLElement;
        if (elem.hasAttribute("noautoload")) {
            continue;
        }
        let state = loadTag(elem);
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
    GlobalConfig: getGlobalConfig(),
    JSFuncs: {},
    LocalHandlers: LocalHandlers,
    LocalReactComponents: LocalReactComponents,
    LocalNativeComponents: LocalNativeComponents,
    ImportLibs: {
        React: React,
        ReactDOM: ReactDOM,
        mobx: mobx,
        mobxReact: mobxReact,
        HibikiDataCtx: DataCtx,
        HibikiDBCtx: DBCtxModule,
    },
    LibraryCallbacks: {},
    States: {},
    VERSION: VERSION,
    BUILD: BUILD,
    WelcomeMessageFired: false,
    UsageFired: false,
};

hibiki.ImportLibs.Hibiki = hibiki;
window.Hibiki = hibiki;

function fireWelcomeMessage() {
    let globalConfig = getGlobalConfig();
    if (!hibiki.WelcomeMessageFired && !globalConfig.noWelcomeMessage) {
        hibiki.WelcomeMessageFired = true;
        let versionStr = hibiki.VERSION + " " + hibiki.BUILD;
        let flowerEmoji = String.fromCodePoint(0x1F338);
        console.log(flowerEmoji + sprintf(" Hibiki HTML https://github.com/dashborg/hibiki [%s] | Developed by Dashborg Inc https://dashborg.net", versionStr));
    }
    if (!hibiki.UsageFired && !globalConfig.noUsagePing) {
        let versionStr = hibiki.VERSION + "|" + hibiki.BUILD;
        let usageImg = new Image();
        usageImg.src = sprintf("https://hibikihtml.com/hibiki-usage.gif?version=%s&build=%s", hibiki.VERSION, hibiki.BUILD);
        usageImg.onload = function() {};
    }
}

let hideStyleSheet = document.createElement("style");
hideStyleSheet.innerHTML = ".hibiki-cloak { display: none }";
document.querySelector("head").appendChild(hideStyleSheet);

if (document.readyState == "loading") {
    document.addEventListener("DOMContentLoaded", () => autoloadTags());
}
else {
    autoloadTags();
}

fireWelcomeMessage();

