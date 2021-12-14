// Copyright 2021 Dashborg Inc

import * as mobx from "mobx";
import {HibikiNode, Hibiki, HandlerPathType} from "./types";
import {sprintf} from "sprintf-js";

declare var window : any;

const ssFeClientIdKey = "hibiki-feclientid";
const SYM_PROXY = Symbol("proxy");
const SYM_FLATTEN = Symbol("flatten");

function jsonRespHandler(resp) {
    if (!resp.data) {
        throw new Error("No Data Returned");
    }
    if (resp.data && resp.data.error) {
        throw new Error(resp.data.error);
    }
    if (!resp.data.success) {
        throw new Error("Internal Error");
    }
    return resp.data;
}

function parseUrlParams() : any {
    let urlParams = new URLSearchParams(window.location.search);
    let paramsObj = {};
    for (let [k, v] of (urlParams as any).entries()) {
        paramsObj[k] = v;
    }
    return paramsObj;
}

function valToString(val : any) : string {
    if (val == null) {
        return "";
    }
    return val.toString();
}

function valToInt(val : any, def : number) : number {
    if (val == null) {
        return def;
    }
    let ival = parseInt(val);
    if (isNaN(ival)) {
        return def;
    }
    return ival;
}

function valToFloat(val : any, def : number) : number {
    if (val == null) {
        return def;
    }
    let ival = parseFloat(val);
    if (isNaN(ival)) {
        return def;
    }
    return ival;
}

function resolveNumber(val : any, test : (number) => boolean, def : number) : number {
    if (val == null) {
        return def;
    }
    val = parseInt(val);
    if (isNaN(val)) {
        return def;
    }
    if (!test(val)) {
        return def;
    }
    return val;
}

function isObject(v : any) : boolean {
    if (v == null) {
        return false;
    }
    if (mobx.isArrayLike(v)) {
        return false;
    }
    return typeof(v) == "object";
}

function setSS(key : string, val : any) {
    try {
        let sto = window.sessionStorage;
        if (val == null) {
            sto.removeItem(key);
        }
        else {
            sto.setItem(key, JSON.stringify(val));
        }
    }
    catch(e) {
        console.log("SessionStorage set error", e);
    }
}

function getSS(key : string) : any {
    try {
        let sto = window.sessionStorage;
        let jval = sto.getItem(key);
        return JSON.parse(jval);
    }
    catch(e) {
        console.log("SessionStorage get error", e);
        return null;
    }
}

function makeUrlParamsFromObject(params : any) : string {
    let urlparams = "";
    if (params == null || !isObject(params)) {
        return "";
    }
    urlparams = "?";
    let first = true;
    for (let key in params) {
        let val = params[key];
        if (val == null) {
            continue;
        }
        let strVal = val.toString();
        if (!first) {
            urlparams = urlparams + "&";
        }
        first = false;
        urlparams += encodeURIComponent(key) + "=" + encodeURIComponent(val);
    }
    if (urlparams == "?") {
        return "";
    }
    return urlparams;
}

function hasRole(roleList : string[], role : string) : boolean {
    if (roleList == null) {
        return false;
    }
    for (let i=0; i<roleList.length; i++) {
        if (roleList[i] == role) {
            return true;
        }
    }
    return false;
}

function parseDisplayStr(displayStr : string) : {path : string, pagename : string} {
    let fields = displayStr.split("|");
    if (fields.length != 1 && fields.length != 2) {
        return null;
    }
    if (fields.length == 1) {
        let f1 = fields[0].trim();
        if (f1.startsWith("/")) {
            return {path: f1, pagename: "default"};
        }
        return {path: null, pagename: f1};
    }
    let path = fields[0].trim();
    if (!path.startsWith("/")) {
        return null;
    }
    let pagename = fields[1].trim();
    return {path, pagename};
}

function smartDecodeParams(paramsStr : string) : {[e : string] : any} {
    let rtn = {};
    if (paramsStr == null || paramsStr == "") {
        return rtn;
    }
    let paramsObj : any = new URLSearchParams(paramsStr);
    for (let [key, val] of paramsObj.entries()) {
        if (val == null || val == "") {
            rtn[key] = null;
            continue;
        }
        if ((val[0] == "-" || val[0] == "+" || (val[0] >= "0" && val[0] <= "9")) && (val.match(/^[+-]?\d+(\.\d+)?$/))) {
            let ival = parseFloat(val);
            if (!isNaN(ival)) {
                rtn[key] = ival;
            }
            continue;
        }
        if (val[0] != "\"" && val[0] != "{" && val[0] != "[") {
            rtn[key] = val;
            continue;
        }
        try {
            rtn[key] = JSON.parse(val);
        }
        catch(e) {
            continue;
        }
    }
    return rtn;
}

