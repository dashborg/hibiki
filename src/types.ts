import type {HibikiState} from "./state";
import type {RtContext, HibikiError} from "./error";
import * as mobx from "mobx";

type HibikiNode = {
    tag    : string,
    text?  : string,
    attrs? : Record<string, string>,
    list?  : HibikiNode[],
    style? : Record<string, string>,
    morestyles? : Record<string, Record<string, string>>,
}

type RequestType = {
    path : {
        module : string,
        path : string,
        pathfrag : string,
    },
    data : any[],
    rtContext : RtContext,
    state : HibikiExtState,
    pure : boolean,
};

type EventType = {
    event : string,
    bubble : boolean,
    datacontext : Record<string, any>;
};

type HandlerValType = {
    handlerStr : string,
    node : HibikiNode,
};

type HibikiAction = {
    type          : string,   // "setdata", "invalidate", "html", "error", "blob", "blobext"
    ts?           : number,
    selector?     : string,
    data?         : any,
    err?          : string,
    blobbase64?   : string,
    blobmimetype? : string,
};

type HibikiHandlerModule = {
    callHandler : (req : RequestType) => Promise<any>;
};

type HibikiConfig = {
    initHandler?           : string,
    noConfigMergeFromHtml? : boolean,
    noDataMergeFromHtml?   : boolean,
    hooks? : {
        csrfHook?  : () => Record<string, string>,
        fetchInitHook? : (url : string, init : Record<string, any>) => void,
    },
    modules? : Record<string, HibikiHandlerModule>,
    noUsageImg? : boolean,
    noWelcomeMessage? : boolean,
    errorCallback? : (HibikiError) => void,
};

type PathUnionType = string | PathType;

type PathPart = {
    pathtype : ("root" | "dot" | "array" | "map" | "dyn" | "dynfind" | "deref"),
    pathindex? : number,
    pathkey? : string,

    value? : any,
    caret? : number,
    expr? : any;
};

type PathType = PathPart[];

type TCFBlock = {
    block : StmtBlock,
    catchBlock? : StmtBlock,
    finallyBlock? : StmtBlock,
    contextStr? : string,
};

type StmtBlock = Statement[];

type Statement = {
    stmt : string,
    data? : any,
    handler? : string,
    lvalue? : any,
    expr? : ExprType,
    exprs? : ExprType[],
    setop? : string,
    target? : any,
    event? : string,
    context : any,
    condExpr : ExprType,
    thenBlock? : StmtBlock,
    elseBlock? : StmtBlock,
    appexpr?: ExprType,
    pageexpr? : ExprType,
    params?: ExprType,
};

type ExprType = any;

type DataCtxErrorObjType = {
    _type : "HibikiError",
    message : string,
    context: string,
    rtctx : RtContext,
    err : Error,
};

type ComponentType = {
    componentType : "hibiki-html" | "hibiki-native" | "react-custom",
    libName : string,
    name : string,
    impl? : any,
    reactimpl? : mobx.IObservableValue<any>,
    node? : HibikiNode,
}

type LibComponentType = {
    componentType : "hibiki-html" | "hibiki-native" | "react-custom",
    impl? : any,
    reactimpl? : mobx.IObservableValue<any>,
    node? : HibikiNode,
}

type LibraryType = {
    name: string,
    components: Record<string, LibComponentType>;
};

type HandlerPathObj = {
    ns : string,
    path : string,
    pathfrag : string,
};

interface Hibiki {
    autoloadTags();
    loadTag(elem: HTMLElement) : HibikiExtState;
    render(elem : HTMLElement, state : HibikiExtState);
    createState(config : HibikiConfig, html : string | HTMLElement, initialData : any) : HibikiExtState;
};

interface HibikiExtState {
    setHtml(html : string | HTMLElement);
    setData(path : string, data : any);
    getData(path : string) : any;
    setLocalReactComponent(name : string, reactImpl : any);
    runActions(actions : HibikiAction[]) : any;
    setHtmlPage(htmlPage : string);
    setInitCallback(fn : () => void);
    initialize(force : boolean);
};

export type {HibikiNode, HibikiConfig, HibikiHandlerModule, PathPart, PathType, PathUnionType, TCFBlock, StmtBlock, Statement, ExprType, DataCtxErrorObjType, ComponentType, LibraryType, HandlerPathObj, RequestType, Hibiki, HibikiAction, HibikiExtState, EventType, HandlerValType};
