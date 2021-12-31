// Copyright 2021 Dashborg Inc

import type {HibikiState} from "./state";
import type {RtContext, HibikiError} from "./error";
import type {HibikiRequest} from "./request";
import * as mobx from "mobx";
import type {HAction, HExpr} from "./datactx";

type NodeAttrType = string | HExpr;

type HibikiNode = {
    tag    : string,
    text?  : string,
    attrs? : Record<string, NodeAttrType>,
    handlers? : Record<string, HAction[]>,
    list?  : HibikiNode[],
    style? : Record<string, string>,
    morestyles? : Record<string, Record<string, string>>,
}

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
    bubble : boolean,
    datacontext : Record<string, any>,
};

type HandlerValType = {
    handlerStr : string,
    node : HibikiNode,
};

type HandlerBlock =
      {hibikihandler: string, hibikicontext?: Record<string, any>, ctxstr? : string}
    | {hibikiactions: HibikiAction[], hibikicontext?: Record<string, any>}
    | HAction[];

type HibikiActionValue = {hibikiexpr : string} | any;
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

type AppModuleConfig = {
    rootUrl : string,
    defaultHeaders? : Record<string, HibikiActionString>,
    defaultInit? : any,
};

type FetchHookFn = string | ((url : URL, fetchInit : Record<string, any>) => void);
type CsrfHookFn = string | ((url : URL) => Record<string, string>);
type ErrorCallbackFn = string | ((HibikiError) => void);
type EventCallbackFn = string | ((EventType) => void);

type ModuleConfig = Record<string, any>;

type HtmlParserOpts = {
    noInlineText? : boolean,
};

type HibikiConfig = {
    hooks? : {
        csrfHook?  : CsrfHookFn,
        fetchHook? : FetchHookFn,
    },
    noConfigMergeFromHtml? : boolean,
    noDataMergeFromHtml?   : boolean,
    noUsageImg? : boolean,
    noWelcomeMessage? : boolean,
    modules? : Record<string, ModuleConfig>,
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
}

type LibraryType = {
    name: string,
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
};

interface HibikiExtState {
    setHtml(html : string | HTMLElement);
    setData(path : string, data : any);
    getData(path : string) : any;
    executeHandlerBlock(actions : HandlerBlock, pure? : boolean);
    setPageName(pageName : string);
    setInitCallback(fn : () => void);
    initialize(force : boolean);
};

export type {HibikiNode, HibikiConfig, HibikiHandlerModule, PathPart, PathType, PathUnionType, ComponentType, LibraryType, HibikiRequest, Hibiki, HibikiAction, HibikiActionString, HibikiActionValue, HibikiExtState, EventType, HandlerValType, JSFuncType, AppModuleConfig, FetchHookFn, CsrfHookFn, ReactClass, HandlerPathType, ErrorCallbackFn, EventCallbackFn, HtmlParserOpts, LibComponentType, HandlerBlock, NodeAttrType};
