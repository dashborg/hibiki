type HibikiNode = {
    tag    : string,
    text?  : string,
    attrs? : Record<string, string>,
    list?  : HibikiNode[],
    style? : Record<string, string>,
    moreStyles? : Record<string, Record<string, string>>,
}

type HibikiHandlerModule = {
};

type HibikiConfig = {
    Hooks : {
        CsrfHook?  : () => Record<string, string>,
        FetchInitHook? : (url : string, init : Record<string, any>) => void,
    },
    Modules : Record<string, HibikiHandlerModule>,
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
    _type : "DashborgError",
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
    reactimpl? : any,
    node? : HibikiNode,
}

type LibraryType = {
    name: string,
    components: Record<string, ComponentType>;
};

export type {HibikiNode, HibikiConfig, HibikiHandlerModule, PathPart, PathType, PathUnionType, TCFBlock, StmtBlock, Statement, ExprType, DataCtxErrorObjType, ComponentType, LibraryType};
