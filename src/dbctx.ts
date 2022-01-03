// Copyright 2021 Dashborg Inc

import * as mobx from "mobx";
import * as DataCtx from "./datactx";
import { v4 as uuidv4 } from 'uuid';
import {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {HibikiNode, HibikiVal} from "./types";
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
        let tagName = this.resolveAttr("component") ?? this.node.tag;
        if (tagName.startsWith("html-")) {
            tagName = tagName.substr(5);
        }
        return tagName;
    }

    resolvePath(path : string) : any {
        return this.dataenv.resolvePath(path);
    }

    evalExpr(expr : string, keepMobx? : boolean) : any {
        return this.dataenv.evalExpr(expr, keepMobx);
    }

    hasAttr(attrName : string) : boolean {
        return this.node.attrs && this.node.attrs[attrName] != null;
    }

    resolveAttr(attrName : string, opts? : any) : any {
        if (opts && opts.raw) {
            return DataCtx.getAttributeVal(this.node, attrName, this.dataenv, opts);
        }
        else {
            return DataCtx.getAttributeStr(this.node, attrName, this.dataenv, opts);
        }
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

    setDataPath(path : string, value : any) {
        this.dataenv.setDataPath(path, value);
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

    _getBindPathLV(attrName : string) : DataCtx.LValue {
        let attrval = this.resolveAttr(attrName, {raw: true});
        if (attrval instanceof DataCtx.LValue) {
            return attrval;
        }
        if (attrval == null) {
            return DataCtx.CreateReadOnlyLValue(null, "bindpath-null:" + this.node.tag + "#" + attrName);
        }
        if (typeof(attrval) != "string") {
            console.log(sprintf("Warning: Invalid %s=\"%s\": typeof expr is not a string was '%s'", attrName, this.getRawAttr(attrName), typeof(attrval)));
            return DataCtx.CreateReadOnlyLValue(null, "bindpath-error:" + this.node.tag + "#" + attrName);
        }
        try {
            let lvalue = DataCtx.ParseLValuePathThrow(attrval, this.dataenv);
            let value = lvalue.get();
            if (value instanceof DataCtx.LValue) {
                return value;
            }
            return lvalue;
        }
        catch(e) {
            let emsg = DataCtx.getShortEMsg(e);
            console.log(sprintf("Warning: Invalid %s=\"%s\": %s", attrName, this.getRawAttr(attrName), emsg));
            return DataCtx.CreateReadOnlyLValue(null, "bindpath-error:" + this.node.tag + "#" + attrName);
        }
    }

    setDefaultForData(dataName : string) {
        if (dataName == "value" && this.hasAttr("defaultvalue")) {
            let lv = this.resolveData(dataName, true);
            if (lv.get() == null) {
                let defValue = this.resolveAttr("defaultvalue", {raw: true});
                lv.set(defValue);
            }
        }
        else if (this.hasAttr(dataName + ".default")) {
            let lv = this.resolveData(dataName, true);
            if (lv.get() == null) {
                let defValue = this.resolveAttr(dataName + ".default", {raw: true});
                lv.set(defValue);
            }
        }
        return;
    }

    resolveAttrData(dataName : string, writeable : boolean) : DataCtx.LValue {
        if (this.hasAttr(dataName + ".bindpath")) {
            return this._getBindPathLV(dataName + ".bindpath");
        }
        if (this.hasAttr(dataName)) {
            if (writeable) {
                console.log(sprintf("Warning: %s=\"%s\" specified for writeable '%s' value (making read-only)", dataName, this.getRawAttr(dataName), dataName));
            }
            let dataVal = this.resolveAttr(dataName, {raw: true});
            return DataCtx.CreateReadOnlyLValue(dataVal, "readonly:" + this.node.tag + "#" + dataName);
        }
        return null;
    }

    resolveData(dataName : string, writeable : boolean) : DataCtx.LValue {
        if (dataName == "data" && this.hasAttr("bind")) {
            if (writeable) {
                console.log(sprintf("Warning: %s=\"%s\" specified for writeable '%s' value (making read-only)", "bind", this.getRawAttr("bind"), dataName));
            }
            let dataVal = this.resolveAttr("bind", {raw: true});
            if (dataVal instanceof DataCtx.LValue) {
                return dataVal;
            }
            return DataCtx.CreateReadOnlyLValue(dataVal, "readonly:" + this.node.tag + "#" + "bind");
        }
        let attrData = this.resolveAttrData(dataName, writeable);
        if (attrData != null) {
            return attrData;
        }
        if (writeable) {
            return this.getNodeLValueRoot().subMapKey(dataName);
        }
        return DataCtx.CreateReadOnlyLValue(null, "readonly-null:" + this.node.tag + "#" + dataName);
    }

    registerUuid() {
        this.dataenv.dbstate.NodeUuidMap.set(this.uuid, this);
    }

    unregisterUuid() {
        this.dataenv.dbstate.NodeUuidMap.delete(this.uuid);
    }
}

export {DBCtx, resolveCnMapEx};
