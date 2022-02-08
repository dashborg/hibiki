// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as mobx from "mobx";
import {Hibiki, HandlerPathType, HibikiVal, HibikiValObj, JSFuncStr} from "./types";
import {sprintf} from "sprintf-js";
import type {HibikiBlob} from "./datactx";
import type {HibikiNode, NodeAttrType} from "./html-parser";

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
    let paramsObj : Record<string, string> = {};
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

function resolveNumber(val : any, test : (v : number) => boolean, def : number) : number {
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
    return typeof(v) === "object";
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

function smartDecodeParams(paramsStr : string) : Record<string, any> {
    let rtn : Record<string, any> = {};
    if (paramsStr == null || paramsStr == "") {
        return rtn;
    }
    let paramsObj : any = new URLSearchParams(paramsStr);
    for (let [key, val] of paramsObj.entries()) {
        if (val == null || val == "") {
            rtn[key] = null;
            continue;
        }
        let lcVal = val.toLowerCase();
        if (lcVal === "true") {
            rtn[key] = true;
            continue;
        }
        if (lcVal === "false") {
            rtn[key] = false;
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
        if (val === "") {
            return "";
        }
        let lcVal = val.toLowerCase();
        if (lcVal === "true" || lcVal === "false" || val[0] == "\"" || val[0] == "{" || val[0] == "[" || val[0] == "-" || (val[0] >= "0" && val[0] <= "9")) {
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

function unpackPositionalArgArray(data : HibikiValObj) : HibikiVal[] {
    if (data == null) {
        return [];
    }
    let posArgs = data["*args"];
    if (posArgs == null || !mobx.isArrayLike(posArgs)) {
        return [];
    }
    return posArgs;
}

function callHook(hookName : string, hookFn : JSFuncStr | Function, ...rest : any[]) : any {
    if (hookFn == null) {
        return null;
    }
    let realHookFn : Function = null;
    if (typeof(hookFn) == "function") {
        realHookFn = hookFn;
    }
    else {
        if (!isObject(hookFn) || hookFn.jsfunc == null) {
            return null;
        }
        realHookFn = window[hookFn.jsfunc];
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

function base64ToArray(b64 : string) : Uint8Array {
    let binaryStr = atob(b64);
    let arr = new Uint8Array(binaryStr.length);
    for (let i=0; i<binaryStr.length; i++) {
        arr[i] = binaryStr.charCodeAt(i);
    }
    return arr;
}

function unbox(data : any) : any {
    if (data == null) {
        return null;
    }
    if (mobx.isBoxedObservable(data)) {
        return data.get();
    }
    return data;
}

function splitTrim(s : string, splitStr : string) : string[] {
    if (s == null || s == "") {
        return [];
    }
    let parts = s.split(splitStr);
    for (let i=0; i<parts.length; i++) {
        parts[i] = parts[i].trim();
    }
    return parts;
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

function bindLibContext(node : HibikiNode, libContext : string) {
    if (node == null) {
        return;
    }
    if (node.tag != "#text") {
        node.libContext = libContext;
    }
    if (node.list == null) {
        return;
    }
    for (let subNode of node.list) {
        bindLibContext(subNode, libContext);
    }
}

function cnArrToClassAttr(cnArr : Record<string, boolean>[]) : string {
    if (cnArr == null || cnArr.length == 0) {
        return null;
    }
    let rtn : Record<string, boolean> = {};
    for (let part of cnArr) {
        if (part == null) {
            continue;
        }
        for (let key in part) {
            if (key === "hibiki-cloak" || key.startsWith("@")) {
                continue;
            }
            if (part[key]) {
                rtn[key] = true;
            }
            else {
                delete rtn[key];
            }
        }
    }
    return Object.keys(rtn).join(" ");
}

function cnArrToLosslessStr(cnArr : Record<string, boolean>[], locked? : boolean) : string {
    if (cnArr == null || cnArr.length == 0) {
        return null;
    }
    let rtn : string[] = [];
    if (locked) {
        rtn.push("@classlock");
    }
    for (let part of cnArr) {
        if (part == null) {
            continue;
        }
        for (let key in part) {
            if (key === "hibiki-cloak") {
                continue;
            }
            if (part[key]) {
                rtn.push(key);
            }
            else {
                rtn.push("!" + key);
            }
        }
    }
    return rtn.join(" ");
}

function classStringToCnArr(cstr : string) : Record<string, boolean>[] {
    if (cstr == null || cstr === "") {
        return [];
    }
    let rtn : Record<string, boolean>[] = [];
    let parts = cstr.split(/\s+/);
    for (let part of parts) {
        part = part.trim();
        if (part === "" || part === "!" || part.startsWith("@")) {
            continue;
        }
        if (part.startsWith("!")) {
            rtn.push({[part.substr(1)]: false});
        }
        else {
            rtn.push({[part]: true});
        }
    }
    return rtn;
}

function isClassStringLocked(cstr : string) : boolean {
    if (cstr == null) {
        return false;
    }
    return cstr.startsWith("@classlock");
}

function joinClassStrs(...cstrs : string[]) : string {
    if (cstrs.length == 0) {
        return null;
    }
    let rtn = cstrs[0];
    for (let i=1; i<cstrs.length; i++) {
        if (rtn == null || rtn === "") {
            rtn = cstrs[i];
        }
        else {
            rtn = rtn + " " + cstrs[i];
        }
    }
    return rtn;
}

function attrBaseName(attrName : string) : string {
    let colonIdx = attrName.indexOf(":");
    if (colonIdx === -1) {
        return attrName;
    }
    return attrName.substr(colonIdx+1);
}

function parseAttrName(attrName : string) : [string, string] {
    let colonIdx = attrName.indexOf(":");
    if (colonIdx === -1) {
        return ["self", attrName];
    }
    if (colonIdx === 0) {
        return ["root", attrName.substr(1)];
    }
    return [attrName.substr(0, colonIdx), attrName.substr(colonIdx+1)];
}

function nsAttrName(attrName : string, ns : string) : string {
    if (ns == null || ns === "self") {
        return attrName;
    }
    if (ns === "root") {
        return ":" + attrName;
    }
    return ns + ":" + attrName;
}

function urlSameOrigin(urlStr : string) {
    let url = new URL(urlStr, window.location.href);
    return url.origin == window.location.origin;
}

function validateModulePath(modName : string, hpath : HandlerPathType) {
    if (hpath.url.startsWith("http://") || hpath.url.startsWith("https://") || hpath.url.startsWith("//") || !urlSameOrigin(hpath.url)) {
        throw new Error(sprintf("Invalid %s module URL, must not specify a protocol or host: %s", modName, fullPath(hpath)));
    }
    if (!hpath.url.startsWith("/")) {
        throw new Error(sprintf("Invalid %s module URL, must not specify a relative url: %s", modName, fullPath(hpath)));
    }
}

function compareVersions(v1 : string, v2 : string) : number {
    if (v1 === v2) {
        return 0;
    }
    if (v1 === "devbuild") {
        return 1;
    }
    if (v2 === "devbuild") {
        return -1;
    }
    let match1 = v1.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (match1 == null) {
        throw new Error("Invalid Version: " + v1);
    }
    let match2 = v2.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (match2 == null) {
        throw new Error("Invalid Version: " + v2);
    }
    let m1num = parseInt(match1[1])*10000 + parseInt(match1[2])*100 + parseInt(match1[3]);
    let m2num = parseInt(match2[1])*10000 + parseInt(match2[2])*100 + parseInt(match2[3]);
    if (m1num > m2num) {
        return 1;
    }
    if (m1num < m2num) {
        return -1;
    }
    return 0;
}

export {jsonRespHandler, parseUrlParams, valToInt, valToFloat, resolveNumber, isObject, getSS, setSS, hasRole, parseDisplayStr, smartEncodeParams, smartDecodeParams, textContent, deepTextContent, SYM_PROXY, SYM_FLATTEN, evalDeepTextContent, jseval, nodeStr, unpackPositionalArgs, callHook, stripAtKeys, getHibiki, parseHandler, fullPath, smartEncodeParam, unpackArg, unpackAtArgs, base64ToArray, addToArrayDupCheck, removeFromArray, spliceCopy, valInArray, rawAttrFromNode, STYLE_UNITLESS_NUMBER, subMapKey, subArrayIndex, unbox, splitTrim, bindLibContext, unpackPositionalArgArray, cnArrToClassAttr, classStringToCnArr, isClassStringLocked, joinClassStrs, attrBaseName, cnArrToLosslessStr, parseAttrName, nsAttrName, validateModulePath, compareVersions};

