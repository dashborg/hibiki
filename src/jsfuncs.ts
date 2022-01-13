// Copyright 2021-2022 Dashborg Inc

import * as mobx from "mobx";
import type {JSFuncType} from "./types";
import {sprintf} from "sprintf-js";
import {isObject, addToArrayDupCheck, removeFromArray} from "./utils";
import {v4 as uuidv4} from 'uuid';

let DefaultJSFuncs : Record<string, JSFuncType> = {};

function jsLen(v : any) : number {
    if (v == null) {
        return 0;
    }
    if (typeof(v) == "string" || mobx.isArrayLike(v)) {
        return v.length;
    }
    if (typeof(v) == "object") {
        return Object.keys(v).length;
    }
    return 1;
}

function jsIndexOf(str : string, ...rest : any[]) {
    if (str == null) {
        return -1;
    }
    // @ts-ignore
    return str.indexOf(...rest);
}

function jsMin(...rest : any[]) {
    if (rest == null || rest.length == 0) {
        return 0;
    }
    let rtn = rest[0] ?? 0;
    for (let i=1; i<rest.length; i++) {
        let v = rest[i] ?? 0;
        if (v < rtn) {
            rtn = v;
        }
    }
    return rtn;
}

function jsMax(...rest : any[]) {
    if (rest == null || rest.length == 0) {
        return 0;
    }
    let rtn = rest[0] ?? 0;
    for (let i=1; i<rest.length; i++) {
        let v = rest[i] ?? 0;
        if (v > rtn) {
            rtn = v;
        }
    }
    return rtn;
}

function jsSplice(arr : any[], ...rest : any[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return null;
    }
    let newArr = [...arr];
    // @ts-ignore
    newArr.splice(...rest);
    return newArr;
}

function jsSlice(arr : any[], ...rest : any[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return null;
    }
    return arr.slice(...rest);
}

function jsPush(arr : any[], ...rest : any[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return [...rest];
    }
    let rtn = [...arr, ...rest];
    return rtn;
}

function jsPop(arr : any[], ...rest : any[]) {
    if (arr == null) {
        return [];
    }
    else if (!mobx.isArrayLike(arr)) {
        return [];
    }
    let rtn = [...arr];
    rtn.pop();
    return rtn;
}

function jsSetAdd(arr : any[], ...rest : any[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        arr = [];
    }
    let rtn = [...arr];
    for (let i=0; i<rest.length; i++) {
        addToArrayDupCheck(rtn, rest[i]);
    }
    return rtn;
}

function jsSetRemove(arr : any[], ...rest : any[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return [];
    }
    let rtn = [...arr];
    for (let i=0; i<rest.length; i++) {
        removeFromArray(rtn, rest[i]);
    }
    return rtn;
}

function jsSetHas(arr : any[], item : any) : boolean {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return false;
    }
    for (let i=0; i<arr.length; i++) {
        if (arr[i] == item) {
            return true;
        }
    }
    return false;
}

function jsInt(v : any) : number {
    return parseInt(v);
}

function jsFloat(v : any) : number {
    return parseFloat(v);
}

function jsStr(v : any) : string {
    return String(v);
}

function jsBool(v : any) : boolean {
    return !!v;
}

function jsJsonParse(v : string) : any {
    if (v == null || v == "") {
        return null;
    }
    return JSON.parse(v);
}

function jsJson(v : any, ...rest : any[]) : string {
    return JSON.stringify(v, ...rest);
}

function jsSplit(str : string, ...rest : any[]) : string[] {
    if (str == null) {
        return null;
    }
    // @ts-ignore
    return String(str).split(...rest);
}

function jsNow() : number {
    return Date.now();
}

function jsMerge(...vals : any[]) : any {
    if (vals == null || vals.length == 0) {
        return null;
    }
    let rtn = null;
    if (isObject(vals[0])) {
        rtn = vals[0];
    }
    for (let i=1; i<vals.length; i++) {
        let v = vals[i];
        if (v != null && isObject(v)) {
            rtn = {...rtn, ...v};
        }
    }
    return rtn;
}

function jsEval(jsexpr : string) : any {
    if (jsexpr == null) {
        return null;
    }
    let evalVal = eval("(" + jsexpr + ")");
    if (typeof(evalVal) == "function") {
        evalVal = evalVal();
    }
    return evalVal;
}

