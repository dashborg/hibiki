// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as mobx from "mobx";
import {v4 as uuidv4} from 'uuid';
import {DataEnvironment, HibikiState, HibikiExtState} from "./state";
import {sprintf} from "sprintf-js";
import {parseHtml, HibikiNode} from "./html-parser";
import {RtContext, getShortEMsg, HibikiError} from "./error";
import {SYM_PROXY, SYM_FLATTEN, isObject, nodeStr, parseHandler, fullPath, STYLE_UNITLESS_NUMBER, splitTrim, bindLibContext, classStringToCnArr, cnArrToClassAttr, cnArrToLosslessStr, attrBaseName, parseAttrName, nsAttrName, getHibiki, HibikiWrappedObj, base64ToArray} from "./utils";
import {PathPart, PathType, PathUnionType, EventType, HandlerValType, HibikiAction, HibikiActionString, HibikiActionValue, HandlerBlock, HibikiVal, HibikiValObj, JSFuncType, HibikiSpecialVal, HibikiPrimitiveVal, StyleMapType} from "./types";
import type {NodeAttrType} from "./html-parser";
import {HibikiRequest} from "./request";
import type {EHandlerType} from "./state";
import {doParse} from "./hibiki-parser";
import {DefaultJSFuncs} from "./jsfuncs";
import type {InjectedAttrsObj, DBCtx} from "./dbctx";

declare var window : any;

const MAX_ARRAY_SIZE = 10000;
const SYM_NOATTR = Symbol("noattr");
const MAX_ACTIONS = 1000;
const MAX_STACK = 30;
const MAX_LVALUE_LEVEL = 5;

type RtContextOpts = {
    rtContext? : string,
};

type SetPathOpts = {
    rtContext? : string,
    setop? : string,
}

type ExprResolveType = "resolve" | "raw" | "natural";

type HActionResult = {
    rtnVal? : HibikiVal,
    execReturn? : boolean,   // return out of handler
};

type HExpr = {
    etype      : string,
    filter?    : string,
    exprs?     : HExpr[],
    op?        : string,
    fn?        : string,
    val?       : HibikiVal,
    key?       : HExpr,
    path?      : PathType,
    valexpr?   : HExpr,
    pathexpr?  : HExpr,
    sourcestr? : string,
    params?    : HExpr,   // namedCallParams
};

type ContextVarType = {key : string, expr : HExpr};

type HIteratorExpr = {
    data       : HExpr,
    itemvar?   : string,
    keyvar?    : string,
    sourcestr? : string,
}

type HAction = {
    actiontype : string,
    event?     : HExpr,
    native?    : boolean,
    bubble?    : boolean,
    pure?      : boolean,
    debug?     : boolean,
    alert?     : boolean,
    setop?     : string,
    setpath?   : PathType,
    callpath?  : HExpr,
    data?      : HExpr,
    html?      : string,
    libcontext? : string,
    nodeuuid?  : string,
    actions?   : Record<string, HAction[]>,
    exithandler? : boolean,
    blockstr?  : string,
    blockctx?  : string,
};

type CompareOpts = {
    locale? : string,
    nocase? : boolean,
    sortType? : ("string" | "numeric"),
    sensitivity? : string,
    field? : string,
    index? : number,
};

const EVENT_ALLOWED_GETTERS : Record<string, boolean> = {
    "type": true,
};

class HibikiReactEvent extends HibikiWrappedObj {
    event : any;

    constructor(event : any) {
        super();
        this.event = event;
    }

    get type() : string {
        return this.event.type;
    }

    allowedGetters(key : string) : boolean {
        return EVENT_ALLOWED_GETTERS[key];
    }

    asString() : string {
        return sprintf("[event:%s]", this.event.type);
    }

    hibikiTypeOf() : string {
        return "hibiki:event";
    }
}

class HibikiParamsObj {
    params : HibikiValObj;
    posArgs : HibikiVal[];

    constructor(params : HibikiValObj) {
        let [paramsObj, isObj] = asPlainObject(params, false);
        if (!isObj) {
            this.params = {};
            this.posArgs = [];
            return;
        }
        let [posArgs, isArr] = asArray(params["*args"], false);
        this.posArgs = (isArr ? [...posArgs] : []);
        this.params = {...paramsObj};
        if (this.params["*args"]) {
            delete this.params["*args"];
        }
    }

    stripNoAttrs() {
        this.params = stripNoAttrShallow(this.params);
        this.posArgs = stripNoAttrShallow(this.posArgs);
    }

    deepCopy(opts? : DeepCopyOptsType) {
        this.params = DeepCopyTypeSafe(this.params, opts);
        this.posArgs = DeepCopyTypeSafe(this.posArgs, opts);
    }

    getAtArgs() : HibikiValObj {
        let rtn : HibikiValObj = {};
        for (let key in this.params) {
            if (key.startsWith("@")) {
                rtn[key.substr(1)] = this.params[key];
            }
        }
        return rtn;
    }

    hasArg(argName : string, pos? : number) : boolean {
        if (argName != null) {
            if (argName in this.params && this.params[argName] !== SYM_NOATTR) {
                return true;
            }
        }
        if (pos != null && this.posArgs.length > pos) {
            if (this.posArgs[pos] !== SYM_NOATTR) {
                return true;
            }
        }
        return false;
    }

    getArg(argName : string, pos? : number) : HibikiVal {
        if (argName != null) {
            if (argName in this.params) {
                return this.params[argName];
            }
        }
        if (pos == null || this.posArgs.length <= pos) {
            return null;
        }
        return this.posArgs[pos];
    }

    getNamedPositionalArgs(posArgNames : string[]) : HibikiValObj {
        let rtn : HibikiValObj = {};
        for (let idx=0; idx<posArgNames.length; idx++) {
            let name = posArgNames[idx];
            rtn[name] = this.getArg(name, idx);
        }
        return rtn;
    }

    getPlainArgs() : HibikiValObj {
        let rtn : HibikiValObj = {};
        for (let key in this.params) {
            if (key.startsWith("@")) {
                continue;
            }
            rtn[key] = this.params[key];
        }
        return rtn;
    }
}

class HActionBlock {
    blockType : "block" | "handler";  // handlers are top-level, blocks are like in "then"/"else" clauses.  affects the "setreturn" action
    actions : HAction[];
    libContext : string;

    constructor(blockType : "block" | "handler", actions : HAction[], libContext? : string) {
        this.blockType = blockType;
        this.actions = actions;
        this.libContext = libContext;
    }
}

const CHILDRENVAR_ALLOWED_GETTERS : Record<string, boolean> = {
    "all": true,
    "noslot": true,
    "tags": true,
    "bycomp": true,
    "byslot": true,
    "bytag": true,
    "first": true,
    "byindex": true,
    "filter": true,
    "size": true,
    "node": true,
    "nodes": true,
};

class ChildrenVar extends HibikiWrappedObj {
    boundNodes : DBCtx[];
    
    constructor(boundNodes : DBCtx[]) {
        super();
        this.boundNodes = boundNodes ?? [];
    }

    allowedGetters(key : string) : boolean {
        return CHILDRENVAR_ALLOWED_GETTERS[key];
    }

    get all() : ChildrenVar {
        return this;
    }

    get size() : number {
        return this.boundNodes.length;
    }

    get noslot() : ChildrenVar {
        let rtn : DBCtx[] = [];
        for (let child of this.boundNodes) {
            let childSlot = child.resolveAttrStr("slot");
            if (childSlot == null) {
                rtn.push(child);
            }
        }
        return new ChildrenVar(rtn);
    }

    get node() : HibikiValObj {
        if (this.boundNodes.length == 0) {
            return null;
        }
        let ctx = this.boundNodes[0];
        return ctx.makeNodeVar(true);
    }

    get nodes() : HibikiVal[] {
        let rtn : HibikiVal[] = [];
        for (let child of this.boundNodes) {
            rtn.push(child.makeNodeVar(true));
        }
        return rtn;
    }

    get tags() : ChildrenVar {
        let rtn : DBCtx[] = [];
        for (let child of this.boundNodes) {
            if (child.node.tag.startsWith("#")) {
                continue;
            }
            rtn.push(child);
        }
        return new ChildrenVar(rtn);
    }

    get bycomp() : Record<string, ChildrenVar> {
        let rtn : Record<string, ChildrenVar> = {};
        for (let child of this.boundNodes) {
            if (child.node.tag.startsWith("hibiki-")) {
                continue;
            }
            let tagName = child.node.tag;
            let compName = child.resolveAttrStr("component") ?? tagName;
            let component = child.dataenv.dbstate.ComponentLibrary.findComponent(compName, child.node.libContext);
            let cname = null;
            if (component == null) {
                if (tagName.startsWith("#")) {
                    cname = tagName;
                }
                else if (tagName.startsWith("html-")) {
                    cname = "@html:" + tagName.substr(5);
                }
                else if (tagName.indexOf("-") == -1) {
                    cname = "@html:" + tagName;
                }
                else {
                    cname = "@unknown:" + tagName;
                }
            }
            else {
                cname = component.libName + ":" + component.name;
            }
            if (rtn[cname] == null) {
                rtn[cname] = new ChildrenVar([]);
            }
            rtn[cname].pushChild(child);
        }
        return rtn;
    }

    get byslot() : Record<string, ChildrenVar> {
        let rtn : Record<string, ChildrenVar> = {};
        for (let child of this.boundNodes) {
            let childSlot = child.resolveAttrStr("slot");
            if (childSlot == null) {
                continue;
            }
            if (!(childSlot in rtn)) {
                rtn[childSlot] = new ChildrenVar([]);
            }
            rtn[childSlot].pushChild(child);
        }
        return rtn;
    }

    get bytag() : Record<string, ChildrenVar> {
        let rtn : Record<string, ChildrenVar> = {};
        for (let child of this.boundNodes) {
            let tagName = child.node.tag;
            if (!(tagName in rtn)) {
                rtn[tagName] = new ChildrenVar([]);
            }
            rtn[tagName].pushChild(child);
        }
        return rtn;
    }

    get first() : ChildrenVar {
        let rtn : DBCtx[] = (this.boundNodes.length > 0 ? [this.boundNodes[0]] : []);
        return new ChildrenVar(rtn);
    }

    get byindex() : ChildrenVar[] {
        let rtn : ChildrenVar[] = [];
        for (let child of this.boundNodes) {
            rtn.push(new ChildrenVar([child]));
        }
        return rtn;
    }

    get filter() : LambdaValue {
        let fn : (dataenv : DataEnvironment, params : HibikiParamsObj) => HibikiVal = (dataenv : DataEnvironment, params : HibikiParamsObj) => {
            let {filterexpr: filterExpr} = params.getNamedPositionalArgs(["filterexpr"]);
            if (filterExpr == null) {
                return null;
            }
            if (!(filterExpr instanceof LambdaValue)) {
                throw new Error(sprintf("ChildrenVar filterexpr must be a LambdaValue, got '%s'", hibikiTypeOf(filterExpr)));
            }
            let rtn : DBCtx[] = [];
            let hibiki = getHibiki();
            for (let childCtx of this.boundNodes) {
                let nodeVar = childCtx.makeNodeVar(true);
                let lambdaEnv = dataenv.makeChildEnv({node: nodeVar}, null);
                let isActive = filterExpr.invoke(lambdaEnv, new HibikiParamsObj(null));
                if (isActive && isActive !== SYM_NOATTR) {
                    rtn.push(childCtx);
                }
            }
            return new ChildrenVar(rtn);
        };
        return new LambdaValue(null, fn);
    }

    pushChild(child : DBCtx) {
        this.boundNodes.push(child);
    }

    asString() : string {
        let arr = [];
        for (let child of this.boundNodes) {
            if (child.node.tag.startsWith("#")) {
                arr.push(child.node.tag);
            }
            else {
                arr.push("<" + child.node.tag + ">");
            }
        }
        if (arr.length === 0) {
            return "[children:none]";
        }
        return sprintf("[children:%s]", arr.toString());
    }

    hibikiTypeOf() : string {
        return "hibiki:children";
    }
}

class OpaqueValue {
    value : any;

    constructor(value : any) {
        this.value = value;
    }
}

const BLOB_ALLOWED_GETTERS : Record<string, boolean> = {
    "mimetype": true,
    "bloblen": true,
    "name": true,
    "base64": true,
};

class HibikiBlob extends HibikiWrappedObj {
    mimetypeIv : string = null;
    dataIv : string = null;
    nameIv : string = null;

    constructor(mimetype : string, data : string, name? : string) {
        super();
        this.mimetypeIv = mimetype;
        this.dataIv = data;
        this.nameIv = name;
    }

    makeDataUrl() : string {
        return "data:" + this.mimetypeIv + ";base64," + this.dataIv;
    }

    allowedGetters(key : string) : boolean {
        return BLOB_ALLOWED_GETTERS[key];
    }

    appendData(data : string) {
        this.dataIv += data;
    }

    get bloblen() : number {
        let bloblen = 0;
        if (this.dataIv != null) {
            bloblen = this.dataIv.length;
        }
        return Math.ceil((bloblen/4)*3);
    }

    get mimetype() : string {
        return this.mimetypeIv;
    }

    get name() : string {
        return this.nameIv;
    }

