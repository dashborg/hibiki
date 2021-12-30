// Copyright 2021 Dashborg Inc

import * as mobx from "mobx";
import * as React from "react";

import {DBCtx} from "./dbctx";
import type {HibikiNode, HandlerValType} from "./types";
import * as DataCtx from "./datactx";
import {sprintf} from "sprintf-js";
import {isObject, textContent} from "./utils";
import {getAttribute} from "./state";
import {DataEnvironment} from "./state";

let BLOCKED_ELEMS = {
    "html": true,
    "body": true,
    "meta": true,
    "base": true,
    "frameset": true,
    "title": true,
    "applet": true,
};

let INLINE_ELEMS = {
    "a": true,
    "abbr": true,
    "acronym": true,
    "b": true,
    "bdo": true,
    "big": true,
    "br": true,
    "button": true,
    "cite": true,
    "code": true,
    "dfn": true,
    "em": true,
    "i": true,
    "img": true,
    "input": true,
    "kbd": true,
    "label": true,
    "map": true,
    "object": true,
    "output": true,
    "q": true,
    "samp": true,
    "script": true,
    "select": true,
    "small": true,
    "span": true,
    "strong": true,
    "sub": true,
    "sup": true,
    "textarea": true,
    "time": true,
    "tt": true,
    "var": true,
};

let SUBMIT_ELEMS = {
    "form": true,
};

let SPECIAL_ATTRS = {
    "style": true,
    "class": true,
    "if": true,
    "foreach": true,
    "eid": true,
    "disabled": true,
    "ref": true,
    "bind": true,
    "handler": true,
    "blobsrc": true,
    "defaultvalue": true,
};

let UNMANAGED_INPUT_TYPES = {
    "submit": true,
    "button": true,
    "hidden": true,
    "reset": true,
    "image": true,
};

let MANAGED_ATTRS = {
    "value": {"value": true, "defaultvalue": true},
    "radio": {"checked": true, "defaultchecked": true},
    "checkbox": {"checked": true, "defaultchecked": true},
    "file": {"value": true},
};

function getManagedType(tagName : string, typeName : string) : ("value" | "radio" | "checkbox" | "file" | null) {
    if (tagName == "select" || tagName == "textarea") {
        return "value";
    }
    if (tagName != "input") {
        return null;
    }
    if (UNMANAGED_INPUT_TYPES[typeName]) {
        return null;
    }
    if (typeName == "radio" || typeName == "checkbox" || typeName == "file") {
        return typeName;
    }
    return "value";
}

function getFilteredSubNodesByTag(ctx : DBCtx, tag : string) {
    let node = ctx.node;
    if (node.list == null || node.list.length == 0) {
        return [];
    }
    let rtn = [];
    for (let sn of node.list) {
        if (sn.tag != tag) {
            continue;
        }
        rtn.push(sn);
    }
    return DataCtx.demobx(rtn);
}

function getSubNodesByTag(node : HibikiNode, tag : string) : HibikiNode[] {
    if (node.list == null || node.list.length == 0) {
        return [];
    }
    let rtn = [];
    for (let sn of node.list) {
        if (sn.tag == tag) {
            rtn.push(sn);
        }
    }
    return DataCtx.demobx(rtn);
}

function filterSubNodes(node : HibikiNode, filterFn : (HibikiNode) => boolean) : HibikiNode[] {
    if (node.list == null || node.list.length == 0) {
        return [];
    }
    let rtn = [];
    for (let sn of node.list) {
        if (filterFn(sn)) {
            rtn.push(sn);
        }
    }
    return DataCtx.demobx(rtn);
}

function renderTextSpan(text : string, style : any) : any {
    if (text === undefined) {
        text = null;
    }
    if (style != null && Object.keys(style).length > 0) {
        return <span style={style}>{text}</span>;
    }
    return text;
}

function renderTextData(node : HibikiNode, dataenv : DataEnvironment, onlyText? : boolean) : any {
    let ctx = new DBCtx(null, node, dataenv);
    let style = ctx.resolveStyleMap("style");
    let dataLV = ctx.resolveData("data", false);
    let bindVal = DataCtx.demobx(dataLV.get());
    if (bindVal == null && ctx.hasAttr("nulltext")) {
        let nullText = ctx.resolveAttr("nulltext");
        let rtn = DataCtx.formatVal(nullText, null);
        return renderTextSpan(rtn, style);
    }
    let rtn = DataCtx.formatVal(bindVal, ctx.resolveAttr("format"));
    if (onlyText) {
        return rtn;
    }
    return renderTextSpan(rtn, style);
}

