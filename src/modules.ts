// Copyright 2021 Dashborg Inc

import {isObject, unpackPositionalArgs, stripAtKeys} from "./utils";
import {sprintf} from "sprintf-js";
import type {HibikiState} from "./state";
import type {RequestType, AppModuleConfig, FetchHookFn, Hibiki, HibikiAction} from "./types";
import * as DataCtx from "./datactx";

let VALID_METHODS = {"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true};

function getHibiki() : Hibiki {
    return (window as any).Hibiki;
}

function handleFetchResponse(url : URL, resp : any) : Promise<any> {
    if (!resp.ok) {
        throw new Error(sprintf("Bad status code response from fetch '%s': %d %s", url.toString(), resp.status, resp.statusText));
    }
    let contentType = resp.headers.get("Content-Type");
    if (contentType != null && contentType.startsWith("application/json")) {
        return resp.json();
    }
    let blobp = resp.blob();
    return blobp.then((blob) => {
        return new Promise((resolve, _) => {
            let reader = new FileReader();
            reader.onloadend = () => {
                let mimetype = blob.type;
                let semiIdx = (reader.result as string).indexOf(";");
                if (semiIdx == -1 || mimetype == null || mimetype == "") {
                    throw new Error("Invalid BLOB returned from fetch, bad mimetype or encoding");
                }
                let dbblob = new DataCtx.HibikiBlob();
                dbblob.mimetype = blob.type;
                // extra 7 bytes for "base64," ... e.g. data:image/jpeg;base64,[base64data]
                dbblob.data = (reader.result as string).substr(semiIdx+1+7);
                resolve(dbblob);
            };
            reader.readAsDataURL(blob);
        });
    });
}

function convertHeaders(headersObj : any) : Headers {
    let rtn = new Headers();
    if (headersObj == null || !isObject(headersObj)) {
        return rtn;
    }
    for (let key in headersObj) {
        rtn.set(key, headersObj[key]);
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
    
    callHandler(req : RequestType) : Promise<any> {
        let {url: urlStr, params, init: fetchInit, method} = unpackPositionalArgs(req.data, ["url", "params", "init"]);
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
            url = new URL(urlStr);
        }
        catch (e) {
            throw new Error(sprintf("Invalid URL passed to fetch '%s': %s", urlStr, e.toString()));
        }
        if (params != null && !isObject(params)) {
            throw new Error(sprintf("Invalid params passed to /@fetch for url '%s', params must be an object not an array", urlStr));
        }
        fetchInit = fetchInit ?? {};
        fetchInit.headers = convertHeaders(fetchInit.headers);
        fetchInit.method = method;
        setParams(method, url, fetchInit, params);
        this.state.runFetchHooks(url, fetchInit);
        let p = fetch(url.toString(), fetchInit).then((resp) => handleFetchResponse(url, resp));
        return p;
    }
}

class AppModule {
    state : HibikiState;
    rootPath : string;
    defaultMethod : string;
    
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
    }

    callHandler(req : RequestType) : Promise<any> {
        let url : URL = null;
        try {
            url = new URL(this.rootPath + req.path.path);
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
        fetchInit = fetchInit ?? {};
        fetchInit.headers = convertHeaders(fetchInit.headers);
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

    callHandler(req : RequestType) : Promise<any> {
        let handler = getHibiki().LocalHandlers[req.path.path];
        if (handler == null) {
            throw new Error(sprintf("Local handler '%s' not found", req.path.path));
        }
        let rtn = handler(req);
        let p = Promise.resolve(rtn).then((rtnVal) => {
            if (rtnVal != null) {
                let rtnAction : HibikiAction = {
                    type: "setdata",
                    ts: Date.now(),
                    selector: "@rtn",
                    data: rtn,
                };
                req.actions.push(rtnAction);
            }
            return {hibikiactions: req.actions};
        });
        return p;
    }
}

export {FetchModule, AppModule, LocalModule};
