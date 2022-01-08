// Copyright 2021 Dashborg Inc

import * as mobx from "mobx";
import md5 from "md5";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {v4 as uuidv4} from 'uuid';
import type {HibikiNode, ComponentType, LibraryType, HibikiConfig, HibikiHandlerModule, HibikiAction, EventType, HandlerValType, JSFuncType, Hibiki, ErrorCallbackFn, HtmlParserOpts, HandlerBlock, NodeAttrType, HibikiVal, HibikiValObj, HibikiValEx} from "./types";
import * as DataCtx from "./datactx";
import {isObject, textContent, SYM_PROXY, SYM_FLATTEN, nodeStr, callHook, getHibiki, parseHandler, fullPath, parseUrlParams, smartDecodeParams, blobPrintStr, unbox} from "./utils";
import {subNodesByTag, firstSubNodeByTag} from "./nodeutils";
import {RtContext, HibikiError} from "./error";
import {HibikiRequest} from "./request";
import * as NodeUtils from "./nodeutils";
import type {DBCtx} from "./dbctx";

import {parseHtml} from "./html-parser";

type CallHandlerOptsType = {
    dataenv? : DataEnvironment,
    rtContext? : RtContext,
};

type EHandlerType = {handler : HandlerBlock, node : HibikiNode, dataenv : DataEnvironment};

function eventBubbles(event : string) : boolean {
    if (event === "load") {
        return false;
    }
    if (event.startsWith("x")) {
        return false;
    }
    return true;
}

function createDepPromise(libName : string, srcUrl : string, state : HibikiState, libNode : HibikiNode) : [Promise<any>, string[]] {
    if (libNode == null) {
        return [Promise.resolve(true), []];
    }
    let parr = [];
    let scriptTags = subNodesByTag(libNode, "script");
    let srcs = [];
    for (let i=0; i<scriptTags.length; i++) {
        let stag = scriptTags[i];
        let attrs = NodeUtils.getRawAttrs(stag);
        if (attrs.type != null && attrs.type !== "text/javascript") {
            continue;
        }
        if (attrs.src == null) {
            let p = state.queueScriptText(textContent(stag), !attrs.async);
            parr.push(p);
            continue;
        }
        let scriptSrc = attrs.src;
        if (attrs.relative) {
            scriptSrc = new URL(scriptSrc, srcUrl).toString();
        }
        let p = state.queueScriptSrc(scriptSrc, !attrs.async);
        parr.push(p);
        srcs.push("[script]" + scriptSrc);
    }
    let linkTags = subNodesByTag(libNode, "link");
    for (let i=0; i<linkTags.length; i++) {
        let ltag = linkTags[i];
        let attrs = NodeUtils.getRawAttrs(ltag);
        if (attrs.rel !== "stylesheet" || attrs.href == null) {
            continue;
        }
        let cssUrl = attrs.href;
        if (attrs.relative) {
            cssUrl = new URL(cssUrl, srcUrl).toString();
        }
        let p = state.loadCssLink(cssUrl, !attrs.async);
        parr.push(p);
        srcs.push("[css]" + cssUrl);
    }
    let styleTags = subNodesByTag(libNode, "style");
    for (let i=0; i<styleTags.length; i++) {
        state.loadStyleText(textContent(styleTags[i]));
    }
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
        let p = state.ComponentLibrary.importLibrary(libName, attrs.src, attrs.prefix, !attrs.async);
        parr.push(p);
        srcs.push("[library]" + libUrl);
    }
    return [Promise.all(parr).then(() => true), srcs];
}

