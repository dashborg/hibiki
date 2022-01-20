// Copyright 2021-2022 Dashborg Inc

import * as mobx from "mobx";
import {v4 as uuidv4} from 'uuid';
import {DataEnvironment, HibikiState} from "./state";
import {sprintf} from "sprintf-js";
import {parseHtml} from "./html-parser";
import {RtContext, getShortEMsg, HibikiError} from "./error";
import {SYM_PROXY, SYM_FLATTEN, isObject, stripAtKeys, unpackPositionalArgs, nodeStr, parseHandler, fullPath, blobPrintStr, STYLE_UNITLESS_NUMBER, STYLE_KEY_MAP, splitTrim, bindLibContext} from "./utils";
import {PathPart, PathType, PathUnionType, EventType, HandlerValType, HibikiAction, HibikiActionString, HibikiActionValue, HandlerBlock, NodeAttrType, HibikiVal, HibikiNode, HibikiValObj, HibikiValEx, AutoMergeExpr, JSFuncType} from "./types";
import {HibikiRequest} from "./request";
import type {EHandlerType} from "./state";
import {doParse} from "./hibiki-parser";
import * as cn from "classnames/dedupe";
import {DefaultJSFuncs} from "./jsfuncs";

window.cn = cn;

declare var window : any;

const MAX_ARRAY_SIZE = 10000;
const SYM_NOATTR = Symbol("noattr");
const MAX_ACTIONS = 1000;
const MAX_STACK = 30;

type RtContextOpts = {
    rtContext? : string,
};

type HExpr = {
    etype    : string,
    filter?  : string,
    exprs?   : HExpr[],
    op?      : string,
    fn?      : string,
    val?     : any,
    key?     : HExpr,
    path?    : PathType,
    valexpr? : HExpr,
    sourcestr? : string,
};

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
    blockstr?  : string,
    blockctx?  : string,
};

class HActionBlock {
    actions : HAction[];
    libContext : string;

    constructor(actions : HAction[], libContext? : string) {
        this.actions = actions;
        this.libContext = libContext;
    }
}

class ChildrenVar {
    list : HibikiNode[];
    dataenv : DataEnvironment;
    
    constructor(list : HibikiNode[], dataenv : DataEnvironment) {
        this.list = list ?? [];
        this.dataenv = dataenv;
    }

    get all() : ChildrenVar {
        return this;
    }

    get noslot() : ChildrenVar {
        let rtn = [];
        for (let child of this.list) {
            let childSlot = getAttributeStr(child, "slot", this.dataenv);
            if (childSlot == null) {
                rtn.push(child);
            }
        }
        return new ChildrenVar(rtn, this.dataenv);
    }

    get bycomp() : Record<string, ChildrenVar> {
        let rtn : Record<string, ChildrenVar> = {};
        for (let child of this.list) {
            if (child.tag.startsWith("hibiki-")) {
                continue;
            }
            let compName = getAttributeStr(child, "component", this.dataenv) ?? child.tag;
            let component = this.dataenv.dbstate.ComponentLibrary.findComponent(compName, child.libContext);
            let cname = null;
            if (component == null) {
                if (child.tag.startsWith("#")) {
                    cname = child.tag;
                }
                else if (child.tag.startsWith("html-")) {
                    cname = "@html:" + child.tag.substr(5);
                }
                else if (child.tag.indexOf("-") == -1) {
                    cname = "@html:" + child.tag;
                }
                else {
                    cname = "@unknown:" + child.tag;
                }
            }
            else {
                cname = component.libName + ":" + component.name;
            }
            if (rtn[cname] == null) {
                rtn[cname] = new ChildrenVar([], this.dataenv);
            }
            rtn[cname].list.push(child);
        }
        return rtn;
    }

    get byslot() : Record<string, ChildrenVar> {
        let rtn = {};
        for (let child of this.list) {
            let childSlot = getAttributeStr(child, "slot", this.dataenv);
            if (childSlot == null) {
                continue;
            }
            if (!(childSlot in rtn)) {
                rtn[childSlot] = new ChildrenVar([], this.dataenv);
            }
            rtn[childSlot].list.push(child);
        }
        return rtn;
    }

    get bytag() : Record<string, ChildrenVar> {
        let rtn = {};
        for (let child of this.list) {
            let tagName = child.tag;
            if (!(tagName in rtn)) {
                rtn[tagName] = new ChildrenVar([], this.dataenv);
            }
            rtn[tagName].list.push(child);
        }
        return rtn;
    }

    get first() : ChildrenVar {
        let rtn = (this.list.length > 0 ? [this.list[0]] : []);
        return new ChildrenVar(rtn, this.dataenv);
    }

    get byindex() : ChildrenVar[] {
        let rtn = [];
        for (let child of this.list) {
            rtn.push(new ChildrenVar([child], this.dataenv));
        }
        return rtn;
    }

    asString() : string {
        let arr = [];
        for (let child of this.list) {
            if (child.tag.startsWith("#")) {
                arr.push(child.tag);
            }
            else {
                arr.push("<" + child.tag + ">");
            }
        }
        if (arr.length === 0) {
            return "[children:none]";
        }
        return sprintf("[children:%s]", arr.toString());
    }
}

class OpaqueValue {
    _type : "OpaqueValue";
    value : any;

    constructor(value : any) {
        this._type = "OpaqueValue";
        this.value = value;
    }

    asString() : string {
        if (this.value == null) {
            return null;
        }
        if (this.value instanceof ChildrenVar) {
            return this.value.asString();
        }
        return "[opaque]";
    }
}

function isOpaqueType(val : any, setter? : boolean) : boolean {
    if (setter && val instanceof ChildrenVar) {
        return true;
    }
    return (val instanceof OpaqueValue || val instanceof HibikiBlob || val instanceof DataEnvironment || val instanceof HibikiRequest || val instanceof RtContext);
}

function opaqueTypeAsString(val : any) {
    if (val instanceof ChildrenVar) {
        return val.asString();
    }
    if (val instanceof HibikiBlob) {
        return val.asString();
    }
    if (val instanceof DataEnvironment) {
        return "[DataEnvironment]";
    }
    if (val instanceof HibikiRequest) {
        return sprintf("[HibikiRequest:%s]", val.reqid);
    }
    if (val instanceof RtContext) {
        return sprintf("[RtContext:%s]", val.rtid);
    }
    if (val instanceof OpaqueValue) {
        return val.asString();
    }
    return "[opaque]";
}

class HibikiBlob {
    mimetype : string = null;
    data : string = null;
    name : string = null;
    _type : "HibikiBlob" = "HibikiBlob";

    makeDataUrl() : string {
        return "data:" + this.mimetype + ";base64," + this.data;
    }

