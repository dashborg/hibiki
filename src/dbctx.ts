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

let NODASHELEM = {
    "tr": true,
    "td": true,
    "th": true,
    "tbody": true,
    "thead": true,
    "option": true,

    "html-tr": true,
    "html-td": true,
    "html-th": true,
    "html-tbody": true,
    "html-thead": true,
    "html-option": true,
};

function resolveCnMapEx(node : HibikiNode, dataenv : DataEnvironment, classAttr : string, moreClasses : string) {
    let classAttrVal = DataCtx.getAttributeStr(node, classAttr, dataenv) || "";
    let classVal = (moreClasses || "") + " " + classAttrVal;
    let rawCnArr = classVal.split(/\s+/);
    let cnMap = {};
    let noDashElem = false;
    if (dataenv.dbstate.Ui != "dashborg") {
        noDashElem = true;
    }
    for (let i=0; i<rawCnArr.length; i++) {
        let val = rawCnArr[i].trim();
        if (val == "") {
            continue;
        }
        if (val == "no-dashelem" || val == "-dashelem") {
            noDashElem = true;
        }
        if (val.startsWith("no-")) {
            delete cnMap[val.substr(3)];
            continue;
        }
        if (val.startsWith("-")) {
            delete cnMap[val.substr(1)];
            continue;
        }
        cnMap[val] = true;
        if (val == "row") {
            delete cnMap["col"];
        }
        if (val == "col") {
            delete cnMap["row"];
        }
        if (val == "segments") {
            delete cnMap["segment"];
        }
    }
    if (cnMap["row"] || cnMap["col"]) {
        cnMap["dashelem"] = true;
    }
    else if (cnMap["dashinline"]) {
        delete cnMap["dashinline"];
    }
    else {
        if (!noDashElem && !NODASHELEM[node.tag]) {
            cnMap["dashelem"] = true;
        }
    }
    if (node.attrs != null) {
        for (let [k,v] of Object.entries(node.attrs)) {
            if (!k.startsWith(classAttr + ".")) {
                continue;
            }
            let kval = k.substr(classAttr.length+1);
            let rval = DataCtx.getAttributeStr(node, k, dataenv);
            if (rval) {
                cnMap[kval] = true;
            }
            else {
                delete cnMap[kval];
            }
        }
    }
    return cnMap;
}

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

// dbstate
//   Components
//   queueScriptSrc
//   queueScriptText
//   Ui
//   setDataPath
//   parseHtml
//   reportError
//   PanelDOMRoot
//   unregisterDataNodeState
//   queuePostScriptRunFn
//   fireScriptsLoaded
//   startPushStream
//   callData
//   findTemplate
//   findScript

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

    resolvePath(path : string, opts? : {rtContext? : string}) : any {
        opts = opts ?? {};
        let rtContext = opts.rtContext ?? "DBCtx.resolvePath";
        return this.dataenv.resolvePath(path, {rtContext: rtContext});
    }

    evalExpr(expr : string, keepMobx? : boolean) : any {
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

    hasHandler(handlerName : string) : boolean {
        return (this.node.handlers != null && this.node.handlers[handlerName] != null);
    }

    resolveAttrVals() : Record<string, HibikiVal> {
        return DataCtx.resolveValAttrs(this.node, this.dataenv);
    }

    resolveAttrs(opts? : {raw? : boolean}) : any {
        if (opts && opts.raw) {
            return DataCtx.resolveValAttrs(this.node, this.dataenv);
        }
        else {
            return DataCtx.resolveStrAttrs(this.node, this.dataenv);
        }
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

    resolveStyleMap(styleAttr : string, initStyles? : any) : any {
        return DataCtx.getStyleMap(this.node, styleAttr, this.dataenv, initStyles);
    }

    resolveCnMap(classAttr : string, moreClasses? : string) {
        return resolveCnMapEx(this.node, this.dataenv, classAttr, moreClasses);
    }

    setDataPath(path : string, value : any, rtContext? : string) {
        rtContext = rtContext ?? "DBCtx.setDataPath";
        this.dataenv.setDataPath(path, value, rtContext);
    }

    getEventDataenv() : DataEnvironment {
        let handlers = NodeUtils.makeHandlers(this.node);
        let htmlContext = sprintf("<%s>", this.node.tag);
        let envOpts = {
            htmlContext: htmlContext,
            handlers: handlers,
            eventBoundary: "hard",
        };
        let eventDataenv = this.dataenv.makeChildEnv(null, envOpts);
        return eventDataenv;
    }

    @boundMethod handleEvent(event : string, datacontext? : Record<string, any>) : Promise<any> {
        if (this.isEditMode()) {
            return null;
        }
        let eventDataenv = this.getEventDataenv();
        let rtctx = new RtContext();
        rtctx.pushContext(sprintf("native event %s:%s (in %s)", nodeStr(this.node), event, this.dataenv.getHtmlContext()), null);
        let action = {
            actiontype: "fireevent",
            native: true,
            event: {etype: "literal", val: event},
            data: {etype: "literal", val: datacontext},
        };
        return DataCtx.ExecuteHandlerBlock([action], false, eventDataenv, rtctx, false);
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

    @boundMethod handleOnChange(newVal : any) : boolean {
        this.handleEvent("change", {value: newVal});
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

export {DBCtx, resolveCnMapEx};
