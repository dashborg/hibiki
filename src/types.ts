// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type {HibikiState} from "./state";
import type {RtContext, HibikiError} from "./error";
import type {HibikiRequest} from "./request";
import * as mobx from "mobx";
import type {HExpr, HibikiBlob, LValue, HIteratorExpr, HAction, HActionBlock, OpaqueValue, ChildrenVar, LambdaValue, ContextVarType} from "./datactx";
import type {DataEnvironment, EHandlerType} from "./state";
import type {HibikiNode} from "./html-parser";
import type {InjectedAttrsObj} from "./dbctx";

type HibikiValObj = {[k : string] : HibikiVal};
type HibikiVal = HibikiPrimitiveVal | HibikiSpecialVal | HibikiValObj | HibikiVal[];
type HibikiPrimitiveVal = null | string | number | boolean
type HibikiSpecialVal = HibikiBlob | HibikiNode | OpaqueValue | ChildrenVar | LambdaValue | LValue | HibikiError | symbol;
type StyleMapType = Record<string, number|string>;

type HibikiReactProps = {
    node : HibikiNode,
    dataenv : DataEnvironment,
    injectedAttrs : InjectedAttrsObj,
    parentHtmlTag : string,
};

type AutoMergeExpr = {
    source : string,
    dest : string,
    include? : Record<string, boolean>,
    includeForce? : Record<string, boolean>,
    exclude? : Record<string, boolean>,
};

type AutoFireExpr = {
    source : string,
    dest : string,
    include : Record<string, boolean>,
};

type JSFuncType = {
    fn : (...args : any[]) => any,
    native : boolean,
    positionalArgs : boolean,
};

type HandlerPathType = {
    module : string,
    url : string,
    method : string,
};

type EventType = {
    event : string,
    native : boolean,
    bubble : boolean,
    datacontext : Record<string, any>,
    nodeuuid? : string,
};

type HandlerValType = {
    block : HandlerBlock,
    node : HibikiNode,
    boundDataenv? : DataEnvironment,
    contextVars? : ContextVarType[],
};

type HandlerBlock =
      {hibikihandler: string, hibikicontext?: Record<string, any>, ctxstr? : string, libContext? : string}
    | {hibikiactions: HibikiAction[], hibikicontext?: Record<string, any>, libContext?: string}
    | HActionBlock;

type HibikiActionValue = HibikiVal | {hibikiexpr : string};
type HibikiActionString   = string | {hibikiexpr : string};

type HibikiAction = {
    actiontype    : string,
    event?        : HibikiActionString,  // for type=fireevent
    bubble?       : boolean,             // for type=fireevent
    pure?         : boolean,             // for type=callhandler
    debug?        : boolean,             // for type=log
    alert?        : boolean,             // for type=log
    setop?        : string,
    setpath?      : string,
    callpath?     : HibikiActionString,
    data?         : HibikiActionValue,
    exithandler?  : boolean,             // for type=setreturn
    html?         : string,              // for type=html
    libcontext?   : string,              // for type=html
    nodeuuid?     : string,              // for type=fireevent
    actions?      : Record<string, HibikiAction[]>,
    blockstr?     : string,              // for type=block
    blockctx?     : string,              // for type=block
    blobbase64?   : string,              // for type=setpath (blobs)
    blobmimetype? : string,              // for type=setpath (blobs)
};

type HibikiHandlerModule = {
    callHandler : (req : HibikiRequest) => Promise<any>;
};

type JSFuncStr = {jsfunc : string};
type FetchHookFn = JSFuncStr | ((url : URL, fetchInit : Record<string, any>) => void);
type CsrfHookFn = JSFuncStr | ((url : URL) => string);
type ErrorCallbackFn = JSFuncStr | ((err : HibikiError) => boolean);
type EventCallbackFn = JSFuncStr | ((event : EventType) => void);

type ModuleConfig = Record<string, any>;

type HtmlParserOpts = {
    noInlineText? : boolean,
};

type HttpConfig = {
    baseUrl?: string,             // defaults to null (dynamically set to window.location.href)
    lockToBaseOrigin? : boolean,  // defaults to false
    forceRelativeUrls? : boolean, // defaults to false
    
    defaultHeaders? : Record<string, HibikiActionString>,
    defaultInit? : Record<string, any>,

    // CSRF configuration
    csrfToken? : JSFuncStr | (() => string) | HibikiActionString;  // defaults to DefaultCsrfValueFn
    csrfMethods? : string[],         // defaults to ["POST", "PUT", "PATCH"]
    csrfParams? : string[],          // defaults to []
    csrfHeaders? : string[],         // defaults to ["X-Csrf-Token", "X-CSRFToken"]
    csrfAllowedOrigins? : string[],  // defaults to [baseUrl.origin].  ["*"] means all (not recommended)

    // called right before calling fetch, can modify url or fetchInit.
    // throw an exception to cancel the fetch request.
    fetchHookFn? : JSFuncStr | ((url : URL, fetchInit : any) => void);

    compiledHeaders? : Record<string, HExpr>,                // internal use
    compiledCsrfToken? : string | JSFuncStr | (() => string) | HExpr, // internal use
};