function makeNodeVar(ctx : DBCtx) : any {
    let node = ctx.node;
    if (node == null) {
        return null;
    }
    let rtn : any = {};
    rtn.tag = ctx.getHtmlTagName();
    rtn.rawtag = ctx.node.tag;
    rtn._type = "HibikiNode";
    rtn.attrs = ctx.resolveAttrs({raw: true});
    rtn.stylemap = {};
    rtn.uuid = ctx.uuid;
    rtn.dataenv = ctx.dataenv;
    rtn.cnmap = {};

    // classes
    let classAttrs = {};
    for (let attrkey in rtn.attrs) {
        if (attrkey == "class") {
            classAttrs["class"] = true;
            continue;
        }
        if (!attrkey.startsWith("class-")) {
            continue;
        }
        let dotIndex = attrkey.indexOf(".");
        if (dotIndex != -1) {
            attrkey = attrkey.substr(0, dotIndex);
        }
        classAttrs[attrkey] = true;
    }
    for (let cnAttr in classAttrs) {
        rtn.cnmap[cnAttr] = ctx.resolveCnMap(cnAttr);
    }

    // styles
    if (node.style != null) {
        rtn.stylemap["style"] = ctx.resolveStyleMap("style");
    }
    if (node.morestyles != null) {
        for (let sn in node.morestyles) {
            rtn.stylemap[sn] = ctx.resolveStyleMap(sn);
        }
    }
    
    return rtn;
}

function makeChildrenVar(dataenv : DataEnvironment, node : HibikiNode) : any {
    if (node == null || node.list == null || node.list.length == 0) {
        return null;
    }
    let rtn : any = {};
    rtn.all = node.list;
    rtn.bytag = {};
    rtn.byslot = {};
    for (let i=0; i<node.list.length; i++) {
        let n = node.list[i];
        let tagname = n.tag;
        if (rtn.bytag[tagname] == null) {
            rtn.bytag[tagname] = [];
        }
        rtn.bytag[tagname].push(n);
        let slotname = getAttribute(n, "slot", dataenv);
        if (slotname != null) {
            if (rtn.byslot[slotname] == null) {
                rtn.byslot[slotname] = [];
            }
            rtn.byslot[slotname].push(n);
        }
    }
    return rtn;
}

function parseArgsDecl(datatypes : string) : {[e : string] : boolean} {
    let rtn : {[e : string] : boolean} = {};
    if (datatypes == null || datatypes.trim() == "") {
        return rtn;
    }
    let split = datatypes.split(/,/);
    for (let i=0; i<split.length; i++) {
        let field = split[i].trim();
        if (field == "") {
            continue;
        }
        if (!field.match(/\*?[a-z][a-z0-9_]*/)) {
            console.log("Bad field definition: ", field);
            continue;
        }
        let isWriteable = false;
        if (field.startsWith("*")) {
            isWriteable = true;
            field = field.substr(1);
        }
        rtn[field] = isWriteable;
    }
    return rtn;
}

function parseSingleAutomerge(amVal : string) : {name? : string, opts? : any} {
    if (amVal == "1") {
        return {name: null, opts: {all: true}};
    }
    let atPos = amVal.indexOf("@");
    if (atPos == -1) {
        return {name: amVal, opts: {all: true}};
    }
    else {
        let fields = amVal.split("@", 2);
        let opts = {};
        opts[fields[1]] = true;
        return {name: fields[0], opts: opts};
    }
}

function parseAutomerge(amAttr : string) : any[] {
    let amVals = amAttr.split(",");
    let rtn = [];
    for (let i=0; i<amVals.length; i++) {
        let amVal = amVals[i];
        rtn.push(parseSingleAutomerge(amVal));
    }
    return rtn;
}

function handleConvertType(ctx : DBCtx, value : string) : any {
    let convertType = ctx.resolveAttr("converttype");
    if (convertType == null) {
        return;
    }
    let convertLV = ctx.resolveData("convertoutput", true);
    let convertErrorLV = ctx.resolveData("converterror", true);
    try {
        let subType = null;
        if (convertType.startsWith("json:") || convertType.startsWith("jseval:")) {
            let fields = convertType.split(":");
            convertType = fields[0];
            subType = fields[1];
        }
        if (convertType == "json" || convertType == "jseval") {
            if (value == null || value == "") {
                value = null;
            }
            else if (convertType == "json") {
                value = JSON.parse(value);
            }
            else {
                let evalVal = eval("(" + value + ")");
                if (typeof(evalVal) == "function") {
                    evalVal = evalVal();
                }
                value = evalVal;
            }
            if (subType == "array") {
                if (value != null && !mobx.isArrayLike(value)) {
                    throw new Error("JSON value is not an array");
                }
            }
            if (subType == "map" || subType == "struct") {
                if (value != null && !isObject(value)) {
                    throw new Error("JSON value is not an object");
                }
            }
        }
        else {
            value = DataCtx.convertSimpleType(convertType, value, ctx.resolveAttr("converterrorvalue"));
        }
        convertLV.set(value);
        convertErrorLV.set(null);
    }
    catch (e) {
        let errObj = {message: sprintf("Error converting value: %s", e), err: e};
        convertLV.set(null);
        convertErrorLV.set(errObj);
    }
    return value;
}

