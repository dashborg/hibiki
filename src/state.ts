// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as mobx from "mobx";
import md5 from "md5";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {v4 as uuidv4} from 'uuid';
import type {ComponentType, LibraryType, HibikiConfig, HibikiHandlerModule, HibikiAction, EventType, HandlerValType, JSFuncType, Hibiki, ErrorCallbackFn, HtmlParserOpts, HandlerBlock, HibikiVal, HibikiValObj} from "./types";
import type {HibikiNode, NodeAttrType} from "./html-parser";
import * as DataCtx from "./datactx";
import {isObject, textContent, SYM_PROXY, SYM_FLATTEN, nodeStr, callHook, getHibiki, parseHandler, fullPath, parseUrlParams, smartDecodeParams, unbox, bindLibContext, compareVersions} from "./utils";
import {subNodesByTag, firstSubNodeByTag} from "./nodeutils";
import {RtContext, HibikiError} from "./error";
import {HibikiRequest} from "./request";
import * as NodeUtils from "./nodeutils";
import type {DBCtx} from "./dbctx";
import {doParse} from "./hibiki-parser";

import {parseHtml} from "./html-parser";

type CallHandlerOptsType = {
    dataenv? : DataEnvironment,
    rtContext? : RtContext,
};

type EHandlerType = {
    handler : HandlerBlock,
    node : HibikiNode,
    dataenv : DataEnvironment,
    contextVars? : DataCtx.ContextVarType[],
};

let RESTRICTED_MODS = {
    "": true,
    "hibiki": true,
    "lib": true,
    "local": true,
    "http": true,
    "main": true,
    "h": true,
    "html": true,
};

function eventBubbles(event : string) : boolean {
    if (event === "load") {
        return false;
    }
    if (event.startsWith("x")) {
        return false;
    }
    return true;
}

type DataEnvironmentOpts = {
    componentRoot? : HibikiValObj,
    argsRoot? : HibikiValObj,
    description? : string,
    handlers? : Record<string, HandlerValType>,
    htmlContext? : string,
    libContext? : string,
    eventBoundary? : string, // "soft" | "hard",
    blockLocalData? : boolean,
};

class DataEnvironment {
    parent : DataEnvironment | null;
    dbstate : HibikiState;
    specials : Record<string, any>;
    handlers : Record<string, HandlerValType>;
    componentRoot : HibikiValObj;
    argsRoot? : HibikiValObj;
    htmlContext : string;
    libContext : string;
    description : string;
    eventBoundary : "soft" | "hard";
    blockLocalData : boolean;

    constructor(dbstate : HibikiState, opts? : DataEnvironmentOpts) {
        this.parent = null;
        this.dbstate = dbstate;
        this.specials = {};
        this.handlers = {};
        this.eventBoundary = null;
        this.htmlContext = null;
        this.libContext = null;
        this.blockLocalData = false;
        if (opts != null) {
            this.componentRoot = opts.componentRoot;
            this.argsRoot = opts.argsRoot;
            this.description = opts.description;
            this.handlers = opts.handlers || {};
            this.htmlContext = opts.htmlContext;
            this.libContext = opts.libContext;
            if (opts.eventBoundary === "soft" || opts.eventBoundary === "hard") {
                this.eventBoundary = opts.eventBoundary;
            }
            this.blockLocalData = opts.blockLocalData;
        }
    }

    getHtmlContext() : string {
        if (this.htmlContext != null) {
            return this.htmlContext;
        }
        if (this.parent == null) {
            return "none";
        }
        return this.parent.getHtmlContext();
    }

    getLibContext() : string {
        if (this.libContext != null) {
            return this.libContext;
        }
        if (this.parent == null) {
            return null;
        }
        return this.parent.getLibContext();
    }

    getFullHtmlContext() : string {
        let env : DataEnvironment = this;
        let rtn = "";
        while (env != null) {
            if (env.htmlContext != null && env.htmlContext !== "<define-vars>") {
                if (rtn === "") {
                    rtn = env.htmlContext;
                }
                else {
                    if (env.htmlContext !== "<root>") {
                        rtn = env.htmlContext + " | " + rtn;
                    }
                }
            }
            env = env.parent;
        }
        if (rtn === "") {
            return "<unknown>";
        }
        return rtn;
    }

    resolveRoot(rootName : string, opts?: {caret? : number}) : HibikiValObj | HibikiVal[] {
        opts = opts || {};
        if (opts.caret != null && opts.caret < 0 || opts.caret > 1) {
            throw new Error("Invalid caret value, must be 0 or 1");
        }
        if (rootName === "global" || rootName === "data") {
            return unbox(this.dbstate.DataRoots["global"]);
        }
        if (rootName === "state") {
            return unbox(this.dbstate.DataRoots["state"]);
        }
        if (rootName === "null") {
            return null;
        }
        if (rootName === "nodedata") {
            // this is Map<string, IObservableValue<HibikiVal>>, not quite compatible, but works for read-only
            return (this.dbstate.NodeDataMap as any);
        }
        if (rootName === "context") {
            let ref : DataEnvironment = this;
            if (opts.caret) {
                for (let i=0; i<opts.caret && ref != null; i++) {
                    ref = ref.parent;
                }
            }
            if (ref == null) {
                return null;
            }
            return ref.getContextProxy();
        }
        if (rootName === "currentcontext") {
            let ref : DataEnvironment = this;
            if (opts.caret) {
                for (let i=0; i<opts.caret && ref != null; i++) {
                    ref = ref.parent;
                }
            }
            if (ref == null) {
                return null;
            }
            return ref.specials;
        }
        if (rootName === "contextstack") {
            return this.getContextStack();
        }
        if (rootName === "c" || rootName === "component") {
            return this.getComponentRoot();
        }
        if (rootName === "args") {
            return this.getArgsRoot();
        }
        if (rootName == "lib") {
            let libContext = this.getLibContext() ?? "main";
            return unbox(this.dbstate.DataRoots["lib:" + libContext])
        }
        if (rootName in this.dbstate.DataRoots) {
            return unbox(this.dbstate.DataRoots[rootName]);
        }
        throw new Error("Invalid root path");
    }

