// Copyright 2021 Dashborg Inc

import {isObject, unpackPositionalArgs, stripAtKeys, getHibiki} from "./utils";
import {sprintf} from "sprintf-js";
import type {HibikiState} from "./state";
import type {AppModuleConfig, FetchHookFn, Hibiki, HibikiAction} from "./types";
import * as DataCtx from "./datactx";
import type {HibikiRequest} from "./request";
import merge from "lodash/merge";

let VALID_METHODS = {"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true};

function handleFetchResponse(url : URL, resp : any) : Promise<any> {
    if (!resp.ok) {
        throw new Error(sprintf("Bad status code response from fetch '%s': %d %s", url.toString(), resp.status, resp.statusText));
    }
    let contentType = resp.headers.get("Content-Type");
    if (contentType != null && contentType.startsWith("application/json")) {
        return resp.json();
    }
    let blobp = resp.blob();
    return blobp.then((blob) => DataCtx.BlobFromBlob(blob));
}

function convertHeaders(...headersObjArr : any[]) : Headers {
    let rtn = new Headers();
    for (let i=0; i<headersObjArr.length; i++) {
        let headersObj = headersObjArr[i];
        if (headersObj != null && isObject(headersObj)) {
            for (let key in headersObj) {
                rtn.set(key, headersObj[key]);
            }
        }
    }
    return rtn;
}

function setParams(method : string, url : URL, fetchInit : Record<string, any>, params : any) {
    if (params == null || !isObject(params)) {
        return;
    }
    if (method == "GET" || method == "DELETE") {
        for (let key in params) {
            let val = params[key];
            if (val == null || typeof(val) == "function") {
                continue;
            }
            if (typeof(val) == "string" || typeof(val) == "number") {
                url.searchParams.set(key, val.toString());
            }
            else {
                url.searchParams.set(key, JSON.stringify(val));
            }
        }
        return;
    }
    fetchInit.headers.set("Content-Type", "application/json");
    fetchInit.body = JSON.stringify(params);
    return;
}

class FetchModule {
    state : HibikiState;

    constructor(state : HibikiState) {
        this.state = state;
    }
    
    callHandler(req : HibikiRequest) : Promise<any> {
        let reqData = req.data ?? {};
        let {url: urlStr, data, init: fetchInit, method} = unpackPositionalArgs(reqData, ["url", "data", "init"]);
        let {"@headers": headersObj} = reqData;
        if (method == null) {
            method = req.path.pathfrag;
        }
        if (method == null) {
            throw new Error(sprintf("Invalid null method passed to /@fetch:[method]"));
        }
        method = method.toUpperCase();
        if (!VALID_METHODS[method]) {
            throw new Error(sprintf("Invalid method passed to /@fetch:[method]: '%s'", method));
        }
        if (urlStr == null || typeof(urlStr) != "string") {
            throw new Error("Invalid call to /@fetch, first argument must be a string (the URL to fetch)");
        }
        let url : URL = null;
        try {
            url = new URL(urlStr, window.location.href);
        }
        catch (e) {
            throw new Error(sprintf("Invalid URL passed to fetch '%s': %s", urlStr, e.toString()));
        }
        if (data != null && !isObject(data)) {
            throw new Error(sprintf("Invalid data passed to /@fetch for url '%s', data must be an object not an array", urlStr));
        }
        fetchInit = fetchInit ?? {};
        fetchInit.headers = convertHeaders(fetchInit.headers, headersObj);
        fetchInit.method = method;
        setParams(method, url, fetchInit, data);
        this.state.runFetchHooks(url, fetchInit);
        let p = fetch(url.toString(), fetchInit).then((resp) => handleFetchResponse(url, resp));
        return p;
    }
}

function evalHExprMap(m : Record<string, DataCtx.HExpr>, state : HibikiState, datacontext : Record<string, any>) {
    if (m == null) {
        return null;
    }
    let dataenv = state.rootDataenv().makeChildEnv(datacontext, null);
    let rtn = {};
    for (let key in m) {
        let val = DataCtx.evalExprAst(m[key], dataenv);
        rtn[key] = val;
    }
    return DataCtx.demobx(rtn);
}

class AppModule {
    state : HibikiState;
    rootPath : string;
    defaultMethod : string;
    defaultHeaders : Record<string, DataCtx.HExpr>;
    defaultInit : any;
    
    constructor(state : HibikiState, config : AppModuleConfig) {
        this.state = state;
        if (config == null) {
            throw new Error("Invalid AppModule config, cannot be null");
        }
        this.rootPath = config.rootPath;
        if (this.rootPath == null) {
            this.rootPath = "";
        }
        if (this.rootPath.endsWith("/")) {
            this.rootPath = this.rootPath.substr(0, this.rootPath.length-1);
        }
        this.defaultMethod = config.defaultMethod ?? "GET";
        this.defaultHeaders = {};
        if (config.defaultHeaders != null) {
            for (let hkey in config.defaultHeaders) {
                this.defaultHeaders[hkey] = DataCtx.evalActionStr(config.defaultHeaders[hkey]);
            }
        }
        this.defaultInit = config.defaultInit ?? {};
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        let url : URL = null;
        try {
            url = new URL(this.rootPath + req.path.path, window.location.href);
        }
        catch (e) {
            throw new Error(sprintf("Invalid URL for /@app[%s] handler '%s': %s", this.rootPath, this.rootPath + req.path.path, e.toString()));
        }
        let data : Record<string, any> = req.data || {};
        let {"@method": method, "@init": fetchInit, "@headers": headersObj} = data;
        method = (method ?? this.defaultMethod).toUpperCase();
        if (!VALID_METHODS[method]) {
            throw new Error(sprintf("Invalid method passed to /@app%s '%s'", req.path.path, method));
        }
        fetchInit = merge({}, this.defaultInit, fetchInit ?? {});
        let defaultHeaders = evalHExprMap(this.defaultHeaders, ((req.state as any).state as HibikiState), {data: req.data, url: url.toString()});
        fetchInit.headers = convertHeaders(defaultHeaders, fetchInit.headers, headersObj);
        fetchInit.method = method;
        let params = stripAtKeys(data);
        setParams(method, url, fetchInit, params);
        this.state.runFetchHooks(url, fetchInit);
        let p = fetch(url.toString(), fetchInit).then((resp) => handleFetchResponse(url, resp));
        return p;
    }
}

class RawModule {
    state : HibikiState;

    constructor(state : HibikiState) {
        this.state = state;
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        let url : URL = null;
        try {
            url = new URL(req.path.path, window.location.href);
        }
        catch (e) {
            throw new Error(sprintf("Invalid URL for raw handler '%s': %s", req.path.path, e.toString()));
        }
        let data : Record<string, any> = req.data || {};
        let {"@method": method, "@init": fetchInit, "@headers": headersObj} = data;
        method = (method ?? "get").toUpperCase();
        if (!VALID_METHODS[method]) {
            throw new Error(sprintf("Invalid method passed to %s: '%s'", req.path.path, method));
        }
        fetchInit = fetchInit ?? {};
        fetchInit.headers = convertHeaders(fetchInit.headers, headersObj);
        fetchInit.method = method;
        let params = stripAtKeys(data);
        setParams(method, url, fetchInit, params);
        this.state.runFetchHooks(url, fetchInit);
        let p = fetch(url.toString(), fetchInit).then((resp) => handleFetchResponse(url, resp));
        return p;
    }
}

class LocalModule {
    state : HibikiState;
    
    constructor(state : HibikiState, config : any) {
        this.state = state;
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        let handlerName = sprintf("/@local%s", req.path.path);
        let ide = this.state.pageDataenv();
        if (ide.handlers[handlerName] != null) {
            return Promise.resolve({hibikihandler: ide.handlers[handlerName].handlerStr});
        }
        let handler = getHibiki().LocalHandlers[req.path.path];
        if (handler == null) {
            throw new Error(sprintf("Local handler '%s' not found", req.path.path));
        }
        let rtn = handler(req);
        let p = Promise.resolve(rtn).then((rtnVal) => {
            if (rtnVal != null) {
                req.setReturn(rtnVal);
            }
            return {hibikiactions: req.actions};
        });
        return p;
    }
}

class LibModule {
    state : HibikiState;
    libContext : string;
    
    constructor(state : HibikiState, config : any) {
        config = config ?? {};
        this.state = state;
        this.libContext = config.libContext;
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        let libContext = this.libContext;
        let handlerName = sprintf("/@lib%s", req.path.path);
        let block = this.state.ComponentLibrary.findLocalBlockHandler(handlerName, libContext);
        if (block != null) {
            return Promise.resolve(block);
        }
        let handler = this.state.ComponentLibrary.findLocalHandler(req.path.path, libContext);
        if (handler == null) {
            throw new Error(sprintf("Lib '%s' handler '%s' not found", libContext, req.path.path));
        }
        let rtn = handler(req);
        let p = Promise.resolve(rtn).then((rtnVal) => {
            if (rtnVal != null) {
                req.setReturn(rtnVal);
            }
            return {hibikiactions: req.actions};
        });
        return p;
    }
}

export {FetchModule, AppModule, LocalModule, RawModule, LibModule};
