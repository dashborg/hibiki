// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as mobx from "mobx";
import * as DataCtx from "./datactx";
import { v4 as uuidv4 } from 'uuid';
import {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import type {HibikiVal, HibikiValObj, HibikiReactProps, StyleMapType, AutoMergeExpr} from "./types";
import type {NodeAttrType} from "./html-parser";
import {HibikiNode} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {nodeStr, isObject, attrBaseName, cnArrToClassAttr, classStringToCnArr, nsAttrName, cnArrToLosslessStr, parseAttrName, isClassStringLocked, joinClassStrs, textContent} from "./utils";
import {RtContext} from "./error";
import type {EHandlerType} from "./state";

async function convertFormData(formData : FormData) : Promise<Record<string, any>> {
    let params = {};
    for (let key of (formData as any).keys()) {
        let arrVal = formData.getAll(key);
        if (arrVal.length == 0) {
            continue;
        }
        else if (arrVal.length == 1 && (arrVal[0] instanceof Blob) && arrVal[0].size == 0 && !arrVal[0].name) {
            continue;
        }
        else if (arrVal.length == 1) {
            if (arrVal[0] instanceof Blob) {
                params[key] = await DataCtx.BlobFromBlob(arrVal[0]);
            }
            else {
                params[key] = arrVal[0];
            }
        }
        else {
            let newArr : any[] = [];
            for (let i=0; i<arrVal.length; i++) {
                let val = arrVal[i];
                if (val instanceof Blob) {
                    newArr.push(await DataCtx.BlobFromBlob(val));
                }
                else {
                    newArr.push(val);
                }
            }
            params[key] = newArr;
        }
    }
    return params;
}

function createInjectObj(ctx : DBCtx, child : HibikiNode, nodeDataenv : DataEnvironment) : InjectedAttrsObj {
    let childCtx = makeCustomDBCtx(child, nodeDataenv, null);
    let nodeVar = childCtx.makeNodeVar(true);
    let evalInjectAttrsEnv = ctx.dataenv.makeChildEnv({node: nodeVar}, null);
    let evalInjectCtx = makeCustomDBCtx(ctx.node, evalInjectAttrsEnv, null);
    let injectAttrs = evalInjectCtx.resolveUnmergedAttrVals();
    let toInject = new InjectedAttrsObj();
    for (let k in injectAttrs) {
        if (!k.startsWith("inject:")) {
            continue;
        }
        let shortName = k.substr(7);
        toInject.attrs[shortName] = injectAttrs[k];
    }
    if (ctx.node.handlers != null) {
        for (let hname in ctx.node.handlers) {
            if (!hname.startsWith("inject:")) {
                continue;
            }
            let shortName = hname.substr(7);
            let handlerBlock = ctx.node.handlers[hname];
            let ehandler = {handler: new DataCtx.HActionBlock("handler", handlerBlock, ctx.dataenv.getLibContext()), node: ctx.node, dataenv: evalInjectAttrsEnv};
            toInject.handlers[shortName] = ehandler;
        }
    }
    return toInject;
}

function _assignToArgsRootNs(argsRoot : HibikiValObj, key : string, val : HibikiVal, forced : boolean) {
    let [ns, baseName] = parseAttrName(key);
    if (baseName === "") {
        return;
    }
    if (argsRoot["@ns"][ns] == null) {
        argsRoot["@ns"][ns] = {};
    }
    let nsRoot = argsRoot["@ns"][ns];
    if (baseName === "class") {
        if (!forced && nsRoot["@classlock"]) {
            return;
        }
        if (forced) {
            nsRoot["@classlock"] = true;
        }
        let cnArr1 = classStringToCnArr(DataCtx.valToString(nsRoot["class"]));
        let cnArr2 = classStringToCnArr(DataCtx.valToString(val));
        nsRoot["class"] = cnArrToLosslessStr([...cnArr1, ...cnArr2]);
        return;
    }
    if (baseName in nsRoot) {
        return;
    }
    nsRoot[baseName] = val;
}

function _assignAllToArgsRoot(argsRoot : HibikiValObj, vals : HibikiValObj, forced : boolean) {
    for (let key in vals) {
        _assignToArgsRootNs(argsRoot, key, vals[key], forced);
    }
}

function mergeArgsRootNs(argsRoot : HibikiValObj, ns : string) {
    if (argsRoot["@ns"][ns] == null) {
        return;
    }
    let nsRoot = argsRoot["@ns"][ns];
    for (let key in nsRoot) {
        if (key.startsWith("@")) {
            continue;
        }
        argsRoot[key] = nsRoot[key];
    }
}

function resolveArgsRoot(ctx : DBCtx) : HibikiValObj {
    let argsRoot = {"@ns": {}};
    _assignAllToArgsRoot(argsRoot, ctx.injectedAttrs.getInjectedVals(), false);
    _assignAllToArgsRoot(argsRoot, ctx.amData.getAllAMValsFlattened(true), true);
    _assignAllToArgsRoot(argsRoot, ctx.resolveUnmergedAttrVals(), false);
    _assignAllToArgsRoot(argsRoot, ctx.amData.getAllAMValsFlattened(false), false);
    // TODO class/style

    // merge to $args from self, then overwrite with root.  does not merge "class" args
    mergeArgsRootNs(argsRoot, "self");
    mergeArgsRootNs(argsRoot, "root");
    
    return argsRoot;
}

// 'class' and 'style' are pre-merged
class InjectedAttrsObj {
    attrs : HibikiValObj;
    handlers : Record<string, EHandlerType>;
    
    constructor() {
        this.attrs = {};
        this.handlers = {};
    }

    getInjectedLValues() : Record<string, DataCtx.LValue> {
        let rtn : Record<string, DataCtx.LValue> = {};
        for (let key in this.attrs) {
            let val = this.attrs[key];
            if (val instanceof DataCtx.LValue) {
                rtn[key] = val;
            }
        }
        return rtn;
    }

    getInjectedVals() : HibikiValObj {
        return this.attrs;
    }

    getInjectedValPair(attrName : string) : [HibikiVal, boolean] {
        if (!(attrName in this.attrs)) {
            return [null, false];
        }
        // no need to check SYM_NOATTR, already checked when creating InjectedAttrsObj
        let val = this.attrs[attrName];
        return [val, true];
    }

    getHandler(name : string) : EHandlerType {
        return this.handlers[name];
    }
}

// inj2 overrides inj1
function mergeInjectedAttrs(inj1 : InjectedAttrsObj, inj2 : InjectedAttrsObj) : InjectedAttrsObj {
    let rtn = new InjectedAttrsObj();
    Object.assign(rtn.attrs, inj1.attrs, inj2.attrs);
    Object.assign(rtn.handlers, inj1.handlers, inj2.handlers);
    return rtn;
}

// the order matters here.  first check for specific attr, then check for all.
// start with exclude, then includeForce, then include.
// returns [include, includeForced]
function checkAMAttr(amExpr : AutoMergeExpr, attrName : string) : [boolean, boolean] {
    if (attrName === "@style") {
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


// class and style are pre-merged
class AutoMergeData {
    ctx : DBCtx;
    attrs : Record<string, HibikiValObj>;
    forcedAttrs : Record<string, HibikiValObj>;
    resolvedSelf : boolean;
    resolvedAll : boolean;

    constructor(ctx : DBCtx) {
        this.ctx = ctx;
        this.attrs = {};
        this.forcedAttrs = {};
        this.resolvedSelf = false;
        this.resolvedAll = false;
    }

    resolveAM(resolveAll : boolean) {
        if (this.resolvedAll || (this.resolvedSelf && !resolveAll)) {
            return;
        }
        this.resolveAMInternal(resolveAll);
        this.resolvedSelf = true;
        this.resolvedAll = resolveAll;
    }

    resolveAMInternal(resolveAll : boolean) {
        let node = this.ctx.node;
        let dataenv = this.ctx.dataenv;
        let argsRoot = dataenv.getArgsRoot();
        if (node.automerge == null || node.automerge.length === 0 || argsRoot == null || argsRoot["@ns"] == null) {
            return;
        }
        for (let amExpr of node.automerge) {
            let destNs = amExpr.dest;
            if (destNs === "self" && this.resolvedSelf) {
                continue;
            }
            if (destNs !== "self" && !resolveAll) {
                continue;
            }
            if (this.attrs[destNs] == null) {
                this.attrs[destNs] = {};
            }
            if (this.forcedAttrs[destNs] == null) {
                this.forcedAttrs[destNs] = {};
            }
            let srcRoot = argsRoot["@ns"][amExpr.source];
            if (srcRoot == null) {
                continue;
            }
            for (let srcAttr in srcRoot) {
                if (srcAttr.startsWith("@")) {
                    continue;
                }
                let [include, includeForce] = checkAMAttr(amExpr, srcAttr);
                if (include && includeForce) {
                    this.forcedAttrs[destNs][srcAttr] = srcRoot[srcAttr];
                }
                else if (include) {
                    this.attrs[destNs][srcAttr] = srcRoot[srcAttr];
                }
            }
        }
    }

    resolveAMPair(attrName : string, forced : boolean) : [HibikiVal, boolean] {
        let [ns, baseAttrName] = parseAttrName(attrName);
        this.resolveAM(ns !== "self");
        let attrRoot = (forced ? this.forcedAttrs : this.attrs);
        if (attrRoot == null || attrRoot[ns] == null || !(attrName in attrRoot[ns])) {
            return [null, false];
        }
        let val = attrRoot[ns][attrName];
        return [val, true];
    }

    getAMVals(ns : string, forced : boolean) : HibikiValObj {
        this.resolveAM(ns !== "self");
        if (forced) {
            return this.forcedAttrs[ns] ?? {};
        }
        return this.attrs[ns] ?? {};
    }

    getAllAMValsFlattened(forced : boolean) : HibikiValObj {
        this.resolveAM(true);
        let attrs = (forced ? this.forcedAttrs : this.attrs);
        let rtn : HibikiValObj = {};
        for (let ns in attrs) {
            for (let key in attrs[ns]) {
                let fullAttrName = nsAttrName(key, ns);
                rtn[fullAttrName] = attrs[ns][key];
            }
        }
        return rtn;
    }
}

function mergeAttrVals(vals : HibikiValObj, toMerge : HibikiValObj) {
    if (toMerge == null) {
        return;
    }
    for (let key in toMerge) {
        if (key in vals || DataCtx.isUnmerged(key)) {
            continue;
        }
        vals[key] = toMerge[key];
    }
}

function makeCustomDBCtx(nodeArg : HibikiNode, dataenvArg : DataEnvironment, injectedAttrs : InjectedAttrsObj) : DBCtx {
    return new DBCtx(null, nodeArg, dataenvArg, injectedAttrs);
}

function makeDBCtx(elem : React.Component<HibikiReactProps, {}>) : DBCtx {
    return new DBCtx(elem, null, null, null);
}

function makeTextDBCtx(text : string, dataenvArg : DataEnvironment) {
    let textNode = new HibikiNode("#text", {text: text});
    return new DBCtx(null, textNode, dataenvArg, null);
}

function makeErrorDBCtx(errText : string, dataenvArg : DataEnvironment) {
    let textNode = new HibikiNode("#text", {text: errText});
    let divNode = new HibikiNode("div", {list: [textNode]});
    return new DBCtx(null, divNode, dataenvArg, null);
}

class DBCtx {
    dataenv : DataEnvironment;
    node : HibikiNode;
    uuid : string;
    injectedAttrs : InjectedAttrsObj;
    amData : AutoMergeData;
    isRoot : boolean;
    
    constructor(elem : React.Component<HibikiReactProps, {}>, nodeArg : HibikiNode, dataenvArg : DataEnvironment, injectedAttrs : InjectedAttrsObj) {
        this.isRoot = false;
        if (elem != null) {
            this.dataenv = elem.props.dataenv;
            this.node = elem.props.node;
            this.injectedAttrs = elem.props.injectedAttrs ?? new InjectedAttrsObj();
            let elemAny = elem as any;
            if (elemAny.uuid == null) {
                elemAny.uuid = uuidv4();
            }
            this.uuid = elemAny.uuid;
        }
        else {
            this.dataenv = dataenvArg;
            this.node = nodeArg;
            this.uuid = uuidv4();
            this.injectedAttrs = injectedAttrs ?? new InjectedAttrsObj();
        }
        if (this.node == null) {
            throw new Error("DBCtx no node prop");
        }
        if (this.dataenv == null) {
            throw new Error("DBCtx no dataenv prop");
        }
        this.amData = new AutoMergeData(this);
    }

    getHtmlTagName() : string {
        let tagName = this.resolveAttrStr("component") ?? this.node.tag;
        if (tagName.startsWith("html-")) {
            tagName = tagName.substr(5);
        }
        return tagName;
    }

    resolvePath(path : string, opts? : {rtContext? : string}) : HibikiVal {
        opts = opts ?? {};
        let rtContext = opts.rtContext ?? "DBCtx.resolvePath";
        return this.dataenv.resolvePath(path, {rtContext: rtContext});
    }

    evalExpr(expr : string, keepMobx? : boolean) : HibikiVal {
        return this.dataenv.evalExpr(expr, keepMobx);
    }

    resolveAttrStr(attrName : string) : string {
        let [val, exists] = this.resolveAttrValPair(attrName);
        if (!exists) {
            return null;
        }
        return DataCtx.valToAttrStr(val);
    }

    resolveAttrVal(attrName : string) : HibikiVal {
        let [val, exists] = this.resolveAttrValPair(attrName);
        return val;
    }

    hasAttr(attrName : string) : boolean {
        let [val, exists] = this.resolveAttrValPair(attrName);
        return exists;
    }

    resolveAttrValPair(attrName : string) : [HibikiVal, boolean] {
        let unmerged = DataCtx.isUnmerged(attrName);
        if (!unmerged) {
            let [ival, iexists] = this.injectedAttrs.getInjectedValPair(attrName);
            if (iexists) {
                return [ival, true];
            }
            let [amVal, amExists] = this.amData.resolveAMPair(attrName, true);
            if (amExists) {
                return [amVal, true];
            }
        }
        let [attrVal, attrExists] = DataCtx.getUnmergedAttributeValPair(this.node, attrName, this.dataenv);
        if (attrExists) {
            return [attrVal, true];
        }
        if (!unmerged) {
            let [amVal, amExists] = this.amData.resolveAMPair(attrName, false);
            if (amExists) {
                return [amVal, true];
            }
        }
        return [null, false];
    }

    // does not check for automerge or noattr!
    hasRawAttr(attrName : string) : boolean {
        return (this.node.attrs != null && this.node.attrs[attrName] != null);
    }

    hasHandler(handlerName : string) : boolean {
        if (handlerName in this.injectedAttrs.handlers) {
            return true;
        }
        return (this.node.handlers != null && this.node.handlers[handlerName] != null);
    }

    resolveUnmergedAttrVals() : HibikiValObj {
        let node = this.node;
        if (node.attrs == null) {
            return {};
        }
        let rtn = {};
        for (let attrName in node.attrs) {
            let [ns, baseAttrName] = parseAttrName(attrName);
            if (baseAttrName === "class") {
                let classStr = DataCtx.getUnmergedAttributeStr(node, attrName, this.dataenv);
                rtn[attrName] = joinClassStrs(rtn[attrName], classStr);
                continue;
            }
            if (baseAttrName.startsWith("class.")) {
                let className = baseAttrName.substr(6);
                let classStr = DataCtx.getUnmergedAttributeStr(node, attrName, this.dataenv);
                let positive = (classStr && classStr !== "0");
                let baseClassAttrName = nsAttrName("class", ns);
                rtn[baseClassAttrName] = joinClassStrs(rtn[baseClassAttrName], (positive ? className : "!" + className));
                continue;
            }
            if (DataCtx.isUnmerged(attrName)) {
                continue;
            }
            let [val, exists] = DataCtx.getUnmergedAttributeValPair(node, attrName, this.dataenv);
            if (exists) {
                rtn[attrName] = val;
            }
        }
        if (node.style != null) {
            let ctxStr = sprintf("'style' attr in %s", nodeStr(node));
            rtn["style"] = DataCtx.resolveUnmergedStyleMap(node.style, this.dataenv, ctxStr);
        }
        if (node.morestyles != null) {
            for (let styleAttr in node.morestyles) {
                let ctxStr = sprintf("'%s' attr in %s", styleAttr, nodeStr(node));
                rtn[styleAttr] = DataCtx.resolveUnmergedStyleMap(node.morestyles[styleAttr], this.dataenv, ctxStr);
            }
        }
        return rtn;
    }

    // no style, class is fully resolved
    resolveAttrVals() : HibikiValObj {
        let rtn : HibikiValObj = {};
        mergeAttrVals(rtn, this.injectedAttrs.getInjectedVals());
        mergeAttrVals(rtn, this.amData.getAMVals("self", true));
        mergeAttrVals(rtn, this.resolveUnmergedAttrVals());
        mergeAttrVals(rtn, this.amData.getAMVals("self", false));
        let cnArr = this.resolveCnArray(null);
        if (cnArr != null && cnArr.length > 0) {
            rtn["class"] = cnArrToLosslessStr(cnArr);
        }
        return rtn;
    }

    getRawAttr(attrName : string) : string {
        if (!this.node.attrs) {
            return null;
        }
        return DataCtx.rawAttrStr(this.node.attrs[attrName]);
    }

    isEditMode() : boolean {
        return false;
    }

    resolveNsStyleMap(styleAttr : string, initStyles? : StyleMapType) : StyleMapType {
        let [injectedStyleMap, iexists] = DataCtx.asStyleMapFromPair(this.injectedAttrs.getInjectedValPair(styleAttr));
        if (iexists) {
            return Object.assign({}, initStyles, injectedStyleMap);
        }
        let [amStyleMap, amExists] = DataCtx.asStyleMapFromPair(this.amData.resolveAMPair(styleAttr, true));
        if (amExists) {
            return Object.assign({}, initStyles, amStyleMap);
        }
        let ctxStr = sprintf("'%s' attr in %s", styleAttr, nodeStr(this.node));
        let nodeStyleMap = DataCtx.resolveUnmergedStyleMap(this.node.getStyleMap(styleAttr), this.dataenv, ctxStr);
        let rtnStyleMap = Object.assign({}, initStyles, nodeStyleMap);
        [amStyleMap, amExists] = DataCtx.asStyleMapFromPair(this.amData.resolveAMPair(styleAttr, false));
        if (amExists) {
            Object.assign(rtnStyleMap, amStyleMap);
        }
        return rtnStyleMap;
    }

    resolveStyleMap(initStyles? : StyleMapType) : StyleMapType {
        return this.resolveNsStyleMap("style", initStyles);
    }

    resolveNsCnArray(ns : string, moreClasses? : string) : Record<string, boolean>[] {
        let classAttrName = nsAttrName("class", ns);
        
        // moreClasses is the 'base', always applied
        let rtn = classStringToCnArr(moreClasses);

        // injected always applies as well
        let [ival, exists] = this.injectedAttrs.getInjectedValPair(classAttrName);
        if (exists) {
            let injectedClasses = classStringToCnArr(DataCtx.valToString(ival));
            rtn.push(...injectedClasses);
        }

        // if automerge, force, return
        let [amVal, amExists] = this.amData.resolveAMPair(classAttrName, true);
        if (amExists) {
            rtn.push(...classStringToCnArr(DataCtx.valToString(amVal)));
            return rtn;
        }

        // unmerged value gets added to base+injected (this includes class.[foo] attrs)
        rtn.push(...DataCtx.resolveUnmergedCnArray(this.node, ns, this.dataenv));

        // un-forced automerge gets added
        [amVal, amExists] = this.amData.resolveAMPair(classAttrName, false);
        if (amExists) {
            rtn.push(...classStringToCnArr(DataCtx.valToString(amVal)));
        }
        return rtn;
    }

    resolveCnArray(moreClasses? : string) : Record<string, boolean>[] {
        return this.resolveNsCnArray("self", moreClasses);
    }

    setDataPath(path : string, value : HibikiVal, rtContext? : string) {
        rtContext = rtContext ?? "DBCtx.setDataPath";
        this.dataenv.setDataPath(path, value, rtContext);
    }

    getEventDataenv() : DataEnvironment {
        let handlers = NodeUtils.makeHandlers(this.node, this.injectedAttrs, null, null);
        let htmlContext = sprintf("<%s>", this.node.tag);
        let envOpts = {
            htmlContext: htmlContext,
            handlers: handlers,
            eventBoundary: "hard",
        };
        let eventDataenv = this.dataenv.makeChildEnv(null, envOpts);
        return eventDataenv;
    }

    @boundMethod handleMountEvent() : Promise<any> {
        if (!this.hasHandler("mount")) {
            return null;
        }
        let context = {
            innerhtml: this.node.innerhtml,
            outerhtml: this.node.outerhtml,
        };
        return this.handleEvent("mount", context);
    }

    @boundMethod handleInitEvent() : Promise<any> {
        if (!this.hasHandler("init")) {
            return null;
        }
        let context = {
            innerhtml: this.node.innerhtml,
            outerhtml: this.node.outerhtml,
        };
        return this.handleEvent("init", context);
    }

    @boundMethod handleEvent(event : string, datacontext? : Record<string, any>) : Promise<any> {
        if (this.isEditMode()) {
            return null;
        }
        let eventDataenv = this.getEventDataenv();
        let rtctx = new RtContext();
        rtctx.pushContext(sprintf("Firing native '%s' event on %s (in %s)", event, nodeStr(this.node), this.dataenv.getHtmlContext()), null);
        let eventObj = {event: event, bubble: false, datacontext: datacontext, native: true};
        let prtn = DataCtx.FireEvent(eventObj, eventDataenv, rtctx, false);
        return prtn;
    }

    @boundMethod handleOnSubmit(e : any) : boolean {
        if (e != null) {
            let actionAttr = this.resolveAttrStr("action");
            if (actionAttr == null || actionAttr === "#") {
                e.preventDefault();
            }
        }
        let formData = new FormData(e.target);
        let paramsPromise = convertFormData(formData);
        paramsPromise.then((params) => {
            this.handleEvent("submit", {formdata: params});
        });
        return false;
    }

    @boundMethod handleOnClick(e : any) : boolean {
        if (e != null) {
            let hrefAttr = this.resolveAttrStr("href");
            if (hrefAttr == null || hrefAttr === "#") {
                e.preventDefault();
            }
        }
        this.handleEvent("click");
        return true;
    }

    @boundMethod handleOnChange(newVal : HibikiVal) : boolean {
        this.handleEvent("change", {value: newVal});
        return false;
    }

    @boundMethod handleAfterChange(newVal : HibikiVal) : boolean {
        this.handleEvent("afterchange", {value: newVal});
        return false;
    }

    resolveLValueAttr(dataName : string) : DataCtx.LValue {
        let [val, exists] = this.resolveAttrValPair(dataName);
        if (!exists || !(val instanceof DataCtx.LValue)) {
            return null;
        }
        return val;
    }

    registerUuid() {
        this.dataenv.dbstate.NodeUuidMap.set(this.uuid, this);
    }

    unregisterUuid() {
        this.dataenv.dbstate.NodeUuidMap.delete(this.uuid);
        this.dataenv.dbstate.NodeDataMap.delete(this.uuid);
    }

    getNodeData(compName : string, defaultsObj? : HibikiValObj) : mobx.IObservableValue<HibikiValObj> {
        let box = this.dataenv.dbstate.NodeDataMap.get(this.uuid);
        if (box == null) {
            let uuidName = "id_" + this.uuid.replace(/-/g, "_");
            let nodeData = Object.assign({}, defaultsObj, {_hibiki: {"customtag": compName, uuid: this.uuid}});
            box = mobx.observable.box(nodeData, {name: uuidName});
            this.dataenv.dbstate.NodeDataMap.set(this.uuid, box);
        }
        return box;
    }

    makeNodeVar(withAttrs : boolean) : HibikiValObj {
        let node = this.node;
        if (node == null) {
            return null;
        }
        let rtn : HibikiValObj = {};
        rtn.tag = this.getHtmlTagName();
        rtn.rawtag = this.node.tag;
        rtn.uuid = this.uuid;
        if (node.innerhtml) {
            rtn.innerhtml = node.innerhtml;
        }
        if (node.outerhtml) {
            rtn.outerhtml = node.outerhtml;
        }
        if (withAttrs) {
            rtn.attrs = this.resolveAttrVals();
        }
        rtn.children = this.makeChildrenVar();
        return rtn;
    }

    // returns [val, exists]
    resolveConditionAttr(attrName : string) : [boolean, boolean] {
        let exists = this.hasRawAttr(attrName);
        if (!exists) {
            return [false, false];
        }
        let val = DataCtx.valToBool(this.resolveAttrVal(attrName));
        return [val, true];
    }

    makeChildrenVar() : DataCtx.ChildrenVar {
        if (this.node.list == null) {
            return new DataCtx.ChildrenVar([]);
        }
        let boundList = bindNodeList(this.node.list, this.dataenv, this.isRoot);
        return new DataCtx.ChildrenVar(boundList);
    }
}

function bindSingleNode(node : HibikiNode, dataenv : DataEnvironment, injectedAttrs : InjectedAttrsObj, isRoot : boolean) : [DBCtx, boolean, DataEnvironment] {
    if (node.tag === "#text") {
        return [makeCustomDBCtx(node, dataenv, injectedAttrs), false, null];
    }
    if (node.tag === "#comment") {
        return [null, false, null];
    }
    if (NodeUtils.BLOCKED_ELEMS[node.tag]) {
        return [null, false, null];
    }
    if (node.tag === "if-break") {
        let ifBreakCtx = makeCustomDBCtx(node, dataenv, null);
        let [ifAttr, exists] = ifBreakCtx.resolveConditionAttr("condition");
        if (!exists) {
            return [makeErrorDBCtx("<if-break> requires 'condition' attribute", dataenv), false, null];
        }
        if (!ifAttr) {
            return [null, false, null];
        }
        return [ifBreakCtx, true, null];
    }
    if (node.tag === "define-vars") {
        let setCtx = makeCustomDBCtx(node, dataenv, null);
        let contextAttr = setCtx.resolveAttrStr("context");
        if (contextAttr == null) {
            contextAttr = textContent(node).trim();
            if (contextAttr === "") {
                contextAttr = null;
            }
        }
        if (contextAttr == null) {
            return [makeErrorDBCtx("<define-vars> no context attribute", dataenv), false, null];
        }
        try {
            let specials = DataCtx.ParseAndCreateSpecialsThrow(contextAttr, dataenv, "<define-vars>");
            return [null, false, dataenv.makeChildEnv(specials, {htmlContext: "<define-vars>"})];
        }
        catch (e) {
            return [makeErrorDBCtx("<define-vars> Error parsing/executing context block: " + e, dataenv), false, null];
        }
    }
    if (node.tag === "define-handler") {
        if (!isRoot) {
            let msg = "<define-handler> is only allowed at root of <hibiki>, <page>, or <define-component> nodes";
            return [makeErrorDBCtx(msg, dataenv), false, null];
        }
        return [null, false, null];
    }
    return [makeCustomDBCtx(node, dataenv, injectedAttrs), false, null];
}

function bindNodeList(list : HibikiNode[], dataenv : DataEnvironment, isRoot : boolean) : DBCtx[] {
    if (list == null || list.length == 0) {
        return null;
    }
    let rtn : DBCtx[] = [];
    for (let child of list) {
        let [ctx, stopLoop, newDataenv] = bindSingleNode(child, dataenv, null, isRoot);
        if (ctx != null) {
            if (ctx.node.tag === "h-children") {
                let boundChildren = expandChildrenNode(ctx);
                if (boundChildren != null) {
                    rtn.push(...boundChildren);
                }
            }
            else {
                rtn.push(ctx);
            }
        }
        if (stopLoop) {
            break;
        }
        if (newDataenv != null) {
            dataenv = newDataenv;
        }
    }
    return rtn;
}

function expandChildrenNode(ctx : DBCtx) : DBCtx[] {
    let textStr = ctx.resolveAttrStr("text");
    if (textStr != null) {
        return [makeTextDBCtx(textStr, ctx.dataenv)];
    }
    let bindVal = ctx.resolveAttrVal("bind");
    if (bindVal == null) {
        return bindNodeList(ctx.node.list, ctx.dataenv, false);
    }
    if (!(bindVal instanceof DataCtx.ChildrenVar)) {
        let msg = sprintf("%s bind expression is not valid, must be [children] type", nodeStr(ctx.node));
        return [makeErrorDBCtx(msg, ctx.dataenv)];
    }
    let ctxList = bindVal.boundNodes;
    if (ctxList == null || ctxList.length == 0) {
        return null;
    }
    let ctxSpecials = {};
    let contextattr = ctx.resolveAttrStr("datacontext");
    if (contextattr != null) {
        try {
            ctxSpecials = DataCtx.ParseAndCreateSpecialsThrow(contextattr, ctx.dataenv, nodeStr(ctx.node));
        }
        catch (e) {
            let msg = nodeStr(ctx.node) + " Error parsing/executing context block: " + e;
            return [makeErrorDBCtx(msg, ctx.dataenv)];
        }
    }
    let rtnList : DBCtx[] = [];
    for (let childCtx of ctxList) {
        let toInject : InjectedAttrsObj = childCtx.injectedAttrs;
        let nodeDataenv = childCtx.dataenv;
        if (ctxSpecials != null) {
            nodeDataenv = childCtx.dataenv.makeChildEnv(ctxSpecials, null);
        }
        let tagName = childCtx.node.tag;
        if (!NodeUtils.NON_INJECTABLE[tagName] && !tagName.startsWith("#")) {
            let newInjections = createInjectObj(ctx, childCtx.node, nodeDataenv);
            if (toInject == null) {
                toInject = newInjections;
            }
            else {
                toInject = mergeInjectedAttrs(toInject, newInjections);
            }
        }
        let newCtx = makeCustomDBCtx(childCtx.node, nodeDataenv, toInject);
        rtnList.push(newCtx);
    }
    return rtnList;
}


export {DBCtx, makeDBCtx, makeCustomDBCtx, InjectedAttrsObj, createInjectObj, resolveArgsRoot, bindSingleNode, bindNodeList, mergeInjectedAttrs, expandChildrenNode};