function jsJs(fnName : string, ...rest : any[]) : any {
    if (typeof(fnName) != "string") {
        throw new Error("fn:js first argument must be a string (the function to call)");
    }
    let val = window[fnName];
    if (typeof(val) == "function") {
        return val(...rest);
    }
    return val;
}

function jsSubstr(str : string, ...rest : any[]) : string {
    if (str == null) {
        return null;
    }
    if (typeof(str) != "string") {
        str = String(str);
    }
    // @ts-ignore
    return str.substr(...rest);
}

function jsSprintf(format : string, ...rest : any[]) : string {
    if (format == null) {
        return null;
    }
    if (typeof(format) != "string") {
        throw new Error("fn:sprintf first argument must be a string");
    }
    return sprintf(format, ...rest);
}

function jsTrim(str : string) : string {
    if (typeof(str) !== "string") {
        return null;
    }
    return str.trim();
}

function jsStartsWith(str : string, ...rest : any[]) : boolean {
    if (str == null || typeof(str) != "string") {
        return false;
    }
    // @ts-ignore
    return str.startsWith(...rest);
}

function jsEndsWith(str : string, ...rest : any[]) : boolean {
    if (str == null || typeof(str) != "string") {
        return false;
    }
    // @ts-ignore
    return str.endsWith(...rest);
}

function jsMatch(str : string, regex : string | RegExp, ...rest : any[]) : any {
    if (str == null || regex == null) {
        return null;
    }
    if (typeof(regex) != "string" && !(regex instanceof RegExp)) {
        throw new Error("fn:match 2nd argument must be a regexp");
    }
    let re : RegExp = null;
    if (typeof(regex) == "string") {
        re = new RegExp(regex, ...rest);
    }
    else {
        re = regex;
    }
    return str.match(re);
}

function jsBlobAsText(blob : any) : string {
    if (blob == null || !isObject(blob) || blob._type != "HibikiBlob") {
        return null;
    }
    if (!blob.mimetype.startsWith("text/")) {
        return null;
    }
    return atob(blob.data);
}

function jsBlobAsBase64(blob : any) : string {
    if (blob == null || !isObject(blob) || blob._type != "HibikiBlob") {
        return null;
    }
    return blob.data;
}

function jsBlobMimeType(blob : any) : string {
    if (blob == null || !isObject(blob) || blob._type != "HibikiBlob") {
        return null;
    }
    return blob.mimetype;
}

function jsBlobLen(blob : any) : number {
    if (blob == null || !isObject(blob) || blob._type != "HibikiBlob") {
        return null;
    }
    let bloblen = 0;
    if (blob.data != null) {
        bloblen = blob.data.length;
    }
    return Math.ceil((bloblen/4)*3);
}

function jsBlobName(blob : any) : string {
    if (blob == null) {
        return null;
    }
    if (isObject(blob) && blob._type == "HibikiBlob") {
        return blob.name;
    }
    return null;
}

function jsUuid() : string {
    return uuidv4();
}

reg("len", jsLen, true);
reg("indexof", jsIndexOf, true);
reg("min", jsMin, false);
reg("max", jsMax, false);
reg("splice", jsSplice, true);
reg("slice", jsSlice, true);
reg("push", jsPush, true);
reg("pop", jsPop, true);
reg("setadd", jsSetAdd, true);
reg("setremove", jsSetRemove, true);
reg("sethas", jsSetHas, true);
reg("int", jsInt, true);
reg("float", jsFloat, true);
reg("str", jsStr, true);
reg("bool", jsBool, true);
reg("jsonparse", jsJsonParse, true);
reg("json", jsJson, true);
reg("split", jsSplit, true);
reg("now", jsNow, true);
reg("ts",  jsNow, true);
reg("merge", jsMerge, true);
reg("jseval", jsEval, true);
reg("js", jsJs, false);
reg("substr", jsSubstr, true);
reg("sprintf", jsSprintf, true);
reg("trim", jsTrim, true);
reg("startswith", jsStartsWith, true);
reg("endswith", jsEndsWith, true);
reg("match", jsMatch, true);
reg("blobastext", jsBlobAsText, true);
reg("blobasbase64", jsBlobAsBase64, true);
reg("blobmimetype", jsBlobMimeType, true);
reg("bloblen", jsBlobLen, true);
reg("blobname", jsBlobName, true);
reg("uuid", jsUuid, true);

function reg(name : string, fn : any, native : boolean) {
    DefaultJSFuncs[name] = {fn, native};
}

export {DefaultJSFuncs};
