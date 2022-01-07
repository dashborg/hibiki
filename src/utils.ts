// Copyright 2021 Dashborg Inc

import * as mobx from "mobx";
import {HibikiNode, Hibiki, HandlerPathType, NodeAttrType, HibikiVal, HibikiValObj} from "./types";
import {sprintf} from "sprintf-js";
import type {HibikiBlob} from "./datactx";

declare var window : any;

const ssFeClientIdKey = "hibiki-feclientid";
const SYM_PROXY = Symbol("proxy");
const SYM_FLATTEN = Symbol("flatten");

function spliceCopy(arr : any[], ...rest : any[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return null;
    }
    let newArr = [...arr];
    // @ts-ignore
    newArr.splice(...rest);
    return newArr;
}

function addToArrayDupCheck(arr : HibikiVal, val : any) : HibikiVal[] {
    if (arr == null || !mobx.isArrayLike(arr)) {
        arr = [];
    }
    for (let i=0; i<arr.length; i++) {
        if (arr[i] == val) {
            return arr;
        }
    }
    arr.push(val);
    return arr;
}

function removeFromArray(arr : HibikiVal, val : any) : HibikiVal {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return arr;
    }
    for (let i=0; i<arr.length; i++) {
        if (arr[i] == val) {
            arr.splice(i, 1);
            return arr;
        }
    }
    return arr;
}

function valInArray(arr : HibikiVal, val : any) : boolean {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return false;
    }
    for (let i=0; i<arr.length; i++) {
        if (arr[i] == val) {
            return true;
        }
    }
    return false;
}

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