type HibikiGlobalConfig = {
    noUsagePing : boolean,
    noWelcomeMessage : boolean,
};

type HibikiConfig = {
    noConfigMergeFromHtml? : boolean,
    noDataMergeFromHtml?   : boolean,
    modules? : Record<string, ModuleConfig>,
    httpConfig? : HttpConfig;
    unhandledErrorHook? : ErrorCallbackFn;
};

type PathUnionType = string | PathType;

type PathPart = {
    pathtype : ("root" | "dot" | "array" | "map" | "dyn" | "deref"),
    pathindex? : number,
    pathkey? : string,

    value? : HibikiVal,
    caret? : number,
    expr? : any;
};

type PathType = PathPart[];

type ComponentType = {
    componentType : "hibiki-html" | "hibiki-native" | "react-custom",
    libName : string,
    name : string,
    impl? : mobx.IObservableValue<any>,
    reactimpl? : mobx.IObservableValue<any>,
    node? : HibikiNode,
}

type LibComponentType = {
    componentType : "hibiki-html" | "hibiki-native" | "react-custom",
    impl? : mobx.IObservableValue<any>,
    reactimpl? : mobx.IObservableValue<any>,
    node? : HibikiNode,
    isPrivate? : boolean,
}

type LibraryType = {
    name: string,
    libNode : HibikiNode,
    url?: string,
    libComponents: Record<string, LibComponentType>;
    importedComponents : Record<string, ComponentType>;
    localHandlers : Record<string, (req : HibikiRequest) => any>;
    modules : Record<string, HibikiHandlerModule>;
    handlers : Record<string, HandlerValType>;
};

type ReactClass = new(props : any) => React.Component<any, any>;

interface Hibiki {
    autoloadTags() : void;
    loadTag(elem: HTMLElement) : HibikiExtState;
    render(elem : HTMLElement, state : HibikiExtState) : void;
    createState(config : HibikiConfig, html : string | HTMLElement, initialData : any) : HibikiExtState;
    registerLocalJSHandler(path : string, fn : (req : HibikiRequest) => any) : void;
    registerLocalReactComponentImpl(name : string, reactImpl : ReactClass) : void;
    registerLocalNativeComponentImpl(name : string, reactImpl : ReactClass) : void;
    addLibraryCallback(libName : string, fn : Function) : void;
    HibikiReact : new(props : any) => React.Component<{hibikiState : HibikiExtState}, {}>;
    VERSION : string;
    BUILD : string;

    // subject to change, use with caution (not part of public API)
    ModuleRegistry : Record<string, (new(state : HibikiState, config : ModuleConfig) => HibikiHandlerModule)>;
    JSFuncs : Record<string, JSFuncType>;
    LocalHandlers : Record<string, (req : HibikiRequest) => any>;
    LocalReactComponents : mobx.ObservableMap<string, ReactClass>;
    LocalNativeComponents : mobx.ObservableMap<string, ReactClass>;
    ImportLibs : Record<string, any>;
    LibraryCallbacks : Record<string, any[]>;
    States : Record<string, HibikiExtState>;
    DataCtx : any;
    DBCtxModule : any;
    WelcomeMessageFired : boolean;
    UsageFired: boolean;
};

interface HibikiExtState {
    setHtml(html : string | HTMLElement) : void;
    setData(path : string, data : any): void;
    getData(path : string) : HibikiVal;
    executeHandlerBlock(actions : HandlerBlock, pure? : boolean) : Promise<HibikiVal>;
    callHandler(handlerUrl : string, data : HibikiValObj) : Promise<HibikiVal>;
    setPageName(pageName : string) : void;
    setInitCallback(fn : () => void);
    initialize(force : boolean) : void;
    makeWatcher(exprStr : string, callback : (v : HibikiVal) => void) : (() => void);
};

export type {HibikiConfig, HibikiHandlerModule, PathPart, PathType, PathUnionType, ComponentType, LibraryType, HibikiRequest, Hibiki, HibikiAction, HibikiActionString, HibikiActionValue, HibikiExtState, EventType, HandlerValType, JSFuncType, FetchHookFn, CsrfHookFn, ReactClass, HandlerPathType, ErrorCallbackFn, EventCallbackFn, HtmlParserOpts, LibComponentType, HandlerBlock, HibikiVal, HibikiValObj, AutoMergeExpr, AutoFireExpr, HibikiReactProps, HttpConfig, JSFuncStr, HibikiSpecialVal, HibikiPrimitiveVal, StyleMapType, HibikiGlobalConfig};

