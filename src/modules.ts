// Copyright 2021 Dashborg Inc

import {isObject, unpackPositionalArgs, stripAtKeys, getHibiki, fullPath, getSS, setSS, smartEncodeParam, unpackArg, unpackAtArgs, blobPrintStr, base64ToArray} from "./utils";
import {sprintf} from "sprintf-js";
import type {HibikiState} from "./state";
import type {AppModuleConfig, FetchHookFn, Hibiki, HibikiAction, HandlerPathType, HibikiExtState} from "./types";
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

function hibikiState(state : HibikiExtState) : HibikiState {
    return ((state as any).state as HibikiState);
}

function formDataFromParams(params : Record<string, any>) : FormData {
    let formData = new FormData();
    for (let key in params) {
        let val = params[key];
        if (val == null || typeof(val) == "function") {
            formData.delete(key);
            continue;
        }
        if (typeof(val) == "string" || typeof(val) == "number") {
            formData.set(key, val.toString());
        }
        else if (val instanceof Blob) {
            formData.set(key, val);
        }
        else if (val instanceof DataCtx.HibikiBlob) {
            let binaryArr = base64ToArray(val.data);
            if (val.name != null) {
                let blob = new File([binaryArr], val.name, {type: val.mimetype});
                formData.set(key, blob);
            }
            else {
                let blob = new Blob([binaryArr], {type: val.mimetype});
                formData.set(key, blob);
            }
        }
        else {
            formData.set(key, DataCtx.JsonStringify(val));
        }
    }
    return formData;
}

function urlSearchParamsFromParams(params : Record<string, any>) : URLSearchParams {
    let usp = new URLSearchParams();
    for (let key in params) {
        let val = params[key];
        if (val == null || typeof(val) == "function") {
            usp.delete(key);
            continue;
        }
        if (typeof(val) == "string" || typeof(val) == "number") {
            usp.set(key, val.toString());
        }
        else if (val instanceof Blob) {
            throw new Error(sprintf("Cannot serialize Blob %s with url encoding (use 'multipart' encoding)", blobPrintStr(val)));
        }
        else if (val instanceof DataCtx.HibikiBlob) {
            throw new Error(sprintf("Cannot serialize HibikiBlob %s with url encoding (use 'multipart' encoding)", blobPrintStr(val)));
        }
        else {
            usp.set(key, JSON.stringify(val));
        }
    }
    return usp;
}

function jsonParamsFromParams(params : Record<string, any>) : string {
    let rtn = {};
    for (let key in params) {
        let val = params[key];
        if (val == null || typeof(val) == "function") {
            rtn[key] = null;
        }
        if (typeof(val) == "string" || typeof(val) == "number") {
            rtn[key] = val;
        }
        else if (val instanceof Blob) {
            throw new Error(sprintf("Cannot serialize Blob %s with json encoding (use 'multipart' encoding)", blobPrintStr(val)));
        }
        else if (val instanceof DataCtx.HibikiBlob) {
            let blob : Record<string, any> = {};
            blob.mimetype = val.mimetype;
            blob.data = val.data;
            if (val.name != null) {
                blob.name = val.name;
            }
            rtn[key] = blob;
        }
        else {
            rtn[key] = val;
        }
    }
    return DataCtx.JsonStringify(rtn);
}