function parseUrlParams() : Record<string,string> {
    let urlParams = new URLSearchParams(window.location.search);
    let paramsObj = {};
    for (let [k, v] of (urlParams as any).entries()) {
        paramsObj[k] = v;
    }
    return paramsObj;
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

function subMapKey(v : HibikiVal, mapKey : string) : HibikiVal {
    if (v == null || !isObject(v)) {
        return null;
    }
    if (v instanceof Map || mobx.isObservableMap(v)) {
        return v.get(mapKey);
    }
    return v[mapKey];
}

function subArrayIndex(v : HibikiVal, arrIdx : number) : HibikiVal {
    if (v == null || !mobx.isArrayLike(v)) {
        return null;
    }
    let arr : HibikiVal[] = (v as HibikiVal[]);
    if (arrIdx < 0 || arr.length < arrIdx) {
        return null;
    }
    return arr[arrIdx];
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

function valToString(val : HibikiVal) : string {
    if (val == null) {
        return null;
    }
    if (typeof(val) == "string" || typeof(val) == "number" || typeof(val) == "boolean" || typeof(val) == "symbol" || typeof(val) == "bigint") {
        return val.toString();
    }
    if (typeof(val) == "function") {
        return "[Function]";
    }
    if (mobx.isArrayLike(val)) {
        return val.toString();
    }
    if ((val as any)._type === "HibikiBlob") {
        return blobPrintStr(val as HibikiBlob);
    }
    return "[Object object]";
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
        let strVal = valToString(val);
        if (!first) {
            urlparams = urlparams + "&";
        }
        first = false;
        urlparams += encodeURIComponent(key) + "=" + encodeURIComponent(strVal);
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

function smartEncodeParam(val : any, isRaw? : boolean) : string {
    if (val == null) {
        return null;
    }
    if (isRaw) {
        return String(val);
    }
    if (typeof(val) == "string") {
        if (val == "") {
            return "";
        }
        if (val[0] == "\"" || val[0] == "{" || val[0] == "[" || val[0] == "-" || (val[0] >= "0" && val[0] <= "9")) {
            return JSON.stringify(val);
        }
        return val;
    }
    if (typeof(val) == "number") {
        return String(val);
    }
    return JSON.stringify(val);
}

function smartEncodeParams(paramsObj : {[e : string] : any}) : string {
    let usp = new URLSearchParams();
    if (paramsObj == null) {
        return "";
    }
    for (let key in paramsObj) {
        let val = paramsObj[key];
        if (val == null) {
            usp.delete(key);
            continue;
        }
        try {
            let encVal = smartEncodeParam(val);
            usp.set(key, val);
        }
        catch(e) {
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
    let format = rawAttrFromNode(node, "format");
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

function rawAttrFromNode(node : HibikiNode, attrName : string) : string {
    if (node == null || node.attrs == null) {
        return null;
    }
    return rawAttrStr(node.attrs[attrName]);
}

function rawAttrStr(attr : NodeAttrType) : string {
    if (attr == null) {
        return null;
    }
    if (typeof(attr) == "string") {
        return attr;
    }
    return attr.sourcestr;
}

function nodeStr(node : HibikiNode) : string {
    let extraStr = "";
    if (node.attrs != null && node.attrs.component != null) {
        extraStr += " component=" + node.attrs.component;
    }
    if (node.attrs != null && node.attrs.name != null) {
        extraStr += " name=" + node.attrs.name;
    }
    return "<" + node.tag + extraStr + ">";
}

function unpackArg(data : Record<string, any>, argName : string, pos? : number) : any {
    if (data == null) {
        return null;
    }
    if (argName != null) {
        if (argName in data) {
            return data[argName];
        }
    }
    if (pos == null) {
        return null;
    }
    let posArgs = data["*args"];
    if (posArgs == null || posArgs.length <= pos) {
        return null;
    }
    return posArgs[pos];
}

function unpackAtArgs(data : Record<string, any>) : Record<string, any> {
    if (data == null) {
        return {};
    }
    let rtn : Record<string, any> = {};
    for (let key in data) {
        if (key.startsWith("@")) {
            rtn[key.substr(1)] = data[key];
        }
    }
    return rtn;
}


function unpackPositionalArgs(data : HibikiValObj, posArgNames : string[]) : HibikiValObj {
    if (data == null) {
        return {};
    }
    let posArgs = data["*args"];
    if (posArgs == null || !mobx.isArrayLike(posArgs) || posArgs.length == 0 || posArgNames == null || posArgNames.length == 0) {
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

function stripAtKeys(obj : HibikiValObj) : HibikiValObj {
    if (obj == null) {
        return null;
    }
    let rtn : HibikiValObj = {};
    for (let key in obj) {
        if (key.startsWith("@")) {
            continue;
        }
        rtn[key] = obj[key];
    }
    return rtn;
}

function fullPath(hpath : HandlerPathType) : string {
    if (hpath == null) {
        return null;
    }
    let method = hpath.method ?? "DYN";
    if (hpath.module == "http") {
        if (method == "DYN" && (hpath.url.startsWith("http") || hpath.url.startsWith("//"))) {
            return hpath.url;
        }
        return method + " " + hpath.url;
    }
    else {
        let url = (hpath.url == null || hpath.url == "/" ? "" : hpath.url);
        if (!url.startsWith("/")) {
            url = ":" + url;
        }
        if (method == "DYN") {
            return "//@" + hpath.module + url;;
        }
        return method + " " + "//@" + hpath.module + url;
    }
}

function parseHandler(handlerPath : string) : HandlerPathType {
    if (handlerPath == null || handlerPath == "") {
        throw new Error("Invalid handler path, cannot be null or empty");
    }
    let methodMatch = handlerPath.match("^(GET|POST|PUT|PATCH|DELETE|DYN)\\s*");
    let method = null;
    if (methodMatch != null) {
        handlerPath = handlerPath.substr(methodMatch[0].length);
        if (method != "DYN") {
            method = methodMatch[1];
        }
    }
    let testUrl : URL = null;
    if (handlerPath.startsWith("//@")) {
        let okModule = handlerPath.match("^//@([a-zA-Z_][a-zA-Z0-9_-]*)(/|:|$)");
        if (okModule == null) {
            throw new Error("Invalid handler path, bad module name: " + handlerPath);
        }
        let match = handlerPath.match("^//@([a-zA-Z_][a-zA-Z0-9_-]*)(/.*)?$");
        if (match == null) {
            match = handlerPath.match("^//@([a-zA-Z_][a-zA-Z0-9_-]*):(.*)$")
        }
        if (match == null) {
            throw new Error("Invalid handler path, bad module URL format: " + handlerPath);
        }
        let urlStr = (match[2] ?? "/");
        try {
            testUrl = new URL(urlStr, window.location.href);
        }
        catch (e) {
            throw new Error("Invalid handler path, bad module URL: " + handlerPath);
        }
        if (testUrl.protocol != "http:" && testUrl.protocol != "https:") {
            throw new Error("Invalid handler path, invalid protocol: " + handlerPath);
        }
        return {module: match[1], url: urlStr, method: method};
    }
    try {
        testUrl = new URL(handlerPath, window.location.href);
    }
    catch (e) {
        throw new Error("Invalid handler path, bad URL: " + handlerPath);
    }
    if (testUrl.protocol != "http:" && testUrl.protocol != "https:") {
        throw new Error("Invalid handler path, invalid protocol: " + handlerPath);
    }
    return {module: "http", url: handlerPath, method: method};
}

function getHibiki() : Hibiki {
    return (window as any).Hibiki;
}

function blobPrintStr(blob : Blob | HibikiBlob) : string {
    if (blob == null) {
        return null;
    }
    if (isObject(blob) && (blob as any)._type == "HibikiBlob") {
        let hblob : HibikiBlob = (blob as any);
        let bloblen = 0;
        if (hblob.data != null) {
            bloblen = hblob.data.length;
        }
        if (hblob.name != null) {
            return sprintf("[hibikiblob type=%s, len=%s, name=%s]", hblob.mimetype, Math.ceil((bloblen/4)*3), hblob.name);
        }
        return sprintf("[hibikiblob type=%s, len=%s]", hblob.mimetype, Math.ceil((bloblen/4)*3))
    }
    if (blob instanceof File && blob.name != null) {
        sprintf("[jsblob type=%s, len=%s, name=%s]", blob.type, blob.size, blob.name);
    }
    if (blob instanceof Blob) {
        return sprintf("[jsblob type=%s, len=%s]", blob.type, blob.size);
    }
    return null;
}

function base64ToArray(b64 : string) : Uint8Array {
    let binaryStr = atob(b64);
    let arr = new Uint8Array(binaryStr.length);
    for (let i=0; i<binaryStr.length; i++) {
        arr[i] = binaryStr.charCodeAt(i);
    }
    return arr;
}

function unbox(data : any) : any {
    if (mobx.isBoxedObservable(data)) {
        return data.get();
    }
    return data;
}

const STYLE_UNITLESS_NUMBER = { // from react
    "animation-iteration-count": true,
    "border-image-outset": true,
    "border-image-slice": true,
    "border-image-width": true,
    "box-flex": true,
    "box-flex-group": true,
    "box-ordinal-group": true,
    "column-count": true,
    columns: true,
    flex: true,
    "flex-grow": true,
    "flex-positive": true,
    "flex-shrink": true,
    "flex-negative": true,
    "flex-order": true,
    "grid-row": true,
    "grid-row-end": true,
    "grid-row-span": true,
    "grid-row-start": true,
    "grid-column": true,
    "grid-column-end": true,
    "grid-column-span": true,
    "grid-column-start": true,
    "font-weight": true,
    "line-clamp": true,
    "line-height": true,
    opacity: true,
    order: true,
    orphans: true,
    tabsize: true,
    widows: true,
    "z-index": true,
    zoom: true,
    
    // svg-related properties
    "fill-opacity": true,
    "flood-opacity": true,
    "stop-opacity": true,
    "stroke-dasharray": true,
    "stroke-dashoffset": true,
    "stroke-miterlimit": true,
    "stroke-opacity": true,
    "stroke-width": true,
};

const STYLE_KEY_MAP = {
    "bold": {key: "fontWeight", val: "bold"},
    "italic": {key: "fontStyle", val: "italic"},
    "underline": {key: "textDecoration", val: "underline"},
    "strike": {key: "textDecoration", val: "line-through"},
    "pre": {key: "whiteSpace", val: "pre"},
    "fixedfont": {key: "fontFamily", val: "\"courier new\", fixed"},
    "grow": {key: "flex", val: "1 0 0"},
    "noshrink": {key: "flexShrink", val: "0"},
    "shrink": {key: "flexShrink", val: "1"},
    "scroll": {key: "overflow", val: "scroll"},
    "center": {flex: true, key: "justifyContent", val: "center"},
    "xcenter": {flex: true, key: "alignItems", val: "center"},
    "fullcenter": {flex: true},
};

export {jsonRespHandler, parseUrlParams, valToString, valToInt, valToFloat, resolveNumber, isObject, getSS, setSS, makeUrlParamsFromObject, hasRole, parseDisplayStr, smartEncodeParams, smartDecodeParams, textContent, deepTextContent, SYM_PROXY, SYM_FLATTEN, evalDeepTextContent, jseval, nodeStr, unpackPositionalArgs, callHook, stripAtKeys, getHibiki, parseHandler, fullPath, smartEncodeParam, unpackArg, unpackAtArgs, blobPrintStr, base64ToArray, addToArrayDupCheck, removeFromArray, spliceCopy, valInArray, rawAttrFromNode, STYLE_UNITLESS_NUMBER, STYLE_KEY_MAP, subMapKey, subArrayIndex, unbox};