    get base64() : string {
        return this.dataIv;
    }

    get text() : string {
        if (this.mimetypeIv == null || !this.mimetypeIv.startsWith("text/")) {
            return null;
        }
        return atob(this.dataIv);
    }

    asJson() : HibikiValObj {
        let rtn : HibikiValObj = {};
        rtn.mimetype = this.mimetypeIv;
        rtn.data = this.dataIv;
        if (this.nameIv != null) {
            rtn.name = this.nameIv;
        }
        return rtn;
    }

    asJsBlob() : Blob {
        let binaryArr = base64ToArray(this.dataIv);
        if (this.nameIv != null) {
            let blob = new File([binaryArr], this.nameIv, {type: this.mimetypeIv});
            return blob;
        }
        else {
            let blob = new Blob([binaryArr], {type: this.mimetypeIv});
            return blob;
        }
    }

    asString() : string {
        if (this.nameIv != null) {
            return sprintf("[hibikiblob type=%s, len=%s, name=%s]", this.mimetypeIv, this.bloblen, this.nameIv);
        }
        return sprintf("[hibikiblob type=%s, len=%s]", this.mimetypeIv, this.bloblen)
    }

    hibikiTypeOf() : string {
        return "hibiki:blob";
    }
}

function rawAttrStr(attr : NodeAttrType) : string {
    if (attr == null) {
        return null;
    }
    if (typeof(attr) === "string") {
        return attr;
    }
    return attr.sourcestr;
}

const NON_MERGED_ATTRS = {
    "if": true,
    "unwrap": true,
    "foreach": true,
    "component": true,
    "eid": true,
    "ref": true,
    "condition": true,
    "automerge": true,
    "slot": true,
    "class": true,
    "style": true,
};

function isUnmerged(attrName : string) : boolean {
    if (attrName == null || attrName === "" || attrName.startsWith("@")) {
        return false;
    }
    let baseName = attrBaseName(attrName);
    return NON_MERGED_ATTRS[baseName] || baseName.startsWith("class.");
}

// coalesces 'class' and 'class.[foo]' attributes
function resolveUnmergedCnArray(node : HibikiNode, ns : string, dataenv : DataEnvironment) : Record<string, boolean>[] {
    let baseClassAttrName = nsAttrName("class", ns);
    let classStr = getUnmergedAttributeStr(node, baseClassAttrName, dataenv);
    let cnArr = classStringToCnArr(classStr);
    if (node.attrs == null) {
        return cnArr;
    }
    for (let [k,v] of Object.entries(node.attrs)) {
        if (!k.startsWith(baseClassAttrName + ".")) {
            continue;
        }
        let kval = k.substr(baseClassAttrName.length+1);
        if (kval === "") {
            continue;
        }
        let rval = getUnmergedAttributeStr(node, k, dataenv);
        if (rval && rval !== "0" && rval !== "false" && kval !== "hibiki-cloak") {
            cnArr.push({[kval]: true});
        }
        else {
            cnArr.push({[kval]: false});
        }
    }
    return cnArr;
}

function resolveUnmergedStyleMap(styleMap : Record<string, NodeAttrType>, dataenv : DataEnvironment, ctxStr : string) : StyleMapType {
    if (styleMap == null) {
        return {};
    }
    let rtn : StyleMapType = {};
    for (let [styleProp, nodeAttr] of Object.entries(styleMap)) {
        let fullCtxStr = sprintf("Resolving style property '%s' in %s", ctxStr);
        let [rval, exists] = resolveNodeAttrPair(nodeAttr, dataenv, fullCtxStr, "natural");
        if (!exists) {
            continue;
        }
        let styleVal = valToStyleProp(rval);
        if (styleVal == null) {
            continue;
        }
        rtn[styleProp] = styleVal;
    }
    return rtn;
}

type ResolveOpts = {
    style? : boolean,
    rtContext? : string,
    noAutoMerge? : boolean,
    noBindings? : boolean,
};

function valToString(val : HibikiVal) : string {
    if (val == null) {
        return null;
    }
    val = resolveLValue(val);
    if (val == null) {
        return null;
    }
    let [pval, isPrim] = asPrimitive(val);
    if (isPrim) {
        return pval.toString();
    }
    let [arrVal, isArr] = asArray(val, false);
    if (isArr) {
        return arrVal.toString();
    }
    let [objVal, isObj] = asPlainObject(val, false);
    if (isObj) {
        return "[object]";
    }
    return specialValToString(val);
}

function valToBool(val : HibikiVal) : boolean {
    val = resolveLValue(val);
    if (val == null || val === SYM_NOATTR) {
        return false;
    }
    return !!val;
}

function valToNumber(data : HibikiVal) : number {
    if (data == null || data === SYM_NOATTR) {
        return 0;
    }
    data = resolveLValue(data);
    if (typeof(data) === "string") {
        return Number(data);
    }
    if (typeof(data) === "number") {
        return data;
    }
    if (typeof(data) === "boolean") {
        return (data ? 1 : 0);
    }
    if (typeof(data) === "symbol") {
        return NaN;
    }
    return NaN;
}

// returns [value, exists]
function resolveNodeAttrPair(val : NodeAttrType, dataenv : DataEnvironment, rtContextStr : string, rtype : ExprResolveType) : [HibikiVal, boolean] {
    if (val == null) {
        return [null, false];
    }
    if (typeof(val) === "string") {
        return [val, true];
    }
    let resolvedVal : HibikiVal = null;
    try {
        resolvedVal = evalExprAst(val, dataenv, rtype);
    }
    catch (e) {
        console.log(sprintf("ERROR %s expression\n\"%s\"\n", rtContextStr, val.sourcestr), e.toString());
        return [null, true];
    }
    if (isNoAttr(resolvedVal)) {
        return [null, false];
    }
    return [resolvedVal, true];
}

function valToAttrStr(val : HibikiVal) : string {
    if (val == null || val === false || val === "") {
        return null;
    }
    if (val === true) {
        return "1";
    }
    return valToString(val);
}

function valToStyleProp(val : HibikiVal) : (string | number) {
    if (val == null || val === false || val === "") {
        return null;
    }
    if (typeof(val) === "number") {
        return val;
    }
    return valToString(val);
}

function getUnmergedAttributeStr(node : HibikiNode, attrName : string, dataenv : DataEnvironment) : string {
    let [hval, exists] = getUnmergedAttributeValPair(node, attrName, dataenv);
    if (!exists) {
        return null;
    }
    return valToAttrStr(hval);
}

function getUnmergedAttributeValPair(node : HibikiNode, attrName : string, dataenv : DataEnvironment) : [HibikiVal, boolean] {
    if (!node) {
        return [null, false];
    }
    if (node.attrs && node.attrs[attrName] != null) {
        let aval = node.attrs[attrName];
        let ctxStr = sprintf("resolving attribute '%s' in %s", attrName, nodeStr(node));
        let [rtnVal, exists] = resolveNodeAttrPair(aval, dataenv, ctxStr, "raw");
        if (exists) {
            return [rtnVal, true];
        }
    }
    return [null, false];
}

function formatVal(val : HibikiVal, format : string) : string {
    try {
        if (format == null || format === "") {
            return valToString(val) ?? "null";
        }
        else if (format === "json") {
            return JsonStringify(val, {space: 2});
        }
        else if (format === "json-compact") {
            return JsonStringify(val);
        }
        else if (format === "json-noresolve") {
            return JsonStringify(val, {space: 2, noresolve: true});
        }

        // format is set (sprintf like string)
        if (val === SYM_NOATTR) {
            val = "[noattr]";
        }
        val = DeepCopy(val, {resolve: true, json: true});
        let [arrVal, isArr] = asArray(val, false);
        if (isArr) {
            return sprintf(format, ...arrVal);
        }
        return sprintf(format, val);
    } catch (e) {
        return "format-error[" + e + "]";
    }
}

function formatFilter(val : any, params : HibikiParamsObj) {
    let format = params.getArg("format", 0);
    return formatVal(val, valToString(format));
}

function forceAsArray(val : HibikiVal) : HibikiVal[] {
    if (mobx.isArrayLike(val)) {
        return val;
    }
    return [val];
}

function rtnIfType(v : any, itype : string) : any {
    if (v == null) {
        return null;
    }
    if (itype === "array") {
        if (!mobx.isArrayLike(v)) {
            return null;
        }
        return null;
    }
    else if (itype === "map") {
        if (v instanceof Map || mobx.isObservableMap(v)) {
            return v;
        }
        if (!isObject(v)) {
            return null;
        }
        return v;
    }
    else {
        return null;
    }
}

function makeIteratorFromValue(bindVal : HibikiVal) : [any, boolean] {
    let iterator = null;
    let isMap = false;
    if (bindVal == null) {
        return [[], false];
    }
    let [arrVal, isArr] = asArray(bindVal, false);
    if (isArr) {
        return [arrVal, false];
    }
    if (bindVal instanceof Map || mobx.isObservableMap(bindVal)) {
        return [bindVal, true];
    }
    let [plainObj, isObj] = asPlainObject(bindVal, false);
    if (isObj) {
        return [Object.entries(plainObj), true];
    }
    else {
        return [[bindVal], false];
    }
}

function getKV(ival : any, isMap : boolean) : [any, any] {
    if (isMap) {
        let [key, val] = ival;
        return [key, val];
    }
    return [null, ival];
}

function* makeIteratorFromExpr(iteratorExpr : HIteratorExpr, dataenv : DataEnvironment) : Generator<Record<string, any>, void, void> {
    let rawData = evalExprAst(iteratorExpr.data, dataenv, "resolve");
    let [iterator, isMap] = makeIteratorFromValue(rawData);
    let index = 0;
    for (let rawVal of iterator) {
        let [key, val] = getKV(rawVal, isMap);
        let rtn : Record<string, any> = {};
        if (iteratorExpr.itemvar != null) {
            rtn[iteratorExpr.itemvar] = val;
        }
        if (iteratorExpr.keyvar != null) {
            if (isMap) {
                rtn[iteratorExpr.keyvar] = key;
            }
            else {
                rtn[iteratorExpr.keyvar] = index;
            }
        }
        index++;
        yield rtn;
    }
}

class Watcher {
    expr : HExpr;
    lastVal : HibikiVal;
    firstRun : boolean;
    fireOnInitialRun : boolean;
    
    constructor(expr : HExpr, fireOnInitialRun : boolean) {
        this.expr = expr;
        this.lastVal = null;
        this.firstRun = true;
        this.fireOnInitialRun = fireOnInitialRun;
    }

    checkValue(dataenv : DataEnvironment) : [HibikiVal, boolean] {
        let val = evalExprAst(this.expr, dataenv, "resolve");
        let valUpdated = !DeepEqual(val, this.lastVal);
        if (this.firstRun) {
            valUpdated = this.fireOnInitialRun;
        }
        this.lastVal = val;
        this.firstRun = false;
        return [val, valUpdated];
    }
}

class LambdaValue {
    expr : HExpr;
    invokeFn : (dataenv : DataEnvironment, params : HibikiParamsObj) => HibikiVal;
    
    constructor(expr : HExpr, invokeFn : (dataenv : DataEnvironment, params : HibikiParamsObj) => HibikiVal) {
        this.expr = expr;
        this.invokeFn = invokeFn;
    }

    invoke(dataenv : DataEnvironment, params : HibikiParamsObj) : HibikiVal {
        if (this.expr) {
            dataenv = dataenv.makeChildEnv(params.params, {htmlContext: "invoke-context"});
            let rtn = evalExprAst(this.expr, dataenv, "natural");
            return rtn;
        }
        if (this.invokeFn) {
            let invokeRtn = this.invokeFn(dataenv, params);
            return invokeRtn;
        }
        return null;
    }
}

abstract class LValue {
    abstract get() : HibikiVal;
    abstract set(newVal : HibikiVal) : void;
    abstract subArrayIndex(index : number) : LValue;
    abstract subMapKey(key : string) : LValue;
    abstract asString() : string;
}

class NullLValue extends LValue {
    constructor() {
        super();
    }

    get() : HibikiVal {
        return null;
    }

    set(newVal : HibikiVal) : void {
        // nothing
    }

    subMapKey(key : string) : LValue {
        return new NullLValue();
    }

    subArrayIndex(index : number) : LValue {
        return new NullLValue();
    }

    asString() : string {
        return "[lvalue:null]";
    }
}

class BoundLValue extends LValue {
    path : PathType;
    dataenv : DataEnvironment
    rtContext : string;
    
    constructor(path : PathType, dataenv : DataEnvironment, rtContext? : string) {
        super();
        this.path = path;
        this.dataenv = dataenv;
        this.rtContext = rtContext;
    }

    get() : HibikiVal {
        let staticPath = evalPath(this.path, this.dataenv);
        return ResolvePath(staticPath, this.dataenv, {rtContext: this.rtContext});
    }

    set(newVal : HibikiVal) {
        let staticPath = evalPath(this.path, this.dataenv);
        SetPath(staticPath, this.dataenv, newVal, {rtContext: this.rtContext, setop: "setraw"});
    }

