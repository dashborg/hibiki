// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {isObject, getHibiki, fullPath, getSS, setSS, smartEncodeParam, callHook, validateModulePath} from "./utils";
import {sprintf} from "sprintf-js";
import type {HibikiState} from "./state";
import type {FetchHookFn, Hibiki, HibikiAction, HandlerPathType, HibikiExtState, HttpConfig, HibikiActionString, HibikiVal, HibikiValObj} from "./types";
import * as DataCtx from "./datactx";
import type {HibikiRequest} from "./request";
import merge from "lodash/merge";
import * as mobx from "mobx";

let VALID_METHODS : Record<string, boolean> = {"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true};

function fetchDataObj(url : URL, resp : any, inErrorHandler : boolean) : Promise<HibikiVal> {
    let contentType = resp.headers.get("Content-Type");
    if (contentType != null && contentType.startsWith("application/json")) {
        return resp.text().then((textData) => {
            try {
                return JSON.parse(textData);
            }
            catch (err) {
                let blobRtn = new DataCtx.HibikiBlob("text/json-unparseable", btoa(textData));
                if (inErrorHandler) {
                    return blobRtn;
                }
                let errMsg = sprintf("Unparseable JSON: " + err.message);
                let rtnErr = new Error(errMsg);
                rtnErr["hibikiErrorType"] = "http";
                rtnErr["hibikiErrorData"] = {status: resp.status, statustext: resp.statusText, data: blobRtn};
                throw rtnErr;
            }
        });
    }
    let blobp = resp.blob();
    return blobp.then((blob) => DataCtx.BlobFromBlob(blob));
}

function handleFetchResponse(url : URL, resp : any) : Promise<any> {
    if (!resp.ok) {
        let errMsg = sprintf("Bad status code response from fetch '%s': %d %s", url.toString(), resp.status, resp.statusText);
        let rtnErr = new Error(errMsg);
        let dataPromise = fetchDataObj(url, resp, true);
        return dataPromise.then((data) => {
            let errData = {status: resp.status, statustext: resp.statusText, data: data};
            rtnErr["hibikiErrorData"] = errData;
            rtnErr["hibikiErrorType"] = "http";
            throw rtnErr;
        });
    }
    return fetchDataObj(url, resp, false);
}

function handleFetchFail(err : Error) : Promise<any> {
    err["hibikiErrorType"] = "http";
    err["hibikiErrorData"] = {status: 599, statustext: "Network Error"};
    throw err;
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

function formDataConvertVal(val : any, inArray? : boolean) : any {
    if (val == null || typeof(val) == "function") {
        return null;
    }
    if (typeof(val) == "string" || typeof(val) == "number" || typeof(val) == "boolean") {
        return val.toString();
    }
    if (val instanceof Blob) {
        return val;
    }
    if (val instanceof DataCtx.HibikiBlob) {
        return val.asJsBlob();
    }
    if (!inArray && mobx.isArrayLike(val)) {
        let rtn = [];
        for (let i=0; i<val.length; i++) {
            let subVal = formDataConvertVal(val[i], true);
            rtn.push(subVal);
        }
        return rtn;
    }
    return DataCtx.JsonStringify(val);
}

function formDataFromParams(params : Record<string, any>) : FormData {
    let formData = new FormData();
    for (let key in params) {
        let val = params[key];
        let convertedVal = formDataConvertVal(val, false);
        if (convertedVal == null) {
            continue;
        }
        if (mobx.isArrayLike(convertedVal)) {
            for (let i=0; i<convertedVal.length; i++) {
                formData.append(key, convertedVal[i]);
            }
        }
        else {
            formData.set(key, convertedVal);
        }
    }
    return formData;
}

function urlSearchParamsConvertVal(val : any, inArray? : boolean) : any {
    if (val == null || typeof(val) == "function") {
        return null;
    }
    if (typeof(val) == "string" || typeof(val) == "number" || typeof(val) == "boolean") {
        return val.toString();
    }
    else if (val instanceof Blob) {
        throw new Error(sprintf("Cannot serialize Blob %s with url encoding (use 'multipart' encoding)", DataCtx.blobPrintStr(val)));
    }
    else if (val instanceof DataCtx.HibikiBlob) {
        throw new Error(sprintf("Cannot serialize HibikiBlob %s with url encoding (use 'multipart' encoding)", DataCtx.blobPrintStr(val)));
    }
    else if (!inArray && mobx.isArrayLike(val)) {
        let rtn = [];
        for (let i=0; i<val.length; i++) {
            let subVal = urlSearchParamsConvertVal(val[i], true);
            rtn.push(subVal);
        }
        return rtn;
    }
    else {
        return DataCtx.JsonStringify(val);
    }
}

function urlSearchParamsFromParams(params : Record<string, any>) : URLSearchParams {
    let usp = new URLSearchParams();
    for (let key in params) {
        let val = urlSearchParamsConvertVal(params[key]);
        if (val == null) {
            continue;
        }
        if (mobx.isArrayLike(val)) {
            for (let i=0; i<val.length; i++) {
                usp.append(key, val[i]);
            }
        }
        else {
            usp.set(key, val);
        }
    }
    return usp;
}

function jsonReplacer(key : string, value : any) : any {
    if (this[key] instanceof Blob) {
        throw new Error(sprintf("Cannot serialize Blob %s with json encoding (use 'multipart' encoding)", DataCtx.blobPrintStr(this[key])));
    }
    if (this[key] instanceof DataCtx.HibikiBlob) {
        let hblob : DataCtx.HibikiBlob = this[key];
        return hblob.asJson();
    }
    return DataCtx.JsonReplacerFn.bind(this)(key, value);
}

function DefaultCsrfValueFn() {
    let csrfToken = null;
    let csrfMwElem = document.querySelector('[name=csrfmiddlewaretoken]');
    if (csrfMwElem != null) {
        csrfToken = (csrfMwElem as any).value;
    }
    let csrfMetaElem = document.querySelector("meta[name=csrf-token]");
    if (csrfMetaElem != null) {
        csrfToken = (csrfMetaElem as any).content;
    }
    return csrfToken;
}

function setParams(method : string, url : URL, fetchInit : Record<string, any>, data : DataCtx.HibikiParamsObj) {
    let atData = data.getArg("@data");
    let [atDataObj, isAtDataObj] = DataCtx.asPlainObject(atData, true);
    if (!isAtDataObj) {
        throw new Error("Invalid @data, must be an object: type=" + DataCtx.hibikiTypeOf(atData));
    }
    let params = Object.assign({}, fetchInit["csrfParams"], (atDataObj ?? {}), data.getPlainArgs());
    let encoding = DataCtx.valToString(data.getArg("@encoding"));
    if (method == "GET" || method == "DELETE") {
        if (encoding != null && encoding != "url") {
            console.log(sprintf("WARNING, @encoding=%s is ignored for GET/DELETE requests, only 'url' is supported", encoding));
        }
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
    if (encoding == null || encoding == "json") {
        fetchInit.headers.set("Content-Type", "application/json");
        fetchInit.body = JSON.stringify(params, jsonReplacer);
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

function evalCsrfHExpr(hexpr : DataCtx.HExpr, state : HibikiState, datacontext : HibikiValObj) : string {
    if (hexpr == null) {
        return null;
    }
    let dataenv = state.rootDataenv().makeChildEnv(datacontext, null);
    let val = DataCtx.evalExprAst(hexpr, dataenv, "resolve");
    return DataCtx.valToString(val);
}

function setCsrf(req : HibikiRequest, url : URL, fetchInit : Record<string, any>, opts : HttpConfig) {
    if (opts.csrfMethods.indexOf(fetchInit.method) == -1) {
        return;
    }
    if (opts.csrfAllowedOrigins.indexOf("*") == -1 && opts.csrfAllowedOrigins.indexOf(url.origin)) {
        return;
    }
    let csrfToken : string = DataCtx.valToString(req.params.getArg("@csrf"));
    if (csrfToken == null && opts.compiledCsrfToken != null) {
        let token = opts.compiledCsrfToken;
        if (typeof(token) === "string") {
            csrfToken = token;
        }
        else if (typeof(token) === "function" || (isObject(token) && "jsfunc" in token)) {
            csrfToken = callHook("CSRFValue", token);
        }
        else if (isObject(token) && "etype" in token) {
            let val = evalCsrfHExpr(token, hibikiState(req.state), {data: req.params.params, url: url.toString()});
        }
    }
    if (csrfToken == null) {
        return;
    }
    for (let h of opts.csrfHeaders) {
        fetchInit.headers.set(h, csrfToken);
    }
    for (let p of opts.csrfParams) {
        if (fetchInit["csrfParams"] == null) {
            fetchInit["csrfParams"] = {};
        }
        fetchInit["csrfParams"][p] = csrfToken;
    }
}

function makeFetchInit(req : HibikiRequest, url : URL, opts : HttpConfig) : Record<string, any> {
    let {mode: dataMode, init: dataInitArg, headers: dataHeaders, credentials: dataCredentials} = req.params.getAtArgs();
    let [dataInit, _] = DataCtx.asPlainObject(dataInitArg, false);
    let method = getMethod(req);
    if (!VALID_METHODS[method]) {
        throw new Error(sprintf("Invalid method '%s' passed to http handler %s", method, fullPath(req.callpath)));
    }
    let fetchInit = Object.assign({}, opts.defaultInit, dataInit);
    let defaultHeaders = evalHExprMap(opts.compiledHeaders, hibikiState(req.state), {data: req.params.params, url: url.toString()});
    fetchInit.headers = convertHeaders(fetchInit.headers, defaultHeaders, (dataInit ?? {}).headers, dataHeaders);
    fetchInit.method = method;
    if (dataMode != null) {
        fetchInit.mode = dataMode;
    }
    if (dataCredentials != null) {
        fetchInit.credentials = dataCredentials;
    }
    setCsrf(req, url, fetchInit, opts);
    setParams(method, url, fetchInit, req.params);
    if (opts.fetchHookFn != null) {
        callHook("FetchHook", opts.fetchHookFn, url, fetchInit);
    }
    return fetchInit;
}

function isActionStr(v : any) : boolean {
    if (v == null) {
        return false;
    }
    if (isObject(v) && "hibikiexpr" in v) {
        return true;
    }
    return false;
}

function setDefaultOptions(opts : HttpConfig) {
    opts.baseUrl = opts.baseUrl ?? window.location.href;
    opts.csrfToken = opts.csrfToken ?? DefaultCsrfValueFn;
    opts.csrfMethods = opts.csrfMethods ?? ["POST", "PUT", "PATCH"];
    opts.csrfHeaders = opts.csrfHeaders ?? ["X-Csrf-Token", "X-CSRFToken"];
    opts.csrfParams = opts.csrfParams ?? [];
    opts.csrfAllowedOrigins = opts.csrfAllowedOrigins ?? [(new URL(opts.baseUrl)).origin];
    if (opts.defaultHeaders != null) {
        opts.compiledHeaders = {};
        for (let hkey in opts.defaultHeaders) {
            opts.compiledHeaders[hkey] = DataCtx.compileActionStr(opts.defaultHeaders[hkey]);
        }
    }
    if (isActionStr(opts.csrfToken)) {
        opts.compiledCsrfToken = DataCtx.compileActionStr(opts.csrfToken as HibikiActionString);
    }
    else {
        opts.compiledCsrfToken = opts.csrfToken as any;
    }
}

class HttpModule {
    state : HibikiState;
    opts : HttpConfig;

    constructor(state : HibikiState, opts : HttpConfig) {
        this.state = state;
        this.opts = Object.assign({}, opts);
        setDefaultOptions(this.opts);
    }

    callHandler(req : HibikiRequest) : Promise<any> {
        let url : URL = null;
        try {
            let baseUrl = this.opts.baseUrl ?? window.location.href;
            let callPathUrlStr = req.callpath.url;
            if (this.opts.forceRelativeUrls && callPathUrlStr.startsWith("/") && !callPathUrlStr.startsWith("//")) {
                callPathUrlStr = callPathUrlStr.substr(1);
            }
            url = new URL(callPathUrlStr, baseUrl);
            if (this.opts.lockToBaseOrigin) {
                let baseOrigin = (new URL(baseUrl)).origin;
                if (url.origin !== baseOrigin) {
                    throw new Error(sprintf("Origin is locked to '%s'", baseOrigin));
                }
            }
            if (this.opts.forceRelativeUrls) {
                let baseUrlObj = new URL(baseUrl);
                let baseOrigin = baseUrlObj.origin;
                if (url.origin !== baseOrigin || !url.pathname.startsWith(baseUrlObj.pathname)) {
                    throw new Error(sprintf("Handler URL '%s' is not relative to '%s' (forceRelativeUrls is set)", url.toString(), baseUrl.toString()));
                }
            }
        }
        catch (e) {
            let modName = "http";
            if (req.callpath.module != "http") {
                modName = sprintf("%s[http]", req.callpath.module);
            }
            throw new Error(sprintf("Invalid URL for %s handler '%s': %s", modName, fullPath(req.callpath), e.toString()));
        }
        let fetchInit = makeFetchInit(req, url, this.opts);
        let p = fetch(url.toString(), fetchInit).catch((resp) => handleFetchFail(resp)).then((resp) => handleFetchResponse(url, resp));
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
        let val = DataCtx.evalExprAst(m[key], dataenv, "resolve");
        rtn[key] = val;
    }
    return DataCtx.demobx(rtn);
}

function getMethod(req : HibikiRequest) : string {
    let method = req.callpath.method;
    if (method != null && method != "DYN") {
        return method.toUpperCase();
    }
    let dataMethod = DataCtx.valToString(req.params.getArg("@method"));
    if (dataMethod != null) {
        return dataMethod.toUpperCase();
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
            return Promise.resolve(ide.handlers[handlerName].block);
        }
        let handler = getHibiki().LocalHandlers[req.callpath.url];
        if (handler == null) {
            throw new Error(sprintf("Local handler '%s' not found", req.callpath.url));
        }
        req.params.deepCopy({resolve: true});
        req.data = req.params.getPlainArgs();
        let rtn = handler(req);
        let p = Promise.resolve(rtn).then((rtnVal) => {
            if (rtnVal != null) {
                req.setReturn(rtnVal);
            }
            return {hibikiactions: req.actions, libContext: "main"};
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
        req.params.deepCopy({resolve: true});
        req.data = req.params.getPlainArgs();
        let rtn = handler(req);
        let p = Promise.resolve(rtn).then((rtnVal) => {
            if (rtnVal != null) {
                req.setReturn(rtnVal);
            }
            return {hibikiactions: req.actions, libContext: this.libContext};
        });
        return p;
    }
}

export {LocalModule, HttpModule, LibModule};
