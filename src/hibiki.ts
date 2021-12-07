// Copyright 2021 Dashborg Inc

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import {parseHtml} from "./html-parser";
import {HibikiState, DataEnvironment} from "./state";
import * as ReactDOM from "react-dom";
import {HibikiRootNode, CORE_LIBRARY} from "./nodes";
import {deepTextContent, evalDeepTextContent, isObject} from "./utils";
import merge from "lodash/merge";
import type {HibikiNode, HibikiConfig, Hibiki, HibikiExtState, ReactClass, LibraryType} from "./types";
import {FetchModule, AppModule, LocalModule} from "./modules";
import {DefaultJSFuncs} from "./jsfuncs";

declare var window : any;

function readHibikiOptsFromHtml(htmlObj : HibikiNode) : {config : HibikiConfig, initialData : any, initHandler : string} {
    let config : HibikiConfig = null;
    let initialData : any = null;
    let initHandler : string = null;
    if (htmlObj == null || htmlObj.list == null) {
        return {config, initialData, initHandler};
    }
    for (let i=0; i<htmlObj.list.length; i++) {
        let subNode = htmlObj.list[i];
        if (config == null && subNode.tag == "hibiki-config") {
            config = evalDeepTextContent(subNode, true);
        }
        if (initialData == null && subNode.tag == "hibiki-data") {
            initialData = evalDeepTextContent(subNode, true);
            if (initialData != null && !isObject(initialData)) {
                initialData = {data: initialData};
            }
        }
        if (initHandler == null && subNode.tag == "hibiki-init") {
            initHandler = deepTextContent(subNode);
        }
    }
    return {config, initialData, initHandler};
}

function readHibikiConfigFromOuterHtml(htmlElem : string | HTMLElement) : HibikiConfig {
    let rtn : HibikiConfig = {};
    if (typeof(htmlElem) == "string") {
        return rtn;
    }
    let initHandlerAttr = htmlElem.getAttribute("init.handler");
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

// TODO handle errors
let createState = function createState(config : HibikiConfig, html : string | HTMLElement, initialData : any) : HibikiExtState {
    let state = new HibikiState();
    state.ComponentLibrary.addLibrary(CORE_LIBRARY);
    state.ComponentLibrary.rawImportLib("@main", "@hibiki/core", null);
    
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
        if (config.initHandler == null) {
            config.initHandler = hibikiOpts.initHandler;
        }
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
            let siblingNode = document.createElement("div");
            siblingNode.classList.add("hibiki-root");
            elem.parentNode.insertBefore(siblingNode, elem.nextSibling); // insertAfter
            renderNode = siblingNode;
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

function registerLocalHandler(path : string, fn : (HibikiRequest) => any) {
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
    registerLocalHandler: registerLocalHandler,
    registerLocalReactComponentImpl: registerLocalReactComponentImpl,
    registerLocalNativeComponentImpl: registerLocalNativeComponentImpl,
    addLibraryCallback: addLibraryCallback,
    HibikiReact: HibikiRootNode,
    ModuleRegistry: {
        "local": LocalModule,
        "fetch": FetchModule,
        "app": AppModule,
    },
    JSFuncs: DefaultJSFuncs,
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
};

window.Hibiki = hibiki;

document.addEventListener("DOMContentLoaded", () => autoloadTags());
