// Copyright 2021-2022 Dashborg Inc

import * as mobx from "mobx";
import * as DataCtx from "./datactx";
import { v4 as uuidv4 } from 'uuid';
import {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import type {HibikiVal, HibikiValObj, HibikiReactProps, StyleMapType, AutoMergeExpr} from "./types";
import type {HibikiNode, NodeAttrType} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {nodeStr, isObject, attrBaseName, cnArrToClassAttr, classStringToCnArr, nsAttrName, cnArrToLosslessStr, parseAttrName, isClassStringLocked, joinClassStrs} from "./utils";
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
    let styleMap = evalInjectCtx.resolveNsStyleMap("inject:style", null);
    if (styleMap != null && Object.keys(styleMap).length > 0) {
        toInject.styleMap = styleMap;
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
    styleMap : StyleMapType;
    handlers : Record<string, EHandlerType>;
    
    constructor() {
        this.attrs = {};
        this.styleMap = null;
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

class DBCtx {
    dataenv : DataEnvironment;
    node : HibikiNode;
    uuid : string;
    injectedAttrs : InjectedAttrsObj;
    amData : AutoMergeData;
    
    constructor(elem : React.Component<HibikiReactProps, {}>, nodeArg : HibikiNode, dataenvArg : DataEnvironment, injectedAttrs : InjectedAttrsObj) {
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
        e.preventDefault();
        let formData = new FormData(e.target);
        let paramsPromise = convertFormData(formData);
        paramsPromise.then((params) => {
            this.handleEvent("submit", {formdata: params});
        });
        return false;
    }

    @boundMethod handleOnClick(e : any) : boolean {
        if (e != null) {
            e.preventDefault();
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

    getNodeData(compName : string) : mobx.IObservableValue<HibikiVal> {
        let box = this.dataenv.dbstate.NodeDataMap.get(this.uuid);
        if (box == null) {
            let uuidName = "id_" + this.uuid.replace(/-/g, "_");
            box = mobx.observable.box({_hibiki: {"customtag": compName, uuid: this.uuid}}, {name: uuidName});
            this.dataenv.dbstate.NodeDataMap.set(this.uuid, box);
        }
        return box;
    }

    getNodeDataLV(compName : string) : DataCtx.ObjectLValue {
        let box = this.dataenv.dbstate.NodeDataMap.get(this.uuid);
        if (box == null) {
            let uuidName = "id_" + this.uuid.replace(/-/g, "_");
            box = mobx.observable.box({_hibiki: {"customtag": compName, uuid: this.uuid}}, {name: uuidName});
            this.dataenv.dbstate.NodeDataMap.set(this.uuid, box);
        }
        return new DataCtx.ObjectLValue(null, box);
    }

    makeNodeVar(withAttrs : boolean) {
        let node = this.node;
        if (node == null) {
            return null;
        }
        let rtn : any = {};
        rtn.tag = this.getHtmlTagName();
        rtn.rawtag = this.node.tag;
        rtn.uuid = this.uuid;
        if (withAttrs) {
            rtn.attrs = this.resolveAttrVals();
        }
        rtn.children = new DataCtx.ChildrenVar(this.node.list, this.dataenv);
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
}

export {DBCtx, makeDBCtx, makeCustomDBCtx, InjectedAttrsObj, createInjectObj, resolveArgsRoot};