    subArrayIndex(index : number) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "array", pathindex: index});
        return new BoundLValue(newpath, this.dataenv, this.rtContext);
    }

    subMapKey(key : string) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "map", pathkey: key});
        return new BoundLValue(newpath, this.dataenv, this.rtContext);
    }

    asString() : string {
        return sprintf("[lvalue:%s]", StringPath(this.path));
    }
}

function exValToVal(exVal : HibikiVal) : HibikiVal {
    if (exVal == null) {
        return null;
    }
    if (exVal instanceof LValue) {
        return exVal.get();
    }
    if (exVal === SYM_NOATTR) {
        return null;
    }
    if (typeof(exVal) === "symbol" || exVal instanceof Symbol) {
        return exVal.toString();
    }
    return exVal;
}

class ReadOnlyLValue extends LValue {
    wrappedLV : LValue;

    constructor(lv : LValue) {
        super();
        this.wrappedLV = lv;
    }

    get() : HibikiVal {
        return this.wrappedLV.get();
    }

    set(newVal : HibikiVal) {
        return;
    }

    subArrayIndex(index : number) : LValue {
        let rtn = this.wrappedLV.subArrayIndex(index);
        return new ReadOnlyLValue(rtn);
    }

    subMapKey(key : string) : LValue {
        let rtn = this.wrappedLV.subMapKey(key);
        return new ReadOnlyLValue(rtn);
    }

    asString() : string {
        return sprintf("[readonly-lvalue:%s]", this.wrappedLV.asString());
    }
}

function CreateReadOnlyLValue(val : any, debugName : string) : LValue {
    let box = mobx.observable.box(val, {deep: false, name: debugName});
    let lvalue = new ObjectLValue(null, box);
    return new ReadOnlyLValue(lvalue);
}

function CreateObjectLValue(val : any, debugName : string) : LValue {
    let box = mobx.observable.box(val, {deep: false, name: debugName});
    let lvalue = new ObjectLValue(null, box);
    return lvalue;
}

class ObjectLValue extends LValue {
    path : PathType;
    root : mobx.IObservableValue<any>;
    rtContext : string;

    constructor(path? : PathType, root? : mobx.IObservableValue<any>, name? : string) {
        super();
        if (path == null) {
            path = [{pathtype: "root", pathkey: "global"}];
        }
        if (root == null) {
            root = mobx.observable.box(null, {name: (name || "ObjectLValue")});
        }
        this.path = path;
        this.root = root;
        this.rtContext = name;
    }

    get() : HibikiVal {
        return quickObjectResolvePath(this.path, this.root.get());
    }

    set(newVal : HibikiVal) {
        this.root.set(quickObjectSetPath(this.path, this.root.get(), newVal));
    }

    subArrayIndex(index : number) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "array", pathindex: index});
        return new ObjectLValue(newpath, this.root);
    }

    subMapKey(key : string) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "map", pathkey: key});
        return new ObjectLValue(newpath, this.root);
    }

    asString() : string {
        return sprintf("[object-lvalue:%s]", StringPath(this.path));
    }
}

function StringPath(path : PathUnionType) : string {
    if (typeof(path) === "string") {
        return path;
    }
    if (path.length === 0) {
        return "[empty]";
    }
    let rtn = "";
    for (let i=0; i<path.length; i++) {
        let pp = path[i];
        if (pp.pathtype === "root") {
            if (i === 0) {
                if (pp.pathkey === "global" || pp.pathkey == null) {
                    rtn = "$";
                }
                else if (pp.pathkey === "context") {
                    rtn = "@";
                }
                else if (pp.pathkey === "currentcontext") {
                    rtn = "@";
                }
                else {
                    rtn = "$" + pp.pathkey;
                }
            }
            continue;
        }
        else if (pp.pathtype === "dot") {
            continue;
        }
        else if (pp.pathtype === "array") {
            rtn = rtn + sprintf("[%d]", pp.pathindex);
        }
        else if (pp.pathtype === "dyn") {
            rtn = rtn + "[dyn]";
        }
        else if (pp.pathtype === "deref") {
            rtn = rtn + "$(deref)";
        }
        else if (pp.pathtype === "map") {
            if (pp.pathkey == null) {
                continue;
            }
            let partStr = _pathPartStr(rtn, pp.pathkey);
            rtn += partStr;
        }
    }
    return rtn;
}

function _pathPartStr(curPath : string, key : string) : string {
    if (key.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        if (curPath === "." || curPath === "@") {
            return key;
        }
        return "." + key;
    }
    else {
        return sprintf("[%s]", JSON.stringify(key));
    }
}

function ParseBlock(blockStr : string) : HAction[] {
    try {
        return ParseBlockThrow(blockStr);
    }
    catch (e) {
        console.log("ERROR during ParseBlock [[", blockStr, "]]", e);
        return null;
    }
}

function ParseBlockThrow(blockStr : string) : HAction[] {
    let block : HAction[] = doParse(blockStr + ";", "ext_statementBlock");
    return block;
}

function ParsePath(path : string) : PathType {
    try {        
        return ParsePathThrow(path);
    }
    catch (e) {
        console.log(sprintf("ERROR during ParsePath [[%s]]", path), e);
        return null;
    }
}

function ParsePathThrow(pathStr : string, allowDynamic? : boolean) : PathType {
    let expr = doParse(pathStr, "ext_pathExprNonTerm");
    let path : PathType = expr.path;
    if (!allowDynamic) {
        for (let i=0; i<path.length; i++) {
            if (path[i].pathtype === "dyn") {
                throw new Error("Error parsing path, path must be static (no dynamic references allowed): + " + pathStr);
            }
            if (path[i].pathtype === "deref") {
                throw new Error("Error parsing path, path must be static (no dereferencing allowed): + " + pathStr);
            }
        }
    }
    return path;
}

function ParseSetPath(setpath : string) : { op : string, path : PathType } {
    try {
        return ParseSetPathThrow(setpath);
    }
    catch (e) {
        console.log("ERROR during ParseSetPath", "[[", setpath, "]]", e);
        return null;
    }
}

function ParseSetPathThrow(setpath : string) : { op : string, path : PathType } {
    let found = setpath.match(/^([a-z][a-z0-9]*)\:(.+)/);
    if (found == null) {
        let rtnPath = ParsePathThrow(setpath);
        return {op : "set", path: rtnPath};
    }
    let rtnPath = ParsePathThrow(found[2]);
    return {op: found[1], path: rtnPath};
}

function internalResolvePath(path : PathType, irData : HibikiVal, dataenv : DataEnvironment, resolveType : "resolve" | "lvalue", level : number) : HibikiVal {
    // note that irData starts as null when resolving a root path
    if (level >= path.length || irData === SYM_NOATTR) {
        return irData ?? null;   // remove 'undefined'
    }
    let pp = path[level];
    if (pp.pathtype === "root") {
        if (level !== 0) {
            throw new Error(sprintf("Root($) path invalid in ResolvePath except at level 0, path=%s, level=%d", StringPath(path), level));
        }
        if (pp.pathkey === "expr") {
            let newIrData : HibikiVal = pp.value;
            return internalResolvePath(path, newIrData, dataenv, resolveType, level+1);
        }
        let newIrData : HibikiVal = null;
        try {
            newIrData = dataenv.resolveRoot(pp.pathkey, {caret: pp.caret});
        }
        catch (e) {
            throw new Error(sprintf("Invalid root path, path=%s, pathkey=%s, level=%d", StringPath(path), pp.pathkey, level));
        }
        return internalResolvePath(path, newIrData, dataenv, resolveType, level+1);
    }
    else if (pp.pathtype === "array") {
        if (irData instanceof LValue) {
            if (resolveType === "lvalue") {
                return irData.subArrayIndex(pp.pathindex);
            }
            irData = resolveLValue(irData);
        }
        if (irData == null || irData === SYM_NOATTR) {
            return irData ?? null;   // remove 'undefined'
        }
        let [_, isSpecial] = asSpecial(irData, false);
        if (isSpecial) {
            return null;
        }
        let [arrObj, isArray] = asArray(irData, false);
        if (!isArray) {
            throw new Error(sprintf("Cannot resolve array index (non-array) in ResolvePath, path=%s, level=%d", StringPath(path), level));
        }
        if (pp.pathindex < 0) {
            throw new Error(sprintf("Bad array index: %d in ResolvePath, path=%s, level=%d", pp.pathindex, StringPath(path), level));
        }
        if (pp.pathindex >= arrObj.length) {
            return null;
        }
        return internalResolvePath(path, arrObj[pp.pathindex], dataenv, resolveType, level+1);
    }
    else if (pp.pathtype === "map") {
        if (irData instanceof LValue) {
            if (resolveType === "lvalue") {
                return irData.subMapKey(pp.pathkey);
            }
            irData = resolveLValue(irData);
        }
        if (irData == null || irData === SYM_NOATTR) {
            return null;
        }
        if (irData instanceof HibikiWrappedObj) {
            if (!irData.allowedGetters(pp.pathkey)) {
                return null;
            }
            return internalResolvePath(path, irData[pp.pathkey], dataenv, resolveType, level+1);
        }
        let [_, isSpecial] = asSpecial(irData, false);
        if (isSpecial) {
            return null;
        }
        if ((irData instanceof Map) || mobx.isObservableMap(irData)) {
            return internalResolvePath(path, irData.get(pp.pathkey), dataenv, resolveType, level+1);
        }
        let [dataObj, isObj] = asPlainObject(irData, false);
        if (!isObj) {
            throw new Error(sprintf("Cannot resolve map key (non-object) in ResolvePath, path=%s, level=%d, type=%s", StringPath(path), level, hibikiTypeOf(irData)));
        }
        if (level == 1 && path[0].pathtype === "root" && path[0].pathkey === "args" && !(pp.pathkey in dataObj)) {
            // special case, NOATTR for undefined values off $args root
            return SYM_NOATTR;
        }
        return internalResolvePath(path, dataObj[pp.pathkey], dataenv, resolveType, level+1);
    }
    else {
        throw new Error(sprintf("Bad PathPart in ResolvePath, path=%s, pathtype=%s, level=%d", StringPath(path), pp.pathtype, level));
    }
    return null;
}

function ResolvePath(pathUnion : PathUnionType, dataenv : DataEnvironment, opts? : RtContextOpts) : any {
    try {
        return ResolvePathThrow(pathUnion, dataenv);
    }
    catch (e) {
        let context = "";
        if (opts && opts.rtContext != null) {
            context = " | " + opts.rtContext;
        }
        console.log(sprintf("ResolvePath Error: %s%s", e.message, context));
        return null;
    }
}

function ResolvePathThrow(pathUnion : PathUnionType, dataenv : DataEnvironment) : any {
    let path : PathType = null;
    if (typeof(pathUnion) === "string") {
        path = ParsePath(pathUnion);
    }
    else {
        path = pathUnion;
    }
    if (path == null) {
        return null;
    }
    return internalResolvePath(path, null, dataenv, "resolve", 0);
}

function appendData(path : PathType, curData : HibikiVal, newData : HibikiVal) : HibikiVal {
    if (curData == null) {
        return [newData];
    }
    let [arrVal, isArr] = asArray(curData, false);
    if (isArr) {
        arrVal.push(newData);
        return arrVal;
    }
    if (typeof(curData) === "string" && newData == null) {
        return curData;
    }
    if (typeof(curData) === "string" && typeof(newData) === "string") {
        return curData + newData;
    }
    throw new Error(sprintf("SetPath cannot append newData, path=%s, typeof=%s", StringPath(path), hibikiTypeOf(curData)));
}

function appendArrData(path : PathType, curData : HibikiVal, newData : HibikiVal) : HibikiVal {
    if (newData == null) {
        return curData;
    }
    let [newDataArr, isNewDataArr] = asArray(newData, false);
    if (!isNewDataArr) {
        return curData;
    }
    if (curData == null) {
        return newData;
    }
    let [curDataArr, isCurDataArr] = asArray(curData, false);
    if (isCurDataArr) {
        for (let v of newDataArr) {
            curDataArr.push(v);
        }
        return curDataArr;
    }
    throw new Error(sprintf("SetPath cannot appendarr newData, path=%s, typeof=%s", StringPath(path), hibikiTypeOf(curData)));
}