function smartEncodeParams(paramsObj : {[e : string] : any}) : string {
    let usp = new URLSearchParams();
    if (paramsObj == null) {
        return "";
    }
    for (let key in paramsObj) {
        let val = paramsObj[key];
        if (typeof(val) == "string") {
            if (val == "") {
                usp.set(key, "");
                continue;
            }
            if (val[0] == "\"" || val[0] == "{" || val[0] == "[" || val[0] == "-" || (val[0] >= "0" && val[0] <= "9")) {
                usp.set(key, JSON.stringify(val));
                continue;
            }
            usp.set(key, val);
            continue;
        }
        if (typeof(val) == "number") {
            usp.set(key, String(val));
            continue;
        }
        try {
            usp.set(key, JSON.stringify(val));
        }
        catch (e) {
            continue;
        }
    }
    return usp.toString();
}

function textContent(node : HibikiNode) : string {
    if (node == null || node.list == null) {
        return "";
    }
    let rtn = "";
    for (let sn of node.list) {
        if (sn.tag == "#text") {
            rtn += sn.text;
        }
    }
    return rtn;
}

function deepTextContent(node : HibikiNode) : string {
    if (node.tag == "#text") {
        return node.text;
    }
    if (node == null || node.list == null) {
        return "";
    }
    let rtn = "";
    for (let sn of node.list) {
        let sntext = deepTextContent(sn);
        rtn = rtn + sntext;
    }
    return rtn;
}

function jseval(text : string) : any {
    let evalVal = eval("(" + text + ")");
    if (typeof(evalVal) == "function") {
        evalVal = evalVal();
    }
    return evalVal;
}

function evalDeepTextContent(node : HibikiNode, throwError : boolean) : any {
    let text = deepTextContent(node).trim();
    if (text == "") {
        return null;
    }
    let format = rawAttr(node, "format");
    try {
        if (format == null || format == "json") {
            return JSON.parse(text);
        }
        else if (format == "jseval") {
            return jseval(text);
        }
        else {
            if (throwError) {
                throw new Error("Invalid 'format' attribute, must be 'json', 'jseval'");
            }
            return null;
        }
    }
    catch (e) {
        if (throwError) {
            throw e;
        }
        return null;
    }
}

function rawAttr(node : HibikiNode, attrName : string) : string {
    if (node == null || node.attrs == null) {
        return null;
    }
    return node.attrs[attrName];
}

function nodeStr(node : HibikiNode) : string {
    if (node.attrs != null && node.attrs.name != null) {
        return "<" + node.tag + " " + node.attrs.name + ">";
    }
    return "<" + node.tag + ">";
}

function unpackPositionalArgs(data : Record<string, any>, posArgNames : string[]) : Record<string, any> {
    if (data == null) {
        return {};
    }
    let posArgs = data["*args"];
    if (posArgs == null || posArgs.length == 0 || posArgNames == null || posArgNames.length == 0) {
        return data;
    }
    let rtn = {...data};
    for (let i=0; i<posArgs.length && i<posArgNames.length; i++) {
        if (rtn[posArgNames[i]] == null) {
            rtn[posArgNames[i]] = posArgs[i];
        }
    }
    return rtn;
}

function callHook(hookName : string, hookFn : string | Function, ...rest : any[]) : any {
    if (hookFn == null || hookFn == "") {
        return null;
    }
    let realHookFn : Function = null;
    if (typeof(hookFn) == "function") {
        realHookFn = hookFn;
    }
    else {
        realHookFn = window[hookFn];
        if (realHookFn == null || typeof(realHookFn) != "function") {
            console.log(sprintf("Hibiki hook[%s], function '%s' could not be resolved", hookName, hookFn));
            return null;
        }
    }
    return realHookFn(...rest);
}

function stripAtKeys(obj : Record<string, any>) : Record<string, any> {
    if (obj == null) {
        return null;
    }
    let rtn : Record<string, any> = {};
    for (let key in obj) {
        if (key.startsWith("@")) {
            continue;
        }
        rtn[key] = obj[key];
    }
    return rtn;
}

function parseHandler(handlerPath : string) : HandlerPathType {
    if (handlerPath == null || handlerPath == "" || handlerPath[0] != '/') {
        return null;
    }
    let match = handlerPath.match("^(?:/@([a-zA-Z_][a-zA-Z0-9_-]*))?(/[a-zA-Z0-9._/-]*)?(?:[:](@?[a-zA-Z][a-zA-Z0-9_-]*))?$")
    if (match == null) {
        return null;
    }
    return {fullpath: handlerPath, module: (match[1] ?? ""), path: (match[2] ?? "/"), pathfrag: (match[3] ?? "")};
}

function getHibiki() : Hibiki {
    return (window as any).Hibiki;
}

export {jsonRespHandler, parseUrlParams, valToString, valToInt, valToFloat, resolveNumber, isObject, getSS, setSS, makeUrlParamsFromObject, hasRole, parseDisplayStr, smartEncodeParams, smartDecodeParams, textContent, deepTextContent, SYM_PROXY, SYM_FLATTEN, rawAttr, evalDeepTextContent, jseval, nodeStr, unpackPositionalArgs, callHook, stripAtKeys, getHibiki, parseHandler};

