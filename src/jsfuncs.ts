// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as mobx from "mobx";
import type {JSFuncType, HibikiVal, HibikiValObj} from "./types";
import {sprintf} from "sprintf-js";
import {isObject, addToArrayDupCheck, removeFromArray, unpackArg, unpackPositionalArgArray} from "./utils";
import {v4 as uuidv4} from 'uuid';
import * as DataCtx from "./datactx";
import type {DataEnvironment} from "./state";

let DefaultJSFuncs : Record<string, JSFuncType> = {};

function jsLen(v : HibikiVal) : number {
    if (v == null || v === DataCtx.SYM_NOATTR) {
        return 0;
    }
    if (typeof(v) === "string" || mobx.isArrayLike(v)) {
        return v.length;
    }
    let [objVal, isObj] = DataCtx.asPlainObject(v, false);
    if (isObj) {
        return Object.keys(objVal).length;
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

function jsMin(...rest : HibikiVal[]) : number {
    if (rest == null || rest.length == 0) {
        return 0;
    }
    let rtn : number = DataCtx.valToNumber(rest[0]) ?? 0;
    for (let i=1; i<rest.length; i++) {
        let v = DataCtx.valToNumber(rest[i]) ?? 0;
        if (v < rtn) {
            rtn = v;
        }
    }
    return rtn;
}

function jsMax(...rest : HibikiVal[]) : number {
    if (rest == null || rest.length == 0) {
        return 0;
    }
    let rtn : number = DataCtx.valToNumber(rest[0]) ?? 0;
    for (let i=1; i<rest.length; i++) {
        let v = DataCtx.valToNumber(rest[i]) ?? 0;
        if (v > rtn) {
            rtn = v;
        }
    }
    return rtn;
}

function jsFloor(v : HibikiVal) : number {
    return Math.floor(DataCtx.valToNumber(v));
}

function jsCeil(v : HibikiVal) : number {
    return Math.ceil(DataCtx.valToNumber(v));
}

function jsSplice(val : HibikiVal, ...rest : any[]) {
    let [arrObj, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    let newArr = [...arrObj];
    // @ts-ignore
    newArr.splice(...rest);
    return newArr;
}

function jsSlice(params : HibikiValObj) : HibikiVal[] {
    let [rawVal, startVal, endVal] = unpackPositionalArgArray(params);
    let val = DataCtx.resolveLValue(rawVal);
    let [arrVal, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    let startIdx = ((startVal == null || startVal === DataCtx.SYM_NOATTR) ? undefined : DataCtx.valToNumber(startVal));
    let endIdx = ((endVal == null || endVal === DataCtx.SYM_NOATTR)  ? undefined : DataCtx.valToNumber(endVal));
    if ((startIdx != null && isNaN(startIdx)) || (endIdx != null && isNaN(endIdx))) {
        throw new Error("Invalid start/end arguments to fn:slice, must be numeric (not NaN)");
    }
    let makeRefs = DataCtx.valToBool(unpackArg(params, "makerefs"));
    if (makeRefs && !(rawVal instanceof DataCtx.LValue)) {
        console.log("WARNING fn:slice makerefs=true, but data is not a reference");
    }
    if (!makeRefs || !(rawVal instanceof DataCtx.LValue)) {
        return arrVal.slice(startIdx, endIdx);
    }
    let rawLv = rawVal as DataCtx.LValue;
    let indexArr = arrVal.map((_, idx) => idx);
    let slicedIndexArr = indexArr.slice(startIdx, endIdx);
    return slicedIndexArr.map((idx) => rawLv.subArrayIndex(idx));
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

function jsInt(v : HibikiVal) : number {
    let rtn = DataCtx.valToNumber(v);
    // @ts-ignore - javascript allows an number to be passed to parseInt
    return parseInt(rtn);
}

function jsFloat(v : HibikiVal) : number {
    return DataCtx.valToNumber(v);
}

function jsStr(v : HibikiVal) : string {
    return DataCtx.valToString(v);
}

function jsBool(v : HibikiVal) : boolean {
    return DataCtx.valToBool(v);
}

function jsJsonParse(v : string) : any {
    if (v == null || v === "" || typeof(v) !== "string") {
        return null;
    }
    return JSON.parse(v);
}

function jsJson(v : HibikiVal, ...rest : any[]) : string {
    return JSON.stringify(v, ...rest);
}

function jsSplit(str : HibikiVal, ...rest : any[]) : string[] {
    if (str == null) {
        return null;
    }
    let strVal = DataCtx.valToString(str);
    // @ts-ignore
    return strVal.split(...rest);
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
    if (jsexpr == null || typeof(jsexpr) !== "string") {
        return null;
    }
    let evalVal = eval("(" + jsexpr + ")");
    if (typeof(evalVal) === "function") {
        evalVal = evalVal();
    }
    return evalVal;
}

function jsJs(fnName : string, ...rest : any[]) : any {
    if (typeof(fnName) !== "string") {
        throw new Error("fn:js first argument must be a string (the function to call)");
    }
    let val = window[fnName];
    if (typeof(val) === "function") {
        return val(...rest);
    }
    return val;
}

function jsSubstr(v : HibikiVal, ...rest : any[]) : string {
    let str = DataCtx.valToString(v);
    if (str == null) {
        return null;
    }
    // @ts-ignore
    return str.substr(...rest);
}

function jsUpperCase(val : HibikiVal) : string {
    let str = DataCtx.valToString(val);
    if (str == null) {
        return null;
    }
    return str.toUpperCase();
}

function jsLowerCase(val : HibikiVal) : string {
    let str = DataCtx.valToString(val);
    if (str == null) {
        return null;
    }
    return str.toLowerCase();
}

function jsSprintf(format : HibikiVal, ...rest : any[]) : string {
    if (format == null) {
        return null;
    }
    if (typeof(format) !== "string") {
        throw new Error("fn:sprintf first argument must be a string");
    }
    return sprintf(format, ...rest);
}

function jsTrim(str : HibikiVal) : string {
    if (typeof(str) !== "string") {
        return null;
    }
    return str.trim();
}

function jsStartsWith(str : HibikiVal, ...rest : any[]) : boolean {
    if (str == null || typeof(str) !== "string") {
        return false;
    }
    // @ts-ignore
    return str.startsWith(...rest);
}

function jsEndsWith(str : HibikiVal, ...rest : any[]) : boolean {
    if (str == null || typeof(str) !== "string") {
        return false;
    }
    // @ts-ignore
    return str.endsWith(...rest);
}

function jsMatch(str : HibikiVal, regex : string | RegExp, ...rest : any[]) : any {
    if (str == null || regex == null) {
        return null;
    }
    if (typeof(str) !== "string") {
        throw new Error("fn:match 1st argument must be a string");
    }
    if (typeof(regex) !== "string" && !(regex instanceof RegExp)) {
        throw new Error("fn:match 2nd argument must be a regexp");
    }
    let re : RegExp = null;
    if (typeof(regex) === "string") {
        re = new RegExp(regex, ...rest);
    }
    else {
        re = regex;
    }
    return str.match(re);
}

function jsBlobAsText(blob : any) : string {
    if (blob == null || !isObject(blob) || blob._type !== "HibikiBlob") {
        return null;
    }
    if (!blob.mimetype.startsWith("text/")) {
        return null;
    }
    return atob(blob.data);
}

function jsBlobAsBase64(blob : any) : string {
    if (blob == null || !isObject(blob) || blob._type !== "HibikiBlob") {
        return null;
    }
    return blob.data;
}

function jsBlobMimeType(blob : any) : string {
    if (blob == null || !isObject(blob) || blob._type !== "HibikiBlob") {
        return null;
    }
    return blob.mimetype;
}

function jsBlobLen(blob : any) : number {
    if (blob == null || !isObject(blob) || blob._type !== "HibikiBlob") {
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
    if (isObject(blob) && blob._type === "HibikiBlob") {
        return blob.name;
    }
    return null;
}

function jsUuid() : string {
    return uuidv4();
}

function jsTypeOf(val : HibikiVal) : string {
    return DataCtx.hibikiTypeOf(val);
}

function jsDeepEqual(val1 : HibikiVal, val2 : HibikiVal) : boolean {
    return DataCtx.DeepEqual(val1, val2);
}

function jsDeepCopy(val : HibikiVal) : HibikiVal {
    return DataCtx.DeepCopy(val, {resolve: true});
}

function extractCompareOpts(params : HibikiValObj) : DataCtx.CompareOpts {
    if (params == null) {
        return {};
    }
    let {locale, "type": sortType, sensitivity, nocase, field, index} = params;
    let opts : DataCtx.CompareOpts = {};
    if (locale != null) {
        opts.locale = DataCtx.valToString(locale);
    }
    if (field != null) {
        opts.field = DataCtx.valToString(field);
    }
    if (sensitivity != null) {
        opts.sensitivity = DataCtx.valToString(sensitivity);
    }
    if (index != null) {
        opts.index = DataCtx.valToNumber(index);
    }
    if (nocase != null) {
        opts.nocase = DataCtx.valToBool(nocase);
    }
    if (sortType != null) {
        let sortStr = DataCtx.valToString(sortType);
        if (sortStr === "numeric" || sortStr === "string") {
            opts.sortType = sortStr;
        }
    }
    return opts;
}

function jsCompare(params : HibikiValObj) : number {
    let args = unpackPositionalArgArray(params);
    let compareOpts = extractCompareOpts(params);
    let v1 = (args.length >= 1 ? args[0] : null);
    let v2 = (args.length >= 2 ? args[1] : null);
    return DataCtx.compareVals(v1, v2, compareOpts);
}

function jsSort(params : HibikiValObj, dataenv : DataEnvironment) : HibikiVal[] {
    let rawData = unpackArg(params, "data", 0);
    let data = DataCtx.resolveLValue(rawData);
    if (data == null) {
        return null;
    }
    let [arrData, isArr] = DataCtx.asArray(data, false);
    if (!isArr) {
        return null;
    }
    let compareOpts = extractCompareOpts(params);
    let makeRefs = DataCtx.valToBool(unpackArg(params, "makerefs"));
    let sortDesc = DataCtx.valToBool(unpackArg(params, "desc"));
    let sortMult = (sortDesc ? -1 : 1);
    let indexArr = arrData.map((_, idx) => idx);
    indexArr.sort((idx1, idx2) => {
        return sortMult*DataCtx.compareVals(arrData[idx1], arrData[idx2], compareOpts)
    });
    if (makeRefs && !(rawData instanceof DataCtx.LValue)) {
        console.log("WARNING fn:sort makerefs=true, but data is not a reference");
    }
    if (makeRefs && (rawData instanceof DataCtx.LValue)) {
        let dataLv = rawData as DataCtx.LValue;
        return indexArr.map((idx) => dataLv.subArrayIndex(idx));
    }
    else {
        return indexArr.map((idx) => arrData[idx]);
    }
}

function reg(name : string, fn : any, native : boolean, positionalArgs : boolean) {
    DefaultJSFuncs[name] = {fn, native, positionalArgs};
}

reg("len", jsLen, true, true);
reg("indexof", jsIndexOf, false, true);
reg("min", jsMin, false, true);
reg("max", jsMax, false, true);
reg("floor", jsFloor, false, true);
reg("ceil", jsCeil, false, true);
reg("splice", jsSplice, true, true);
reg("slice", jsSlice, true, false);
reg("push", jsPush, true, true);
reg("pop", jsPop, true, true);
reg("setadd", jsSetAdd, true, true);
reg("setremove", jsSetRemove, true, true);
reg("sethas", jsSetHas, true, true);
reg("int", jsInt, true, true);
reg("float", jsFloat, true, true);
reg("str", jsStr, true, true);
reg("bool", jsBool, true, true);
reg("jsonparse", jsJsonParse, true, true);
reg("json", jsJson, true, true);
reg("split", jsSplit, true, true);
reg("now", jsNow, true, true);
reg("ts",  jsNow, true, true);
reg("merge", jsMerge, true, true);
reg("jseval", jsEval, true, true);
reg("js", jsJs, false, true);
reg("substr", jsSubstr, true, true);
reg("uppercase", jsUpperCase, true, true);
reg("lowercase", jsLowerCase, true, true);
reg("sprintf", jsSprintf, true, true);
reg("trim", jsTrim, true, true);
reg("startswith", jsStartsWith, true, true);
reg("endswith", jsEndsWith, true, true);
reg("match", jsMatch, true, true);
reg("blobastext", jsBlobAsText, true, true);
reg("blobasbase64", jsBlobAsBase64, true, true);
reg("blobmimetype", jsBlobMimeType, true, true);
reg("bloblen", jsBlobLen, true, true);
reg("blobname", jsBlobName, true, true);
reg("uuid", jsUuid, true, true);
reg("typeof", jsTypeOf, true, true);
reg("deepequal", jsDeepEqual, true, true);
reg("deepcopy", jsDeepCopy, true, true);
reg("compare", jsCompare, true, false);
reg("sort", jsSort, true, false);

export {DefaultJSFuncs};