function setPathWrapper(op : string, path : PathType, dataenv : DataEnvironment, setData : HibikiVal, opts : {allowContext : boolean}) {
    let allowContext = opts.allowContext;
    if (path == null) {
        throw new Error(sprintf("Invalid set path expression, null path"));
    }
    let rootpp = path[0];
    if (rootpp.pathtype !== "root") {
        throw new Error(sprintf("Invalid non-rooted path expression [[%s]]", StringPath(path)));
    }
    if ((rootpp.pathkey === "global") || (rootpp.pathkey === "data")) {
        if (path.length === 1 && op === "set") {
            dataenv.dbstate.DataRoots["global"].set(setData);
            return;
        }
        let irData = dataenv.resolveRoot(rootpp.pathkey);
        internalSetPath(dataenv, op, path, irData, false, setData, 1);
        return;
    }
    if (path.length <= 1) {
        throw new Error(sprintf("Invalid set path expression, cannot set raw root [[%s]] %s", StringPath(path), rootpp.pathkey));
    }
    else if (rootpp.pathkey === "state") {
        let irData = dataenv.resolveRoot("state");
        internalSetPath(dataenv, op, path, irData, false, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "context" && allowContext) {
        let irData = dataenv.resolveRoot("context", {caret: rootpp.caret});
        internalSetPath(dataenv, op, path, irData, false, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "currentcontext" && allowContext) {
        let irData = dataenv.resolveRoot("currentcontext", {caret: rootpp.caret});
        internalSetPath(dataenv, op, path, irData, false, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "c" || rootpp.pathkey === "component") {
        let irData = dataenv.resolveRoot("c");
        internalSetPath(dataenv, op, path, irData, false, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "args") {
        let irData = dataenv.resolveRoot("args");
        internalSetPath(dataenv, op, path, irData, true, setData, 1);
        return;
    }
    else {
        if (allowContext) {
            throw new Error(sprintf("Cannot SetPath except $data ($), $state, $args, $c, or $context (@) roots, path=%s", StringPath(path)));
        }
        else {
            throw new Error(sprintf("Cannot SetPath except $data ($), $state, $args, or $c, path=%s", StringPath(path)));
        }
    }
    
}

function ObjectSetPath(pathStr : string, localRoot : any, setData : any) : any {
    let {op, path} = ParseSetPath(pathStr);
    if (path == null || path.length <= 1) {
        return;
    }
    let rootpp = path[0];
    if (rootpp.pathtype !== "root" || rootpp.pathkey !== "global") {
        return;
    }
    return internalSetPath(null, op, path, localRoot, false, setData, 1, {nomap: true});
}

function quickObjectResolvePath(path : PathType, localRoot : any) : any {
    if (path == null || path.length === 0) {
        return null;
    }
    let rootpp = path[0];
    if (rootpp.pathtype !== "root" || rootpp.pathkey !== "global") {
        return;
    }
    try {
        return internalResolvePath(path, localRoot, null, "resolve", 1);
    }
    catch (e) {
        console.log("Error getting object path", e);
        return null;
    }
}

function quickObjectSetPath(path : PathType, localRoot : any, setData : any) : any {
    if (path == null || path.length === 0) {
        return null;
    }
    let rootpp = path[0];
    if (rootpp.pathtype !== "root" || rootpp.pathkey !== "global") {
        return;
    }
    try {
        return internalSetPath(null, "set", path, localRoot, false, setData, 1, {nomap: true});
    }
    catch (e) {
        console.log("Error setting object path", e);
        return null;
    }
}

function runSetOp(path : PathType, localRoot : HibikiVal, op : string, origSetData : HibikiVal, readOnly : boolean) : HibikiVal {
    let setData = DeepCopy(origSetData);
    if (localRoot instanceof LValue) {
        if (op === "set") {
            localRoot.set(setData);
            return localRoot;
        }
        if (readOnly) {
            return localRoot;
        }
        if (op === "setraw") {
            return setData;
        }
        throw new Error(sprintf("Invalid setPath op=%s for LValue bindpath", op));
    }
    if (readOnly) {
        return localRoot;
    }
    if (op === "append") {
        return appendData(path, localRoot, setData);
    }
    if (op === "appendarr") {
        return appendArrData(path, localRoot, setData);
    }
    else if (op === "set" || op === "setraw") {
        return setData;
    }
    else if (op === "setunless") {
        if (localRoot != null) {
            return localRoot;
        }
        return setData;
    }
    else if (op === "blobext") {
        return blobExtDataPath(path, localRoot, setData);
    }
    else {
        throw new Error(sprintf("Invalid setPath op=%s", op));
    }
}

function internalSetPath(dataenv : DataEnvironment, op : string, path : PathType, localRoot : HibikiVal, readOnly : boolean, setData : HibikiVal, level : number, opts? : {}) : any {
    if (mobx.isBoxedObservable(localRoot)) {
        throw new Error("Bad localRoot -- cannot be boxed observable.");
    }
    opts = opts || {};
    if (level >= path.length) {
        return runSetOp(path, localRoot, op, setData, readOnly);
    }
    let pp = path[level];
    if (pp.pathtype === "root") {
        throw new Error(sprintf("Invalid path, root path not first part, path=%s, level=%d", StringPath(path), level));
    }
    else if (pp.pathtype === "array") {
        if (pp.pathindex < 0 || pp.pathindex > MAX_ARRAY_SIZE) {
            throw new Error(sprintf("SetPath bad array index=%d, path=%s, level=%d", pp.pathindex, StringPath(path), level));
        }
        let resolvedVal : HibikiVal = null;
        let originalResolvedVal : HibikiVal = null;
        if (localRoot instanceof LValue) {
            resolvedVal = localRoot.get();
            originalResolvedVal = resolvedVal;
        }
        else {
            resolvedVal = localRoot;
        }
        if (resolvedVal == null) {
            resolvedVal = [];
        }
        let [_, isSpecial] = asSpecial(resolvedVal, false);
        if (isSpecial) {
            throw new Error(sprintf("SetPath cannot resolve array index through %s, path=%s, level=%d", specialValToString(resolvedVal), StringPath(path), level));
        }
        let [arrVal, isArr] = asArray(resolvedVal, false);
        if (!isArr) {
            throw new Error(sprintf("SetPath cannot resolve array index through non-array, path=%s, level=%d, type=%s", StringPath(path), level, hibikiTypeOf(resolvedVal)));
        }
        if (arrVal.length < pp.pathindex + 1) {
            arrVal.length = pp.pathindex + 1;
        }
        let newVal = internalSetPath(dataenv, op, path, arrVal[pp.pathindex], readOnly, setData, level+1, opts);
        arrVal[pp.pathindex] = newVal;
        if (localRoot instanceof LValue) {
            if (arrVal !== originalResolvedVal) {
                localRoot.set(arrVal);
            }
            return localRoot;
        }
        return arrVal;
    }
    else if (pp.pathtype === "map") {
        let resolvedVal : HibikiVal = null;
        let originalResolvedVal : HibikiVal = null;
        if (localRoot instanceof LValue) {
            resolvedVal = localRoot.get();
            originalResolvedVal = resolvedVal;
        }
        else {
            resolvedVal = localRoot;
        }
        if (resolvedVal == null) {
            resolvedVal = {};
        }
        let [_, isSpecial] = asSpecial(resolvedVal, false);
        if (isSpecial) {
            throw new Error(sprintf("SetPath cannot resolve map key through %s, path=%s, level=%d", specialValToString(resolvedVal), StringPath(path), level));
        }
        if ((resolvedVal instanceof Map) || mobx.isObservableMap(localRoot)) {
            let mapVal = (resolvedVal as any) as Map<string, HibikiVal>;
            let newVal = internalSetPath(dataenv, op, path, mapVal.get(pp.pathkey), readOnly, setData, level+1, opts);
            mapVal.set(pp.pathkey, newVal);
        }
        else {
            let [objVal, isObj] = asPlainObject(resolvedVal, false);
            if (!isObj) {
                throw new Error(sprintf("SetPath cannot resolve map key through non-object, path=%s, level=%d, type=%s", StringPath(path), level, hibikiTypeOf(resolvedVal)));
            }
            let newVal = internalSetPath(dataenv, op, path, objVal[pp.pathkey], readOnly, setData, level+1, opts);
            objVal[pp.pathkey] = newVal;  // sets resolvedVal (objVal is just a typed version of resolvedVal)
        }
        if (localRoot instanceof LValue) {
            if (resolvedVal !== originalResolvedVal) {
                localRoot.set(resolvedVal);
            }
            return localRoot;
        }
        return resolvedVal;
    }
    else {
        throw new Error(sprintf("Bad PathPart in SetPath, path=%s, level=%d", StringPath(path), level));
    }
    return null;
}

function SetPath(path : PathUnionType, dataenv : DataEnvironment, setData : HibikiVal, opts? : SetPathOpts) {
    try {
        SetPathThrow(path, dataenv, setData, opts);
    }
    catch (e) {
        let context = "";
        if (opts && opts.rtContext != null) {
            context = " | " + opts.rtContext;
        }
        console.log(sprintf("SetPath Error: %s%s", e.message, context));
    }
}

function SetPathThrow(pathUnion : PathUnionType, dataenv : DataEnvironment, setData : HibikiVal, opts? : SetPathOpts) {
    opts = opts ?? {};
    let path : PathType = null;
    let op : string = null;
    if (typeof(pathUnion) === "string") {
        let spr = ParseSetPath(pathUnion);
        if (spr == null) {
            return;
        }
        path = spr.path;
        op = spr.op;
    }
    else {
        path = pathUnion;
        op = opts.setop ?? "set";
    }
    if (path == null) {
        return;
    }
    setPathWrapper(op, path, dataenv, setData, {allowContext: false});
}

function specialValToString(val : any) : string {
    if (val === SYM_NOATTR) {
        return "[noattr]";
    }
    if (typeof(val) === "symbol" || val instanceof Symbol) {
        return val.toString();
    }
    if (typeof(val) === "function") {
        return "[Function]";
    }
    if (typeof(val) === "bigint") {
        return val.toString();
    }
    if (val instanceof DataEnvironment) {
        return "[DataEnvironment]";
    }
    if (val instanceof HibikiRequest) {
        return sprintf("[HibikiRequest:%s]", val.reqid);
    }
    if (val instanceof HibikiState || val instanceof HibikiExtState) {
        return "[HibikiState]";
    }
    if (val instanceof HibikiWrappedObj) {
        return val.asString();
    }
    if (val instanceof LambdaValue) {
        return "[lambda]";
    }
    if (val instanceof OpaqueValue) {
        return "[opaque]";
    }
    if (val instanceof RtContext) {
        return sprintf("[RtContext:%s]", val.rtid);
    }
    if (val instanceof LValue) {
        return val.asString();
    }
    if (val instanceof Map) {
        return "[map]";
    }
    return "[" + hibikiTypeOf(val) + "]";
}

function mapToObject(m : Map<string, HibikiVal>) : HibikiValObj {
    let rtn = {};
    for (let [k,v] of m) {
        rtn[k] = v;
    }
    return rtn;
}

function JsonReplacerFn(key : string, val : any) : any {
    if (val == null) {
        return null;
    }
    if (val instanceof Map) {
        return mapToObject(val);
    }
    let [sval, isSpecial] = asSpecial(val, false);
    if (!isSpecial) {
        return val;
    }
    return specialValToString(val);
}

class CycleDetector {
    cycleMap : WeakMap<HibikiVal[] | HibikiValObj, number>;
    cyclePath : string[];

    constructor() {
        this.cycleMap = new WeakMap();
        this.cyclePath = ["root"];
    }

    addObj(val : HibikiValObj | HibikiVal[]) : string {
        let cycleIdx = this.cycleMap.get(val);
        if (cycleIdx != null) {
            let prevPath = this.cyclePath.slice(0, cycleIdx).join("");
            return this.cyclePath.join("") + " -> " + prevPath;
        }
        this.cycleMap.set(val, this.cyclePath.length);
        return null;
    }

    removeObj(val : HibikiValObj | HibikiVal[]) : void {
        this.cycleMap.delete(val);
    }

    pushPath(path : string) : void {
        this.cyclePath.push(path);
    }

    popPath() : void {
        this.cyclePath.pop();
    }
}

function CheckCycle(data : HibikiVal, detector? : CycleDetector) : [boolean, string] {
    if (data == null) {
        return [false, null];
    }
    if (detector == null) {
        detector = new CycleDetector();
    }
    if (mobx.isBoxedObservable(data)) {
        return CheckCycle(data.get(), detector);
    }
    let [pdata, isPrim] = asPrimitive(data);
    if (isPrim) {
        return [false, null];
    }
    let [sdata, isSpecial] = asSpecial(data, false);
    if (isSpecial) {
        if (sdata instanceof LValue) {
            detector.pushPath(".*");
            let rtn = CheckCycle(sdata.get(), detector);
            detector.popPath();
            return rtn;
        }
        return [false, null];
    }
    let [arrData, isArray] = asArray(data, false);
    if (isArray) {
        let cyclePath = detector.addObj(arrData);
        if (cyclePath != null) {
            return [true, cyclePath];
        }
        for (let idx=0; idx<arrData.length; idx++) {
            let av = arrData[idx];
            detector.pushPath("[" + idx + "]");
            let [isCycle, cyclePath] = CheckCycle(av, detector);
            detector.popPath();
            if (isCycle) {
                return [true, cyclePath];
            }
        }
        detector.removeObj(arrData);
        return [false, null];
    }
    let [objData, isObj] = asPlainObject(data, false);
    if (isObj) {
        let cyclePath = detector.addObj(objData);
        if (cyclePath != null) {
            return [true, cyclePath];
        }
        let rtn : HibikiValObj = {};
        for (let key in objData) {
            detector.pushPath(_pathPartStr(null, key));
            let [isCycle, cyclePath] = CheckCycle(objData[key], detector);
            detector.popPath();
            if (isCycle) {
                return [true, cyclePath];
            }
        }
        detector.removeObj(objData);
        return [false, null];
    }
    return [false, null];
}

function stripNoAttrShallow<T extends HibikiVal>(val : T) : T {
    if (val == null || val === SYM_NOATTR) {
        return null;
    }
    let [arrObj, isArr] = asArray(val, false);
    if (isArr) {
        arrObj = [...arrObj];
        for (let i=arrObj.length-1; i>=0; i--) {
            if (arrObj[i] === SYM_NOATTR) {
                arrObj.pop();
                continue;
            }
            break;
        }
        for (let i=0; i<arrObj.length; i++) {
            if (arrObj[i] === SYM_NOATTR) {
                arrObj[i] = null;
            }
        }
        return arrObj as T;
    }
    let [plainObj, isObj] = asPlainObject(val, false);
    if (isObj) {
        plainObj = {...plainObj};
        for (let key in plainObj) {
            if (plainObj[key] === SYM_NOATTR) {
                delete plainObj[key];
            }
        }
        return plainObj as T;
    }
    return val;
}

type DeepCopyOptsType = {resolve? : boolean, json? : boolean, cycleArr? : HibikiVal[], cyclePath? : string[]};

function DeepCopyTypeSafe<T extends (HibikiValObj | HibikiVal[])>(data : T, opts? : DeepCopyOptsType) : T {
    return DeepCopy(data, opts) as T;
}

function CleanVal(data : any) : HibikiVal {
    return DeepCopy(data);
}

// this also has the effect of demobx
function DeepCopy(data : HibikiVal, opts? : DeepCopyOptsType) : HibikiVal {
    if (data == null) {
        return null;
    }
    if (mobx.isBoxedObservable(data)) {
        return DeepCopy(data.get(), opts);
    }
    opts = opts ?? {};
    if (opts.cycleArr == null) {
        opts.cycleArr = [];
        opts.cyclePath = [];
    }
    let [pdata, isPrim] = asPrimitive(data);
    if (isPrim) {
        return pdata;
    }
    if (data instanceof Map) {
        return mapToObject(data);
    }
    let [sdata, isSpecial] = asSpecial(data, false);
    if (isSpecial) {
        if (opts.resolve && sdata instanceof LValue) {
            opts.cyclePath.push(".*");
            return DeepCopy(sdata.get(), opts);
        }
        if (opts.resolve && sdata === SYM_NOATTR) {
            return null;
        }
        if (opts.json) {
            return specialValToString(sdata);
        }
        return sdata;
    }
    let [arrData, isArray] = asArray(data, false);
    if (isArray) {
        if (opts.cycleArr.indexOf(arrData) !== -1) {
            throw new Error(sprintf("DeepCopy circular-reference cycle: %s", opts.cyclePath.join("")));
        }
        opts.cycleArr.push(arrData);
        let rtn : HibikiVal[] = [];
        for (let idx=0; idx<arrData.length; idx++) {
            let av = arrData[idx];
            opts.cyclePath.push("[" + idx + "]");
            rtn.push(DeepCopy(av, opts));
            opts.cyclePath.pop();
        }
        opts.cycleArr.pop();
        return rtn;
    }
    let [objData, isObj] = asPlainObject(data, false);
    if (isObj) {
        if (opts.cycleArr.indexOf(objData) !== -1) {
            throw new Error(sprintf("DeepCopy circular-reference cycle: %s", opts.cyclePath.join("")));
        }
        opts.cycleArr.push(objData);
        let rtn : HibikiValObj = {};
        for (let key in objData) {
            opts.cyclePath.push(_pathPartStr(null, key));
            rtn[key] = DeepCopy(objData[key], opts);
            opts.cyclePath.pop();
        }
        opts.cycleArr.pop();
        return rtn;
    }
    return null;
}

function hibikiTypeOf(val : HibikiVal) : string {
    if (val == null) {
        return "null";
    }
    if (mobx.isArrayLike(val)) {
        return "array";
    }
    if (typeof(val) !== "object") {
        return typeof(val);
    }
    if (val instanceof Map) {
        return "map";
    }
    if (Object.getPrototypeOf(val) === Object.prototype) {
        return "object";
    }
    if (val instanceof HibikiWrappedObj) {
        return val.hibikiTypeOf();
    }
    if (val instanceof OpaqueValue) {
        return "hibiki:opaque";
    }
    if (val instanceof LambdaValue) {
        return "hibiki:lambda";
    }
    if (val instanceof LValue) {
        return "hibiki:lvalue";
    }
    if (val instanceof DataEnvironment) {
        return "hibiki:dataenvironment";
    }
    if (val instanceof HibikiRequest) {
        return "hibiki:request";
    }
    if (val instanceof RtContext) {
        return "hibiki:rtcontext";
    }
    if (val instanceof HibikiState) {
        return "hibiki:state";
    }
    return "unknown";
}

function resolveToPrimitive(data : HibikiVal) : HibikiPrimitiveVal {
    let [pval, isPrim] = asPrimitive(data);
    if (isPrim) {
        return pval;
    }
    return valToString(data);
}

function asPrimitive(data : HibikiVal) : [HibikiPrimitiveVal, boolean] {
    if (data == null) {
        return [null, true];
    }
    if (typeof(data) === "string" || typeof(data) === "number" || typeof(data) === "boolean") {
        return [data, true];
    }
    return [null, false];
}

function asSpecial(data : HibikiVal, nullOk : boolean) : [HibikiSpecialVal, boolean] {
    if (data == null) {
        return [null, false];
    }
    if (typeof(data) === "symbol" || data instanceof OpaqueValue || data instanceof LambdaValue || data instanceof LValue || data instanceof HibikiWrappedObj) {
        return [data, true];
    };
    if (typeof(data) === "object") {
        if (mobx.isArrayLike(data)) {
            return [null, false];
        }
        if (Object.getPrototypeOf(data) !== Object.prototype) {
            // safety case, if some strange item gets into the data (State, DataEnvironment, Error, RtContext, etc.)
            return [data as any, true];
        }
        return [null, false];
    }
    return [null, false];
}

function isNoAttr(data : HibikiVal) : boolean {
    if (data instanceof LValue) {
        data = resolveLValue(data)
    }
    return (data === SYM_NOATTR);
}

function asPlainObject(data : HibikiVal, nullOk : boolean) : [HibikiValObj, boolean] {
    if (data == null) {
        return [null, nullOk];
    }
    let [_, isSpecial] = asSpecial(data, false);
    if (isSpecial) {
        return [null, false];
    }
    let [__, isArray] = asArray(data, false);
    if (isArray) {
        return [null, false];
    }
    if (Object.getPrototypeOf(data) === Object.prototype) {
        return [data as HibikiValObj, true];
    }
    return [null, false];
}

function asStyleMap(data : HibikiVal, nullOk : boolean) : [StyleMapType, boolean] {
    if (data == null) {
        return [null, nullOk];
    }
    let [objVal, isObj] = asPlainObject(data, false);
    if (!isObj) {
        return [null, false];
    }
    for (let styleProp in objVal) {
        let val = objVal[styleProp];
        if (val != null && typeof(val) !== "string" && typeof(val) !== "number") {
            return [null, false];
        }
    }
    return [objVal as StyleMapType, true];
}

function asStyleMapFromPair([val, exists] : [HibikiVal, boolean]) : [StyleMapType, boolean] {
    if (!exists) {
        return [null, false];
    }
    return asStyleMap(val, false);
}

function asArray(data : HibikiVal, nullOk : boolean) : [HibikiVal[], boolean] {
    if (data == null) {
        return [null, nullOk];
    }
    if (!mobx.isArrayLike(data)) {
        return [null, false];
    }
    return [data, true];
}

function isArrayEqual(data1 : HibikiVal[], data2 : HibikiVal[]) : boolean {
    if (data1.length !== data2.length) {
        return false;
    }
    for (let i=0; i<data1.length; i++) {
        if (!DeepEqual(data1[i], data2[i])) {
            return false;
        }
    }
    return true;
}

function DeepEqual(data1 : HibikiVal, data2 : HibikiVal) : boolean {
    if (data1 === data2) {
        return true;
    }
    if (data1 instanceof LValue) {
        data1 = data1.get();
    }
    if (data2 instanceof LValue) {
        data2 = data2.get();
    }
    if ((data1 == null && data2 == null) || data1 === data2) {
        return true;
    }
    if (data1 == null || data2 == null) {
        return false;
    }
    let [_,  d1IsSpecial] = asSpecial(data1, false);
    let [__, d2IsSpecial] = asSpecial(data2, false);
    if (d1IsSpecial || d2IsSpecial) {
        return false;  // special values are only equal if "===" (already checked above)
    }
    let [d1arr, d1IsArr] = asArray(data1, false);
    let [d2arr, d2IsArr] = asArray(data2, false);
    if (d1IsArr && d2IsArr) {
        return isArrayEqual(d1arr, d2arr);
    }
    if (d1IsArr || d2IsArr) {
        return false;
    }
    let [d1prim, d1IsPrim] = asPrimitive(data1);
    let [d2prim, d2IsPrim] = asPrimitive(data2);
    if (d1IsPrim && d2IsPrim) {
        return d1prim == d2prim;
    }
    if (d1IsPrim || d2IsPrim) {
        return false;
    }
    let [d1obj, d1IsObj] = asPlainObject(data1, false);
    let [d2obj, d2IsObj] = asPlainObject(data2, false);
    if (!d1IsObj || !d2IsObj) {
        return false;
    }
    let d1keys : string[] = Object.keys(data1);
    let d2keys : string[] = Object.keys(data2);
    if (d1keys.length !== d2keys.length) {
        return false;
    }
    for (let key of d1keys) {
        let v1 = d1obj[key];
        let v2 = d2obj[key];
        if (!DeepEqual(v1, v2)) {
            return false;
        }
    }
    return true;
}

function demobxInternal<T extends HibikiVal>(v : T) : [T, boolean] {
    if (v == null) {
        return [null, false];
    }
    let [vprim, isPrim] = asPrimitive(v);
    if (isPrim) {
        return [v, false];
    }
    let [vspecial, isSpecial] = asSpecial(v, false);
    if (isSpecial) {
        return [v, false];
    }
    let [varr, isArray] = asArray(v, false);
    if (isArray) {
        let rtnArr : HibikiVal[] = varr.slice();
        let arrUpdated = mobx.isObservable(varr);
        for (let i=0; i<rtnArr.length; i++) {
            let [elem, elemUpdated] = demobxInternal(rtnArr[i]);
            if (elemUpdated) {
                arrUpdated = true;
            }
            rtnArr[i] = elem;
        }
        if (arrUpdated) {
            return [rtnArr as T, true];
        }
        return [varr as T, false];
    }
    let [vobj, isObj] = asPlainObject(v, false);
    if (isObj) {
        let rtnObj : HibikiValObj = {};
        let objUpdated = mobx.isObservable(vobj);
        for (let key in vobj) {
            let [elem, elemUpdated] = demobxInternal(vobj[key]);
            if (elemUpdated) {
                objUpdated = true;
            }
            rtnObj[key] = elem;
        }
        if (objUpdated) {
            return [rtnObj as T, true];
        }
        return [vobj as T, false];
    }
    return [null as T, false];
}

function demobx<T extends HibikiVal>(v : T) : T {
    let [rtn, updated] = demobxInternal(v);
    return rtn;
}

function JsonStringify(v : HibikiVal, opts? : {space? : number, noresolve? : boolean}) : string {
    opts = opts ?? {};
    v = DeepCopy(v, {resolve: !opts.noresolve});
    return JSON.stringify(v, JsonReplacerFn, opts.space);
}

function evalFnAst(fnAst : any, dataenv : DataEnvironment) : HibikiVal {
    let state = dataenv.dbstate;
    let stateFn : JSFuncType = null;
    let fnName = fnAst.fn.toLowerCase();
    if (fnName.startsWith("fn:")) {
        fnName = fnName.substr(3);
        stateFn = DefaultJSFuncs[fnName];
    }
    else if (fnName.startsWith("fnx:")) {
        fnName = fnName.substr(4);
        stateFn = state.JSFuncs[fnName];
    }
    if (stateFn != null) {
        let params = evalExprParams(fnAst.params, dataenv);
        if (!stateFn.native) {
            params.deepCopy({resolve: true});
        }
        else if (!stateFn.retainNoAttr) {
            params.stripNoAttrs();
        }
        if (stateFn.paramFn != null) {
            return stateFn.paramFn(params, dataenv);
        }
        else if (stateFn.fn != null) {
            return stateFn.fn(...params.posArgs);
        }
        else {
            throw new Error(sprintf("Invalid function: '%s', no function defined", fnAst.fn));
        }
    }
    else {
        throw new Error(sprintf("Invalid function: '%s'", fnAst.fn));
    }
}

function evalPath(path : PathType, dataenv : DataEnvironment, depth? : number) : PathType {
    if (depth == null) {
        depth = 0;
    }
    if (depth > 5) {
        throw new Error("evalPath depth exceeded, cannot evaluate path:" + path);
    }
    let staticPath : PathType = [];
    for (let i=0; i<path.length; i++) {
        let pp = path[i];
        if (pp.pathtype === "dyn") {
            let e = evalExprAst(pp.expr, dataenv, "resolve");
            if (typeof(e) === "number") {
                staticPath.push({pathtype: "array", pathindex: e});
            }
            else {
                staticPath.push({pathtype: "map", pathkey: String(e)});
            }
        }
        else if (pp.pathtype === "deref") {
            let e = evalExprAst(pp.expr, dataenv, "resolve");
            if (e == null || typeof(e) !== "string") {
                staticPath.push({pathtype: "root", pathkey: "null"});
                continue;
            }
            let newpath = ParsePathThrow(e, true);
            newpath = evalPath(newpath, dataenv, depth+1);
            staticPath.push(...newpath);
        }
        else {
            staticPath.push(pp);
        }
    }
    return staticPath;
}

function evalExprArray(exprArray : HExpr[], dataenv : DataEnvironment, rtype : ExprResolveType) : HibikiVal[] {
    if (exprArray == null || exprArray.length === 0) {
        return [];
    }
    let rtn = [];
    for (let i=0; i<exprArray.length; i++) {
        let expr = evalExprAst(exprArray[i], dataenv, rtype);
        rtn.push(expr);
    }
    return rtn;
}

function makeRef(path : PathType, dataenv : DataEnvironment, ctxStr : string) : LValue {
    if (path == null || path.length == 0) {
        return null;
    }
    let rootpp = path[0];
    if (rootpp.pathtype !== "root") {
        throw new Error(sprintf("Invalid non-rooted path expression [[%s]]", StringPath(path)));
    }
    if (rootpp.pathkey === "global" || rootpp.pathkey === "data" || rootpp.pathkey === "c" || rootpp.pathkey === "component") {
        let lv = new BoundLValue(path, dataenv, ctxStr);
        return lv;
    }
    throw new Error(sprintf("Can only make a reference/bindpath of global ($) or component ($c) path, expr=[[%s]]", StringPath(path)));
}

function evalPathExprAst(exprAst : HExpr, dataenv : DataEnvironment, ctxStr : string) : [LValue, boolean] {
    if (exprAst.etype === "path") {
        let lv = makeRef(exprAst.path, dataenv, ctxStr);
        if (lv == null) {
            return [null, true];
        }
        return [lv, true];
    }
    if (exprAst.etype === "noattr") {
        return [null, false];
    }
    if (exprAst.etype === "op") {
        if (exprAst.op === "?:") {
            let econd = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            if (econd) {
                return evalPathExprAst(exprAst.exprs[1], dataenv, ctxStr);
            }
            else {
                return evalPathExprAst(exprAst.exprs[2], dataenv, ctxStr);
            }
        }
        else {
            new Error(sprintf("Invalid path expression op type: '%s'", exprAst.op));
        }
    }
    if (exprAst.etype === "literal") {
        if (exprAst.val == null) {
            return [null, true];
        }
        throw new Error(sprintf("Invalid literal in path expr (only 'null' is allowed), type=%s", hibikiTypeOf(exprAst.val)));
    }
    throw new Error(sprintf("Invalid path expression etype: '%s'", exprAst.etype));
}

function evalExprParams(exprAst : HExpr, dataenv : DataEnvironment) : HibikiParamsObj {
    let val = evalExprAst(exprAst, dataenv, "natural");
    let [plainObj, isObj] = asPlainObject(val, true);
    if (isObj) {
        return new HibikiParamsObj(plainObj);
    }
    let [arrObj, isArr] = asArray(val, false);
    if (isArr) {
        return new HibikiParamsObj({"*args": arrObj});
    }
    return new HibikiParamsObj({"*args": [val]});
}

// rtype (controls lvalue resolution)
//   "resolve" - always resolve lvalues, resolve SYM_NOATTR to null
//   "raw"     - no extra resolution
//   "natural" - resolve "path" exprs lvalues (no extra resolution)
function evalExprAst(exprAst : HExpr, dataenv : DataEnvironment, rtype : ExprResolveType) : HibikiVal {
    if (rtype === "resolve") {
        let rtn = evalExprAstInternal(exprAst, dataenv, "natural");
        rtn = resolveLValue(rtn);
        if (rtn === SYM_NOATTR) {
            return null;
        }
        return rtn;
    }
    else {
        return evalExprAstInternal(exprAst, dataenv, rtype);
    }
}

function evalExprAstInternal(exprAst : HExpr, dataenv : DataEnvironment, rtype : "raw" | "natural") : HibikiVal {
    if (exprAst == null) {
        return null;
    }
    if (exprAst.etype === "path") {
        let staticPath = evalPath(exprAst.path, dataenv);
        let pathResolveType : ("lvalue" | "resolve") = (rtype === "raw" ? "lvalue" : "resolve");
        let val = internalResolvePath(staticPath, null, dataenv, pathResolveType, 0);
        if (rtype === "natural") {
            return resolveLValue(val);
        }
        return val;
    }
    else if (exprAst.etype === "literal") {
        let val = exprAst.val;
        return val;
    }
    else if (exprAst.etype === "array") {
        let rtn = evalExprArray(exprAst.exprs, dataenv, "natural");
        return rtn;
    }
    else if (exprAst.etype === "array-range") {
        let e1 = valToNumber(evalExprAst(exprAst.exprs[0], dataenv, "resolve"));
        let e2 = valToNumber(evalExprAst(exprAst.exprs[1], dataenv, "resolve"));
        if (isNaN(e1) || isNaN(e2) || e1 > e2) {
            return [];
        }
        let rtn = [];
        for (let i=e1; i<=e2; i++) {
            rtn.push(i);
        }
        return rtn;
    }
    else if (exprAst.etype === "map") {
        let rtn = {};
        if (exprAst.exprs == null || exprAst.exprs.length === 0) {
            return rtn;
        }
        for (let i=0; i<exprAst.exprs.length; i++) {
            let k = evalExprAst(exprAst.exprs[i].key, dataenv, "resolve");
            let v = evalExprAst(exprAst.exprs[i].valexpr, dataenv, "natural");
            if (k != null) {
                rtn[valToString(k)] = v;
            }
        }
        return rtn;
    }
    else if (exprAst.etype === "raw") {
        let val = evalExprAst(exprAst.exprs[0], dataenv, "raw");
        return val;
    }
    else if (exprAst.etype === "isnoattr") {
        let val = evalExprAst(exprAst.exprs[0], dataenv, "raw");
        return val === SYM_NOATTR;
    }
    else if (exprAst.etype === "ref") {
        let [lv, exists] = evalPathExprAst(exprAst.pathexpr, dataenv, null);
        if (!exists) {
            return SYM_NOATTR;
        }
        return lv;
    }
    else if (exprAst.etype === "isref") {
        let val = evalExprAst(exprAst.exprs[0], dataenv, "raw");
        return (val instanceof LValue);
    }
    else if (exprAst.etype === "refinfo") {
        let val = evalExprAst(exprAst.exprs[0], dataenv, "raw");
        if (val instanceof LValue) {
            return val.asString();
        }
        return null;
    }
    else if (exprAst.etype === "deref") {
        let val = evalExprAst(exprAst.exprs[0], dataenv, "raw");
        if (val instanceof LValue) {
            return val.get();
        }
        return null;
    }
    else if (exprAst.etype === "fn") {
        return evalFnAst(exprAst, dataenv);
    }
    else if (exprAst.etype === "filter") {
        let filter = exprAst.filter;
        if (filter === "format") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "natural");
            let params = evalExprParams(exprAst.params, dataenv);
            return formatFilter(e1, params);
        }
        else {
            throw new Error(sprintf("Invalid filter '%s' (only format is allowed)", exprAst.filter));
        }
    }
    else if (exprAst.etype === "op") {
        if (exprAst.op === "&&") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "natural");
            if (!e1 || e1 === SYM_NOATTR) {
                return false;
            }
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "natural");
            if (e2 === SYM_NOATTR) {
                return false;
            }
            return e2;
        }
        else if (exprAst.op === "||") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "natural");
            if (e1 && e1 !== SYM_NOATTR) {
                return e1;
            }
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "natural");
            return e2;
        }
        else if (exprAst.op === "??") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "natural");
            if (e1 != null && e1 !== SYM_NOATTR) {
                return e1;
            }
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "natural");
            return e2;
        }
        else if (exprAst.op === "*") {
            let e1 : HibikiVal = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 : HibikiVal = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            return valToNumber(e1) * valToNumber(e2);
        }
        else if (exprAst.op === "+") {
            // special, will evaluate entire array.
            if (exprAst.exprs == null || exprAst.exprs.length === 0) {
                return null;
            }
            let rtnVal : any = evalExprAst(exprAst.exprs[0], dataenv, "resolve") ?? null;
            if (typeof(rtnVal) === "symbol") {
                rtnVal = valToString(rtnVal);
            }
            for (let i=1; i<exprAst.exprs.length; i++) {
                let ev : any = evalExprAst(exprAst.exprs[i], dataenv, "resolve") ?? null;
                if (typeof(ev) === "symbol") {
                    ev = valToString(ev);
                }
                rtnVal = rtnVal + ev;
            }
            return rtnVal;
        }
        else if (exprAst.op === "/") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            return valToNumber(e1) / valToNumber(e2);
        }
        else if (exprAst.op === "%") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            return valToNumber(e1) % valToNumber(e2);
        }
        else if (exprAst.op === ">=") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            if (typeof(e1) === "string" && typeof(e2) === "string") {
                return e1 >= e2;
            }
            return valToNumber(e1) >= valToNumber(e2);
        }
        else if (exprAst.op === "<=") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            if (typeof(e1) === "string" && typeof(e2) === "string") {
                return e1 <= e2;
            }
            return valToNumber(e1) <= valToNumber(e2);
        }
        else if (exprAst.op === ">") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            if (typeof(e1) === "string" && typeof(e2) === "string") {
                return e1 > e2;
            }
            return valToNumber(e1) > valToNumber(e2);
        }
        else if (exprAst.op === "<") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            if (typeof(e1) === "string" && typeof(e2) === "string") {
                return e1 < e2;
            }
            return valToNumber(e1) < valToNumber(e2);
        }
        else if (exprAst.op === "<=>") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            return compareVals(e1, e2);
        }
        else if (exprAst.op === "==") {
            // TODO: fix == bug (toString())
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "natural") ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "natural") ?? null;
            if (e1 === SYM_NOATTR) {
                e1 = null;
            }
            if (e2 === SYM_NOATTR) {
                e2 = null;
            }
            if (e1 === e2) {
                return true;
            }
            return resolveLValue(e1) == resolveLValue(e2);
        }
        else if (exprAst.op === "!=") {
            // TODO: fix == bug (toString())
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "natural") ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "natural") ?? null;
            if (e1 === SYM_NOATTR) {
                e1 = null;
            }
            if (e2 === SYM_NOATTR) {
                e2 = null;
            }
            if (e1 === e2) {
                return false;
            }
            return resolveLValue(e1) != resolveLValue(e2);
        }
        else if (exprAst.op === "!") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            return !e1;
        }
        else if (exprAst.op === "-") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            let e2 = evalExprAst(exprAst.exprs[1], dataenv, "resolve");
            return valToNumber(e1) - valToNumber(e2);
        }
        else if (exprAst.op === "u-") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve") ?? null;
            return -valToNumber(e1);
        }
        else if (exprAst.op === "u+") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv, "resolve") ?? null;
            return +valToNumber(e1);
        }
        else if (exprAst.op === "?:") {
            let econd = evalExprAst(exprAst.exprs[0], dataenv, "resolve");
            if (econd) {
                return evalExprAst(exprAst.exprs[1], dataenv, "natural");
            }
            else {
                return evalExprAst(exprAst.exprs[2], dataenv, "natural");
            }
        }
        else {
            throw new Error(sprintf("Invalid expression op type: '%s'", exprAst.op));
        }
    }
    else if (exprAst.etype === "noattr") {
        return SYM_NOATTR;
    }
    else if (exprAst.etype === "invoke") {
        let expr = exprAst.exprs[0];
        if (expr == null) {
            return null;
        }
        let val = evalExprAst(expr, dataenv, "resolve");
        if (!(val instanceof LambdaValue)) {
            return val;
        }
        let invokeParams = evalExprParams(exprAst.params, dataenv);
        return val.invoke(dataenv, invokeParams);
    }
    else if (exprAst.etype === "lambda") {
        let expr = exprAst.exprs[0];
        if (expr == null) {
            return null;
        }
        return new LambdaValue(expr, null);
    }
    else {
        console.log("BAD ETYPE", exprAst);
        console.trace();
        throw new Error(sprintf("Invalid expression etype: '%s'", exprAst.etype));
    }
}

