// Copyright 2021-2022 Dashborg Inc

import * as mobx from "mobx";
import * as DataCtx from "./datactx";
import { v4 as uuidv4 } from 'uuid';
import {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import type {HibikiVal, HibikiValObj, HibikiReactProps, StyleMapType} from "./types";
import type {HibikiNode, NodeAttrType} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {nodeStr, isObject, attrBaseName, cnArrToClassAttr} from "./utils";
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

const NON_MERGED_ATTRS = {
    "if": true,
    "foreach": true,
    "component": true,
    "eid": true,
    "ref": true,
    "condition": true,
    "automerge": true,
    "slot": true,
};

function createInjectObj(ctx : DBCtx, child : HibikiNode, nodeDataenv : DataEnvironment) : InjectedAttrsObj {
    let childCtx = makeCustomDBCtx(child, nodeDataenv, null);
    let nodeVar = NodeUtils.makeNodeVar(childCtx, true);
    let evalInjectAttrsEnv = ctx.dataenv.makeChildEnv({node: nodeVar}, null);
    let evalInjectCtx = makeCustomDBCtx(ctx.node, evalInjectAttrsEnv, null);
    let injectAttrs = evalInjectCtx.resolveAttrVals();
    let toInject = new InjectedAttrsObj();
    for (let k in injectAttrs) {
        if (!k.startsWith("inject:")) {
            continue;
        }
        let shortName = k.substr(7);
        let lv = ctx.resolveLValueAttr(k);
        if (lv != null) {
            toInject.attrs[shortName] = lv;
        }
        else {
            toInject.attrs[shortName] = injectAttrs[k];
        }
    }
    let styleMap = evalInjectCtx.resolveNsStyleMap("inject", null);
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
            if (key in rtn) {
                continue;
            }
            let lv = this.getInjectedLValue(key);
            if (lv != null) {
                rtn[key] = lv;
            }
        }
        return rtn;
    }

    getInjectedVals() : HibikiValObj {
        let rtn : HibikiValObj = {};
        for (let key in this.attrs) {
            if (key in rtn) {
                continue;
            }
            let [ival, exists] = this.getInjectedValPair(key);
            if (exists) {
                rtn[key] = ival;
            }
        }
        return rtn;
    }

    getInjectedValPair(attrName : string) : [HibikiVal, boolean] {
        if (!(attrName in this.attrs)) {
            return [null, false];
        }
        let val = DataCtx.resolveLValue(this.attrs[attrName]);
        if (val === DataCtx.SYM_NOATTR) {
            return [null, false];
        }
        return [val, true];
    }

    getInjectedLValue(attrName : string) : DataCtx.LValue {
        if (!(attrName in this.attrs)) {
            return null;
        }
        let val = this.attrs[attrName];
        if (val == null || !(val instanceof DataCtx.LValue)) {
            return null;
        }
        let resolvedVal = val.getEx();
        if (resolvedVal === DataCtx.SYM_NOATTR) {
            return null;
        }
        return val;
    }

    getHandler(name : string) : EHandlerType {
        return this.handlers[name];
    }
}

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
                if (NON_MERGED_ATTRS[srcAttr]) {
                    continue;
                }
                let [include, includeForce] = DataCtx.checkAMAttr(amExpr, srcAttr);
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
        this.resolveAM(false);
        let attrRoot = (forced ? this.forcedAttrs : this.attrs);
        if (attrRoot == null || attrRoot["self"] == null || !(attrName in attrRoot)) {
            return [null, false];
        }
        let val = attrRoot[attrName];
        return [val, true];
    }

    getAMVals(ns : string, forced : boolean) : HibikiValObj {
        this.resolveAM(ns !== "self");
        if (forced) {
            return this.forcedAttrs[ns] ?? {};
        }
        return this.attrs[ns] ?? {};
    }
}

function mergeAttrVals(vals : HibikiValObj, toMerge : HibikiValObj) {
    if (toMerge == null) {
        return;
    }
    for (let key in toMerge) {
        if (key === "" || key in vals || NON_MERGED_ATTRS[key] || key.startsWith("@")) {
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
        if (!NON_MERGED_ATTRS[attrName]) {
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
        if (!NON_MERGED_ATTRS[attrName]) {
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
        for (let key in node.attrs) {
            let baseName = attrBaseName(key);
            if (NON_MERGED_ATTRS[key] || key === "class" || key.startsWith("class.")) {
                continue;
            }
            let [val, exists] = DataCtx.getUnmergedAttributeValPair(node, key, this.dataenv);
            if (exists) {
                rtn[key] = val;
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
            rtn["class"] = cnArrToClassAttr(cnArr);
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

    resolveNsStyleMap(ns : string, initStyles? : StyleMapType) : StyleMapType {
        if (ns === "self" && this.injectedAttrs.styleMap != null) {
            initStyles = Object.assign({}, initStyles);
            for (let skey in this.injectedAttrs.styleMap) {
                initStyles[skey] = this.injectedAttrs.styleMap[skey];
            }
        }
        return DataCtx.getStyleMap(this.node, ns, this.dataenv, initStyles);
    }

    resolveStyleMap(initStyles? : StyleMapType) : StyleMapType {
        return this.resolveNsStyleMap("self", initStyles);
    }

    resolveNsCnArray(ns : string, moreClasses? : string) : Record<string, boolean>[] {
        let [ival, exists] = this.injectedAttrs.getInjectedValPair(DataCtx.nsAttrName("class", ns));
        if (exists) {
            moreClasses = (moreClasses ?? "") + " " + DataCtx.valToString(ival);
        }
        return DataCtx.resolveCnArray(this.node, ns, this.dataenv, moreClasses);
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
        let ivalLv = this.injectedAttrs.getInjectedLValue(dataName);
        if (ivalLv != null) {
            return ivalLv;
        }
        return DataCtx.resolveLValueAttr(this.node, dataName, this.dataenv);
    }

    resolveArgsRoot(implNode : HibikiNode) : HibikiValObj {
        return DataCtx.resolveArgsRoot(this.node, this.dataenv, this.injectedAttrs, implNode);
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
}

export {DBCtx, makeDBCtx, makeCustomDBCtx, InjectedAttrsObj, createInjectObj};
