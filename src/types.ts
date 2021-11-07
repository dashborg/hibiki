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
    DataRoots : Record<string, any>,
    Modules : Record<string, HibikiHandlerModule>,
};

export type {HibikiNode, HibikiConfig, HibikiHandlerModule};
