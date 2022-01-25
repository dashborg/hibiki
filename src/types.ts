// Copyright 2021-2022 Dashborg Inc

import type {HibikiState} from "./state";
import type {RtContext, HibikiError} from "./error";
import type {HibikiRequest} from "./request";
import * as mobx from "mobx";
import type {HExpr, HibikiBlob, LValue, HIteratorExpr, HAction, HActionBlock, OpaqueValue, ChildrenVar} from "./datactx";
import type {DataEnvironment, EHandlerType} from "./state";

type NodeAttrType = string | HExpr;

type HibikiValEx = HibikiVal | LValue | symbol;
type HibikiValObj = {[k : string] : HibikiVal};
type HibikiVal = string | number | boolean | HibikiValObj | HibikiVal[] | HibikiBlob | HibikiNode | OpaqueValue | ChildrenVar;
type InjectedAttrs = Record<string, HibikiVal | LValue | EHandlerType>;

type HibikiNode = {
    tag    : string,
    text?  : string,
    attrs? : Record<string, NodeAttrType>,
    foreachAttr? : HIteratorExpr,
    handlers? : Record<string, HAction[]>,
    bindings? : Record<string, HExpr>,
    list?  : HibikiNode[],
    style? : Record<string, NodeAttrType>,
    morestyles? : Record<string, Record<string, NodeAttrType>>,
    automerge? : AutoMergeExpr[],
    autofire? : AutoFireExpr[],
    innerhtml? : string,
    outerhtml? : string,
    libContext? : string,
}

type HibikiReactProps = {
    node : HibikiNode,
    dataenv : DataEnvironment,
    injectedAttrs : InjectedAttrs,
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
type ErrorCallbackFn = JSFuncStr | ((HibikiError) => boolean);
type EventCallbackFn = JSFuncStr | ((EventType) => void);

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

type HibikiConfig = {
    noConfigMergeFromHtml? : boolean,
    noDataMergeFromHtml?   : boolean,
    noUsageImg? : boolean,
    noWelcomeMessage? : boolean,
    modules? : Record<string, ModuleConfig>,
    httpConfig? : HttpConfig;
    unhandledErrorHook? : ErrorCallbackFn;
};

type PathUnionType = string | PathType;

type PathPart = {
    pathtype : ("root" | "dot" | "array" | "map" | "dyn" | "deref"),
    pathindex? : number,
    pathkey? : string,

    value? : any,
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
    localHandlers : Record<string, (HibikiRequest) => any>;
    modules : Record<string, HibikiHandlerModule>;
    handlers : Record<string, HandlerValType>;
};

type ReactClass = new(props : any) => React.Component<any, any>;

interface Hibiki {
    autoloadTags();
    loadTag(elem: HTMLElement) : HibikiExtState;
    render(elem : HTMLElement, state : HibikiExtState);
    createState(config : HibikiConfig, html : string | HTMLElement, initialData : any) : HibikiExtState;
    registerLocalJSHandler(path : string, fn : (HibikiRequest) => any);
    registerLocalReactComponentImpl(name : string, reactImpl : ReactClass);
    registerLocalNativeComponentImpl(name : string, reactImpl : ReactClass);
    addLibraryCallback(libName : string, fn : Function);
    HibikiReact : new(props : any) => React.Component<{hibikiState : HibikiExtState}, {}>;
    ModuleRegistry : Record<string, (new(HibikiState, ModuleConfig) => HibikiHandlerModule)>;
    JSFuncs : Record<string, JSFuncType>;
    LocalHandlers : Record<string, (HibikiRequest) => any>;
    LocalReactComponents : mobx.ObservableMap<string, ReactClass>;
    LocalNativeComponents : mobx.ObservableMap<string, ReactClass>;
    ImportLibs : Record<string, any>;
    LibraryCallbacks : Record<string, any[]>;
    States : Record<string, HibikiExtState>;
    VERSION : string;
    BUILD : string;
};

interface HibikiExtState {
    setHtml(html : string | HTMLElement);
    setData(path : string, data : any);
    getData(path : string) : any;
    executeHandlerBlock(actions : HandlerBlock, pure? : boolean);
    callHandler(handlerUrl : string, data : HibikiValObj);
    setPageName(pageName : string);
    setInitCallback(fn : () => void);
    initialize(force : boolean);
    makeWatcher(exprStr : string, callback : (v : HibikiVal) => void) : (() => void);
};

export type {HibikiNode, HibikiConfig, HibikiHandlerModule, PathPart, PathType, PathUnionType, ComponentType, LibraryType, HibikiRequest, Hibiki, HibikiAction, HibikiActionString, HibikiActionValue, HibikiExtState, EventType, HandlerValType, JSFuncType, FetchHookFn, CsrfHookFn, ReactClass, HandlerPathType, ErrorCallbackFn, EventCallbackFn, HtmlParserOpts, LibComponentType, HandlerBlock, NodeAttrType, HibikiVal, HibikiValObj, HibikiValEx, AutoMergeExpr, AutoFireExpr, HibikiReactProps, HttpConfig, JSFuncStr, InjectedAttrs};