    getContextProxy() : {[e : string] : any} {
        let self = this;
        let traps = {
            get: (obj : any, prop : (string | number | symbol)) : any => {
                if (prop == null) {
                    return null;
                }
                if (prop === SYM_PROXY) {
                    return true;
                }
                if (prop === SYM_FLATTEN) {
                    return self.getSquashedContext();
                }
                return self.getContextKey(prop.toString());
            },
            set: (obj : any, prop : string, value : any) : boolean => {
                if (prop == null) {
                    return true;
                }
                self.specials[prop] = value;
                return true;
            },
        };
        return new Proxy({}, traps);
    }

    getSquashedContext() : {[e : string] : any} {
        let stack = this.getContextStack();
        let rtn = {};
        for (let i=stack.length-1; i>=0; i--) {
            Object.assign(rtn, stack[i]);
        }
        return rtn;
    }

    printStack() {
        let jsonSpecials = DataCtx.JsonStringify(this.specials);
        let deType = "";
        if (this.eventBoundary === "hard") {
            deType = "--|";
        }
        else if (this.eventBoundary === "soft") {
            deType = "-*|";
        }
        else {
            deType = "  |";
        }
        let hkeysStr = Object.keys(this.handlers).join(",");
        let specialsStr = Object.keys(this.specials).map((v) => "@" + v).join(",");
        let libStr = "";
        if (this.libContext != null && this.libContext !== "main") {
            libStr = sprintf("lib[%s] ", this.libContext);
        }
        let stackStr = sprintf("%s %-30s | %-30s | %s%s", deType, this.htmlContext, specialsStr, libStr, hkeysStr);
        console.log(stackStr);
        if (this.parent != null) {
            this.parent.printStack();
        }
    }

    // always returns hard
    // returns soft if event == "*" or env.handlers[//@event/[event]] != null
    getEventBoundary(event : string) : DataEnvironment {
        let env : DataEnvironment = this;;
        let evHandlerName = sprintf("//@event/%s", event);
        while (env != null) {
            if (env.eventBoundary === "hard") {
                return env;
            }
            if (event != null && env.eventBoundary === "soft") {
                if (event === "*" || env.handlers[evHandlerName] != null) {
                    return env;
                }
            }
            env = env.parent;
        }
        return env;
    }

    getParentEventBoundary(event : string) : DataEnvironment {
        let eb1 = this.getEventBoundary(event);
        if (eb1 == null || eb1.parent == null) {
            return null;
        }
        return eb1.parent.getEventBoundary(event);
    }

    resolveEventHandler(event : EventType, rtctx : RtContext, parent? : boolean) : EHandlerType {
        let env = this.getEventBoundary(event.event);
        if (env == null) {
            return null;
        }
        let evHandlerName = sprintf("//@event/%s", event.event);
        if ((evHandlerName in env.handlers) && !rtctx.isHandlerInStack(env, event.event)) {
            let hval = env.handlers[evHandlerName];
            if (hval.boundDataenv != null) {
                return {handler: hval.block, node: hval.node, dataenv: hval.boundDataenv, contextVars: hval.contextVars};
            }
            return {handler: hval.block, node: hval.node, dataenv: env, contextVars: hval.contextVars};
        }
        if (env.parent == null) {
            return null;
        }
        if (event.bubble) {
            return env.parent.resolveEventHandler(event, rtctx);
        }
        if (parent) {
            return null;
        }
        let parentEnv = this.getParentEventBoundary("*");
        if (parentEnv == null) {
            return null;
        }
        return parentEnv.resolveEventHandler(event, rtctx, true);
    }

    getContextKey(contextkey : string) : any {
        if (contextkey in this.specials) {
            return this.specials[contextkey];
        }
        if (this.parent == null || this.blockLocalData) {
            return null;
        }
        return this.parent.getContextKey(contextkey);
    }

    getComponentRoot() : HibikiValObj {
        if (this.componentRoot != null) {
            return this.componentRoot;
        }
        if (this.parent == null) {
            return null;
        }
        return this.parent.getComponentRoot();
    }

    getArgsRoot() : Record<string, HibikiVal> {
        if (this.argsRoot != null) {
            return this.argsRoot;
        }
        if (this.parent == null) {
            return null;
        }
        return this.parent.getArgsRoot();
    }

    getContextStack() : any[] {
        let dataenv : DataEnvironment = this;
        let rtn = [];
        while (true) {
            if (dataenv == null) {
                break;
            }
            rtn.push(dataenv.specials);
            if (dataenv.blockLocalData) {
                break;
            }
            dataenv = dataenv.parent;
        }
        return rtn;
    }

    makeChildEnv(specials : any, opts : DataEnvironmentOpts) : DataEnvironment {
        specials = specials || {};
        let rtn = new DataEnvironment(this.dbstate, opts);
        rtn.parent = this;
        let copiedSpecials = Object.assign({}, specials || {});
        rtn.specials = copiedSpecials;
        return rtn;
    }