function setParams(method : string, url : URL, fetchInit : Record<string, any>, data : any) {
    if (data == null || !isObject(data)) {
        return;
    }
    let atData = unpackArg(data, "@data");
    if (atData != null && !isObject(atData)) {
        throw new Error("Invalid @data, must be an object: type=" + typeof(atData));
    }
    let params = Object.assign({}, (atData ?? {}), stripAtKeys(data));
    if (method == "GET" || method == "DELETE") {
        for (let key in params) {
            let val = params[key];
            if (val == null || typeof(val) == "function") {
                url.searchParams.delete(key);
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
    let encoding = unpackArg(data, "@encoding");
    if (encoding == null || encoding == "json") {
        fetchInit.headers.set("Content-Type", "application/json");
        fetchInit.body = jsonParamsFromParams(params);
    }
    else if (encoding == "url") {
        fetchInit.headers.set("Content-Type", "application/x-www-form-urlencoded");
        let usp = urlSearchParamsFromParams(params);
        fetchInit.body = usp;
    }
    else if (encoding == "form" || encoding == "multipart") {
        let formData = formDataFromParams(params);
        fetchInit.body = formData;
    }
    else {
        throw new Error("Invalid @encoding specified (must be 'json', 'url', 'form', or 'multipart'): " + encoding);
    }
    return;
}

function buildFetchInit(req : HibikiRequest, defaultInit : any, defaultHeaders : Record<string, any>) : any{
    let {mode: dataMode, init: dataInit, headers: dataHeaders, credentials: dataCredentials} = unpackAtArgs(req.data);
    let method = getMethod(req);
    let fetchInit = Object.assign({}, defaultInit, dataInit);
    fetchInit.headers = convertHeaders((defaultInit ?? {}).headers, defaultHeaders, (dataInit || {}).headers, dataHeaders);
    fetchInit.method = method;
    if (dataMode != null) {
        fetchInit.mode = dataMode;
    }
    if (dataCredentials != null) {
        fetchInit.credentials = dataCredentials;
    }
    return fetchInit;
}

function validateModulePath(modName : string, hpath : HandlerPathType) {
    if (hpath.url.startsWith("http://") || hpath.url.startsWith("https://") || hpath.url.startsWith("//") || !urlSameOrigin(hpath.url)) {
        throw new Error(sprintf("Invalid %s module URL, must not specify a protocol or host: %s", modName, fullPath(hpath)));
    }
    if (!hpath.url.startsWith("/")) {
        throw new Error(sprintf("Invalid %s module URL, must not specify a relative url: %s", modName, fullPath(hpath)));
    }
}

function urlSameOrigin(urlStr : string) {
    let url = new URL(urlStr, window.location.href);
    return url.origin == window.location.origin;
}

class HttpModule {
    state : HibikiState;

    constructor(state : HibikiState) {
        this.state = state;
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        let url : URL = null;
        try {
            url = new URL(req.callpath.url, window.location.href);
        }
        catch (e) {
            throw new Error(sprintf("Invalid URL for http handler '%s': %s", req.callpath.url, e.toString()));
        }
        let fetchInit = buildFetchInit(req, null, null);
        if (!VALID_METHODS[fetchInit.method]) {
            throw new Error(sprintf("Invalid method '%s' passed to http handler %s", fetchInit.method, fullPath(req.callpath)));
        }
        setParams(fetchInit.method, url, fetchInit, req.data);
        this.state.runFetchHooks(url, fetchInit);
        let p = fetch(url.toString(), fetchInit).then((resp) => handleFetchResponse(url, resp));
        return p;
    }
}

function evalHExprMap(m : Record<string, DataCtx.HExpr>, state : HibikiState, datacontext : Record<string, any>) : Record<string, any> {
    if (m == null) {
        return null;
    }
    let dataenv = state.rootDataenv().makeChildEnv(datacontext, null);
    let rtn : Record<string, any> = {};
    for (let key in m) {
        let val = DataCtx.evalExprAst(m[key], dataenv);
        rtn[key] = val;
    }
    return DataCtx.demobx(rtn);
}

class AppModule {
    state : HibikiState;
    rootUrl : URL;
    defaultHeaders : Record<string, DataCtx.HExpr>;
    defaultInit : any;
    
    constructor(state : HibikiState, config : AppModuleConfig) {
        this.state = state;
        if (config == null) {
            throw new Error("Invalid AppModule config, cannot be null");
        }
        if (config.rootUrl == null) {
            throw new Error("Invalid AppModule config, must set rootUrl");
        }
        try {
            this.rootUrl = new URL(config.rootUrl, window.location.href);
        }
        catch (e) {
            throw new Error("Invalid AppModule rootUrl: " + e.toString());
        }
        this.defaultHeaders = {};
        if (config.defaultHeaders != null) {
            for (let hkey in config.defaultHeaders) {
                this.defaultHeaders[hkey] = DataCtx.evalActionStr(config.defaultHeaders[hkey]);
            }
        }
        this.defaultInit = config.defaultInit ?? {};
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        let callpathUrl = req.callpath.url;
        if (callpathUrl.startsWith("/")) {
            callpathUrl = callpathUrl.substr(1);
        }
        let url : URL = null;
        try {
            url = new URL(callpathUrl, this.rootUrl);
            if (url.origin != this.rootUrl.origin) {
                throw new Error(sprintf("Must use a relative URL for app module, origin does not match rootUrl '%s' vs '%s'", this.rootUrl.origin, url.origin));
            }
        }
        catch (e) {
            throw new Error(sprintf("Invalid handler path '%s' [module=app, rootUrl=%s]: %s", fullPath(req.callpath), this.rootUrl.toString(), e.toString()));
        }
        let defaultHeaders = evalHExprMap(this.defaultHeaders, ((req.state as any).state as HibikiState), {data: req.data, url: url.toString()});
        let fetchInit = buildFetchInit(req, this.defaultInit, defaultHeaders);
        if (!VALID_METHODS[fetchInit.method]) {
            throw new Error(sprintf("Invalid method '%s' passed to handler %s", fetchInit.method, fullPath(req.callpath)));
        }
        setParams(fetchInit.method, url, fetchInit, req.data);
        this.state.runFetchHooks(url, fetchInit);
        let p = fetch(url.toString(), fetchInit).then((resp) => handleFetchResponse(url, resp));
        return p;
    }
}

function getMethod(req : HibikiRequest) : string {
    let method = req.callpath.method;
    if (method != null && method != "DYN") {
        return method.toUpperCase();
    }
    if (req.data != null) {
        let dataMethod = unpackArg(req.data, "@method");
        if (dataMethod != null) {
            return dataMethod.toUpperCase();
        }
    }
    return "GET";
}

class LocalModule {
    state : HibikiState;
    
    constructor(state : HibikiState, config : any) {
        this.state = state;
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        validateModulePath("local", req.callpath);
        let handlerName = sprintf("//@local%s", req.callpath.url);
        let ide = this.state.pageDataenv();
        if (ide.handlers[handlerName] != null) {
            return Promise.resolve({hibikihandler: ide.handlers[handlerName].handlerStr});
        }
        let handler = getHibiki().LocalHandlers[req.callpath.url];
        if (handler == null) {
            throw new Error(sprintf("Local handler '%s' not found", req.callpath.url));
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
        validateModulePath("lib", req.callpath);
        let libContext = this.libContext;
        let handlerName = sprintf("//@lib%s", req.callpath.url);
        let block = this.state.ComponentLibrary.findLocalBlockHandler(handlerName, libContext);
        if (block != null) {
            return Promise.resolve(block);
        }
        let handler = this.state.ComponentLibrary.findLocalHandler(req.callpath.url, libContext);
        if (handler == null) {
            throw new Error(sprintf("Lib '%s' handler '%s' not found", libContext, req.callpath.url));
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

class HibikiModule {
    state : HibikiState;

    constructor(state : HibikiState, config : any) {
        this.state = state;
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        validateModulePath("hibiki", req.callpath);
        let handlerName = req.callpath.url;
        if (handlerName == "/get-session-storage") {
            return this.getSS(req);
        }
        else if (handlerName == "/set-session-storage") {
            return this.setSS(req);
        }
        else if (handlerName == "/set-title") {
            return this.setTitle(req);
        }
        else if (handlerName == "/update-url") {
            return this.updateUrl(req);
        }
        else {
            throw new Error("Invalid Hibiki Module handler: " + fullPath(req.callpath));
        }
    }

    getSS(req : HibikiRequest) : Promise<any> {
        let key = unpackArg(req.data, "key", 0);
        if (key == null) {
            throw new Error("get-session-storage requires 'key' parameter");
        }
        return getSS(key);
    }

    setSS(req : HibikiRequest) : Promise<any> {
        let key = unpackArg(req.data, "key", 0);
        if (key == null) {
            throw new Error("set-session-storage requires 'key' parameter");
        }
        let val = DataCtx.demobx(unpackArg(req.data, "value", 1));
        setSS(key, val);
        return null;
    }

    setTitle(req : HibikiRequest) : Promise<any> {
        let title = unpackArg(req.data, "title", 0);
        if (title == null) {
            throw new Error("set-title requires 'title' parameter");
        }
        document.title = String(title);
        req.setData("$state.title", document.title);
        return null;
    }

    updateUrl(req : HibikiRequest) : Promise<any> {
        let data = stripAtKeys(req.data);
        let {path: urlStr, raw: isRaw, replace, title} = unpackAtArgs(req.data);
        let url  = new URL((urlStr ?? ""), window.location.href);
        for (let key in data) {
            let val = data[key];
            if (val == null) {
                url.searchParams.delete(key);
                continue;
            }
            url.searchParams.set(key, smartEncodeParam(val, isRaw));
        }
        if (title != null) {
            document.title = title;
        }
        if (replace) {
            window.history.replaceState(null, document.title, url.toString());
        }
        else {
            window.history.pushState(null, document.title, url.toString());
        }
        hibikiState(req.state).setStateVars();
        return null;
    }
}

export {AppModule, LocalModule, HttpModule, LibModule, HibikiModule};
