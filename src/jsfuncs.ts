// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as mobx from "mobx";
import type {JSFuncType, HibikiVal, HibikiValObj} from "./types";
import {sprintf} from "sprintf-js";
import {isObject, addToArrayDupCheck, removeFromArray, valInArray, HibikiWrappedObj} from "./utils";
import {v4 as uuidv4} from 'uuid';
import * as DataCtx from "./datactx";
import type {DataEnvironment} from "./state";

let DefaultJSFuncs : Record<string, JSFuncType> = {};
let MAX_ITERS = 10000;

function jsLen(v : HibikiVal) : number {
    if (v == null) {
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

function jsIndexOf(params : DataCtx.HibikiParamsObj) {
    let data = params.getArg(null, 0);
    if (data == null) {
        return -1;
    }
    let fromIndex = params.getArg("fromindex", 2);
    if (fromIndex == null) {
        fromIndex = 0;
    }
    if (typeof(fromIndex) !== "number") {
        throw new Error(sprintf("fn:indexof, fromindex (3rd argument) must be a number, got type=%s", DataCtx.hibikiTypeOf(fromIndex)));
    }
    if (typeof(data) === "string") {
        let findArg = params.getArg(null, 1);
        if (findArg == null) {
            return 0;
        }
        if (typeof(findArg) !== "string") {
            throw new Error(sprintf("fn:indexof[string], 2nd argument must be string, got type=%s", DataCtx.hibikiTypeOf(findArg)));
        }
        return data.indexOf(findArg, fromIndex);
    }
    let [arrObj, isArr] = DataCtx.asArray(data, false);
    if (!isArr) {
        throw new Error(sprintf("fn:indexof, 1st argument must be string or array, got type=%s", DataCtx.hibikiTypeOf(data)));
    }
    let findArg = params.getArg(null, 1);
    return arrObj.indexOf(findArg, fromIndex);
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

function jsMoveItem(val : HibikiVal, fromIndexVal : HibikiVal, toIndexVal : HibikiVal) {
    let [arrObj, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    let fromIndex = parseInt(DataCtx.valToNumber(fromIndexVal));
    let toIndex = parseInt(DataCtx.valToNumber(toIndexVal));
    if (isNaN(fromIndex)) {
        throw new Error(sprintf("fn:moveitem 'fromindex' is NaN, type=%s", DataCtx.hibikiTypeOf(fromIndexVal)));
    }
    if (isNaN(toIndex)) {
        throw new Error(sprintf("fn:moveitem 'toindex' is NaN, type=%s", DataCtx.hibikiTypeOf(toIndexVal)));
    }
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= arrObj.length || toIndex >= arrObj.length) {
        throw new Error(sprintf("fn:moveitem from/to indexes are out-of-bounds.  from=%d to=%d len=%d", fromIndex, toIndex, arrObj.length));
    }
    let newArr = [...arrObj];
    if (fromIndex === toIndex) {
        return newArr;
    }
    let elems = newArr.splice(fromIndex, 1);
    newArr.splice(toIndex, 0, elems[0]);
    return newArr;
}

function processSliceArgs(arg : HibikiVal, fnName : string) : [number, number] {
    if (arg == null) {
        return null;
    }
    let [argArr, isArr] = DataCtx.asArray(arg, false);
    if (!isArr) {
        throw new Error(sprintf("Invalid slice arguments to %s, not an array type=%s", fnName, DataCtx.hibikiTypeOf(arg)));
    }
    argArr = DataCtx.stripNoAttrShallow(argArr);
    let [startVal, endVal] = argArr;
    let startIdx = (startVal == null ? undefined : DataCtx.valToNumber(startVal));
    let endIdx = (endVal == null  ? undefined : DataCtx.valToNumber(endVal));
    if ((startIdx != null && isNaN(startIdx)) || (endIdx != null && isNaN(endIdx))) {
        throw new Error(sprintf("Invalid start/end arguments to %s, must be numeric (not NaN)", fnName));
    }
    return [startIdx, endIdx];
}

function jsSlice(params : DataCtx.HibikiParamsObj) : HibikiVal[] {
    params.stripNoAttrs();
    let [rawVal, startVal, endVal] = params.posArgs;
    let val = DataCtx.resolveLValue(rawVal);
    let [arrVal, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    let [startIdx, endIdx] = processSliceArgs([startVal, endVal], "fn:slice");
    let makeRefs = DataCtx.valToBool(params.getArg("makerefs"));
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

function jsPush(val : HibikiVal, ...rest : HibikiVal[]) {
    let [arrObj, isArr] = DataCtx.asArray(val, true);
    if (!isArr) {
        return null;
    }
    if (arrObj == null) {
        arrObj = [];
    }
    let rtn = [...arrObj, ...rest];
    return rtn;
}

function jsUnshift(val : HibikiVal, ...rest : HibikiVal[]) {
    let [arrObj, isArr] = DataCtx.asArray(val, true);
    if (!isArr) {
        return null;
    }
    if (arrObj == null) {
        arrObj = [];
    }
    let rtn = [...rest, ...arrObj];
    return rtn;
}

function jsPop(val : HibikiVal, num : HibikiVal) : HibikiVal[] {
    if (val == null) {
        return null;
    }
    let [arrObj, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    let rtn = [...arrObj];
    if (typeof(num) === "number" && !isNaN(num) && num >= 0 && num <= MAX_ITERS) {
        for (let i=0; i<num; i++) {
            rtn.pop();
        }
    }
    else {
        rtn.pop();
    }
    return rtn;
}

function jsShift(val : HibikiVal, num : HibikiVal) {
    if (val == null) {
        return null;
    }
    let [arrObj, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    let rtn = [...arrObj];
    if (typeof(num) === "number" && !isNaN(num) && num >= 0 && num <= MAX_ITERS) {
        for (let i=0; i<num; i++) {
            rtn.shift();
        }
    }
    else {
        rtn.shift();
    }
    return rtn;
}

function jsJoin(val : HibikiVal, str : HibikiVal) : string {
    if (val == null) {
        return null;
    }
    let [arrObj, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    if (str == null) {
        str = "";
    }
    if (typeof(str) !== "string") {
        throw new Error(sprintf("fn:join 2nd argument must be type string, got type=%s", DataCtx.hibikiTypeOf(str)));
    }
    return arrObj.join(str);
}

function jsArrFilter(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : HibikiVal[] {
    let arrArg = params.getArg("arr", 0);
    let lambdaArg = params.getArg("expr", 1);
    if (arrArg == null) {
        return null;
    }
    let [arrObj, isArr] = DataCtx.asArray(arrArg, false);
    if (!isArr) {
        return null;
    }
    if (lambdaArg == null) {
        return arrObj;
    }
    if (!(lambdaArg instanceof DataCtx.LambdaValue)) {
        throw new Error(sprintf("fn:filter 2nd argument must be type lambda, got type=%s", DataCtx.hibikiTypeOf(lambdaArg)));
    }
    let lambda : DataCtx.LambdaValue = lambdaArg;
    let rtn : HibikiVal[] = [];
    for (let idx=0; idx<arrObj.length; idx++) {
        let params = {elem: arrObj[idx], index: idx};
        let include = lambda.invoke(dataenv, new DataCtx.HibikiParamsObj(params));
        if (include) {
            rtn.push(arrObj[idx]);
        }
    }
    return rtn;
}

function jsArrSome(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : boolean {
    let findIndex = jsArrFindIndex(params, dataenv);
    return (findIndex !== -1);
}

function jsArrEvery(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : boolean {
    let arrArg = params.getArg("arr", 0);
    let lambdaArg = params.getArg("expr", 1);
    if (arrArg == null) {
        return true;
    }
    let [arrObj, isArr] = DataCtx.asArray(arrArg, false);
    if (!isArr) {
        return false;
    }
    if (lambdaArg == null) {
        return true;
    }
    if (!(lambdaArg instanceof DataCtx.LambdaValue)) {
        throw new Error(sprintf("fn:every 2nd argument must be type lambda, got type=%s", DataCtx.hibikiTypeOf(lambdaArg)));
    }
    let lambda : DataCtx.LambdaValue = lambdaArg;
    let rtn : HibikiVal[] = [];
    for (let idx=0; idx<arrObj.length; idx++) {
        let params = {elem: arrObj[idx], index: idx};
        let include = lambda.invoke(dataenv, new DataCtx.HibikiParamsObj(params));
        if (!include) {
            return false;
        }
    }
    return true;
}

function jsArrMap(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : HibikiVal[] {
    let arrArg = params.getArg("arr", 0);
    let lambdaArg = params.getArg("expr", 1);
    if (arrArg == null) {
        return null;
    }
    let [arrObj, isArr] = DataCtx.asArray(arrArg, false);
    if (!isArr) {
        return null;
    }
    if (lambdaArg == null) {
        return arrObj;
    }
    if (!(lambdaArg instanceof DataCtx.LambdaValue)) {
        throw new Error(sprintf("fn:map 2nd argument must be type lambda, got type=%s", DataCtx.hibikiTypeOf(lambdaArg)));
    }
    let lambda : DataCtx.LambdaValue = lambdaArg;
    let rtn : HibikiVal[] = [];
    for (let idx=0; idx<arrObj.length; idx++) {
        let params = {elem: arrObj[idx], index: idx};
        let newVal = lambda.invoke(dataenv, new DataCtx.HibikiParamsObj(params));
        rtn.push(newVal);
    }
    return rtn;
}

function jsArrConcat(...rest : HibikiVal[]) : HibikiVal[] {
    let rtn = [];
    if (rest == null || rest.length === 0) {
        return rtn;
    }
    for (let i=0; i<rest.length; i++) {
        if (rest[i] == null) {
            continue;
        }
        let [arrObj, isArr] = DataCtx.asArray(rest[i], false);
        if (!isArr) {
            throw new Error(sprintf("fn:concat, argument #%d is not an array, got type=%s", i, DataCtx.hibikiTypeOf(rest[i])));
        }
        if (arrObj.length === 0) {
            continue;
        }
        rtn = rtn.concat(arrObj);
    }
    return rtn;
}

function jsArrFindIndexInternal(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment, fnName : string) : [HibikiVal, number] {
    let arrArg = params.getArg("arr", 0);
    let lambdaArg = params.getArg("expr", 1);
    let fromIndex = params.getArg("fromindex");
    if (fromIndex == null) {
        fromIndex = 0;
    }
    if (typeof(fromIndex) !== "number") {
        throw new Error(sprintf("%s 'fromindex' argument must be type number, got type=%s", fnName, DataCtx.hibikiTypeOf(fromIndex)));
    }
    if (arrArg == null) {
        return [null, -1];
    }
    let [arrObj, isArr] = DataCtx.asArray(arrArg, false);
    if (!isArr) {
        return [null, -1];
    }
    if (lambdaArg == null) {
        return [null, -1];
    }
    if (!(lambdaArg instanceof DataCtx.LambdaValue)) {
        throw new Error(sprintf("%s 2nd argument must be type lambda, got type=%s", fnName, DataCtx.hibikiTypeOf(lambdaArg)));
    }
    let lambda : DataCtx.LambdaValue = lambdaArg;
    for (let idx=fromIndex; idx<arrObj.length; idx++) {
        let params = {elem: arrObj[idx], index: idx};
        let include = lambda.invoke(dataenv, new DataCtx.HibikiParamsObj(params));
        if (include) {
            return [arrObj[idx], idx];
        }
    }
    return [null, -1];
}

function jsArrFindIndex(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : number {
    let [rtn, idx] = jsArrFindIndexInternal(params, dataenv, "find:findindex");
    return idx;
}

function jsArrFind(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : HibikiVal {
    let [rtn, idx] = jsArrFindIndexInternal(params, dataenv, "fn:find");
    return rtn;
}

function jsArrReduce(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : HibikiVal {
    let arrArg = params.getArg("arr", 0);
    let lambdaArg = params.getArg("expr", 1);
    let initialValue = params.getArg("initialvalue", 2);
    let hasInitialValue = params.hasArg("initialvalue", 2);
    if (arrArg == null) {
        return null;
    }
    let [arrObj, isArr] = DataCtx.asArray(arrArg, false);
    if (!isArr) {
        return null;
    }
    if (lambdaArg == null) {
        return arrObj;
    }
    if (!(lambdaArg instanceof DataCtx.LambdaValue)) {
        throw new Error(sprintf("fn:reduce 2nd argument must be type lambda, got type=%s", DataCtx.hibikiTypeOf(lambdaArg)));
    }
    let lambda : DataCtx.LambdaValue = lambdaArg;
    let value : HibikiVal = (hasInitialValue ? initialValue : null);
    for (let idx=(hasInitialValue ? 1 : 0); idx<arrObj.length; idx++) {
        let params = {elem: arrObj[idx], index: idx, value: value};
        value = lambda.invoke(dataenv, new DataCtx.HibikiParamsObj(params));
    }
    return value;
}

function jsArrReverse(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : HibikiVal[] {
    let rawVal = params.getArg("arr", 0);
    if (rawVal == null) {
        return null;
    }
    let val = DataCtx.resolveLValue(rawVal);
    let [arrObj, isArr] = DataCtx.asArray(val, false);
    if (!isArr) {
        return null;
    }
    let makeRefs = DataCtx.valToBool(params.getArg("makerefs"));
    if (makeRefs && !(rawVal instanceof DataCtx.LValue)) {
        console.log("WARNING fn:reverse makerefs=true, but data is not a reference");
    }
    if (!makeRefs || !(rawVal instanceof DataCtx.LValue)) {
        return arrObj.reverse();
    }
    let rawLv = rawVal as DataCtx.LValue;
    return arrObj.map((_, idx) => rawLv.subArrayIndex(idx)).reverse();
}

function jsSetAdd(arr : HibikiVal[], ...rest : HibikiVal[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        arr = [];
    }
    let rtn = [...arr];
    for (let i=0; i<rest.length; i++) {
        addToArrayDupCheck(rtn, rest[i]);
    }
    return rtn;
}

function jsSetRemove(arr : HibikiVal[], ...rest : HibikiVal[]) {
    if (arr == null || !mobx.isArrayLike(arr)) {
        return [];
    }
    let rtn = [...arr];
    for (let i=0; i<rest.length; i++) {
        removeFromArray(rtn, rest[i]);
    }
    return rtn;
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

function jsEval(jsexpr : string) : HibikiVal {
    if (jsexpr == null || typeof(jsexpr) !== "string") {
        return null;
    }
    let evalVal = eval("(" + jsexpr + ")");
    if (typeof(evalVal) === "function") {
        evalVal = evalVal();
    }
    return DataCtx.CleanVal(evalVal);
}

function jsJs(fnName : string, ...rest : any[]) : HibikiVal {
    if (typeof(fnName) !== "string") {
        throw new Error("fn:js first argument must be a string (the function to call)");
    }
    let val = window[fnName];
    if (typeof(val) === "function") {
        return DataCtx.DeepCopy(val(...rest));
    }
    return DataCtx.CleanVal(val);
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

function jsTrimIndent(str : HibikiVal) : string {
    if (typeof(str) !== "string") {
        return null;
    }
    let lines = str.split(/\r?\n/);
    let minIndent = null;
    for (let i=0; i<lines.length; i++) {
        let match = lines[i].match(/^\s*\S/);
        if (match == null) {
            continue;
        }
        if (minIndent == null || match[0].length-1 < minIndent) {
            minIndent = match[0].length-1;
        }
    }
    if (minIndent == null || minIndent === 0) {
        return str;
    }
    let indentStr = " ".repeat(minIndent);
    let rtn = [];
    for (let i=0; i<lines.length; i++) {
        if ((i === 0 || i === lines.length-1) && lines[i].trim() === "") {
            continue;
        }
        if (lines[i].startsWith(indentStr)) {
            rtn.push(lines[i].substr(minIndent));
        }
        else {
            rtn.push(lines[i]);
        }
    }
    return rtn.join("\n");
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

function jsMatch(str : HibikiVal, regex : HibikiVal, ...rest : any[]) : any {
    if (str == null || regex == null) {
        return null;
    }
    if (typeof(str) !== "string") {
        throw new Error("fn:match 1st argument must be a string");
    }
    if (typeof(regex) !== "string") {
        throw new Error("fn:match 2nd argument must be a regexp string");
    }
    let re = new RegExp(regex, ...rest);
    return str.match(re);
}

function jsReplace(str : HibikiVal, findStr : HibikiVal, replaceStr : HibikiVal) : string {
    if (typeof(str) !== "string") {
        return null;
    }
    if (typeof(findStr) !== "string") {
        return str;
    }
    if (typeof(replaceStr) !== "string") {
        replaceStr = DataCtx.valToString(replaceStr);
    }
    return str.replace(findStr, replaceStr);
}

function jsReplaceAll(str : HibikiVal, findStr : HibikiVal, replaceStr : HibikiVal) : string {
    if (typeof(str) !== "string") {
        return null;
    }
    if (typeof(findStr) !== "string") {
        return str;
    }
    if (typeof(replaceStr) !== "string") {
        replaceStr = DataCtx.valToString(replaceStr);
    }
    // @ts-ignore - replaceAll exists
    return str.replaceAll(findStr, replaceStr);
}

function jsBlobAsText(blob : HibikiVal) : string {
    if (blob instanceof DataCtx.HibikiBlob) {
        return blob.text;
    }
    return null;
}

function jsBlobAsBase64(blob : HibikiVal) : string {
    if (blob instanceof DataCtx.HibikiBlob) {
        return blob.base64;
    }
    return null;
}

function jsBlobMimeType(blob : HibikiVal) : string {
    if (blob instanceof DataCtx.HibikiBlob) {
        return blob.mimetypeIv;
    }
    return null;
}

function jsBlobLen(blob : HibikiVal) : number {
    if (blob instanceof DataCtx.HibikiBlob) {
        return blob.bloblen;
    }
    return null;
}

function jsBlobName(blob : HibikiVal) : string {
    if (blob instanceof DataCtx.HibikiBlob) {
        return blob.nameIv;
    }
    return null;
}

function jsObjKeys(val : HibikiVal) : string[] {
    let rtn = jsObjAllKeys(val);
    if (rtn == null) {
        return null;
    }
    rtn = rtn.filter((k) => !k.startsWith("@"));
    return rtn;
}

function jsObjAllKeys(val : HibikiVal) : string[] {
    if (val == null) {
        return null;
    }
    let [plainObj, isObj] = DataCtx.asPlainObject(val, false);
    if (isObj) {
        let rtn = Object.keys(val);
        return rtn;
    }
    if (val instanceof HibikiWrappedObj) {
        return val.allowedGetters();
    }
    return null;
}

function jsObjAtKeys(val : HibikiVal) : string[] {
    let rtn = jsObjAllKeys(val);
    if (rtn == null) {
        return null;
    }
    rtn = rtn.filter((k) => k.startsWith("@"));
    return rtn;
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

function extractCompareOpts(params : DataCtx.HibikiParamsObj) : DataCtx.CompareOpts {
    let {locale, "type": sortType, sensitivity, nocase, field, index} = params.params;
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

function jsCompare(params : DataCtx.HibikiParamsObj) : number {
    let args = params.posArgs;
    let compareOpts = extractCompareOpts(params);
    let v1 = (args.length >= 1 ? args[0] : null);
    let v2 = (args.length >= 2 ? args[1] : null);
    return DataCtx.compareVals(v1, v2, compareOpts);
}

function jsSort(params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) : HibikiVal[] {
    let rawData = params.getArg("data", 0);
    let data = DataCtx.resolveLValue(rawData);
    if (data == null) {
        return null;
    }
    let [arrData, isArr] = DataCtx.asArray(data, false);
    if (!isArr) {
        return null;
    }
    let compareOpts = extractCompareOpts(params);
    let makeRefs = DataCtx.valToBool(params.getArg("makerefs"));
    let sortDesc = DataCtx.valToBool(params.getArg("desc"));
    let sliceOpt = processSliceArgs(params.getArg("slice"), "fn:sort#slice");
    let noSort = DataCtx.valToBool(params.getArg("nosort"));
    let sortExprArg = params.getArg("sortexpr");
    let sortExpr : DataCtx.LambdaValue = null;
    if (sortExprArg != null) {
        if (!(sortExprArg instanceof DataCtx.LambdaValue)) {
            throw new Error(sprintf("fn:sort#sortexpr was set, but is not type lambda, type=%s", DataCtx.hibikiTypeOf(sortExprArg)));
        }
        sortExpr = sortExprArg;
    }
    
    let sortMult = (sortDesc ? -1 : 1);
    let indexArr = arrData.map((_, idx) => idx);
    if (!noSort) {
        indexArr.sort((idx1, idx2) => {
            let cmpVal : number = 0;
            if (sortExpr != null) {
                let invokeParams = new DataCtx.HibikiParamsObj({"a": arrData[idx1], "b": arrData[idx2], "aidx": idx1, "bidx": idx2});
                cmpVal = DataCtx.valToNumber(sortExpr.invoke(dataenv, invokeParams));
            }
            else {
                cmpVal = DataCtx.compareVals(arrData[idx1], arrData[idx2], compareOpts);
            }
            return sortMult*cmpVal;
        });
    }
    if (makeRefs && !(rawData instanceof DataCtx.LValue)) {
        console.log("WARNING fn:sort makerefs=true, but data is not a reference");
    }
    let rtn : HibikiVal[] = null;
    if (makeRefs && (rawData instanceof DataCtx.LValue)) {
        let dataLv = rawData as DataCtx.LValue;
        rtn = indexArr.map((idx) => dataLv.subArrayIndex(idx));
    }
    else {
        rtn = indexArr.map((idx) => arrData[idx]);
    }
    if (sliceOpt != null) {
        rtn = rtn.slice(sliceOpt[0], sliceOpt[1]);
    }
    return rtn;
}

function jsSetUpdate(params : DataCtx.HibikiParamsObj) : HibikiVal {
    params.deepCopy({resolve: true});
    let setVal = params.getArg(null, 0);
    let val = params.getArg(null, 1);
    let onOff = DataCtx.valToBool(params.getArg(null, 2));
    let isMulti = true;
    if (params.hasArg("@multi")) {
        isMulti = DataCtx.valToBool(params.getArg("@multi"));
    }
    if (!isMulti) {
        return (onOff ? val : null);
    }
    let [arrVal, isArr] = DataCtx.asArray(setVal, true);
    if (!isArr || arrVal == null) {
        arrVal = [];
    }
    if (onOff) {
        arrVal = addToArrayDupCheck(arrVal, val);
    }
    else {
        arrVal = removeFromArray(arrVal, val);
    }
    return arrVal;
}

function jsSetHas(params : DataCtx.HibikiParamsObj) : boolean {
    params.deepCopy({resolve: true});
    let setVal = params.getArg(null, 0);
    let val = params.getArg(null, 1);
    let isMulti = true;
    if (params.hasArg("@multi")) {
        isMulti = DataCtx.valToBool(params.getArg("@multi"));
    }
    if (!isMulti) {
        return setVal == val;
    }
    return valInArray(setVal, val);
}

function regParamFn(name : string, fn : (params : DataCtx.HibikiParamsObj, dataenv : DataEnvironment) => HibikiVal, opts? : {retainNoAttr? : boolean, insecure? : boolean}) {
    opts = opts ?? {};
    let config : JSFuncType = {
        fn: null,
        paramFn: fn,
        native: true,
        retainNoAttr: opts.retainNoAttr,
        insecure: opts.insecure,
    };
    DefaultJSFuncs[name] = config;
}

function reg(name : string, fn : (...args : HibikiVal[]) => HibikiVal, native : boolean, opts? : {retainNoAttr? : boolean, insecure? : boolean}) {
    opts = opts ?? {};
    let config : JSFuncType = {
        fn: fn,
        paramFn: null,
        native,
        retainNoAttr: opts.retainNoAttr,
        insecure: opts.insecure,
    };
    DefaultJSFuncs[name] = config;
}

// misc functions
reg("len", jsLen, true);  // works with strings or arrays
reg("typeof", jsTypeOf, true);
reg("jsonparse", jsJsonParse, true);
reg("json", jsJson, true);
reg("now", jsNow, true);
reg("ts",  jsNow, true);
reg("merge", jsMerge, true);
reg("uuid", jsUuid, true);
reg("deepequal", jsDeepEqual, true);
reg("deepcopy", jsDeepCopy, true);
reg("jseval", jsEval, true, {insecure: true});
reg("js", jsJs, false, {insecure: true});

// type conversion functions
reg("int", jsInt, true);
reg("float", jsFloat, true);
reg("str", jsStr, true);
reg("bool", jsBool, true);

// blob functions
reg("blobastext", jsBlobAsText, true);
reg("blobasbase64", jsBlobAsBase64, true);
reg("blobmimetype", jsBlobMimeType, true);
reg("bloblen", jsBlobLen, true);
reg("blobname", jsBlobName, true);

// compare and sort
regParamFn("compare", jsCompare);
regParamFn("sort", jsSort);

// array functions
reg("splice", jsSplice, true);
regParamFn("slice", jsSlice);
reg("push", jsPush, true);
reg("pop", jsPop, true);
reg("unshift", jsUnshift, true);
reg("shift", jsShift, true);
reg("join", jsJoin, true);
regParamFn("filter", jsArrFilter);
regParamFn("map", jsArrMap);
regParamFn("find", jsArrFind);
regParamFn("findindex", jsArrFindIndex);
regParamFn("reduce", jsArrReduce);
regParamFn("reverse", jsArrReverse);
regParamFn("every", jsArrEvery);
regParamFn("some", jsArrSome);
reg("concat", jsArrConcat, true);
reg("moveitem", jsMoveItem, true);

// concat


// obj functions
reg("objkeys", jsObjKeys, true);
reg("objatkeys", jsObjAtKeys, true);
reg("objallkeys", jsObjAllKeys, true);

// string functions
reg("substr", jsSubstr, true);
regParamFn("indexof", jsIndexOf);  // works for strings or arrays
reg("uppercase", jsUpperCase, true);
reg("lowercase", jsLowerCase, true);
reg("sprintf", jsSprintf, true);
reg("trim", jsTrim, true);
reg("startswith", jsStartsWith, true);
reg("endswith", jsEndsWith, true);
reg("match", jsMatch, true);
reg("split", jsSplit, true);
reg("replace", jsReplace, true);
reg("replaceall", jsReplaceAll, true);
reg("trimindent", jsTrimIndent, true);

// math functions
reg("min", jsMin, false);
reg("max", jsMax, false);
reg("floor", jsFloor, false);
reg("ceil", jsCeil, false);

// string-set functions
reg("setadd", jsSetAdd, true);
reg("setremove", jsSetRemove, true);
regParamFn("setupdate", jsSetUpdate);
regParamFn("sethas", jsSetHas);

export {DefaultJSFuncs};