    resolvePath(path : string, opts? : {keepMobx? : boolean, rtContext? : string}) : any {
        opts = opts ?? {};
        let rtContext = opts.rtContext ?? "DataEnvironment.resolvePath";
        let rtn = DataCtx.ResolvePath(path, this, {rtContext: rtContext});
        if (!opts.keepMobx) {
            rtn = DataCtx.demobx(rtn);
        }
        return rtn;
    }

    setDataPath(path : string, data : any, rtContext? : string) {
        rtContext = rtContext ?? "DataEnvironment.setDataPath";
        DataCtx.SetPath(path, this, data, {rtContext: rtContext});
    }

    evalExpr(expr : string, keepMobx? : boolean) : any {
        if (expr == null || expr === "") {
            return null;
        }
        let rtn = DataCtx.EvalSimpleExpr(expr, this);
        if (!keepMobx) {
            rtn = DataCtx.demobx(rtn);
        }
        return rtn;
    }
}

class ComponentLibrary {
    libs : Record<string, LibraryType>;               // name -> library
    importedUrls : Record<string, boolean>;
    state : HibikiState;
    srcUrlToLibNameMap : Map<string, string>;

    constructor(state : HibikiState) {
        this.state = state;
        this.libs = {};
        this.importedUrls = {};
        this.srcUrlToLibNameMap = new Map();
    }

    addLibrary(libObj : LibraryType) : void {
        this.libs[libObj.name] = libObj;
    }

    fullLibName(libName : string) : string {
        let libObj = this.libs[libName];
        if (libObj == null || libObj.url == null) {
            return libName;
        }
        return sprintf("%s(%s)", libName, libObj.url);
    }