function isContextPath(path : PathType) : boolean {
    if (path == null || path.length === 0) {
        return false;
    }
    let pp = path[0];
    return pp.pathtype === "root" && pp.pathkey === "context" && !pp.caret;
}

function doAssignment(action : HAction, val : any, pure : boolean, dataenv : DataEnvironment) {
    if (action.setpath == null) {
        return;
    }
    let lvaluePath = evalAssignLVThrow(action.setpath, dataenv);
    if (lvaluePath == null || lvaluePath.length === 0) {
        return null;
    }
    if (pure && !isContextPath(lvaluePath)) {
        return null;
    }
    let setop = action.setop ?? "set";
    setPathWrapper(setop, lvaluePath, dataenv, val, {allowContext: true});
}

function RequestFromAction(action : HAction, pure : boolean, dataenv : DataEnvironment, rtctx : RtContext) : HibikiRequest {
    if (action.actiontype !== "callhandler") {
        throw new Error(sprintf("Cannot create HibikiRequest from actiontype: '%s'", action.actiontype));
    }
    let req = new HibikiRequest(dataenv.dbstate.getExtState(), dataenv);
    req.params = evalExprParams(action.data, dataenv);
    req.params.stripNoAttrs();
    req.data = req.params.getPlainArgs();
    req.rtContext = rtctx;
    req.pure = pure || action.pure;
    req.libContext = dataenv.getLibContext() ?? "main";
    if (action.callpath != null) {
        let callPath = valToString(evalExprAst(action.callpath, dataenv, "resolve"));
        let hpath = parseHandler(callPath);
        if (hpath == null) {
            throw new Error("Invalid handler path: " + callPath);
        }
        req.callpath = hpath;
        if (req.params.getArg("@url") != null || req.params.getArg("@module") != null) {
            throw new Error(sprintf("HibikiAction 'callhandler' cannot specifiy @url or @module params when a callpath is specified"));
        }
    }
    else {
        let {"@url": dataUrl, "@method": dataMethod, "@module": dataModule} = req.params.params;
        if (dataUrl == null) {
            throw new Error(sprintf("HibikiAction 'callhandler' without a callpath must specify an @url param"));
        }
        let hpath = {
            module: valToString(dataModule) ?? "http",
            url: valToString(dataUrl),
            method: valToString(dataMethod) ?? "DYN",
        };
        req.callpath = hpath;
    }
    if (req.params.getArg("@pure")) {
        req.pure = true;
    }
    return req;
}