type DataEnvironmentOpts = {
    componentRoot? : HibikiVal,
    argsRoot? : Record<string, HibikiValEx>,
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
    componentRoot : HibikiVal;
    argsRoot? : Record<string, HibikiValEx>;
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

    resolveRoot(rootName : string, opts?: {caret? : number}) : HibikiVal | Record<string, HibikiValEx> {
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
        else {
            if (rootName in this.dbstate.DataRoots) {
                return unbox(this.dbstate.DataRoots[rootName]);
            }
            throw new Error("Invalid root path");
        }
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
        if (this.parent != null) {
            this.parent.printStack();
        }
        let hkeysStr = Object.keys(this.handlers).join(",");
        let specialsStr = Object.keys(this.specials).map((v) => "@" + v).join(",");
        let stackStr = sprintf("%s %-30s | %-30s | %s", deType, this.htmlContext, specialsStr, hkeysStr);
        console.log(stackStr);
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
            return {handler: hval.block, node: hval.node, dataenv: env};
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

    getComponentRoot() : HibikiVal {
        if (this.componentRoot != null) {
            return this.componentRoot;
        }
        if (this.parent == null) {
            return null;
        }
        return this.parent.getComponentRoot();
    }

    getArgsRoot() : Record<string, HibikiValEx> {
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
    components : Record<string, ComponentType>;       // tag-name -> component
    importedUrls : Record<string, boolean>;
    state : HibikiState;

    constructor(state : HibikiState) {
        this.state = state;
        this.libs = {};
        this.components = {};
        this.importedUrls = {};
    }

    addLibrary(libObj : LibraryType) {
        this.libs[libObj.name] = libObj;
    }

    fullLibName(libName : string) : string {
        let libObj = this.libs[libName];
        if (libObj == null || libObj.url == null) {
            return libName;
        }
        return sprintf("%s(%s)", libName, libObj.url);
    }

    registerLocalJSHandler(libName : string, handlerName : string, fn : (HibikiRequest) => any) {
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("Hibiki registerLocalHandler library '%s' not found", libName);
            return;
        }
        libObj.localHandlers[handlerName] = fn;
    }

    registerModule(libName : string, moduleName : string, module : HibikiHandlerModule) {
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("Hibiki registerModule library '%s' not found", libName);
            return;
        }
        libObj.modules[moduleName] = module;
    }

    registerReactComponentImpl(libName : string, componentName : string, impl : any) {
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

    registerNativeComponentImpl(libName : string, componentName : string, impl : any) {
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

    importLibrary(libContext : string, srcUrl : string, prefix : string, sync : boolean) : Promise<boolean> {
        if (srcUrl == null || srcUrl === "") {
            return Promise.resolve(true);
        }
        if (this.importedUrls[srcUrl]) {
            return Promise.resolve(true);
        }
        this.importedUrls[srcUrl] = true;
        let fetchInit : any = {};
        let libName = null;
        let p = fetch(srcUrl).then((resp) => {
            if (!resp.ok) {
                throw new Error(sprintf("Bad fetch response: %d %s", resp.status, resp.statusText));
            }
            let ctype = resp.headers.get("Content-Type");
            if (!ctype.startsWith("text/")) {
                throw new Error(sprintf("Bad fetch response, non-text mime-type: '%s'", ctype));
            }
            return resp.text();
        })
        .then((rtext) => {
            let defNode = parseHtml(rtext, null, {});
            let libNode = firstSubNodeByTag(defNode, "define-library");
            if (libNode == null) {
                throw new Error(sprintf("No top-level <define-library> found"));
            }
            if (libNode.attrs == null || libNode.attrs.name == null) {
                throw new Error(sprintf("<define-library> must have 'name' attribute"));
            }
            libName = libNode.attrs.name;
            this.buildLib(libName, libNode, true, srcUrl);
            this.rawImportLib(libName, "@hibiki/core", null);
            this.rawImportLib(libContext, libName, prefix);
            let [depPromise, srcs] = createDepPromise(libName, srcUrl, this.state, libNode);
            if (srcs.length > 0) {
                console.log(sprintf("Hibiki Library '%s' dependencies: %s", this.fullLibName(libName), JSON.stringify(srcs)));
            }
            return depPromise;
        })
        .then(() => {
            let hibiki = getHibiki();
            let cbparr = [];
            if (hibiki.LibraryCallbacks[libName] != null) {
                for (let i=0; i<hibiki.LibraryCallbacks[libName].length; i++) {
                    let cbfn = hibiki.LibraryCallbacks[libName][i];
                    cbparr.push(Promise.resolve(cbfn(this.state, this)));
                }
            }
            return Promise.all(cbparr);
        })
        .then(() => {
            let numComps = 0;
            if (this.libs[libName] != null) {
                let libObj = this.libs[libName];
                numComps = Object.keys(libObj.libComponents).length;
                this.state.makeLocalModule(libContext, prefix, libName);
            }
            
            console.log(sprintf("Hibiki Imported Library '%s' to prefix '%s', defined %d component(s)", this.fullLibName(libName), prefix, numComps));
            return true;
        })
        .catch((e) => {
            console.log(sprintf("Error importing library '%s'", srcUrl), e);
            return true;
        });
        if (sync) {
            return p;
        }
        return Promise.resolve(true);
    }

    buildLib(libName : string, htmlobj : HibikiNode, clear : boolean, url? : string) {
        if (this.libs[libName] == null || clear) {
            let lib : LibraryType = {name: libName, libComponents: {}, importedComponents: {}, localHandlers: {}, modules: {}, handlers: {}};
            if (url != null) {
                lib.url = url;
            }
            let hibiki = getHibiki();
            let mreg = hibiki.ModuleRegistry;
            lib.modules["hibiki"] = new mreg["hibiki"](this.state, {});
            lib.modules["http"] = new mreg["http"](this.state, {});
            lib.modules["local"] = new mreg["local"](this.state, {});
            lib.modules["lib"] = new mreg["lib"](this.state, {libContext: libName});
            this.libs[libName] = lib;
        }
        let libObj = this.libs[libName];
        if (htmlobj == null || htmlobj.list == null) {
            return;
        }
        for (let h of htmlobj.list) {
            if (h.tag !== "define-component") {
                continue;
            }
            let attrs = NodeUtils.getRawAttrs(h);
            if (attrs["name"] == null) {
                console.log("define-component tag without a name, skipping");
                continue;
            }
            let name = attrs.name;
            if (libObj.libComponents[name]) {
                console.log(sprintf("cannot redefine component %s/%s", libName, name));
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
        let handlers = NodeUtils.makeHandlers(htmlobj, ["lib"]);
        libObj.handlers = handlers;
    }

    rawImportLib(libContext : string, libName : string, prefix : string) {
        if (prefix === "local") {
            throw new Error("Cannot import library with reserved 'local' prefix");
        }
        let libObj = this.libs[libName];
        if (libObj == null) {
            console.log("Hibiki Error invalid component library in rawImportLib", libName);
            return;
        }
        if (libContext == null || (libContext !== "@main" && this.libs[libContext] == null)) {
            console.log("Hibiki Error invalid libContext in rawImportLib", libContext);
        }
        for (let name in libObj.libComponents) {
            if (name.startsWith("@")) {
                continue;
            }
            let newComp = libObj.libComponents[name];
            let cpath = libName + ":" + name;
            let importName = (prefix == null ? "" : prefix + "-") + name;
            let origComp = this.components[importName];
            if (origComp != null && (origComp.libName !== libName || origComp.name !== name)) {
                console.log(sprintf("Conflicting import %s %s:%s (discarding %s:%s)", importName, origComp.libName, origComp.name, libName, name));
                continue;
            }
            let ctype = {componentType: newComp.componentType, libName: libName, name: name, impl: newComp.impl, reactimpl: newComp.reactimpl, node: newComp.node};
            if (libContext === "@main") {
                this.components[importName] = ctype;
            }
            else {
                let ctxLib = this.libs[libContext];
                ctxLib.importedComponents[importName] = ctype;
            }
        }
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
        if (libContext == null || libContext === "@main") {
            return this.components[tagName];
        }
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
}

class HibikiExtState {
    state : HibikiState;
    
    constructor(state : HibikiState) {
        this.state = state;
    }

    initialize(force : boolean) {
        this.state.initialize(force);
    }

    setHtml(html : string | HTMLElement) {
        let htmlObj = parseHtml(html);
        this.state.setHtml(htmlObj);
    }

    setData(path : string, data : any) {
        let dataenv = this.state.rootDataenv();
        dataenv.setDataPath(path, data, "HibikiExtState.setDataPath");
    }

    getData(path : string) : any {
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

    setPageName(pageName : string) {
        this.state.setPageName(pageName);
    }

    setInitCallback(fn : () => void) {
        this.state.setInitCallback(fn);
    }

    makeHibikiBlob(blob : Blob) : Promise<DataCtx.HibikiBlob> {
        return this.state.blobFromBlob(blob);
    }
}

class HibikiState {
    FeClientId : string = null;
    Ui : string = null;
    ErrorCallback : ErrorCallbackFn;
    HtmlObj : mobx.IObservableValue<any> = mobx.observable.box(null, {name: "HtmlObj", deep: false});
    ComponentLibrary : ComponentLibrary;
    Initialized : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "Initialized"});
    RenderVersion : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "RenderVersion"});
    DataNodeStates = {};
    ResourceCache = {};
    HasRendered = false;
    NodeDataMap : Map<string, mobx.IObservableValue<HibikiVal>> = new Map();  // TODO clear on unmount
    ExtHtmlObj : mobx.ObservableMap<string,any> = mobx.observable.map({}, {name: "ExtHtmlObj", deep: false});
    Config : HibikiConfig = {};
    PageName : mobx.IObservableValue<string> = mobx.observable.box("default", {name: "PageName"});
    InitCallbacks : (() => void)[];
    JSFuncs : Record<string, JSFuncType>;
    NodeUuidMap : Map<string, DBCtx> = new Map();
    
    Modules : Record<string, HibikiHandlerModule> = {};
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
        let action = {
            actiontype: "fireevent",
            native: true,
            event: {etype: "literal", val: "popstate"},
        };
        let rtctx = new RtContext();
        DataCtx.ExecuteHandlerBlock(new DataCtx.HActionBlock([action]), false, this.pageDataenv(), rtctx, true);
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
    }

    initialize(force : boolean) {
        if (this.Initialized.get()) {
            console.log("Hibiki State is already initialized");
        }
        if (force) {
            this.setInitialized();
            return;
        }
        this.setStateVars();
        let rtctx = new RtContext();
        let [deps, srcs] = createDepPromise("@main", window.location.href, this, this.HtmlObj.get());
        if (srcs.length > 0) {
            console.log(sprintf("Hibiki root dependencies: %s", JSON.stringify(srcs)));
        }
        deps.then(() => {
            let action = {
                actiontype: "fireevent",
                native: true,
                event: {etype: "literal", val: "init"},
            };
            let pinit = DataCtx.ExecuteHandlerBlock(new DataCtx.HActionBlock([action]), false, this.pageDataenv(), rtctx, true);
            return pinit;
        }).then(() => {
            this.setInitialized();
        }).catch((e) => {
            rtctx.pushErrorContext(e);
            let errObj = new HibikiError(e.toString(), e, rtctx);
            this.reportErrorObj(errObj);
        });
    }

    getExtState() : HibikiExtState {
        return new HibikiExtState(this);
    }

    @mobx.action setPageName(pageName : string) {
        this.PageName.set(pageName);
    }

    @mobx.action setConfig(config : HibikiConfig) {
        config = config ?? {};
        this.Config = config;
        if (config.hooks == null) {
            config.hooks = {};
        }
        let hibiki = getHibiki();
        let mreg = hibiki.ModuleRegistry;
        if (config.modules != null) {
            for (let moduleName in config.modules) {
                let mconfig = config.modules[moduleName];
                if (mconfig.remove) {
                    continue;
                }
                let mtype = mconfig["type"] ?? moduleName;
                try {
                    let mctor = mreg[mtype];
                    if (mctor == null) {
                        console.log(sprintf("Hibiki Config Error, while configuring module '%s', module type '%s' not found", moduleName, mtype));
                        continue;
                    }
                    this.Modules[moduleName] = new mctor(this, mconfig);
                }
                catch (e) {
                    console.log(sprintf("Hibiki Config, error initializing module '%s' (type '%s')", moduleName, mtype), e);
                }
            }
        }
        this.Modules["hibiki"] = new mreg["hibiki"](this, {});
        this.Modules["local"] = new mreg["local"](this, {});
        this.Modules["lib-local"] = new mreg["local"](this, {});
        if (config.modules == null || !("http" in config.modules)) {
            this.Modules["http"] = new mreg["http"](this, {});
        }
    }

    makeLocalModule(libContext : string, prefix : string, libName : string) {
        if (prefix == null || libName == null) {
            return;
        }
        if (("lib-" + prefix) in this.Modules) {
            return;
        }
        let hibiki = getHibiki();
        let mreg = hibiki.ModuleRegistry;
        if (libContext == null || libContext === "@main") {
            this.Modules["lib-" + prefix] = new mreg["lib"](this, {libContext: libName});
        }
        else {
            let mod = new mreg["lib"](this, {libContext: libName});
            this.ComponentLibrary.registerModule(libContext, "lib-" + prefix, mod);
        }
    }

    @mobx.action setGlobalData(globalData : any) {
        this.DataRoots["global"].set(globalData);
    }

    @mobx.action setHtml(htmlobj : HibikiNode) {
        this.HtmlObj.set(htmlobj);
        this.ComponentLibrary.buildLib("@main", htmlobj, true);
    }

    allowUsageImg() : boolean {
        return !this.Config.noUsageImg;
    }

    allowWelcomeMessage() : boolean {
        return !this.Config.noWelcomeMessage;
    }

    unhandledEvent(event : EventType, rtctx : RtContext) {
        if (event.event == "error" && event.datacontext != null && event.datacontext.error != null) {
            this.reportErrorObj(event.datacontext.error);
        }
        else {
            if (event.event !== "init") {
                console.log(sprintf("Hibiki unhandled event %s", event.event), event.datacontext, rtctx);
            }
        }
    }

    rootDataenv() : DataEnvironment {
        let opts = {htmlContext: "<root>"};
        return new DataEnvironment(this, opts);
    }

    pageDataenv() : DataEnvironment {
        let env = this.rootDataenv();
        let htmlContext = sprintf("<page %s>", this.PageName.get());
        let opts = {eventBoundary: "hard", htmlContext: htmlContext, libContext: "@main", handlers: {}};
        let curPage = this.findCurrentPage();
        let h1 = NodeUtils.makeHandlers(curPage, ["event", "local"]);
        let h2 = NodeUtils.makeHandlers(this.HtmlObj.get(), ["event", "local"]);
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
        rtctx.pushContext("HibikiState.executeHandlerBlock()", null);
        let pinit = DataCtx.ExecuteHandlerBlock(actions, pure, this.pageDataenv(), rtctx, true);
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
        else if (req.libContext == null || req.libContext === "@main") {
            module = this.Modules[moduleName];
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
                return {hibikihandler: data.hibikihandler, ctxstr: data.ctxstr};
            }
            if (isObject(data) && ("hibikiactions" in data) && Array.isArray(data.hibikiactions)) {
                return {hibikiactions: data.hibikiactions};
            }
            return {hibikiactions: [{actiontype: "setreturn", data: data}]};
        });
    }

    reportError(errorMessage : string, rtctx? : RtContext) {
        let err = new HibikiError(errorMessage, null, rtctx);
        this.reportErrorObj(err);
    }

    reportErrorObj(errorObj : HibikiError) {
        if (this.ErrorCallback == null) {
            console.log(errorObj.toString());
            return;
        }
        callHook("ErrorCallback", this.ErrorCallback, errorObj);
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
export type {EHandlerType};
