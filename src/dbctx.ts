// Copyright 2021-2022 Dashborg Inc

import * as mobx from "mobx";
import * as DataCtx from "./datactx";
import cn from "classnames/dedupe";
import { v4 as uuidv4 } from 'uuid';
import {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import type {HibikiVal, HibikiValObj, HibikiValEx, HibikiReactProps} from "./types";
import type {HibikiNode, NodeAttrType} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {nodeStr, isObject} from "./utils";
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

function makeCustomDBCtx(nodeArg : HibikiNode, dataenvArg : DataEnvironment, injectedAttrs : DataCtx.InjectedAttrsObj) : DBCtx {
    return new DBCtx(null, nodeArg, dataenvArg, injectedAttrs);
}

function makeDBCtx(elem : React.Component<HibikiReactProps, {}>) : DBCtx {
    return new DBCtx(elem, null, null, null);
}

class DBCtx {
    dataenv : DataEnvironment;
    node : HibikiNode;
    uuid : string;
    injectedAttrs : DataCtx.InjectedAttrsObj;
    
    constructor(elem : React.Component<HibikiReactProps, {}>, nodeArg : HibikiNode, dataenvArg : DataEnvironment, injectedAttrs : DataCtx.InjectedAttrsObj) {
        if (elem != null) {
            this.dataenv = elem.props.dataenv;
            this.node = elem.props.node;
            this.injectedAttrs = elem.props.injectedAttrs ?? new DataCtx.InjectedAttrsObj();
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
            this.injectedAttrs = injectedAttrs ?? new DataCtx.InjectedAttrsObj();
        }
        if (this.node == null) {
            throw new Error("DBCtx no node prop");
        }
        if (this.dataenv == null) {
            throw new Error("DBCtx no dataenv prop");
        }
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

    resolveAttrExpr(attrName : string) : NodeAttrType {
        if (this.node.attrs == null) {
            return null;
        }
        return this.node.attrs[attrName];
    }

    resolveAttrStr(attrName : string) : string {
        let [ival, exists] = this.injectedAttrs.getInjectedValPair(attrName);
        if (exists) {
            return DataCtx.valToString(ival);
        }
        return DataCtx.getAttributeStr(this.node, attrName, this.dataenv);
    }

    resolveAttrVal(attrName : string) : HibikiVal {
        let [ival, iexists] = this.injectedAttrs.getInjectedValPair(attrName);
        if (iexists) {
            return ival;
        }
        let [rval, exists] = DataCtx.getAttributeValPair(this.node, attrName, this.dataenv);
        return rval;
    }

    resolveAttrValPair(attrName : string) : [HibikiVal, boolean] {
        let [ival, iexists] = this.injectedAttrs.getInjectedValPair(attrName);
        if (iexists) {
            return [ival, true];
        }
        return DataCtx.getAttributeValPair(this.node, attrName, this.dataenv);
    }

    hasAttr(attrName : string) : boolean {
        let [rval, exists] = DataCtx.getAttributeValPair(this.node, attrName, this.dataenv);
        return exists;
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

    resolveAttrVals() : Record<string, HibikiVal> {
        return DataCtx.resolveValAttrs(this.node, this.dataenv, this.injectedAttrs);
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

    resolveNsStyleMap(ns : string, initStyles? : any) : any {
        if (ns === "self" && this.injectedAttrs.styleMap != null) {
            initStyles = initStyles ?? {};
            for (let skey in this.injectedAttrs.styleMap) {
                initStyles[skey] = this.injectedAttrs.styleMap[skey];
            }
        }
        return DataCtx.getStyleMap(this.node, ns, this.dataenv, initStyles);
    }

    resolveStyleMap(initStyles? : Record<string, any>) : any {
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

    getNodeLValueRoot() : DataCtx.LValue {
        let dbstate = this.dataenv.dbstate;
        let nodeData = dbstate.NodeDataMap.get(this.uuid);
        if (nodeData == null) {
            let uuidName = "id_" + this.uuid.replace(/-/g, "_");
            nodeData = mobx.observable.box(null, {name: uuidName});
            dbstate.NodeDataMap.set(this.uuid, nodeData);
        }
        return new DataCtx.ObjectLValue(null, nodeData);
    }

    resolveLValueAttr(dataName : string) : DataCtx.LValue {
        let ivalLv = this.injectedAttrs.getInjectedLValue(dataName);
        if (ivalLv != null) {
            return ivalLv;
        }
        return DataCtx.resolveLValueAttr(this.node, dataName, this.dataenv);
    }

    resolveArgsRoot(implNode : HibikiNode) : Record<string, HibikiValEx> {
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

export {DBCtx, makeDBCtx, makeCustomDBCtx};