    registerLocalJSHandler(libName : string, handlerName : string, fn : (req : HibikiRequest) => any) : void {
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("Hibiki registerLocalHandler library '%s' not found", libName);
            return;
        }
        libObj.localHandlers[handlerName] = fn;
    }

    registerModule(libName : string, moduleName : string, module : HibikiHandlerModule) : void {
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("Hibiki registerModule library '%s' not found", libName);
            return;
        }
        libObj.modules[moduleName] = module;
    }

    registerReactComponentImpl(libName : string, componentName : string, impl : any) : void {
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("Hibiki registerReactComponentImpl library '%s' not found", libName);
            return;
        }
        let ctype = libObj.libComponents[componentName];
        if (ctype == null) {
            console.log("Hibiki registerReactComponentImpl component '%s/%s' not found", libName, componentName);
            return;
        }
        if (ctype.componentType !== "react-custom") {
            console.log("Hibiki registerReactComponentImpl component '%s/%s' is type 'react'", libName, componentName);
            return;
        }
        ctype.reactimpl.set(impl);
    }

    registerNativeComponentImpl(libName : string, componentName : string, impl : any) : void {
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("Hibiki registerNativeComponentImpl library '%s' not found", libName);
            return;
        }
        let ctype = libObj.libComponents[componentName];
        if (ctype == null) {
            console.log("Hibiki registerNativeComponentImpl component '%s/%s' not found", libName, componentName);
            return;
        }
        if (ctype.componentType !== "hibiki-native") {
            console.log("Hibiki registerNativeComponentImpl component '%s/%s' is type 'native'", libName, componentName);
            return;
        }
        ctype.impl.set(impl);
    }

    findLocalBlockHandler(handlerName : string, libContext : string) : HandlerBlock {
        let libObj = this.libs[libContext];
        if (libObj == null) {
            return null;
        }
        if (libObj.handlers[handlerName] == null) {
            return null;
        }
        return libObj.handlers[handlerName].block;
    }

    findLocalHandler(handlerName : string, libContext : string) : (req : HibikiRequest) => Promise<any> {
        let libObj = this.libs[libContext];
        if (libObj == null) {
            return null;
        }
        return libObj.localHandlers[handlerName];
    }

    findComponent(tagName : string, libContext : string) : ComponentType {
        if (tagName.startsWith("local-")) {
            let localTagName = tagName.substr(6);
            let libObj = this.libs[libContext];
            if (libObj == null) {
                return null;
            }
            let comp = libObj.libComponents[localTagName];
            if (comp == null) {
                return null;
            }
            return {
                componentType: comp.componentType,
                libName: libContext,
                name: localTagName,
                impl: comp.impl,
                reactimpl: comp.reactimpl,
                node: comp.node,
            };
        }
        libContext = libContext ?? "main";
        let libObj = this.libs[libContext];
        if (libObj == null) {
            return null;
        }
        return libObj.importedComponents[tagName];
    }

    getModule(moduleName : string, libContext : string) : HibikiHandlerModule {
        let libObj = this.libs[libContext];
        if (libObj == null) {
            return null;
        }
        return libObj.modules[moduleName];
    }

    removeModule(moduleName : string, libContext : string) : void {
        let libObj = this.libs[libContext];
        if (libObj == null) {
            return null;
        }
        delete libObj.modules[moduleName];
    }

    addModule(moduleName : string, module : HibikiHandlerModule, libContext : string) : void {
        let libObj = this.libs[libContext];
        if (libObj == null) {
            return null;
        }
        libObj.modules[moduleName] = module;
    }

    makeLocalModule(libContext : string, libName : string, prefix : string) : void {
        if (libContext == null) {
            throw new Error("null libContext in makeLocalModule");
        }
        if (prefix == null || libName == null) {
            return;
        }
        let hibiki = getHibiki();
        let mreg = hibiki.ModuleRegistry;
        let mod = new mreg["lib"](this.state, {libContext: libName});
        this.registerModule(libContext, "lib-" + prefix, mod);
    }

    buildLibraryFromUrl(srcUrl : string) : Promise<LibraryType> {
        let libName : string = this.srcUrlToLibNameMap.get(srcUrl);
        if (libName != null) {
            return Promise.resolve(this.libs[libName]);
        }
        let libReqVersion : string = null;
        let libNode : HibikiNode = null;
        let fetchInit : any = {};
        let p = fetch(srcUrl).then((resp) => {
            if (!resp.ok) {
                throw new Error(sprintf("Bad fetch response for library url '%s': %d %s", srcUrl, resp.status, resp.statusText));
            }
            let ctype = resp.headers.get("Content-Type");
            if (!ctype.startsWith("text/")) {
                throw new Error(sprintf("Bad fetch response for library url '%s', non-text mime-type: '%s'", srcUrl, ctype));
            }
            return resp.text();
        }).then((rtext) => {
            let defNode = parseHtml(rtext, null, {});
            libNode = firstSubNodeByTag(defNode, "define-library");
            if (libNode == null) {
                throw new Error(sprintf("No top-level <define-library> found for library url '%s'", srcUrl));
            }
            if (libNode.attrs == null || libNode.attrs.name == null) {
                throw new Error(sprintf("<define-library> must have 'name' attribute for library url '%s'", srcUrl));
            }
            libName = DataCtx.rawAttrStr(libNode.attrs.name);
            libReqVersion = DataCtx.rawAttrStr(libNode.attrs.hibikiversion);
            if (libReqVersion != null) {
                if (compareVersions(libReqVersion, getHibiki().VERSION) > 0) {
                    throw new Error(sprintf("Requires Hibiki HTML version %s (current Hibiki HTML version is %s)", libReqVersion, getHibiki().VERSION));
                }
            }
            bindLibContext(libNode, libName);
            return null;
        }).then(() => {
            return this.buildLibrary(libName, libNode, srcUrl, false);
        }).catch((e) => {
            e.message = sprintf("Error importing Hibiki Library \"%s\": %s", srcUrl, e.message);
            throw e;
        });
        return p;
    }

    buildLibrary(libName : string, libNode : HibikiNode, srcUrl : string, forceRebuild : boolean) : Promise<LibraryType> {
        if (!forceRebuild && this.libs[libName]) {
            return Promise.resolve(this.libs[libName]);
        }
        if (libNode == null) {
            return Promise.resolve(null);
        }
        let libObj : LibraryType = {name: libName, libNode: libNode, url: srcUrl, libComponents: {}, importedComponents: {}, localHandlers: {}, modules: {}, handlers: {}};
        this.libs[libName] = libObj;
        if (srcUrl != null) {
            this.srcUrlToLibNameMap.set(srcUrl, libName);
        }
        srcUrl = srcUrl ?? "local";
        let libPrintStr = sprintf("%s(%s)", libName, srcUrl);
        let parr = [];
        let scriptTags = subNodesByTag(libNode, "script");
        let srcs : string[] = [];
        for (let i=0; i<scriptTags.length; i++) {
            let stag = scriptTags[i];
            let attrs = NodeUtils.getRawAttrs(stag);
            if (attrs.type != null && attrs.type !== "text/javascript") {
                console.log(sprintf("WARNING library %s not processing script node with type=%s", libPrintStr, attrs.type));
                continue;
            }
            if (attrs.src == null) {
                let p = this.state.queueScriptText(textContent(stag), !attrs.async);
                parr.push(p);
                continue;
            }
            let scriptSrc = attrs.src;
            if (attrs.relative) {
                scriptSrc = new URL(scriptSrc, srcUrl).toString();
            }
            let p = this.state.queueScriptSrc(scriptSrc, true);
            parr.push(p);
            srcs.push("[script]" + scriptSrc);
        }
        let linkTags = subNodesByTag(libNode, "link");
        for (let i=0; i<linkTags.length; i++) {
            let ltag = linkTags[i];
            let attrs = NodeUtils.getRawAttrs(ltag);
            if (attrs.rel !== "stylesheet") {
                console.log(sprintf("WARNING library %s not processing link node with rel=%s", libPrintStr, attrs.rel));
                continue;
            }
            if (attrs.href == null) {
                console.log(sprintf("WARNING library %s not processing link rel=stylesheet node without href", libPrintStr));
                continue;
            }
            let cssUrl = attrs.href;
            if (attrs.relative) {
                cssUrl = new URL(cssUrl, srcUrl).toString();
            }
            let p = this.state.loadCssLink(cssUrl, !attrs.async);
            parr.push(p);
            srcs.push("[css]" + cssUrl);
        }
        let styleTags = subNodesByTag(libNode, "style");
        for (let i=0; i<styleTags.length; i++) {
            this.state.loadStyleText(textContent(styleTags[i]));
        }

        // components
        let htmlList = libNode.list ?? [];
        for (let h of htmlList) {
            if (h.tag !== "define-component") {
                continue;
            }
            let attrs = NodeUtils.getRawAttrs(h);
            if (attrs["name"] == null) {
                console.log(sprintf("WARNING library %s define-component tag without a name, skipping", libPrintStr));
                continue;
            }
            let name = attrs.name;
            if (name in libObj.libComponents) {
                console.log(sprintf("WARNING library %s cannot redefine component %s/%s", libPrintStr, libName, name));
                continue;
            }
            if (attrs.react) {
                libObj.libComponents[name] = {componentType: "react-custom", reactimpl: mobx.observable.box(null)};
                continue;
            }
            if (attrs.native) {
                libObj.libComponents[name] = {componentType: "hibiki-native", impl: mobx.observable.box(null)};
                continue;
            }
            libObj.libComponents[name] = {componentType: "hibiki-html", node: h};
        }

        // handlers
        if (libName == "main") {
            libObj.handlers = NodeUtils.makeHandlers(libNode, null, libName, ["local", "event"]);
        }
        else {
            libObj.handlers = NodeUtils.makeHandlers(libNode, null, libName, ["lib"]);
        }

        // modules
        let hibiki = getHibiki();
        let mreg = hibiki.ModuleRegistry;
        libObj.modules["hibiki"] = new mreg["hibiki"](this.state, {});
        libObj.modules["http"] = new mreg["http"](this.state, this.state.Config.httpConfig);
        libObj.modules["main"] = new mreg["lib"](this.state, {libContext: "main"});
        if (libName == "main") {
            libObj.modules["local"] = new mreg["local"](this.state, {});
            libObj.modules["lib-local"] = new mreg["lib"](this.state, {libContext: libName});
            this.state.buildConfigModules();
        }
        else {
            libObj.modules["lib"] = new mreg["lib"](this.state, {libContext: libName});
        }
        this.importLibrary(libName, "@hibiki/core", null, true);
        let importTags = subNodesByTag(libNode, "import-library");
        for (let i=0; i<importTags.length; i++) {
            let itag = importTags[i];
            let attrs = NodeUtils.getRawAttrs(itag);
            if (attrs.src == null || attrs.src === "") {
                console.log("Invalid <import-library> tag, no src attribute");
                continue;
            }
            if (attrs.prefix == null || attrs.prefix === "") {
                console.log(sprintf("Invalid <import-library> tag src[%s], no prefix attribute", itag.attrs.src));
                continue;
            }
            let libUrl = attrs.src;
            if (attrs.relative) {
                libUrl = new URL(libUrl, srcUrl).toString();
            }
            let p = this.state.ComponentLibrary.buildLibraryFromUrl(attrs.src);
            let afterImportP = p.then((importedLibObj) => {
                if (importedLibObj != null) {
                    this.importLibrary(libName, importedLibObj.name, attrs.prefix);
                }
            });
            if (!attrs.async) {
                parr.push(afterImportP);
            }
            srcs.push("[library]" + libUrl);
        }
        
        return Promise.all(parr).then(() => {
            let hibiki = getHibiki();
            if (hibiki.LibraryCallbacks[libName] == null) {
                return null;
            }
            let cbparr = [];
            for (let cbfn of hibiki.LibraryCallbacks[libName]) {
                let cbp = Promise.resolve(cbfn(this.state, this));
                cbparr.push(cbp);
            }
            return Promise.all(cbparr);
        })
        .then(() => {
            if (srcs.length > 0) {
                if (libName == "main") {
                    console.log(sprintf("Hibiki root dependencies: %s", JSON.stringify(srcs)));
                }
                else {
                    console.log(sprintf("Hibiki Library '%s' dependencies: %s", libPrintStr, JSON.stringify(srcs)));
                }
            }
            return libObj;
        });
    }

    importLibrary(libContext : string, libName : string, prefix : string, system? : boolean) : void {
        if (!system && (prefix == null || RESTRICTED_MODS[prefix])) {
            throw new Error(sprintf("Cannot import library with reserved '%s' prefix", prefix));
        }
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log(sprintf("Hibiki Error cannot import library '%s': not found", libName));
            return;
        }
        if (libContext == null || this.libs[libContext] == null) {
            console.log("Hibiki Error invalid libContext in rawImportLib", libContext);
        }
        let ctxLib = this.libs[libContext];
        for (let name in libObj.libComponents) {
            if (name.startsWith("@")) {
                continue;
            }
            let newComp = libObj.libComponents[name];
            if (newComp.isPrivate) {
                continue;
            }
            let cpath = libName + ":" + name;
            let importName = (prefix == null ? "" : prefix + "-") + name;
            let origComp = ctxLib.importedComponents[importName];
            if (origComp != null && (origComp.libName !== libName || origComp.name !== name)) {
                console.log(sprintf("Conflicting import %s %s:%s (discarding %s:%s)", importName, origComp.libName, origComp.name, libName, name));
                continue;
            }
            let ctype = {componentType: newComp.componentType, libName: libName, name: name, impl: newComp.impl, reactimpl: newComp.reactimpl, node: newComp.node};
            ctxLib.importedComponents[importName] = ctype;
        }
        this.makeLocalModule(libContext, libName, prefix);
    }
}