async function ExecuteHAction(action : HAction, pure : boolean, dataenv : DataEnvironment, rtctx : RtContext) : Promise<HibikiVal> {
    rtctx.actionCounter++;
    if (rtctx.actionCounter > MAX_ACTIONS) {
        throw new Error(sprintf("Exceeded %d actions, stopping execution", MAX_ACTIONS));
    }
    if (rtctx.stack.length > MAX_STACK) {
        throw new Error(sprintf("Exceeded max stack size (%d), stopping execution", MAX_STACK));
    }
    if (action == null) {
        return null;
    }
    if (action.actiontype == null) {
        rtctx.pushContext(sprintf("Running action", action.actiontype), null);
        throw new Error(sprintf("Invalid Action, no actiontype specified: %s", JSON.stringify(action)));
    }
    rtctx.pushContext(sprintf("Running action '%s'", action.actiontype), null);
    if (action.actiontype === "setdata") {
        let expr = evalExprAst(action.data, dataenv, "natural");
        doAssignment(action, expr, pure, dataenv);
    }
    else if (action.actiontype === "ifblock") {
        let condVal = evalExprAst(action.data, dataenv, "resolve");
        let actions = action.actions ?? {};
        if (condVal) {
            rtctx.pushContext("Executing then clause", null);
            await ExecuteHandlerBlock(new HActionBlock("block", actions["then"]), pure, dataenv, rtctx);
        }
        else {
            rtctx.pushContext("Executing else clause", null);
            await ExecuteHandlerBlock(new HActionBlock("block", actions["else"]), pure, dataenv, rtctx);
        }
        return null;
    }
    else if (action.actiontype === "setreturn") {
        let val = evalExprAst(action.data, dataenv, "natural");
        return val;
    }
    else if (action.actiontype === "callhandler") {
        let req = RequestFromAction(action, pure, dataenv, rtctx);
        rtctx.replaceContext(sprintf("Calling handler %s", fullPath(req.callpath)), null);
        let block = await dataenv.dbstate.callHandlerWithReq(req);
        let rtnVal : HibikiVal = null;
        if (block != null) {
            let libContext : string = null;
            if (typeof(block.libContext) === "string") {
                libContext = block.libContext;
            }
            let handlerEnv = dataenv.makeChildEnv({data: req.data}, {blockLocalData: true, libContext: libContext});
            rtnVal = await ExecuteHandlerBlock(block, req.pure, handlerEnv, rtctx);
        }
        doAssignment(action, rtnVal, pure, dataenv);
        return rtnVal;
    }
    else if (action.actiontype === "invalidate") {
        if (pure) {
            return null;
        }
        let ivParams = evalExprParams(action.data, dataenv);
        ivParams.deepCopy({resolve: true});
        if (ivParams.posArgs.length === 0) {
            dataenv.dbstate.invalidateAll();
        }
        else {
            for (let i=0; i<ivParams.posArgs.length; i++) {
                let iv = ivParams.posArgs[i];
                if (iv != null) {
                    dataenv.dbstate.invalidateRegex(String(iv));
                }
            }
        }
        return null;
    }
    else if (action.actiontype === "fireevent") {
        if (pure) {
            return null;
        }
        if (action.native) {
            rtctx.popContext();
        }
        let eventStr = valToString(evalExprAst(action.event, dataenv, "resolve"));
        if (eventStr == null || eventStr === "") {
            return null;
        }
        let params = evalExprParams(action.data, dataenv);
        params.stripNoAttrs();
        let bubble = !!action.bubble;
        if (params.hasArg("@bubble")) {
            bubble = valToBool(params.getArg("@bubble"));
        }
        let nodeuuid = action.nodeuuid;
        if (params.hasArg("@nodeuuid")) {
            nodeuuid = valToString(params.getArg("@nodeuuid"));
        }
        if (!action.native) {
            if (nodeuuid) {
                rtctx.replaceContext(sprintf("%s '%s' event (node uuid %s)", (bubble ? "Bubbling" : "Firing"), eventStr, nodeuuid), null);
            }
            else {
                rtctx.replaceContext(sprintf("%s '%s' event", (bubble ? "Bubbling" : "Firing"), eventStr), null);
            }
        }
        let datacontext = params.getPlainArgs();
        if (!("value" in datacontext) && params.hasArg(null, 0)) {
            datacontext["value"] = params.getArg(null, 0);
        }
        let event = {event: eventStr, native: action.native, datacontext, bubble, nodeuuid};
        return FireEvent(event, dataenv, rtctx, false);
    }
    else if (action.actiontype === "log") {
        let params = evalExprParams(action.data, dataenv);
        params.stripNoAttrs();
        params.deepCopy();
        let dataValArr = params.posArgs;
        let debugAtArg = valToBool(params.getArg("@debug"));
        let alertAtArg = valToBool(params.getArg("@alert"));
        dataValArr = dataValArr.map((val) => {
            if (val instanceof HibikiError) {
                return val.toString();
            }
            return val;
        });
        console.log("HibikiLog", ...dataValArr);
        if (action.debug || debugAtArg) {
            console.log("DataEnvironment Stack");
            dataenv.printStack();
            console.log(rtctx.asString("> "));
            console.log("RtContext / DataEnvironment", rtctx, dataenv);
        }
        if (action.alert || alertAtArg) {
            let alertStr = dataValArr.map((v) => String(v)).join(", ");
            alert(alertStr);
        }
        return null;
    }
    else if (action.actiontype === "throw") {
        // action.data is not a params type
        rtctx.popContext();
        let errVal = evalExprAst(action.data, dataenv, "resolve");
        if (errVal instanceof HibikiError) {
            if (errVal.rtctx != null) {
                let hctx = rtctx.getTopHandlerContext();
                if (hctx != null) {
                    errVal.rtctx.pushContext(sprintf("Rethrowing error from '%s' handler in %s", hctx.handlerName, nodeStr(hctx.handlerNode)), null);
                }
            }
            return Promise.reject(errVal);
        }
        return Promise.reject(new Error(valToString(errVal)));
    }
    else if (action.actiontype === "nop") {
        return null;
    }
    else if (action.actiontype === "html") {
        let htmlObj = parseHtml(action.html);
        bindLibContext(htmlObj, (action.libcontext ?? "main"));
        if (htmlObj != null) {
            dataenv.dbstate.setHtml(htmlObj);
        }
        return null;
    }
    else {
        throw new Error(sprintf("Invalid Action, actiontype '%s' not supported", action.actiontype));
    }
    return null;
}

