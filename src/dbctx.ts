// Copyright 2021 Dashborg Inc

import * as mobx from "mobx";
import * as DataCtx from "./datactx";
import { v4 as uuidv4 } from 'uuid';
import {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {HibikiNode, HibikiVal, HibikiValEx} from "./types";
import * as NodeUtils from "./nodeutils";
import {nodeStr} from "./utils";
import {RtContext} from "./error";

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

class DBCtx {
    dataenv : DataEnvironment;
    node : HibikiNode;
    uuid : string;
    
    constructor(elem : React.Component<{node : HibikiNode, dataenv : DataEnvironment}, {}>, nodeArg? : HibikiNode, dataenvArg? : DataEnvironment) {
        if (elem != null) {
            let elemAny = elem as any;
            if (elemAny.uuid == null) {
                elemAny.uuid = uuidv4();
            }
            this.dataenv = elem.props.dataenv;
            this.node = elemAny.props.node;
            if (nodeArg != null) {
                this.node = nodeArg;
            }
            this.uuid = elemAny.uuid;
        }
        else {
            this.dataenv = dataenvArg;
            this.node = nodeArg;
            this.uuid = uuidv4();
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

    resolveAttrStr(attrName : string) : string {
        return DataCtx.getAttributeStr(this.node, attrName, this.dataenv);
    }

    resolveAttrVal(attrName : string) : HibikiVal {
        let [rval, exists] = DataCtx.getAttributeValPair(this.node, attrName, this.dataenv);
        return rval;
    }

    resolveAttrValPair(attrName : string) : [HibikiVal, boolean] {
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
        return (this.node.handlers != null && this.node.handlers[handlerName] != null);
    }

    resolveAttrVals() : Record<string, HibikiVal> {
        return DataCtx.resolveValAttrs(this.node, this.dataenv);
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
        return DataCtx.getStyleMap(this.node, ns, this.dataenv, initStyles);
    }

    resolveStyleMap(initStyles? : Record<string, any>) : any {
        return DataCtx.getStyleMap(this.node, "self", this.dataenv, initStyles);
    }

    resolveNsCnArray(ns : string, moreClasses? : string) : Record<string, boolean>[] {
        return DataCtx.resolveCnArray(this.node, ns, this.dataenv, moreClasses);
    }

    resolveCnArray(moreClasses? : string) : Record<string, boolean>[] {
        return DataCtx.resolveCnArray(this.node, "self", this.dataenv, moreClasses);
    }

    setDataPath(path : string, value : HibikiVal, rtContext? : string) {
        rtContext = rtContext ?? "DBCtx.setDataPath";
        this.dataenv.setDataPath(path, value, rtContext);
    }

    getEventDataenv() : DataEnvironment {
        let handlers = NodeUtils.makeHandlers(this.node, null, null);
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
            e.stopPropagation();
        }
        this.handleEvent("click");
        return false;
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
        return DataCtx.resolveLValueAttr(this.node, dataName, this.dataenv);
    }

    resolveArgsRoot() : Record<string, HibikiValEx> {
        return DataCtx.resolveArgsRoot(this.node, this.dataenv);
    }

    resolveAttrData(dataName : string, writeable : boolean) : DataCtx.LValue {
        let lvrtn = this.resolveLValueAttr(dataName);
        if (lvrtn != null) {
            return lvrtn;
        }
        if (this.hasAttr(dataName)) {
            if (writeable) {
                console.log(sprintf("Warning: %s=\"%s\" specified for writeable '%s' value (making read-only)", dataName, this.getRawAttr(dataName), dataName));
            }
            let dataVal = this.resolveAttrVal(dataName);
            return DataCtx.CreateReadOnlyLValue(dataVal, "readonly:" + this.node.tag + "#" + dataName);
        }
        return null;
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

export {DBCtx};