class HibikiExtState {
    state : HibikiState;
    
    constructor(state : HibikiState) {
        this.state = state;
    }

    initialize(force : boolean) : void {
        this.state.initialize(force);
    }

    setHtml(html : string | HTMLElement) : void {
        let htmlObj = parseHtml(html);
        bindLibContext(htmlObj, "main");
        this.state.setHtml(htmlObj);
    }

    setData(path : string, data : any) : void {
        let dataenv = this.state.rootDataenv();
        dataenv.setDataPath(path, data, "HibikiExtState.setDataPath");
    }

    getData(path : string) : HibikiVal {
        let dataenv = this.state.rootDataenv();
        return dataenv.resolvePath(path, {keepMobx: false, rtContext: "HibikiExtState.getData"});
    }

    executeHandlerBlock(actions : HandlerBlock, pure? : boolean) : Promise<HibikiVal> {
        return this.state.executeHandlerBlock(actions, pure);
    }

    callHandler(handlerUrl : string, data : HibikiValObj, pure? : boolean) : Promise<HibikiVal> {
        let actions = [{
            actiontype: "callhandler",
            callpath: handlerUrl,
            data: data,
        }];
        return this.state.executeHandlerBlock({hibikiactions: actions}, pure);
    }

    setPageName(pageName : string) : void {
        this.state.setPageName(pageName);
    }