function compileActionStr(astr : HibikiActionString) : HExpr {
    if (astr == null) {
        return null;
    }
    if (typeof(astr) === "string") {
        return {etype: "literal", val: astr};
    }
    if (isObject(astr) && "hibikiexpr" in astr) {
        return ParseSimpleExprThrow(astr.hibikiexpr);
    }
    return null;
}

function compileActionVal(aval : HibikiActionValue) : HExpr {
    if (aval == null) {
        return null;
    }
    if (isObject(aval)) {
        let objVal : HibikiValObj = (aval as any);
        if ("hibikiexpr" in objVal) {
            let exprStr = objVal.hibikiexpr;
            if (exprStr == null) {
                return {etype: "literal", val: null};
            }
            else if (typeof(exprStr) === "string") {
                return ParseSimpleExprThrow(exprStr);
            }
            else {
                throw new Error("Invalid hibikiexpr expression, not a string: " + hibikiTypeOf(objVal));
            }
        }
    }
    return {etype: "literal", val: aval};
}

function validateAction(action : HAction) : string {
    return null;
}

function convertAction(action : HibikiAction) : HAction {
    if (action.actiontype == null) {
        throw new Error("Invalid HibikiAction, no actiontype field | " + JSON.stringify(action));
    }
    let rtn : HAction = {actiontype: action.actiontype};
    if (action.event != null) {
        rtn.event = compileActionStr(action.event);
    }
    if (action.bubble) rtn.bubble = true;
    if (action.pure) rtn.pure = true;
    if (action.debug) rtn.debug = true;
    if (action.alert) rtn.alert = true;
    if (action.exithandler) rtn.exithandler = true;
    if (action.setop != null && typeof(action.setop) === "string") {
        rtn.setop = action.setop;
    }
    if (action.setpath != null && typeof(action.setpath) === "string") {
        let path = ParsePathThrow(action.setpath, true);
        rtn.setpath = path;
    }
    if (action.callpath != null) {
        let pathExpr = compileActionStr(action.callpath);
        if (pathExpr != null) {
            rtn.callpath = pathExpr;
        }
    }
    if (action.data != null) {
        rtn.data = compileActionVal(action.data);
    }
    if (action.html != null && typeof(action.html) === "string") {
        rtn.html = action.html;
    }
    if (action.libcontext != null && typeof(action.libcontext) === "string") {
        rtn.libcontext = action.libcontext;
    }
    if (action.actions != null) {
        if (!isObject(action.actions)) {
            throw new Error("Invalid HibikiAction, 'actions' field should be Record<string, HibikiAction[]> | " + JSON.stringify(action));
        }
        rtn.actions = {};
        for (let key in action.actions) {
            rtn.actions[key] = convertActions(action.actions[key]);
        }
    }
    if (action.nodeuuid != null && typeof(action.nodeuuid) === "string") {
        rtn.nodeuuid = action.nodeuuid;
    }
    if (action.blockstr != null && typeof(action.blockstr) === "string") {
        rtn.blockstr = action.blockstr;
    }
    if (action.blockctx != null && typeof(action.blockctx) === "string") {
        rtn.blockctx = action.blockctx;
    }
    if (action.blobbase64 != null && typeof(action.blobbase64) === "string") {
        if (action.actiontype === "blob") {
            rtn.actiontype = "setdata";
        }
        let blob = new HibikiBlob(action.blobmimetype, action.blobbase64);
        rtn.data = {etype: "literal", val: blob};
    }
    let err = validateAction(rtn);
    if (err != null) {
        throw new Error(err + " | " + JSON.stringify(action));
    }
    return rtn;
}

function convertActions(actions : HibikiAction[]) : HAction[] {
    if (actions == null || actions.length === 0) {
        return [];
    }
    let rtn : HAction[] = [];
    for (let i=0; i<actions.length; i++) {
        let haction = convertAction(actions[i]);
        if (haction != null) {
            rtn.push(haction);
        }
    }
    return rtn;
}

async function FireEvent(event : EventType, dataenv : DataEnvironment, rtctx : RtContext, throwErrors : boolean) : Promise<HibikiVal> {
    if (event.event === "unhandlederror" && !event.native) {
        throw new Error("Cannot fire->unhandlederror from handler");
    }
    let ehandler : EHandlerType = null;
    if (event.nodeuuid) {
        let dbctx = dataenv.dbstate.NodeUuidMap.get(event.nodeuuid);
        if (dbctx == null) {
            console.log(sprintf("Hibiki fire event '%s', could not find node uuid %s", event.event, event.nodeuuid));
            return null;
        }
        ehandler = dbctx.getEventDataenv().resolveEventHandler(event, rtctx);
    }
    else {
        ehandler = dataenv.resolveEventHandler(event, rtctx);
    }
    if (ehandler == null) {
        if (event.bubble) {
            dataenv.dbstate.unhandledEvent(event, rtctx);
        }
        return null;
    }
    let htmlContext = sprintf("event%s(%s)", (event.bubble ? "-bubble" : ""), event.event);
    let eventEnv = ehandler.dataenv;
    if (ehandler.contextVars != null) {
        try {
            let evalCtxContextStr = htmlContext + " <define-vars>";
            let specials = EvalContextVarsThrow(ehandler.contextVars, eventEnv, evalCtxContextStr);
            eventEnv = eventEnv.makeChildEnv(specials, {htmlContext: "<define-vars>"});
        }
        catch (e) {
            console.log(sprintf("ERROR evaluating <define-vars> before running %s", htmlContext), e);
        }
    }
    eventEnv = eventEnv.makeChildEnv(event.datacontext, {htmlContext: htmlContext});
    let ctxStr = sprintf("Running %s:%s.handler (in [[%s]])", nodeStr(ehandler.node), event.event, ehandler.dataenv.getFullHtmlContext());
    rtctx.pushContext(ctxStr, {handlerEnv: ehandler.dataenv, handlerName: event.event, handlerNode: ehandler.node});
    try {
        await ExecuteHandlerBlock(ehandler.handler, false, eventEnv, rtctx);
        return null;
    }
    catch (e) {
        if (e instanceof HibikiError) {
            if (throwErrors) {
                throw e;
            }
            await dataenv.dbstate.unhandledError(e, rtctx);
            return null;
        }
        rtctx.pushErrorContext(e);
        let errorObj = makeErrorObj(e, rtctx);
        let errorEventObj = {
            event: "error",
            native: true,
            bubble: false,
            datacontext: {error: errorObj, event: event.event},
        };
        let errorHandler = dataenv.resolveEventHandler(errorEventObj, rtctx);
        if (event.event === "error" || errorHandler == null) {
            // no error handler or error while running error handler
            if (throwErrors) {
                throw errorObj;
            }
            await dataenv.dbstate.unhandledError(errorObj, rtctx);
            return null;
        }
        return FireEvent(errorEventObj, dataenv, rtctx, false);
    }
}