function _mergeCnMap(cnMap : {[e:string] : boolean}, initCnMap : {[e:string] : boolean}) : {[e:string] : boolean} {
    let rtn : {[e:string] : boolean} = initCnMap || {};
    for (let k in cnMap) {
        rtn[k] = cnMap[k];
    }
    return rtn;
}

function _mergeStyles(styleMap : {[e:string] : any}, initStyles : {[e:string] : any}) : {[e:string] : any} {
    let rtn : {[e:string] : any} = initStyles || {};
    if (styleMap == null) {
        return rtn;
    }
    for (let k in styleMap) {
        rtn[k] = styleMap[k];
    }
    return rtn;
}

type AutoMergeAttrsType = {
    style: {[e:string] : any},
    cnMap: {[e:string] : boolean},
    disabled: boolean,
};

function automerge(ctx : DBCtx, automergeAttrs : AutoMergeAttrsType, subName : string, opts : any) {
    let nodeVar = ctx.resolvePath("@node");
    if (nodeVar == null) {
        return;
    }
    if (opts.all || opts["class"]) {
        let name = (subName ? "class-" + subName : "class");
        let nodeVarCnMap = nodeVar.cnmap[name];
        let mergedCnMap = _mergeCnMap(nodeVarCnMap, automergeAttrs.cnMap);
        automergeAttrs.cnMap = mergedCnMap;
    }
    if (opts.all || opts["style"]) {
        let styleName = (subName ? "style-" + subName : "style");
        let nodeVarStyles = nodeVar.stylemap[styleName]
        let mergedStyles = _mergeStyles(nodeVarStyles, automergeAttrs.style);
        automergeAttrs.style = mergedStyles;
    }
    if (opts.all || opts["disabled"]) {
        let name = (subName ? "disabled-" + subName : "disabled");
        if (nodeVar.attrs.disabled) {
            automergeAttrs.disabled = true;
            automergeAttrs.cnMap["disabled"] = true;
        }
    }
}

function makeHandlers(node : HibikiNode, handlerPrefixes? : string[]) : Record<string, HandlerValType> {
    let handlers = {};
    if (node.attrs != null) {
        for (let key in node.attrs) {
            if (key == "handler" || key.endsWith(".handler")) {
                let eventName = key.replace(/\.handler$/, "");
                let hname = sprintf("//@event/%s", eventName);
                handlers[hname] = {handlerStr: node.attrs[key], node: node};
            }
        }
    }
    if (handlerPrefixes != null && node.list != null) {
        for (let i=0; i<node.list.length; i++) {
            let subNode = node.list[i];
            if (subNode.tag == "define-handler" && subNode.attrs != null && subNode.attrs.name != null) {
                let hname = subNode.attrs.name;
                let prefixOk = false;
                for (let j=0; j<handlerPrefixes.length; j++) {
                    if (hname.startsWith(sprintf("//@%s/", handlerPrefixes[j]))) {
                        prefixOk = true;
                        break;
                    }
                }
                if (prefixOk) {
                    handlers[hname] = {handlerStr: textContent(subNode), node: subNode};
                }
            }
        }
    }
    return handlers;
}

function subNodesByTag(node : HibikiNode, tag : string) : HibikiNode[] {
    if (node == null || node.list == null) {
        return [];
    }
    let rtn = [];
    for (let i=0; i<node.list.length; i++) {
        if (node.list[i].tag == tag) {
            rtn.push(node.list[i]);
        }
    }
    return rtn;
}

function firstSubNodeByTag(node : HibikiNode, tag : string) : HibikiNode {
    if (node == null || node.list == null) {
        return null;
    }
    for (let i=0; i<node.list.length; i++) {
        if (node.list[i].tag == tag) {
            return node.list[i];
        }
    }
    return null;
}

export {BLOCKED_ELEMS, INLINE_ELEMS, SPECIAL_ATTRS, SUBMIT_ELEMS, MANAGED_ATTRS, renderTextSpan, renderTextData, makeNodeVar, makeChildrenVar, parseArgsDecl, parseAutomerge, handleConvertType, automerge, makeHandlers, subNodesByTag, firstSubNodeByTag, getManagedType};