    asString() : string {
        return blobPrintStr(this);
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

function nsAttrName(attrName : string, ns : string) : string {
    if (ns == null || ns === "self") {
        return attrName;
    }
    if (ns === "root") {
        return ":" + attrName;
    }
    return ns + ":" + attrName;
}

function makeCnArr(cnVal : any) : Record<string, boolean>[] {
    let rtn : Record<string, boolean>[] = [];
    let classVal = cn(cnVal);
    let splitArr = classVal.split(/\s+/);
    for (let i=0; i<splitArr.length; i++) {
        let val = splitArr[i];
        if (val === "") {
            continue;
        }
        if (val.startsWith("no-")) {
            rtn.push({[val.substr(3)]: false});
            continue;
        }
        if (val.startsWith("-")) {
            rtn.push({[val.substr(1)]: false});
            continue;
        }
        rtn.push({[val]: true});
    }
    return rtn;
}

function resolveNonAmCnArray(node : HibikiNode, ns : string, dataenv : DataEnvironment, moreClasses : any) : Record<string, boolean>[] {
    let cnArr = makeCnArr(moreClasses);
    let baseClassAttrName = nsAttrName("class", ns);
    let [classAttrVal, _] = getAttributeValPair(node, baseClassAttrName, dataenv);
    cnArr.push(...makeCnArr(classAttrVal));
    if (node.attrs == null) {
        return cnArr;
    }
    for (let [k,v] of Object.entries(node.attrs)) {
        if (!k.startsWith(baseClassAttrName + ".")) {
            continue;
        }
        let kval = k.substr(baseClassAttrName.length+1);
        let rval = getAttributeStr(node, k, dataenv);
        if (rval && rval !== "0") {
            cnArr.push({[kval]: true});
        }
        else {
            cnArr.push({[kval]: false});
        }
    }
    return cnArr;
}

function resolveCnArray(node : HibikiNode, ns : string, dataenv : DataEnvironment, moreClasses : string) : Record<string, boolean>[] {
    let am = checkSingleAutoMerge(node, "class", ns);

    // check includeForce automerge
    if (am[1].length > 0) {
        let [cnArr, exists] = resolveAutoMergeCnArray(am[1], dataenv);
        if (exists) {
            return cnArr;
        }
    }

    // base class from node (includes moreClasses)
    let rtn = resolveNonAmCnArray(node, ns, dataenv, moreClasses);

    // check include automerge
    if (am[0].length > 0) {
        let [cnArr, exists] = resolveAutoMergeCnArray(am[0], dataenv);
        if (exists && cnArr != null) {
            // automerge class will always merge.
            rtn.push(...cnArr);
        }
    }
    return rtn;
}

function getNonAmStyleMap(node : HibikiNode, ns : string, dataenv : DataEnvironment, initStyles? : any) : Record<string, string> {
    let rtn = initStyles ?? {};
    let styleMap : Record<string, NodeAttrType> = null;
    let styleAttr : string = null;
    if (ns === "self") {
        styleMap = node.style;
        styleAttr = "style";
    }
    else if (node.morestyles != null) {
        if (ns === "root") {
            styleAttr = ":style";
        }
        else {
            styleAttr = ns + ":style";
        }
        styleMap = node.morestyles[styleAttr];
    }
    if (styleMap == null) {
        return rtn;
    }
    for (let [k,v] of Object.entries(styleMap)) {
        let opts = {
            style: true,
            rtContext: sprintf("resolving style property '%s' in attribute '%s' in %s", k, styleAttr, nodeStr(node)),
        };
        let rval = resolveAttrStr(k, v, dataenv, opts);
        if (rval == null) {
            continue;
        }
        let skm = STYLE_KEY_MAP[k];
        if (skm != null) {
            if (skm.flex) {
                rtn.display = "flex";
            }
            if (k == "fullcenter") {
                rtn.justifyContent = "center";
                rtn.alignItems = "center";
                continue;
            }
            rtn[skm.key] = skm.val;
            continue;
        }
        rtn[k] = rval;
    }
    return rtn;
}

function getStyleMap(node : HibikiNode, ns : string, dataenv : DataEnvironment, initStyles? : any) : Record<string, any> {
    ns = ns ?? "self";
    let am = checkSingleAutoMerge(node, "style", ns);

    // check includeForce automerge
    if (am[1].length > 0) {
        let [amStyles, exists] = resolveAutoMergePair(am[1], "@style", dataenv);
        if (exists) {
            if (!isObject(amStyles)) {
                return null;
            }
            return amStyles as Record<string, any>;
        }
    }

    // get base node style (includes initStyles)
    let rtn = getNonAmStyleMap(node, ns, dataenv, initStyles);

    // check include automerge
    if (am[0].length > 0) {
        let [amStyles, exists] = resolveAutoMergePair(am[0], "@style", dataenv);
        if (exists && amStyles != null && isObject(amStyles)) {
            let amStyleMap = amStyles as Record<string, any>;
            // automerge styles will always merge. overwrites existing entries in styleMap
            for (let styleKey in amStyleMap) {
                rtn[styleKey] = amStyleMap[styleKey];
            }
        }
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
    if (typeof(val) == "string" || typeof(val) == "number" || typeof(val) == "boolean" || typeof(val) == "symbol" || typeof(val) == "bigint") {
        return val.toString();
    }
    if (typeof(val) == "function") {
        return "[Function]";
    }
    if (mobx.isArrayLike(val)) {
        return val.toString();
    }
    if (!isObject(val)) {
        return "[" + typeof(val) + "]";
    }
    if (val instanceof HibikiBlob) {
        return blobPrintStr(val);
    }
    if (val instanceof OpaqueValue) {
        return val.asString();
    }
    if (val instanceof HibikiRequest) {
        return sprintf("[HibikiRequest:%s]", val.reqid);
    }
    if (val instanceof RtContext) {
        return sprintf("[RtContext:%s]", val.rtid);
    }
    if (val instanceof DataEnvironment) {
        return "[DataEnvironment]";
    }
    if (val instanceof ChildrenVar) {
        return val.asString();
    }
    return "[Object object]";
}

// turns empty string into null
function resolveAttrStr(k : string, v : NodeAttrType, dataenv : DataEnvironment, opts? : ResolveOpts) : string {
    opts = opts ?? {};
    let [resolvedVal, exists] = resolveAttrValPair(k, v, dataenv, opts);
    if (!exists || resolvedVal == null || resolvedVal === false || resolvedVal === "") {
        return null;
    }
    if (resolvedVal === true) {
        resolvedVal = 1;
    }
    if (resolvedVal instanceof HibikiBlob) {
        return blobPrintStr(resolvedVal);
    }
    resolvedVal = demobx(resolvedVal);
    if (opts.style && typeof(resolvedVal) === "number") {
        if (!STYLE_UNITLESS_NUMBER[k]) {
            resolvedVal = String(resolvedVal) + "px";
        }
    }
    return valToString(resolvedVal);
}

function attrValToStr(v : HibikiVal) : string {
    if (v == null || v === false || v === "") {
        return null;
    }
    if (v === true) {
        v = 1;
    }
    if (v instanceof HibikiBlob) {
        return blobPrintStr(v);
    }
    v = demobx(v);
    return valToString(v);
}

// returns [value, exists]
function resolveAttrValPair(k : string, v : NodeAttrType, dataenv : DataEnvironment, opts? : ResolveOpts) : [HibikiVal, boolean] {
    opts = opts || {};
    if (v == null) {
        return [null, false];
    }
    if (typeof(v) == "string") {
        return [v, true];
    }
    let resolvedVal : HibikiValEx = null;
    try {
        resolvedVal = evalExprAstEx(v, dataenv);
    }
    catch (e) {
        let rtContext = opts.rtContext ?? "resolving attribute '%s'";
        console.log(sprintf("ERROR %s expression\n\"%s\"\n", rtContext, k, v.sourcestr), e.toString());
        return [null, true];
    }
    if (resolvedVal instanceof LValue) {
        resolvedVal = resolvedVal.getEx();
    }
    if (typeof(resolvedVal) == "symbol" || resolvedVal instanceof Symbol) {
        if (resolvedVal === SYM_NOATTR) {
            return [null, false];
        }
        return [resolvedVal.toString(), true];
    }
    if (resolvedVal instanceof LValue) { // satisfy typescript
        return ["[lvalue]", true];
    }
    return [resolvedVal, true];
}

function resolveNonAmLValueAttrParts(node : HibikiNode, attrName : string, dataenv : DataEnvironment) : [LValue, HibikiValEx, boolean] {
    if (node.bindings == null || node.bindings[attrName] == null) {
        return [null, null, false];
    }
    let pathExpr = node.bindings[attrName];
    let pathVal = evalPathExprAst(pathExpr, dataenv);
    if (typeof(pathVal) === "symbol" || pathVal instanceof Symbol) {
        if (pathVal === SYM_NOATTR) {
            return [null, null, false];
        }
        throw new Error(sprintf("Invalid path expression symbol: %s", pathVal.toString()));
    }
    let lvRtn = new BoundLValue(pathVal, dataenv, sprintf("%s@%s", nodeStr(node), attrName));
    let exVal = lvRtn.getEx();
    if (exVal === SYM_NOATTR) {
        return [null, null, false];
    }
    return [lvRtn, exVal, true];
}

function resolveAutoMergeLValue(sourceArr : string[], attrName : string, dataenv : DataEnvironment) : LValue {
    if (sourceArr == null || sourceArr.length == 0) {
        return null;
    }
    let argsRoot = dataenv.getArgsRoot();
    if (argsRoot == null || argsRoot["@ns"] == null) {
        return null;
    }
    for (let i=0; i<sourceArr.length; i++) {
        let source = sourceArr[i];
        let nsArgs = argsRootSource(argsRoot, source);
        if (nsArgs == null) {
            continue;
        }
        if (attrName in nsArgs) {
            let val = nsArgs[attrName];
            if (val instanceof LValue) {
                return val;
            }
        }
    }
    return null;
}

function resolveLValueAttrParts(node : HibikiNode, attrName : string, dataenv : DataEnvironment, opts? : ResolveOpts) : [LValue, HibikiValEx, boolean] {
    opts = opts ?? {};
    let am = (opts.noAutoMerge ? [[], []] : checkSingleAutoMerge(node, attrName, "self"));

    if (am[1].length > 0) {
        let lv = resolveAutoMergeLValue(am[1], attrName, dataenv);
        if (lv != null) {
            let exVal = lv.getEx();
            if (exVal !== SYM_NOATTR) {
                return [lv, exVal, true];
            }
        }
    }

    let [lvRtn, exVal, exists] = resolveNonAmLValueAttrParts(node, attrName, dataenv);
    if (exists) {
        return [lvRtn, exVal, true];
    }
    
    if (am[0].length > 0) {
        let lv = resolveAutoMergeLValue(am[0], attrName, dataenv);
        if (lv != null) {
            let exVal = lv.getEx();
            if (exVal !== SYM_NOATTR) {
                return [lv, exVal, true];
            }
        }
    }

    return [null, null, false];
}

function resolveLValueAttr(node : HibikiNode, attrName : string, dataenv : DataEnvironment, opts? : ResolveOpts) : LValue {
    opts = opts ?? {};
    let [lvalue, val, exists] = resolveLValueAttrParts(node, attrName, dataenv, opts);
    return lvalue;
}

function getAttributeStr(node : HibikiNode, attrName : string, dataenv : DataEnvironment, opts? : ResolveOpts) : string {
    let [hval, exists] = getAttributeValPair(node, attrName, dataenv, opts);
    if (!exists) {
        return null;
    }
    return attrValToStr(hval);
}

const NON_ARGS_ATTRS = {
    "if": true,
    "foreach": true,
    "component": true,
    "eid": true,
    "ref": true,
    "condition": true,
    "automerge": true,
};

// returns [includeSources[], includeForceSources[]]
function checkSingleAutoMerge(node : HibikiNode, attrName : string, ns : string) : [string[], string[]] {
    if (node.automerge == null || NON_ARGS_ATTRS[attrName]) {
        return [[], []];
    }
    let source : string = null;
    let rtn : [string[], string[]] = [[], []];
    for (let i=0; i<node.automerge.length; i++) {
        let amExpr = node.automerge[i];
        if (amExpr.dest !== ns) {
            continue;
        }
        let [include, includeForce] = checkAMAttr(amExpr, attrName);
        if (includeForce) {
            rtn[1].push(amExpr.source);
        }
        else if (include) {
            rtn[0].push(amExpr.source);
        }
    }
    return rtn;
}

function argsRootSource(argsRoot : Record<string, HibikiValEx>, source : string) : Record<string, HibikiValEx> {
    if (argsRoot == null || argsRoot["@ns"] == null) {
        return null;
    }
    return argsRoot["@ns"][source];
}

function resolveAutoMergeCnArraySingle(source : string, argsRoot : Record<string, HibikiValEx>) : [Record<string, boolean>[], boolean] {
    if (source == null || argsRoot == null || argsRoot["@ns"] == null || argsRoot["@ns"][source] == null) {
        return [null, false];
    }
    let srcRoot = argsRootSource(argsRoot, source);
    let exists = ("class" in srcRoot);
    let cnArr = makeCnArr(srcRoot["class"]);
    for (let [k,v] of Object.entries(srcRoot)) {
        if (!k.startsWith("class.")) {
            continue;
        }
        exists = true;
        let kval = k.substr(6);
        if (v && v !== "0") {
            cnArr.push({[kval]: true});
        }
        else {
            cnArr.push({[kval]: false});
        }
    }
    if (!exists) {
        return [null, false];
    }
    return [cnArr, true];
}

function resolveAutoMergeCnArray(sourceArr : string[], dataenv : DataEnvironment) : [Record<string, boolean>[], boolean] {
    if (sourceArr == null || sourceArr.length == 0) {
        return [null, false];
    }
    let argsRoot = dataenv.getArgsRoot();
    if (argsRoot == null || argsRoot["@ns"] == null) {
        return [null, false];
    }
    for (let i=0; i<sourceArr.length; i++) {
        let [cnArr, exists] = resolveAutoMergeCnArraySingle(sourceArr[i], argsRoot);
        if (exists) {
            return [cnArr, true];
        }
    }
    return [null, false];
}

function resolveAutoMergePair(sourceArr : string[], attrName : string, dataenv : DataEnvironment) : [HibikiVal, boolean] {
    if (sourceArr == null || sourceArr.length == 0) {
        return [null, false];
    }
    let argsRoot = dataenv.getArgsRoot();
    if (argsRoot == null || argsRoot["@ns"] == null) {
        return [null, false];
    }
    for (let i=0; i<sourceArr.length; i++) {
        let source = sourceArr[i];
        let nsArgs = argsRootSource(argsRoot, source);
        if (nsArgs == null) {
            continue;
        }
        if (attrName in nsArgs) {
            return [exValToVal(nsArgs[attrName]), true];
        }
    }
    return [null, false];
}

function getAttributeValPair(node : HibikiNode, attrName : string, dataenv : DataEnvironment, opts? : ResolveOpts) : [HibikiVal, boolean] {
    if (!node) {
        return [null, false];
    }
    opts = opts ?? {};

    // check forceInclude automerge
    let am = (opts.noAutoMerge ? [[], []] : checkSingleAutoMerge(node, attrName, "self"));
    if (am[1].length > 0) {
        let [amVal, exists] = resolveAutoMergePair(am[1], attrName, dataenv);
        if (exists) {
            return [amVal, true];
        }
    }

    // check node.bindings
    if (!opts.noBindings && node.bindings && node.bindings[attrName] != null) {
        let [lv, rtnVal, exists] = resolveLValueAttrParts(node, attrName, dataenv, {noAutoMerge: true});
        if (exists) {
            return [exValToVal(rtnVal), true];
        }
    }

    // check node.attrs
    if (node.attrs && node.attrs[attrName] != null) {
        opts = opts || {};
        opts.rtContext = sprintf("resolving attribute '%s' in <%s>", attrName, node.tag);
        let aval = node.attrs[attrName];
        let [rtnVal, exists] = resolveAttrValPair(attrName, aval, dataenv, opts);
        if (exists) {
            return [rtnVal, true];
        }
    }

    // check remaining automerge
    if (am[0].length > 0) {
        let [amVal, exists] = resolveAutoMergePair(am[0], attrName, dataenv);
        if (exists) {
            return [amVal, true];
        }
    }

    // no attr
    return [null, false];
}


// the order matters here.  first check for specific attr, then check for all.
// start with exclude, then includeForce, then include.
// returns [include, includeForced]
function checkAMAttr(amExpr : AutoMergeExpr, attrName : string) : [boolean, boolean] {
    if (attrName == "@style") {
        attrName = "style";
    }
    if (attrName.startsWith("class.")) {
        attrName = "class";
    }
    if (amExpr.exclude != null && amExpr.exclude[attrName]) {
        return [false, false];
    }
    if (amExpr.includeForce != null && amExpr.includeForce[attrName]) {
        return [true, true];
    }
    if (amExpr.include != null && amExpr.include[attrName]) {
        return [true, false];
    }
    if (amExpr.exclude != null && amExpr.exclude["all"]) {
        return [false, false];
    }
    if (amExpr.includeForce != null && amExpr.includeForce["all"]) {
        return [true, true];
    }
    if (amExpr.include != null && amExpr.include["all"]) {
        return [true, false];
    }
    return [false, false];
}

function resolveAutoMergeAttrs(node : HibikiNode, destNs : string, dataenv : DataEnvironment, forced : boolean) : Record<string, HibikiVal> {
    let rtn : Record<string, HibikiVal> = {};
    if (node.automerge == null || node.automerge.length === 0) {
        return rtn;
    }
    let argsRoot = dataenv.getArgsRoot();
    if (argsRoot == null || argsRoot["@ns"] == null) {
        return rtn;
    }
    for (let i=0; i<node.automerge.length; i++) {
        let amExpr = node.automerge[i];
        if (amExpr.dest != destNs) {
            continue;
        }
        let nsRoot = argsRootSource(argsRoot, amExpr.source);
        for (let srcAttr in nsRoot) {
            if (NON_ARGS_ATTRS[srcAttr] || srcAttr.startsWith("@") || srcAttr == "class" || srcAttr.startsWith("class.")) {
                continue;
            }
            let [include, includeForce] = checkAMAttr(amExpr, srcAttr);
            if (forced && includeForce || !forced && include && !includeForce) {
                rtn[srcAttr] = exValToVal(nsRoot[srcAttr]);
            }
        }
    }
    return rtn;
}

// no style, class is fully resolved.
function resolveValAttrs(node : HibikiNode, dataenv : DataEnvironment) : Record<string, HibikiVal> {
    if (node.attrs == null && node.automerge == null) {
        return {};
    }
    let rtn = resolveAutoMergeAttrs(node, "self", dataenv, true);
    if (node.bindings != null) {
        for (let key in node.bindings) {
            if (key in rtn || NON_ARGS_ATTRS[key]) {
                continue;
            }
            let [val, exists] = getAttributeValPair(node, key, dataenv, {noAutoMerge: true});
            if (exists) {
                rtn[key] = val;
            }
        }
    }
    if (node.attrs != null) {
        for (let key in node.attrs) {
            if (key in rtn || NON_ARGS_ATTRS[key] || key == "class" || key.startsWith("class.")) {
                continue;
            }
            let [val, exists] = getAttributeValPair(node, key, dataenv, {noAutoMerge: true, noBindings: true});
            if (exists) {
                rtn[key] = val;
            }
        }
    }
    let amAttrs = resolveAutoMergeAttrs(node, "self", dataenv, false);
    for (let key in amAttrs) {
        if (key in rtn || NON_ARGS_ATTRS[key]) {
            continue;
        }
        rtn[key] = amAttrs[key];
    }
    let cnArr = resolveCnArray(node, "self", dataenv, null);
    if (cnArr != null && cnArr.length > 0) {
        rtn["class"] = cn(cnArr);
    }
    return rtn;
}

function _assignToArgsRootNs(argsRoot : Record<string, HibikiValEx>, key : string, val : HibikiValEx, forced? : boolean) {
    let colonIdx = key.indexOf(":");
    let ns : string = null;
    let baseName : string = null;
    if (colonIdx === -1) {
        ns = "self";
        baseName = key;
    }
    else if (colonIdx === 0) {
        if (key.length === 1) {
            return;
        }
        ns = "root";
        baseName = key.substr(1);
    }
    else {
        ns = key.substr(0, colonIdx);
        baseName = key.substr(colonIdx+1);
        if (baseName == "") {
            return;
        }
    }
    if (NON_ARGS_ATTRS[baseName]) {
        return;
    }
    if (argsRoot["@ns"][ns] == null) {
        argsRoot["@ns"][ns] = {};
    }
    let nsRoot = argsRoot["@ns"][ns];
    if (baseName == "class" || baseName.startsWith("class.")) {
        if (!forced && nsRoot["@classlock"]) {
            return;
        }
        if (forced) {
            nsRoot["@classlock"] = true;
        }
        if (baseName == "class") {
            nsRoot["class"] = cn(nsRoot["class"], val);
        }
        else {
            if (baseName in nsRoot) {
                return;
            }
            nsRoot[baseName] = val;
        }
        return;
    }
    if (baseName in nsRoot) {
        return;
    }
    nsRoot[baseName] = val;
    if (val instanceof LValue) {
        if (nsRoot["@bound"] == null) {
            nsRoot["@bound"] = {};
        }
        nsRoot["@bound"][baseName] = true;
    }
}

function resolveArgsRootAutoMerge(outputArgsRoot : Record<string, HibikiValEx>, node : HibikiNode, dataenv : DataEnvironment, forced : boolean) {
    if (node.automerge == null || node.automerge.length === 0) {
        return;
    }
    let argsRoot = dataenv.getArgsRoot();
    if (argsRoot == null || argsRoot["@ns"] == null) {
        return;
    }

    for (let i=0; i<node.automerge.length; i++) {
        let amExpr = node.automerge[i];
        let srcRoot = argsRootSource(argsRoot, amExpr.source);
        if (srcRoot == null) {
            continue;
        }
        for (let srcAttr in srcRoot) {
            if (srcAttr.startsWith("@") && srcAttr != "@style") {
                continue;
            }
            let [include, includeForce] = checkAMAttr(amExpr, srcAttr);
            if (forced && includeForce || !forced && include && !includeForce) {
                let val = srcRoot[srcAttr];
                let destAttrName : string = null;
                if (amExpr.dest === "self") {
                    destAttrName = srcAttr;
                }
                else if (amExpr.dest === "root") {
                    destAttrName = ":" + srcAttr;
                }
                else {
                    destAttrName = amExpr.dest + ":" + srcAttr;
                }
                _assignToArgsRootNs(outputArgsRoot, destAttrName, val, forced);
            }
        }
    }
}

function mergeArgsRootNs(argsRoot : Record<string, HibikiValEx>, ns : string) {
    if (argsRoot["@ns"][ns] == null) {
        return;
    }
    let nsRoot = argsRoot["@ns"][ns];
    for (let key in nsRoot) {
        if (key.startsWith("@")) {
            continue;
        }
        if (key == "class" || key.startsWith("class.")) {
            continue;
        }
        argsRoot[key] = nsRoot[key];
    }
    if (nsRoot["@bound"] != null) {
        if (argsRoot["@bound"] == null) {
            argsRoot["@bound"] = {};
        }
        for (let key in nsRoot["@bound"]) {
            argsRoot["@bound"][key] = nsRoot["@bound"][key];
        }
    }
}

function resolveArgsRoot(node : HibikiNode, dataenv : DataEnvironment, implNode : HibikiNode) : Record<string, HibikiValEx> {
    let argsRoot = {"@ns": {}};

    // forced automerge
    resolveArgsRootAutoMerge(argsRoot, node, dataenv, true);

    let boundArgs = [];
    if (implNode != null && implNode.attrs != null && implNode.attrs.boundargs != null) {
        let baAttr = rawAttrStr(implNode.attrs.boundargs);
        boundArgs = splitTrim(baAttr, ",");
    }
    for (let i=0; i<boundArgs.length; i++) {
        let key = boundArgs[i];
        if (key in argsRoot || NON_ARGS_ATTRS[key]) {
            continue;
        }
        let lvalue = resolveLValueAttr(node, key, dataenv, {noAutoMerge: true});
        if (lvalue != null) {
            _assignToArgsRootNs(argsRoot, key, lvalue);
            continue;
        }
        let [val, exists] = getAttributeValPair(node, key, dataenv, {noAutoMerge: true, noBindings: true});
        if (exists) {
            let lv = CreateReadOnlyLValue(val, sprintf("$args.%s:readonly", key));
            _assignToArgsRootNs(argsRoot, key, lv);
            continue;
        }
        else {
            let lv = CreateObjectLValue(null, sprintf("$args.%s", key));
            _assignToArgsRootNs(argsRoot, key, lv);
            continue;
        }
    }
    
    if (node.bindings != null) {
        for (let key in node.bindings) {
            if (key in argsRoot || NON_ARGS_ATTRS[key]) {
                continue;
            }
            let lvalue = resolveLValueAttr(node, key, dataenv, {noAutoMerge: true});
            if (lvalue != null) {
                _assignToArgsRootNs(argsRoot, key, lvalue);
            }
        }
    }
    if (node.attrs != null) {
        for (let key in node.attrs) {
            if (key in argsRoot || NON_ARGS_ATTRS[key]) {
                continue;
            }
            let [val, exists] = getAttributeValPair(node, key, dataenv, {noAutoMerge: true, noBindings: true});
            if (exists) {
                _assignToArgsRootNs(argsRoot, key, val);
            }
        }
    }
    if (node.style != null) {
        _assignToArgsRootNs(argsRoot, "@style", node.style);
    }
    if (node.morestyles != null) {
        for (let key in node.morestyles) {
            let styleNs = key.replace(":style", "");
            let styleMap = getStyleMap(node, styleNs, dataenv);
            let styleName = key.replace(":style", ":@style");
            _assignToArgsRootNs(argsRoot, styleName, styleMap);
        }
    }

    // automerge
    resolveArgsRootAutoMerge(argsRoot, node, dataenv, false);

    // merge to $args from self, then overwrite with root.  does not merge "class" args
    mergeArgsRootNs(argsRoot, "self");
    mergeArgsRootNs(argsRoot, "root");

    // specially compute class for argsRoot
    let cnArr = resolveCnArray(node, "self", dataenv, null);
    if (cnArr != null && cnArr.length > 0) {
        argsRoot["class"] = cn(cnArr);
    }

    return argsRoot;
}

function resolveStrAttrs(node : HibikiNode, dataenv : DataEnvironment) : Record<string, string> {
    let vals = resolveValAttrs(node, dataenv);
    let rtn : Record<string, string> = {};
    for (let key in vals) {
        rtn[key] = attrValToStr(vals[key]);
    }
    return rtn;
}

function formatVal(val : HibikiVal, format : string) : string {
    let rtn = null;
    try {
        if (format == null || format === "") {
            if (val instanceof HibikiBlob) {
                rtn = blobPrintStr(val);
            }
            else {
                rtn = valToString(val) ?? "null";
            }
        }
        else if (format === "json") {
            rtn = JsonStringify(val, 2);
        }
        else if (format === "json-compact") {
            rtn = JsonStringify(val);
        }
        else if (mobx.isArrayLike(val)) {
            rtn = sprintf(format, ...val);
        }
        else {
            rtn = sprintf(format, val);
        }
    } catch (e) {
        rtn = "format-error[" + e + "]";
    }
    return rtn;
}

function formatFilter(val : any, args : HibikiValObj) {
    let {format} = unpackPositionalArgs(args, ["format"]);
    return formatVal(val, valToString(format));
}

function forceAsArray(val : any) : any[] {
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

function makeIteratorFromValue(bindVal : any) : [any, boolean] {
    let iterator = null;
    let isMap = false;
    if (bindVal == null) {
        return [[], false];
    }
    if (bindVal instanceof HibikiBlob || (isObject(bindVal) && bindVal._type === "HibikiNode")) {
        return [[bindVal], false];
    }
    if (bindVal instanceof DataEnvironment || bindVal instanceof LValue) {
        return [[], false];
    }
    if (bindVal instanceof Map || mobx.isObservableMap(bindVal)) {
        return [bindVal, true];
    }
    if (mobx.isArrayLike(bindVal)) {
        return [bindVal, false];
    }
    if (typeof(bindVal) === "object") {
        return [Object.entries(bindVal), true];
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
    let rawData = evalExprAst(iteratorExpr.data, dataenv);
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
        let val = evalExprAst(this.expr, dataenv);
        let valUpdated = !DeepEqual(val, this.lastVal);
        if (this.firstRun) {
            valUpdated = this.fireOnInitialRun;
        }
        this.lastVal = val;
        this.firstRun = false;
        return [val, valUpdated];
    }
}

abstract class LValue {
    abstract get() : HibikiVal;
    abstract getEx() : HibikiValEx;
    abstract set(newVal : HibikiValEx);
    abstract subArrayIndex(index : number) : LValue;
    abstract subMapKey(key : string) : LValue;
    abstract getRtContext() : string;
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
        return exValToVal(this.getEx());
    }
    
    getEx() : HibikiValEx {
        let staticPath = evalPath(this.path, this.dataenv);
        return ResolvePath(staticPath, this.dataenv, {rtContext: this.rtContext});
    }

    getRtContext() : string {
        return this.rtContext;
    }

    set(newVal : HibikiValEx) {
        let staticPath = evalPath(this.path, this.dataenv);
        SetPath(staticPath, this.dataenv, newVal, {rtContext: this.rtContext});
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
}

function exValToVal(exVal : HibikiValEx) : HibikiVal {
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
        return exValToVal(this.getEx());
    }

    getEx() : HibikiValEx {
        return this.wrappedLV.getEx();
    }

    getRtContext() : string {
        return this.wrappedLV.getRtContext();
    }

    set(newVal : HibikiValEx) {
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
        return exValToVal(this.getEx());
    }

    getEx() : HibikiValEx {
        return quickObjectResolvePath(this.path, this.root.get());
    }

    getRtContext() : string {
        return this.rtContext;
    }

    set(newVal : HibikiValEx) {
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
}

function StringPath(path : PathUnionType) : string {
    if (typeof(path) == "string") {
        return path;
    }
    if (path.length === 0) {
        return ".";
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

// function internalResolvePath(path : PathType, localRoot : any, globalRoot : any, specials : any, level : number) : any {
function internalResolvePath(path : PathType, irData : any, dataenv : DataEnvironment, level : number) : HibikiValEx {
    if (level >= path.length) {
        return irData;
    }
    if (irData === SYM_NOATTR) {
        return irData;
    }
    let pp = path[level];
    if (pp.pathtype === "root") {
        if (level !== 0) {
            throw new Error(sprintf("Root($) path invalid in ResolvePath except at level 0, path=%s, level=%d", StringPath(path), level));
        }
        if (pp.pathkey === "expr") {
            let newIrData = pp.value;
            return internalResolvePath(path, newIrData, dataenv, level+1);
        }
        let newIrData = null;
        try {
            newIrData = dataenv.resolveRoot(pp.pathkey, {caret: pp.caret});
        }
        catch (e) {
            throw new Error(sprintf("Invalid root path, path=%s, pathkey=%s, level=%d", StringPath(path), pp.pathkey, level));
        }
        return internalResolvePath(path, newIrData, dataenv, level+1);
    }
    else if (pp.pathtype === "array") {
        if (irData == null) {
            return null;
        }
        if (irData instanceof LValue) {
            return internalResolvePath(path, irData.subArrayIndex(pp.pathindex), dataenv, level+1);
        }
        if (isOpaqueType(irData)) {
            return null;
        }
        if (!mobx.isArrayLike(irData)) {
            throw new Error(sprintf("Cannot resolve array index (non-array) in ResolvePath, path=%s, level=%d", StringPath(path), level));
        }
        if (pp.pathindex < 0) {
            throw new Error(sprintf("Bad array index: %d in ResolvePath, path=%s, level=%d", pp.pathindex, StringPath(path), level));
        }
        if (pp.pathindex >= irData.length) {
            return null;
        }
        return internalResolvePath(path, irData[pp.pathindex], dataenv, level+1);
    }
    else if (pp.pathtype === "map") {
        if (irData == null) {
            return null;
        }
        if (irData instanceof LValue) {
            return internalResolvePath(path, irData.subMapKey(pp.pathkey), dataenv, level+1);
        }
        if (isOpaqueType(irData)) {
            return null;
        }
        if (typeof(irData) !== "object") {
            throw new Error(sprintf("Cannot resolve map key (non-object) in ResolvePath, path=%s, level=%d, type=%s", StringPath(path), level, typeof(irData)));
        }
        if ((irData instanceof Map) || mobx.isObservableMap(irData)) {
            return internalResolvePath(path, irData.get(pp.pathkey), dataenv, level+1);
        }
        if (level == 1 && path[0].pathtype === "root" && path[0].pathkey === "args" && !(pp.pathkey in irData)) {
            // special case, NOATTR for undefined values off $args root
            return SYM_NOATTR;
        }
        return internalResolvePath(path, irData[pp.pathkey], dataenv, level+1);
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
    return internalResolvePath(path, null, dataenv, 0);
}

function appendData(path : PathType, curData : any, newData : any) : any {
    if (curData == null) {
        return [newData];
    }
    if (Array.isArray(curData) || mobx.isArrayLike(curData)) {
        curData.push(newData);
        return curData;
    }
    if (typeof(curData) === "string" && newData == null) {
        return curData;
    }
    if (typeof(curData) === "string" && typeof(newData) === "string") {
        return curData + newData;
    }
    throw new Error(sprintf("SetPath cannot append newData, path=%s, typeof=%s", StringPath(path), typeof(curData)));
}

function appendArrData(path : PathType, curData : any, newData : any) : any {
    if (newData == null) {
        return curData;
    }
    if (!Array.isArray(newData) && !mobx.isArrayLike(newData)) {
        return curData;
    }
    if (curData == null) {
        return newData;
    }
    if (Array.isArray(curData) || mobx.isArrayLike(curData)) {
        for (let v of newData) {
            curData.push(v);
        }
        return curData;
    }
    throw new Error(sprintf("SetPath cannot appendarr newData, path=%s, typeof=%s", StringPath(path), typeof(curData)));
}

function setPathWrapper(op : string, path : PathType, dataenv : DataEnvironment, setData : any, opts : {allowContext : boolean}) {
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
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    if (path.length <= 1) {
        throw new Error(sprintf("Invalid set path expression, cannot set raw root [[%s]] %s", StringPath(path), rootpp.pathkey));
    }
    else if (rootpp.pathkey === "state") {
        let irData = dataenv.resolveRoot("state");
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "context" && allowContext) {
        let irData = dataenv.resolveRoot("context", {caret: rootpp.caret});
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "currentcontext" && allowContext) {
        let irData = dataenv.resolveRoot("currentcontext", {caret: rootpp.caret});
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "c" || rootpp.pathkey === "component") {
        let irData = dataenv.resolveRoot("c");
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey === "args") {
        let irData = dataenv.resolveRoot("args");
        internalSetPath(dataenv, op, path, irData, setData, 1);
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
    return internalSetPath(null, op, path, localRoot, setData, 1, {nomap: true});
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
        return internalResolvePath(path, localRoot, null, 1);
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
        return internalSetPath(null, "set", path, localRoot, setData, 1, {nomap: true});
    }
    catch (e) {
        console.log("Error setting object path", e);
        return null;
    }
}

function internalSetPath(dataenv : DataEnvironment, op : string, path : PathType, localRoot : any, setData : any, level : number, opts? : any) : any {
    if (mobx.isBoxedObservable(localRoot)) {
        throw new Error("Bad localRoot -- cannot be boxed observable.");
    }
    opts = opts || {};
    if (level >= path.length) {
        if (localRoot instanceof LValue) {
            if (op !== "set") {
                throw new Error(sprintf("Invalid setPath op=%s for LValue bindpath", op));
            }
            localRoot.set(setData);
            return localRoot;
        }
        if (op === "append") {
            return appendData(path, localRoot, setData);
        }
        if (op === "appendarr") {
            return appendArrData(path, localRoot, setData);
        }
        else if (op === "set") {
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
    let pp = path[level];
    if (pp.pathtype === "root") {
        throw new Error(sprintf("Invalid path, root path not first part, path=%s, level=%d", StringPath(path), level));
    }
    else if (pp.pathtype === "array") {
        if (pp.pathindex < 0 || pp.pathindex > MAX_ARRAY_SIZE) {
            throw new Error(sprintf("SetPath bad array index=%d, path=%s, level=%d", pp.pathindex, StringPath(path), level));
        }
        if (localRoot == null) {
            localRoot = [];
        }
        if (localRoot instanceof LValue) {
            internalSetPath(dataenv, op, path, localRoot.subArrayIndex(pp.pathindex), setData, level+1, opts);
            return localRoot;
        }
        if (isOpaqueType(localRoot, true)) {
            throw new Error(sprintf("SetPath cannot resolve array index through %s, path=%s, level=%d", opaqueTypeAsString(localRoot), StringPath(path), level));
        }
        if (!mobx.isArrayLike(localRoot)) {
            throw new Error(sprintf("SetPath cannot resolve array index through non-array, path=%s, level=%d", StringPath(path), level));
        }
        if (localRoot.length < pp.pathindex + 1) {
            localRoot.length = pp.pathindex + 1;
        }
        let newVal = internalSetPath(dataenv, op, path, localRoot[pp.pathindex], setData, level+1, opts);
        localRoot[pp.pathindex] = newVal;
        return localRoot;
    }
    else if (pp.pathtype === "map") {
        if (localRoot == null) {
            if (opts.nomap) {
                localRoot = {};
            }
            else {
                localRoot = new Map();
            }
        }
        if (isOpaqueType(localRoot, true)) {
            throw new Error(sprintf("SetPath cannot resolve map key through %s, path=%s, level=%d", opaqueTypeAsString(localRoot), StringPath(path), level));
        }
        if (typeof(localRoot) !== "object") {
            throw new Error(sprintf("SetPath cannot resolve map key through non-object, path=%s, level=%d", StringPath(path), level));
        }
        if (localRoot instanceof LValue) {
            internalSetPath(dataenv, op, path, localRoot.subMapKey(pp.pathkey), setData, level+1, opts);
        }
        else if ((localRoot instanceof Map) || mobx.isObservableMap(localRoot)) {
            let newVal = internalSetPath(dataenv, op, path, localRoot.get(pp.pathkey), setData, level+1, opts);
            localRoot.set(pp.pathkey, newVal);
        }
        else {
            let newVal = internalSetPath(dataenv, op, path, localRoot[pp.pathkey], setData, level+1, opts);
            localRoot[pp.pathkey] = newVal;
        }
        return localRoot;
    }
    else {
        throw new Error(sprintf("Bad PathPart in SetPath, path=%s, level=%d", StringPath(path), level));
    }
    return null;
}

// function SetPath(path : PathUnionType, localRoot : any, setData : any, globalRoot? : any) : any {
function SetPath(path : PathUnionType, dataenv : DataEnvironment, setData : any, opts? : RtContextOpts) {
    try {
        SetPathThrow(path, dataenv, setData);
    }
    catch (e) {
        let context = "";
        if (opts && opts.rtContext != null) {
            context = " | " + opts.rtContext;
        }
        console.log(sprintf("SetPath Error: %s%s", e.message, context));
    }
}

function SetPathThrow(pathUnion : PathUnionType, dataenv : DataEnvironment, setData : any) {
    let path : PathType = null;
    let op : string = "";
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
        op = "set";
    }
    if (path == null) {
        return;
    }
    setPathWrapper(op, path, dataenv, setData, {allowContext: false});
}

function LValueMapReplacer(lvMap : any, key : string, value : any) : any {
    if (this[key] instanceof LValue) {
        let id = uuidv4();
        lvMap[id] = this[key];
        return {_type: "HibikiLValue", lvalueref: id};
    }
    return MapReplacer.bind(this)(key, value);
}

function MapReplacer(key : string, value : any) : any {
    if (this[key] == null) {
        return null;
    }
    if (typeof(this[key]) === "function") {
        return null;
    }
    if (this[key] instanceof Map) {
        let rtn = {};
        let m = this[key];
        for (let [k,v] of m) {
            rtn[k] = v;
        }
        return rtn;
    }
    else if (this[key] instanceof Blob) {
        return blobPrintStr(this[key]);
    }
    else if (this[key] instanceof HibikiBlob) {
        return blobPrintStr(this[key]);
    }
    else if (this[key] instanceof LValue) {
        let rtn = this[key].get();
        return demobx(rtn);
    }
    else if (this[key] instanceof DataEnvironment) {
        return "[DataEnvironment]";
    }
    else if (this[key] instanceof HibikiError) {
        return this[key].toString();
    }
    else if (this[key] instanceof HibikiRequest) {
        return "[HibikiRequest]";
    }
    else if (this[key] instanceof HibikiState) {
        return "[HibikiState]";
    }
    else if (this[key] instanceof ChildrenVar) {
        return this[key].asString();
    }
    else if (this[key] === SYM_NOATTR) {
        return null;
    }
    else if (typeof(this[key]) === "symbol" || this[key] instanceof Symbol) {
        return this[key].toString();
    }
    else {
        return value;
    }
}

// does not copy blobs correctly
function DeepCopy(data : any) : any {
    return JSON.parse(JSON.stringify(data, MapReplacer));
}

function DeepEqual(data1 : any, data2 : any) : boolean {
    if (data1 === data2) {
        return true;
    }
    if (data1 instanceof LValue) {
        data1 = data1.get();
    }
    if (data2 instanceof LValue) {
        data2 = data2.get();
    }
    if (data1 == null || data2 == null) {
        return false;
    }
    if (typeof(data1) === "number" && typeof(data2) === "number") {
        if (isNaN(data1) && isNaN(data2)) {
            return true;
        }
        return false;
    }
    if (typeof(data1) === "boolean" && typeof(data2) === "boolean") {
        return data1 === data2;
    }
    let d1arr = mobx.isArrayLike(data1);
    let d2arr = mobx.isArrayLike(data2);
    if (d1arr && d2arr) {
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
    if (d1arr || d2arr) {
        return false;
    }
    if (data1 instanceof HibikiBlob && data2 instanceof HibikiBlob) {
        return data1.mimetype === data2.mimetype && data1.data === data2.data;
    }
    if (data1 instanceof HibikiBlob || data2 instanceof HibikiBlob) {
        return false;
    }
    if (data1 instanceof DataEnvironment || data2 instanceof DataEnvironment) {
        return (data1 instanceof DataEnvironment) && (data2 instanceof DataEnvironment);
    }
    if (data1 instanceof HibikiRequest || data2 instanceof HibikiRequest) {
        return data1.reqid == data2.reqid;
    }
    if (data1 instanceof RtContext || data2 instanceof RtContext) {
        return data1.rtid == data2.rtid;
    }
    if (typeof(data1) !== typeof(data2)) {
        return false;
    }
    if (typeof(data1) !== "object" || typeof(data2) !== "object") {
        return false;
    }
    if (data1._type === "HibikiNode" || data2._type === "HibikiNode") {
        return data1.uuid === data2.uuid;
    }
    // objects and maps...
    let d1map = (data1 instanceof Map || mobx.isObservableMap(data1));
    let d2map = (data2 instanceof Map || mobx.isObservableMap(data2));
    let d1keys = (d1map ? Array.from(data1.keys()) : Object.keys(data1));
    let d2keys = (d2map ? Array.from(data2.keys()) : Object.keys(data2));
    if (d1keys.length !== d2keys.length) {
        return false;
    }
    for (let i=0; i<d1keys.length; i++) {
        let k1 : any = d1keys[i];
        let v1 = (d1map ? data1.get(k1) : data1[k1]);
        let v2 = (d2map ? data2.get(k1) : data2[k1]);
        if (!DeepEqual(v1, v2)) {
            return false;
        }
    }
    return true;
}

function demobxInternal(v : any) : [any, boolean] {
    if (v == null) {
        return [null, false];
    }
    if (typeof(v) === "object" && v[SYM_PROXY]) {
        return [v[SYM_FLATTEN], true];
    }
    if (mobx.isObservable(v)) {
        return [mobx.toJS(v), true];
    }
    if (Array.isArray(v)) {
        let rtn = [];
        let arrUpdated = false;
        for (let i=0; i<v.length; i++) {
            let [elem, updated] = demobxInternal(v[i]);
            if (updated) {
                arrUpdated = true;
            }
            rtn.push(elem);
        }
        if (arrUpdated) {
            return [rtn, true];
        }
        return [v, false];
    }
    if (typeof(v) !== "object") {
        return [v, false];
    }
    if (v instanceof HibikiBlob || v instanceof LValue || v instanceof DataEnvironment || v._type === "HibikiNode") {
        return [v, false];
    }
    if (v instanceof Blob) {
        return [v, false];
    }
    if (v instanceof Map) {
        let rtn = new Map();
        let mapUpdated = false;
        for (let [mapKey, mapVal] of v) {
            let [elem, updated] = demobxInternal(mapVal);
            if (updated) {
                mapUpdated = true;
            }
            rtn.set(mapKey, elem);
        }
        if (mapUpdated) {
            return [rtn, true];
        }
        return [v, false];
    }
    let objRtn = {};
    let objUpdated = false;
    for (let objKey in v) {
        let objVal = v[objKey];
        let [elem, updated] = demobxInternal(objVal);
        if (updated) {
            objUpdated = true;
        }
        objRtn[objKey] = elem;
    }
    if (objUpdated) {
        return [objRtn, true];
    }
    return [v, false];
}

function demobx<T>(v : T) : T {
    let [rtn, updated] = demobxInternal(v);
    return rtn;
}

function JsonStringify(v : any, space? : number) : string {
    v = demobx(v);
    return JSON.stringify(v, MapReplacer, space);
}

function JsonStringifyForCall(lvMap : any, v : any, space? : number) : string {
    v = demobx(v);
    let rfn = function(key, val) {
        return LValueMapReplacer.bind(this)(lvMap, key, val);
    };
    return JSON.stringify(v, rfn, space);
}

function evalFnAst(fnAst : any, dataenv : DataEnvironment) : any {
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
        let elist = evalExprArray(fnAst.exprs, dataenv);
        if (!stateFn.native) {
            elist = demobx(elist);
        }
        return stateFn.fn(...elist);
    }
    else {
        throw new Error(sprintf("Invalid function: '%s'", fnAst.fn));
    }
}

function evalPath(path : PathType, dataenv : DataEnvironment, depth? : number) : any {
    if (depth == null) {
        depth = 0;
    }
    if (depth > 5) {
        throw new Error("evalPath depth exceeded, cannot evaluate path:" + path);
    }
    let staticPath = [];
    for (let i=0; i<path.length; i++) {
        let pp = path[i];
        if (pp.pathtype === "dyn") {
            let e = evalExprAst(pp.expr, dataenv);
            if (typeof(e) === "number") {
                staticPath.push({pathtype: "array", pathindex: e});
            }
            else {
                staticPath.push({pathtype: "map", pathkey: String(e)});
            }
        }
        else if (pp.pathtype === "deref") {
            let e = evalExprAst(pp.expr, dataenv);
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

function evalExprArray(exprArray : HExpr[], dataenv : DataEnvironment) : any[] {
    if (exprArray == null || exprArray.length === 0) {
        return [];
    }
    let rtn = [];
    for (let i=0; i<exprArray.length; i++) {
        let expr = evalExprAst(exprArray[i], dataenv);
        rtn.push(expr);
    }
    return rtn;
}

function evalPathExprAst(exprAst : HExpr, dataenv : DataEnvironment) : (PathType | symbol) {
    if (exprAst.etype === "path") {
        return exprAst.path;
    }
    if (exprAst.etype === "noattr") {
        return SYM_NOATTR;
    }
    if (exprAst.etype === "op") {
        if (exprAst.op === "?:") {
            let econd = evalExprAst(exprAst.exprs[0], dataenv);
            if (econd) {
                return evalPathExprAst(exprAst.exprs[1], dataenv);
            }
            else {
                return evalPathExprAst(exprAst.exprs[2], dataenv);
            }
        }
        else {
            new Error(sprintf("Invalid path expression op type: '%s'", exprAst.op));
        }
    }
    throw new Error(sprintf("Invalid path expression etype: '%s'", exprAst.etype));
}

function evalExprAst(exprAst : HExpr, dataenv : DataEnvironment) : HibikiVal {
    let exVal = evalExprAstEx(exprAst, dataenv);
    return exValToVal(exVal);
}

function evalExprAstEx(exprAst : HExpr, dataenv : DataEnvironment) : HibikiValEx {
    if (exprAst == null) {
        return null;
    }
    if (exprAst.etype === "path") {
        let staticPath = evalPath(exprAst.path, dataenv);
        let val = internalResolvePath(staticPath, null, dataenv, 0);
        if (val instanceof LValue) {
            return val.getEx();
        }
        return val;
    }
    else if (exprAst.etype === "literal") {
        let val = exprAst.val;
        return val;
    }
    else if (exprAst.etype === "array") {
        let rtn = evalExprArray(exprAst.exprs, dataenv);
        return rtn;
    }
    else if (exprAst.etype === "array-range") {
        let e1 = parseInt(evalExprAst(exprAst.exprs[0], dataenv) as any);
        let e2 = parseInt(evalExprAst(exprAst.exprs[1], dataenv) as any);
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
            let k = evalExprAst(exprAst.exprs[i].key, dataenv);
            let v = evalExprAst(exprAst.exprs[i].valexpr, dataenv);
            if (k != null) {
                rtn[valToString(k)] = v;
            }
        }
        return rtn;
    }
    else if (exprAst.etype === "ref") {
        let lv = new BoundLValue(exprAst.path, dataenv);
        return lv;
    }
    else if (exprAst.etype === "fn") {
        return evalFnAst(exprAst, dataenv);
    }
    else if (exprAst.etype === "filter") {
        let filter = exprAst.filter;
        if (filter === "format") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let args = evalExprAst(exprAst.exprs[1], dataenv);
            return formatFilter(e1, args as HibikiValObj);
        }
        else {
            throw new Error(sprintf("Invalid filter '%s' (only format is allowed)", exprAst.filter));
        }
    }
    else if (exprAst.etype === "op") {
        if (exprAst.op === "&&") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            if (!e1) {
                return e1;
            }
            return evalExprAst(exprAst.exprs[1], dataenv);
        }
        else if (exprAst.op === "||") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            if (!!e1) {
                return e1;
            }
            return evalExprAst(exprAst.exprs[1], dataenv);
        }
        else if (exprAst.op === "??") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            if (e1 != null) {
                return e1;
            }
            return evalExprAst(exprAst.exprs[1], dataenv);
        }
        else if (exprAst.op === "*") {
            let e1 : any = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 : any = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 * e2;
        }
        else if (exprAst.op === "+") {
            // special, will evaluate entire array.
            if (exprAst.exprs == null || exprAst.exprs.length === 0) {
                return null;
            }
            let rtnVal : any = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            for (let i=1; i<exprAst.exprs.length; i++) {
                let ev : any = evalExprAst(exprAst.exprs[i], dataenv) ?? null;
                rtnVal = rtnVal + ev;
            }
            return rtnVal;
        }
        else if (exprAst.op === "/") {
            let e1 : any = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 : any = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 / e2;
        }
        else if (exprAst.op === "%") {
            let e1 : any = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 : any = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 % e2;
        }
        else if (exprAst.op === ">=") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 >= e2;
        }
        else if (exprAst.op === "<=") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 <= e2;
        }
        else if (exprAst.op === ">") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 > e2;
        }
        else if (exprAst.op === "<") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 < e2;
        }
        else if (exprAst.op === "==") {
            // TODO: fix == bug (toString())
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 == e2;
        }
        else if (exprAst.op === "!=") {
            // TODO: fix == bug (toString())
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 != e2;
        }
        else if (exprAst.op === "!") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            return !e1;
        }
        else if (exprAst.op === "-") {
            let e1 : any = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            let e2 : any = evalExprAst(exprAst.exprs[1], dataenv) ?? null;
            return e1 - e2;
        }
        else if (exprAst.op === "u-") {
            let e1 : any = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            return -e1;
        }
        else if (exprAst.op === "u+") {
            let e1 : any = evalExprAst(exprAst.exprs[0], dataenv) ?? null;
            return +e1;
        }
        else if (exprAst.op === "?:") {
            let econd = evalExprAst(exprAst.exprs[0], dataenv);
            if (econd) {
                return evalExprAst(exprAst.exprs[1], dataenv);
            }
            else {
                return evalExprAst(exprAst.exprs[2], dataenv);
            }
        }
        else {
            throw new Error(sprintf("Invalid expression op type: '%s'", exprAst.op));
        }
    }
    else if (exprAst.etype === "noattr") {
        return SYM_NOATTR;
    }
    else {
        console.log("BAD ETYPE", exprAst);
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
    let req = new HibikiRequest(dataenv.dbstate.getExtState());
    let fullData : HibikiValObj = demobx(evalExprAst(action.data, dataenv)) as HibikiValObj;
    if (fullData != null && !isObject(fullData)) {
        throw new Error(sprintf("HibikiAction 'callhandler' data must be null or an object, cannot be '%s'", typeof(fullData)));
    }
    req.data = fullData as HibikiValObj;
    req.rtContext = rtctx;
    req.pure = pure || action.pure;
    req.libContext = dataenv.getLibContext() ?? "main";
    if (action.callpath != null) {
        let callPath = valToString(evalExprAst(action.callpath, dataenv));
        let hpath = parseHandler(callPath);
        if (hpath == null) {
            throw new Error("Invalid handler path: " + callPath);
        }
        req.callpath = hpath;
        if (fullData != null) {
            if ("@url" in fullData || "@module" in fullData) {
                throw new Error(sprintf("HibikiAction 'callhandler' cannot specifiy @url or @module params when a callpath is specified"));
            }
        }
    }
    else {
        if (fullData == null) {
            throw new Error(sprintf("HibikiAction 'callhandler' without a callpath must specify an @url param"));
        }
        let {"@url": dataUrl, "@method": dataMethod, "@module": dataModule} = fullData;
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
    if (fullData != null && isObject(fullData) && fullData["@pure"]) {
        req.pure = true;
    }
    return req;
}

async function ExecuteHAction(action : HAction, pure : boolean, dataenv : DataEnvironment, rtctx : RtContext) : Promise<any> {
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
        let expr = evalExprAst(action.data, dataenv);
        doAssignment(action, expr, pure, dataenv);
    }
    else if (action.actiontype === "ifblock") {
        let condVal = evalExprAst(action.data, dataenv);
        let actions = action.actions ?? {};
        if (condVal) {
            rtctx.pushContext("Executing then clause", null);
            await ExecuteHandlerBlock(new HActionBlock(actions["then"]), pure, dataenv, rtctx);
        }
        else {
            rtctx.pushContext("Executing else clause", null);
            await ExecuteHandlerBlock(new HActionBlock(actions["else"]), pure, dataenv, rtctx);
        }
        return null;
    }
    else if (action.actiontype === "setreturn") {
        let val = evalExprAst(action.data, dataenv);
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
        let ivVal = evalExprAst(action.data, dataenv);
        if (ivVal == null) {
            dataenv.dbstate.invalidateAll();
        }
        else {
            let ivArr = (mobx.isArrayLike(ivVal) ? ivVal : [ivVal]);
            for (let i=0; i<ivArr.length; i++) {
                let iv = ivArr[i];
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
        let eventStr = valToString(evalExprAst(action.event, dataenv));
        if (eventStr == null || eventStr === "") {
            return null;
        }
        let bubble = !!action.bubble;
        if (!action.native) {
            if (action.nodeuuid) {
                rtctx.replaceContext(sprintf("%s '%s' event (node uuid %s)", (bubble ? "Bubbling" : "Firing"), eventStr, action.nodeuuid), null);
            }
            else {
                rtctx.replaceContext(sprintf("%s '%s' event", (bubble ? "Bubbling" : "Firing"), eventStr), null);
            }
        }
        let datacontext = null;
        let params = evalExprAst(action.data, dataenv);
        if (params != null && isObject(params)) {
            let objParams : HibikiValObj = params as HibikiValObj;
            let {value} = unpackPositionalArgs(objParams, ["value"]);
            datacontext = stripAtKeys(objParams);
            delete datacontext["*args"];
            if (value != null && !("value" in datacontext)) {
                datacontext.value = value;
            }
        }
        let event = {event: eventStr, native: false, datacontext, bubble, nodeuuid: action.nodeuuid};
        return FireEvent(event, dataenv, rtctx, false);
    }
    else if (action.actiontype === "log") {
        let dataValArr = forceAsArray(demobx(evalExprAst(action.data, dataenv)));
        dataValArr = dataValArr.map((val) => {
            if (val instanceof HibikiError) {
                return val.toString();
            }
            return val;
        });
        console.log("HibikiLog", ...dataValArr);
        if (action.debug) {
            console.log("DataEnvironment Stack");
            dataenv.printStack();
            console.log(rtctx.asString("> "));
            console.log("RtContext / DataEnvironment", rtctx, dataenv);
        }
        if (action.alert) {
            let alertStr = dataValArr.map((v) => String(v)).join(", ");
            alert(alertStr);
        }
        return null;
    }
    else if (action.actiontype === "throw") {
        rtctx.popContext();
        let errVal = evalExprAst(action.data, dataenv);
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
                throw new Error("Invalid hibikiexpr expression, not a string: " + typeof(objVal));
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
        let blob = new HibikiBlob();
        blob.mimetype = action.blobmimetype;
        blob.data = action.blobbase64;
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

async function FireEvent(event : EventType, dataenv : DataEnvironment, rtctx : RtContext, throwErrors : boolean) : Promise<any> {
    if (event.event == "unhandlederror" && !event.native) {
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
    let eventEnv = ehandler.dataenv.makeChildEnv(event.datacontext, {htmlContext: htmlContext});
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
        if (event.event == "error" || errorHandler == null) {
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

async function ExecuteHandlerBlockInternal(block : HandlerBlock, pure : boolean, dataenv : DataEnvironment, rtctx : RtContext) : Promise<any> {
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

function ParseContextAssignListThrow(ctxStr : string) : {key : string, expr : HExpr, setop? : string}[] {
    let actions = doParse(ctxStr, "ext_contextAssignList");
    return actions;
}

function ParseAndCreateContextThrow(ctxStr : string, rootName : "context" | "c", dataenv : DataEnvironment, htmlContext : string) : DataEnvironment {
    let ctxDataenv : DataEnvironment = null;
    if (rootName === "context") {
        ctxDataenv = dataenv.makeChildEnv({}, {htmlContext: htmlContext});
    }
    else {
        ctxDataenv = dataenv;
    }
    let caList = ParseContextAssignListThrow(ctxStr);
    let rtctx = new RtContext();
    rtctx.pushContext(htmlContext, null);
    for (let i=0; i<caList.length; i++) {
        let caVal = caList[i];
        let expr = evalExprAst(caVal.expr, ctxDataenv);
        let setop = caVal.setop ?? "set";
        let path : PathType = [{pathtype: "root", pathkey: rootName}, {pathtype: "map", pathkey: caVal.key}];
        setPathWrapper(setop, path, ctxDataenv, expr, {allowContext: true});
    }
    return ctxDataenv;
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
function EvalSimpleExprThrow(exprStr : string, dataenv : DataEnvironment, rtContext? : string) : any {
    if (exprStr == null || exprStr === "") {
        return null;
    }
    let exprAst = ParseSimpleExprThrow(exprStr);
    let val = evalExprAst(exprAst, dataenv);
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
            let hblob = new HibikiBlob();
            hblob.mimetype = mimetype;
            // extra 7 bytes for "base64," ... e.g. data:image/jpeg;base64,[base64data]
            hblob.data = (reader.result as string).substr(commaIdx+1);
            if (blob instanceof File && blob.name != null) {
                hblob.name = blob.name;
            }
            resolve(hblob);
        };
        reader.readAsDataURL(blob);
    });
}

function BlobFromRRA(rra : HibikiAction) : HibikiBlob {
    if (rra.actiontype !== "blob") {
        return null;
    }
    let blob = new HibikiBlob();
    blob.mimetype = rra.blobmimetype;
    blob.data = rra.blobbase64;
    return blob;
}

function ExtBlobFromRRA(blob : HibikiBlob, rra : HibikiAction) {
    if (blob == null) {
        throw new Error(sprintf("Cannot extend null HibikiBlob"));
    }
    blob.data += rra.blobbase64;
}

function blobExtDataPath(path : PathType, curData : any, newData : any) : any {
    if (curData == null || !(curData instanceof HibikiBlob)) {
        throw new Error(sprintf("SetPath cannot blobext a non-blob, path=%s, typeof=%s", StringPath(path), typeof(curData)));
    }
    curData.data += newData;
    return curData;
}

function JsonEqual(v1 : any, v2 : any) : boolean {
    if (v1 === v2) {
        return true;
    }
    return JsonStringify(v1) === JsonStringify(v2);
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

export {ParsePath, ResolvePath, SetPath, ParsePathThrow, ResolvePathThrow, SetPathThrow, StringPath, DeepCopy, MapReplacer, JsonStringify, EvalSimpleExpr, JsonEqual, ParseSetPathThrow, ParseSetPath, HibikiBlob, ObjectSetPath, DeepEqual, LValue, BoundLValue, ObjectLValue, ReadOnlyLValue, getShortEMsg, CreateReadOnlyLValue, JsonStringifyForCall, demobx, BlobFromRRA, ExtBlobFromRRA, isObject, convertSimpleType, ParseStaticCallStatement, evalExprAst, ParseAndCreateContextThrow, BlobFromBlob, formatVal, ExecuteHandlerBlock, ExecuteHAction, makeIteratorFromExpr, rawAttrStr, resolveStrAttrs, resolveValAttrs, getStyleMap, getAttributeStr, getAttributeValPair, attrValToStr, exValToVal, resolveLValueAttr, resolveArgsRoot, SYM_NOATTR, resolveCnArray, HActionBlock, valToString, compileActionStr, FireEvent, makeErrorObj, OpaqueValue, ChildrenVar, Watcher};

export type {PathType, HAction, HExpr, HIteratorExpr};