async function ExecuteHandlerBlockInternal(block : HandlerBlock, pure : boolean, dataenv : DataEnvironment, rtctx : RtContext) : Promise<HibikiVal> {
    if (block == null) {
        return null;
    }
    let actionArr : HAction[] = null;
    if (block instanceof HActionBlock) {
        actionArr = block.actions;
    }
    else if ("hibikiactions" in block) {
        actionArr = convertActions(block.hibikiactions);
        if (block.hibikicontext != null && isObject(block.hibikicontext)) {
            dataenv = dataenv.makeChildEnv(block.hibikicontext, null);
        }
    }
    else if ("hibikihandler" in block) {
        let ctxstr = block.ctxstr ?? "handler";
        rtctx.pushContext(sprintf("Parsing %s", ctxstr), null);
        actionArr = ParseBlockThrow(block.hibikihandler);
        rtctx.popContext();
        if (block.hibikicontext != null && isObject(block.hibikicontext)) {
            dataenv = dataenv.makeChildEnv(block.hibikicontext, null);
        }
    }
    else {
        console.log("Invalid block passed to ExecuteHandlerBlock", block);
        throw new Error("Invalid block passed to ExecuteHandlerBlock");
    }
    if (actionArr == null || actionArr.length === 0) {
        return null;
    }
    let rtn = null;
    let markPoint = rtctx.stackSize();
    for (let i=0; i<actionArr.length; i++) {
        rtctx.revertStack(markPoint);
        let action = actionArr[i];
        let actionRtn = await ExecuteHAction(action, pure, dataenv, rtctx);
        if (action.actiontype === "setreturn") {
            rtn = actionRtn;
        }
    }
    return rtn;
}

function ExecuteHandlerBlock(block : HandlerBlock, pure : boolean, dataenv : DataEnvironment, rtctx : RtContext) : Promise<any> {
    let prtn = ExecuteHandlerBlockInternal(block, pure, dataenv, rtctx);
    return prtn;
}

function makeErrorObj(e : any, rtctx : RtContext) : HibikiError {
    let message = "Error";
    if (e != null) {
        message = e.toString();
    }
    let rtnErr = new HibikiError(message, e, rtctx);
    window.HibikiLastError = rtnErr;
    return rtnErr;
}

function EvalContextVarsThrow(ctxVars : ContextVarType[], dataenv : DataEnvironment, htmlContext : string) : HibikiValObj {
    let rtctx = new RtContext();
    rtctx.pushContext(htmlContext, null);
    let specials : HibikiValObj = {};
    for (let ctxVar of ctxVars) {
        let evalDataenv = dataenv.makeChildEnv(specials, {htmlContext: htmlContext});
        let expr = evalExprAst(ctxVar.expr, evalDataenv, "natural");
        let specialKey = ctxVar.key;
        specials[specialKey] = expr;
    }
    return specials;
}

function EvalSimpleExpr(exprStr : string, dataenv : DataEnvironment, rtContext? : string) : any {
    try {
        let val = EvalSimpleExprThrow(exprStr, dataenv, rtContext);
        return val;
    }
    catch (e) {
        let emsg = getShortEMsg(e);
        console.log("ERROR evaluating expression", "[[", exprStr, "]]", emsg, rtContext);
        return null;
    }
}

function ParseSimpleExprThrow(exprStr : string) : HExpr {
    let exprAst : HExpr = doParse(exprStr, "ext_fullExpr");
    return exprAst;
}

// function EvalSimpleExpr(exprStr : string, localRoot : any, globalRoot : any, specials? : any) : any {
function EvalSimpleExprThrow(exprStr : string, dataenv : DataEnvironment, rtContext? : string) : HibikiVal {
    if (exprStr == null || exprStr === "") {
        return null;
    }
    let exprAst = ParseSimpleExprThrow(exprStr);
    let val = evalExprAst(exprAst, dataenv, "natural");
    return val;
}

function BlobFromBlob(blob : Blob) : Promise<HibikiBlob> {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.onloadend = () => {
            if (reader.error != null) {
                reject(reader.error);
                return;
            }
            if (reader.result == null) {
                reject(new Error("Invalid BLOB, no reader result"));
                return;
            }
            let mimetype = blob.type;
            if (mimetype == null || mimetype === "") {
                mimetype = "application/octet-stream";
            }
            let commaIdx = (reader.result as string).indexOf(",");
            if (commaIdx === -1) {
                reject(new Error("Invalid BLOB, could not be readAsDataURL"));
                return;
            }
            // e.g. data:image/jpeg;base64,[base64data]
            let blobdata = (reader.result as string).substr(commaIdx+1);
            let blobname = null;
            if (blob instanceof File && blob.name != null) {
                blobname = blob.name;
            }
            let hblob = new HibikiBlob(mimetype, blobdata, blobname);
            resolve(hblob);
        };
        reader.readAsDataURL(blob);
    });
}

function BlobFromRRA(rra : HibikiAction) : HibikiBlob {
    if (rra.actiontype !== "blob") {
        return null;
    }
    let blob = new HibikiBlob(rra.blobmimetype, rra.blobbase64);
    return blob;
}

function ExtBlobFromRRA(blob : HibikiBlob, rra : HibikiAction) {
    if (blob == null) {
        throw new Error(sprintf("Cannot extend null HibikiBlob"));
    }
    blob.appendData(rra.blobbase64);
}

function blobExtDataPath(path : PathType, curData : HibikiVal, newData : HibikiVal) : HibikiVal {
    if (curData == null || !(curData instanceof HibikiBlob)) {
        throw new Error(sprintf("SetPath cannot blobext a non-blob, path=%s, typeof=%s", StringPath(path), hibikiTypeOf(curData)));
    }
    if (typeof(newData) !== "string") {
        throw new Error(sprintf("SetPath cannot blobext with non-string argument, path=%s, typeof=%s", StringPath(path), hibikiTypeOf(newData)));
    }
    curData.appendData(newData);
    return curData;
}

function ParseStaticCallStatement(str : string) : HAction {
    let callAction : HAction = doParse(str, "ext_callStatementNoAssign");
    return callAction;
}

function evalAssignLVThrow(lvalue : PathType, dataenv : DataEnvironment) {
    let lvaluePath = evalPath(lvalue, dataenv);
    if (lvaluePath == null || lvaluePath.length === 0) {
        throw new Error(sprintf("Invalid lvalue-path in assignment (no terms)"));
    }
    let rootpp = lvaluePath[0];
    if (rootpp.pathtype !== "root") {
        throw new Error(sprintf("Invalid lvalue-path type %s", rootpp.pathtype));
    }
    return lvaluePath;
}

function convertSimpleType(typeName : string, value : string, defaultValue : HibikiVal) : HibikiVal {
    if (typeName === "string") {
        return value;
    }
    if (typeName === "int") {
        let rtn = parseInt(value);
        if (isNaN(rtn)) {
            return defaultValue;
        }
        return rtn;
    }
    if (typeName === "float") {
        let rtn = parseFloat(value);
        if (isNaN(rtn)) {
            return defaultValue;
        }
        return rtn;
    }
    return value;
}

function blobPrintStr(blob : Blob | HibikiBlob) : string {
    if (blob == null) {
        return null;
    }
    if (blob instanceof HibikiBlob) {
        return blob.asString();
    }
    if (blob instanceof File && blob.name != null) {
        sprintf("[jsblob type=%s, len=%s, name=%s]", blob.type, blob.size, blob.name);
    }
    if (blob instanceof Blob) {
        return sprintf("[jsblob type=%s, len=%s]", blob.type, blob.size);
    }
    return null;
}

function resolveLValue(val : HibikiVal) : HibikiVal {
    if (val == null) {
        return null;
    }
    let level = 0;
    while (val instanceof LValue) {
        val = val.get();
        level++;
        if (level > MAX_LVALUE_LEVEL) {
            break;
        }
    }
    return val;
}

function resolveToLValue(lv : LValue) : LValue {
    let level = 0;
    let origLv = lv;
    while (true) {
        let val = lv.get();
        if (!(val instanceof LValue)) {
            break;
        }
        lv = val;
        level++;
        if (level > MAX_LVALUE_LEVEL) {
            throw new Error(sprintf("Cannot resolve lv=%s, depth exceeds MAX_LVALUE_LEVEL=%d", origLv.asString(), MAX_LVALUE_LEVEL));
        }
    }
    return lv;
}

// returns [val, wasNumber]
function prepareCompareVal(v : HibikiVal, opts : {field? : string, index? : number}) : [string, boolean] {
    if (v instanceof LValue) {
        v = resolveLValue(v);
    }
    if (v == null) {
        return [null, false];
    }
    if (opts.field != null && typeof(v) === "object") {
        let [objVal, isObj] = asPlainObject(v, false);
        if (!isObj) {
            return [null, false];
        }
        v = objVal[opts.field];
    }
    if (opts.index != null) {
        let [arrVal, isArr] = asArray(v, false);
        if (!isArr) {
            return [null, false];
        }
        if (opts.index < 0 || opts.index >= arrVal.length) {
            return [null, false];
        }
        v = arrVal[opts.index];
    }
    let isNumber = (typeof(v) === "number");
    if (typeof(v) === "number" && isNaN(v)) {
        return [null, false];
    }
    return [valToString(v), isNumber];
}

function compareVals(v1 : HibikiVal, v2 : HibikiVal, opts? : CompareOpts) : number {
    opts = opts ?? {};
    if (v1 === v2) {
        return 0;
    }
    let [sv1, v1num] = prepareCompareVal(v1, opts);
    let [sv2, v2num] = prepareCompareVal(v2, opts);
    if (sv1 == null && sv2 == null) {
        return 0;
    }
    if (sv1 == null) {
        return -1;
    }
    if (sv2 == null) {
        return 1;
    }
    let numeric = v1num && v2num;
    if (opts.sortType === "numeric") {
        numeric = true;
    }
    if (opts.sortType === "string") {
        numeric = false;
    }
    let locale : string = undefined;
    if (opts.locale != null) {
        locale = opts.locale;
    }
    let sensitivity = "variant";
    if (opts.nocase) {
        sensitivity = "accent";
    }
    if (opts.sensitivity != null) {
        sensitivity = opts.sensitivity;
    }
    return sv1.localeCompare(sv2, locale, {numeric: numeric, sensitivity: sensitivity});
}

export {ParsePath, ResolvePath, SetPath, ParsePathThrow, ResolvePathThrow, StringPath, JsonStringify, EvalSimpleExpr, ParseSetPathThrow, ParseSetPath, HibikiBlob, ObjectSetPath, DeepEqual, DeepCopy, CleanVal, DeepCopyTypeSafe, CheckCycle, LValue, BoundLValue, ObjectLValue, ReadOnlyLValue, getShortEMsg, CreateReadOnlyLValue, demobx, BlobFromRRA, ExtBlobFromRRA, isObject, convertSimpleType, ParseStaticCallStatement, evalExprAst, BlobFromBlob, formatVal, ExecuteHandlerBlock, ExecuteHAction, makeIteratorFromExpr, rawAttrStr, getUnmergedAttributeStr, getUnmergedAttributeValPair, SYM_NOATTR, HActionBlock, valToString, valToBool, compileActionStr, FireEvent, makeErrorObj, OpaqueValue, ChildrenVar, Watcher, LambdaValue, blobPrintStr, valToNumber, hibikiTypeOf, JsonReplacerFn, valToAttrStr, resolveLValue, resolveUnmergedCnArray, isUnmerged, resolveUnmergedStyleMap, asStyleMap, asStyleMapFromPair, EvalContextVarsThrow, compareVals, asPrimitive, asArray, asPlainObject, HibikiParamsObj, stripNoAttrShallow};

export type {PathType, HAction, HExpr, HIteratorExpr, ContextVarType, CompareOpts};