    setInitCallback(fn : () => void) {
        this.state.setInitCallback(fn);
    }

    makeHibikiBlob(blob : Blob) : Promise<DataCtx.HibikiBlob> {
        return this.state.blobFromBlob(blob);
    }

    makeWatcher(exprStr : string, callback : (v : HibikiVal) => void) : (() => void) {
        let exprAst : DataCtx.HExpr = doParse(exprStr, "ext_fullExpr");
        exprAst.sourcestr = exprStr;
        let watcher = new DataCtx.Watcher(exprAst, false);
        let disposer = mobx.autorun(() => {
            try {
                let pageEnv = this.state.pageDataenv();
                let [val, updated] = watcher.checkValue(pageEnv);
                if (updated) {
                    callback(DataCtx.demobx(val));
                }
            }
            catch (e) {
                console.log(sprintf("Error evaluating watch expression [[%s]]:", exprStr), e);
            }
        });
        return disposer;
    }
}

class HibikiState {
    FeClientId : string = null;
    Ui : string = null;
    HtmlObj : mobx.IObservableValue<any> = mobx.observable.box(null, {name: "HtmlObj", deep: false});
    ComponentLibrary : ComponentLibrary;
    Initialized : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "Initialized"});
    RenderVersion : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "RenderVersion"});
    DataNodeStates : Record<string, {query : string, dnstate : any}> = {};
    ResourceCache : Record<string, boolean> = {};
    HasRendered = false;
    NodeDataMap : Map<string, mobx.IObservableValue<HibikiValObj>> = new Map();
    ExtHtmlObj : mobx.ObservableMap<string,any> = mobx.observable.map({}, {name: "ExtHtmlObj", deep: false});
    Config : HibikiConfig = {};
    PageName : mobx.IObservableValue<string> = mobx.observable.box("default", {name: "PageName"});
    InitCallbacks : (() => void)[];
    JSFuncs : Record<string, JSFuncType>;
    NodeUuidMap : Map<string, DBCtx> = new Map();
    DataRoots : Record<string, mobx.IObservableValue<HibikiVal>>;

    constructor() {
        this.DataRoots = {};
        this.DataRoots["global"] = mobx.observable.box({}, {name: "GlobalData"})
        this.DataRoots["state"] = mobx.observable.box({}, {name: "AppState"})
        this.ComponentLibrary = new ComponentLibrary(this);
        this.InitCallbacks = [];
        let hibiki = getHibiki();
        this.JSFuncs = hibiki.JSFuncs;
        window.addEventListener("popstate", this.popStateHandler);
    }
    
    @boundMethod popStateHandler() {
        this.setStateVars();
        let rtctx = new RtContext();
        rtctx.pushContext(sprintf("Firing native 'popstate' event"), null);
        let eventObj = {event: "popstate", native: true, bubble: false, datacontext: {}};
        DataCtx.FireEvent(eventObj, this.pageDataenv(), rtctx, false);
    }

    setInitCallback(fn : () => void) {
        if (this.Initialized.get()) {
            fn();
        }
        else {
            this.InitCallbacks.push(fn);
        }
    }

    @mobx.action
    setInitialized() {
        this.Initialized.set(true);
        for (let i=0; i<this.InitCallbacks.length; i++) {
            try {
                this.InitCallbacks[i]();
            }
            catch (e) {
                console.log("Hibiki Error running InitCallback", e);
            }
        }
    }

    @mobx.action setStateVars() {
        let rootDataenv = this.rootDataenv();
        rootDataenv.setDataPath("$state.pagename", this.PageName.get());
        rootDataenv.setDataPath("$state.historystate", window.history.state);
        rootDataenv.setDataPath("$state.title", document.title);
        rootDataenv.setDataPath("$state.rawurlparams", parseUrlParams());
        rootDataenv.setDataPath("$state.urlparams", smartDecodeParams(window.location.search));
        rootDataenv.setDataPath("$state.url", window.location.href);
        rootDataenv.setDataPath("$state.location", {
            protocol: window.location.protocol,
            host: window.location.host,
            hostname: window.location.hostname,
            port: window.location.port,
            href: window.location.href,
            hash: window.location.hash,
        });
    }

    initialize(force : boolean) : Promise<any> {
        if (this.Initialized.get()) {
            console.log("Hibiki State is already initialized");
        }
        if (force) {
            this.setInitialized();
            return;
        }
        this.setStateVars();
        let mainLibPromise = this.ComponentLibrary.buildLibrary("main", this.HtmlObj.get(), "local", true);
        let rtnp = mainLibPromise.then(() => {
            let rtctx = new RtContext();
            rtctx.pushContext(sprintf("Firing native 'init' event"), null);
            let eventObj = {event: "init", native: true, bubble: false, datacontext: {}};
            let pinit = DataCtx.FireEvent(eventObj, this.pageDataenv(), rtctx, true);
            return pinit;
        }).then(() => {
            this.setInitialized();
        }).catch((e) => {
            if (e instanceof HibikiError) {
                console.log("Hibiki Error Initializing HibikiState during 'init' event - Not Rendering\n" + e.toString());
            }
            else {
                console.log("Hibiki Error Initializing HibikiState", e);
            }
        });
        return rtnp;
    }

    async unhandledError(errorObj : HibikiError, rtctx : RtContext) : Promise<any> {
        let pageEnv = this.pageDataenv();
        let eventObj = {event: "unhandlederror", native: true, bubble: false, datacontext: {error: errorObj}};
        let ehandler = pageEnv.resolveEventHandler(eventObj, rtctx);
        if (ehandler != null) {
            try {
                await DataCtx.FireEvent(eventObj, this.pageDataenv(), rtctx, true);
                return null;
            }
            catch (e) {
                if (e instanceof HibikiError) {
                    this.reportErrorObj(e);
                    return null;
                }
                let newErrorObj = DataCtx.makeErrorObj(e, rtctx);
                this.reportErrorObj(newErrorObj);
                return null;
            }
        }
        else {
            this.reportErrorObj(errorObj);
            return null;
        }
    }

    getExtState() : HibikiExtState {
        return new HibikiExtState(this);
    }

    @mobx.action setPageName(pageName : string) : void {
        this.PageName.set(pageName);
    }

    buildConfigModules() {
        if (this.Config.modules == null) {
            return;
        }
        let hibiki = getHibiki();
        let mreg = hibiki.ModuleRegistry;
        for (let moduleName in this.Config.modules) {
            let mconfig = this.Config.modules[moduleName];
            if (mconfig.remove) {
                this.ComponentLibrary.removeModule(moduleName, "main");
                continue;
            }
            if (RESTRICTED_MODS[moduleName] || moduleName.startsWith("lib-")) {
                console.log(sprintf("Hibiki Config Error, cannot configure module with name '%s', name is reserved", moduleName));
                continue;
            }
            let mtype = mconfig["type"] ?? moduleName;
            try {
                let mctor = mreg[mtype];
                if (mctor == null) {
                    console.log(sprintf("Hibiki Config Error, while configuring module '%s', module type '%s' not found", moduleName, mtype));
                    continue;
                }
                let mod = new mctor(this, mconfig);
                this.ComponentLibrary.addModule(moduleName, mod, "main");
            }
            catch (e) {
                console.log(sprintf("Hibiki Config, error initializing module '%s' (type '%s')", moduleName, mtype), e);
            }
        }
    }

    @mobx.action setConfig(config : HibikiConfig) {
        config = config ?? {};
        this.Config = config;
    }

    @mobx.action setGlobalData(globalData : any) {
        this.DataRoots["global"].set(globalData);
    }

    @mobx.action setHtml(htmlobj : HibikiNode) {
        this.HtmlObj.set(htmlobj);
    }

    unhandledEvent(event : EventType, rtctx : RtContext) {
        if (event.event === "init" || event.event === "unhandlederror") {
            return;
        }
        console.log(sprintf("Hibiki unhandled event %s", event.event), event.datacontext, rtctx);
    }

    rootDataenv() : DataEnvironment {
        let opts = {htmlContext: "<root>"};
        return new DataEnvironment(this, opts);
    }

    pageDataenv() : DataEnvironment {
        let env = this.rootDataenv();
        let htmlContext = sprintf("<page %s>", this.PageName.get());
        let opts = {eventBoundary: "hard", htmlContext: htmlContext, libContext: "main", handlers: {}};
        let curPage = this.findCurrentPage();
        let h1 = NodeUtils.makeHandlers(curPage, null, "main", ["event", "local"]);
        let h2 = NodeUtils.makeHandlers(this.HtmlObj.get(), null, "main", ["event", "local"]);
        opts.handlers = Object.assign({}, h2, h1);
        env = env.makeChildEnv(null, opts);
        return env;
    }

    destroyPanel() {
        console.log("Destroy Hibiki State");
    }

    findCurrentPage() : HibikiNode {
        return this.findPage(this.PageName.get());
    }

    findPage(pageName? : string) : HibikiNode {
        if (pageName == null || pageName === "") {
            pageName = "default";
        }
        let htmlobj = this.HtmlObj.get();
        if (htmlobj == null || htmlobj.list == null) {
            return null;
        }
        let starTag = null;
        let hasPages = false;
        for (let h of htmlobj.list) {
            if (h.tag !== "page") {
                continue;
            }
            hasPages = true;
            let tagNameAttr = "default";
            if (h.attrs) {
                tagNameAttr = h.attrs["name"] ?? h.attrs["appname"] ?? "default";
            }
            if (tagNameAttr == pageName) {
                return h;
            }
            if (tagNameAttr === "*" && starTag == null) {
                starTag = h;
            }
        }
        if (starTag != null) {
            return starTag;
        }
        if (!hasPages) {
            return htmlobj;
        }
        return null;
    }

    findScript(scriptName : string) : any {
        let htmlobj = this.HtmlObj.get();
        if (htmlobj == null || htmlobj.list == null) {
            return null;
        }
        for (let h of htmlobj.list) {
            if ((h.tag === "script" || h.tag === "h-script") && h.attrs != null && h.attrs["name"] === scriptName) {
                return h;
            }
        }
        return null;
    }

    executeHandlerBlock(actions : HandlerBlock, pure? : boolean) : Promise<HibikiVal> {
        let rtctx = new RtContext();
        rtctx.pushContext("Calling HibikiState.executeHandlerBlock()", null);
        let pinit = DataCtx.ExecuteHandlerBlock(actions, pure, this.pageDataenv(), rtctx);
        return pinit;
    }

    blobFromBlob(blob : Blob) : Promise<DataCtx.HibikiBlob> {
        return DataCtx.BlobFromBlob(blob);
    }

    async callHandlerWithReq(req : HibikiRequest) : Promise<HandlerBlock> {
        let moduleName = req.callpath.module;
        let module : HibikiHandlerModule;
        if (moduleName == null || moduleName === "") {
            throw new Error(sprintf("Invalid handler, no module specified path: %s", fullPath(req.callpath)));
        }
        else {
            module = this.ComponentLibrary.getModule(moduleName, req.libContext);
        }
        if (module == null) {
            throw new Error(sprintf("Invalid handler, no module '%s' found for path: %s, lib-context '%s'", moduleName, fullPath(req.callpath), req.libContext));
        }
        let rtnp = module.callHandler(req);
        rtnp = Promise.resolve(rtnp);
        return rtnp.then((data) => {
            if (data == null) {
                return null;
            }
            if (data instanceof DataCtx.HActionBlock) {
                return data;
            }
            if (isObject(data) && ("hibikihandler" in data)) {
                return data;
            }
            if (isObject(data) && ("hibikiactions" in data) && Array.isArray(data.hibikiactions)) {
                return data;
            }
            return {hibikiactions: [{actiontype: "setreturn", data: data}]};
        });
    }

    reportError(errorMessage : string, rtctx? : RtContext) {
        let err = new HibikiError(errorMessage, null, rtctx);
        this.reportErrorObj(err);
    }

    reportErrorObj(errorObj : HibikiError) {
        try {
            let rtn = callHook("UnhandledErrorHook", this.Config.unhandledErrorHook, errorObj);
            if (rtn) {
                return;
            }
            console.log(errorObj.toString());
        }
        catch (e) {
            console.log("Hibiki Error while running unhandledErrorHook", e);
            console.log("Original Error:\n" + errorObj.toString());
        }
        
    }

    registerDataNodeState(uuid : string, query : string, dnstate : any) {
        this.DataNodeStates[uuid] = {query: query, dnstate: dnstate};
    }

    unregisterDataNodeState(uuid : string) {
        delete this.DataNodeStates[uuid];
    }

    @mobx.action invalidate(query : string) {
        for (let uuid in this.DataNodeStates) {
            let dnq = this.DataNodeStates[uuid];
            if (dnq.query != query) {
                continue;
            }
            dnq.dnstate.forceRefresh();
        }
    }

    @mobx.action invalidateRegex(queryReStr : string) {
        if (queryReStr == null || queryReStr === "") {
            this.invalidateAll();
            return;
        }
        let queryRe = new RegExp(queryReStr);
        for (let uuid in this.DataNodeStates) {
            let dnq = this.DataNodeStates[uuid];
            if (!dnq.query.match(queryRe)) {
                continue;
            }
            dnq.dnstate.forceRefresh();
        }
    }

    @mobx.action invalidateAll() {
        for (let uuid in this.DataNodeStates) {
            let dnq = this.DataNodeStates[uuid];
            dnq.dnstate.forceRefresh();
        }
    }

    queueScriptSrc(scriptSrc : string, sync : boolean) : Promise<boolean> {
        // console.log("queue script src", scriptSrc);
        let srcMd5 = md5(scriptSrc);
        if (this.ResourceCache[srcMd5]) {
            return Promise.resolve(true);
        }
        this.ResourceCache[srcMd5] = true;
        let scriptElem = document.createElement("script");
        if (sync) {
            scriptElem.async = false;
        }
        let presolve = null;
        let prtn = new Promise((resolve, reject) => {
            presolve = resolve;
        });
        scriptElem.src = scriptSrc;
        scriptElem.addEventListener("load", () => {
            presolve(true);
        });
        document.querySelector("body").appendChild(scriptElem);
        if (!sync) {
            return Promise.resolve(true);
        }
        return prtn.then(() => true);
    }

    queueScriptText(text : string, sync : boolean) : Promise<boolean> {
        // console.log("queue script", text);
        let textMd5 = md5(text);
        if (this.ResourceCache[textMd5]) {
            return;
        }
        this.ResourceCache[textMd5] = true;
        let dataUri = "data:text/javascript;base64," + btoa(text);
        return this.queueScriptSrc(dataUri, sync);
    }

    loadCssLink(cssUrl : string, sync : boolean) : Promise<boolean> {
        let srcMd5 = md5(cssUrl);
        if (this.ResourceCache[srcMd5]) {
            return Promise.resolve(true);
        }
        this.ResourceCache[srcMd5] = true;
        let linkElem = document.createElement("link");
        let presolve = null;
        let prtn = new Promise((resolve, reject) => {
            presolve = resolve;
        });
        linkElem.rel = "stylesheet";
        linkElem.href = cssUrl;
        linkElem.addEventListener("load", () => {
            presolve(true);
        });
        document.querySelector("body").appendChild(linkElem);
        if (!sync) {
            return Promise.resolve(true);
        }
        return prtn.then(() => true);
    }

    loadStyleText(styleText : string) {
        let srcMd5 = md5(styleText);
        if (this.ResourceCache[srcMd5]) {
            return;
        }
        this.ResourceCache[srcMd5] = true;
        let styleElem = document.createElement("style");
        styleElem.type = "text/css";
        styleElem.appendChild(document.createTextNode(styleText));
        document.querySelector("body").appendChild(styleElem);
        return;
    }
}

function hasHtmlRR(rra : any[]) : boolean {
    if (rra == null) {
        return false;
    }
    for (let i=0; i<rra.length; i++) {
        let rr = rra[i];
        if (rr.type === "html") {
            return true;
        }
    }
    return false;
}


export {HibikiState, DataEnvironment, HibikiExtState};
export type {EHandlerType, DataEnvironmentOpts};
