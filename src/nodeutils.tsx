// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as mobx from "mobx";
import * as React from "react";
import {DBCtx, makeCustomDBCtx, InjectedAttrsObj} from "./dbctx";
import type {HandlerValType, HibikiVal} from "./types";
import type {HibikiNode} from "./html-parser";
import * as DataCtx from "./datactx";
import {sprintf} from "sprintf-js";
import {isObject, textContent, rawAttrFromNode, nodeStr, cnArrToClassAttr} from "./utils";
import {DataEnvironment} from "./state";
import type {EHandlerType} from "./state";

let BLOCKED_ELEMS : Record<string, boolean> = {
    "html": true,
    "body": true,
    "meta": true,
    "base": true,
    "frameset": true,
    "title": true,
    "applet": true,
};

let NON_INJECTABLE : Record<string, boolean> = {
    "define-vars": true,
    "if-break": true,
    "#text": true,
};

let INLINE_ELEMS : Record<string, boolean> = {
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

let SUBMIT_ELEMS : Record<string, boolean> = {
    "form": true,
};

let BLOB_ATTRS : Record<string, boolean> = {
    "src": true,
    "href": true,
};

let SPECIAL_ATTRS : Record<string, boolean> = {
    "style": true,
    "class": true,
    "if": true,
    "foreach": true,
    "eid": true,
    "ref": true,
    "bind": true,
    "handler": true,
    "defaultvalue": true,
};

let UNMANAGED_INPUT_TYPES : Record<string, boolean> = {
    "submit": true,
    "button": true,
    "reset": true,
    "image": true,
};

let MANAGED_ATTRS : Record<string, Record<string, boolean>> = {
    "value": {"value": true, "defaultvalue": true},
    "radio": {"checked": true, "defaultchecked": true},
    "checkbox": {"checked": true, "defaultchecked": true},
    "file": {"value": true},
    "select": {"value": true, "defaultvalue": true},
};

function getManagedType(tagName : string, typeName : string) : ("value" | "radio" | "checkbox" | "file" | "select" | "hidden" | null) {
    if (tagName === "select") {
        return "select";
    }
    if (tagName === "textarea") {
        return "value";
    }
    if (tagName !== "input") {
        return null;
    }
    if (UNMANAGED_INPUT_TYPES[typeName]) {
        return null;
    }
    if (typeName === "radio" || typeName === "checkbox" || typeName === "file" || typeName == "hidden") {
        return typeName;
    }
    return "value";
}

function getFilteredSubNodesByTag(ctx : DBCtx, tag : string) {
    let node = ctx.node;
    if (node.list == null || node.list.length === 0) {
        return [];
    }
    let rtn = [];
    for (let sn of node.list) {
        if (sn.tag !== tag) {
            continue;
        }
        rtn.push(sn);
    }
    return DataCtx.demobx(rtn);
}

function getSubNodesByTag(node : HibikiNode, tag : string) : HibikiNode[] {
    if (node.list == null || node.list.length === 0) {
        return [];
    }
    let rtn = [];
    for (let sn of node.list) {
        if (sn.tag === tag) {
            rtn.push(sn);
        }
    }
    return DataCtx.demobx(rtn);
}

function filterSubNodes(node : HibikiNode, filterFn : (HibikiNode) => boolean) : HibikiNode[] {
    if (node.list == null || node.list.length === 0) {
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

function renderTextSpan(text : string, style : any, className : string) : any {
    if (text === undefined) {
        text = null;
    }
    if (style != null && Object.keys(style).length > 0 || (className != null && className.trim() !== "")) {
        return <span style={style} className={className}>{text}</span>;
    }
    return text;
}

function renderTextData(ctx : DBCtx, onlyText? : boolean) : any {
    let style = ctx.resolveStyleMap();
    let cnArr = ctx.resolveCnArray();
    let [bindVal, exists] = ctx.resolveAttrValPair("bind");
    if (!exists) {
        bindVal = DataCtx.SYM_NOATTR;
    }
    let rtn : string = null;
    let nullTextAttr : string = null;
    if (bindVal == null) {
        nullTextAttr = ctx.resolveAttrStr("nulltext");
    }
    if (bindVal == null && nullTextAttr != null) {
        rtn = nullTextAttr;
    }
    else {
        rtn = DataCtx.formatVal(bindVal, ctx.resolveAttrStr("format"));
    }
    if (onlyText) {
        return rtn;
    }
    return renderTextSpan(rtn, style, cnArrToClassAttr(cnArr));
}

function parseArgsDecl(datatypes : string) : {[e : string] : boolean} {
    let rtn : {[e : string] : boolean} = {};
    if (datatypes == null || datatypes.trim() === "") {
        return rtn;
    }
    let split = datatypes.split(/,/);
    for (let i=0; i<split.length; i++) {
        let field = split[i].trim();
        if (field === "") {
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

function handleConvertType(ctx : DBCtx, value : string) : any {
    let convertType = ctx.resolveAttrStr("converttype");
    if (convertType == null) {
        return;
    }
    let convertLV = ctx.resolveLValueAttr("convertoutput");
    let convertErrorLV = ctx.resolveLValueAttr("converterror");
    try {
        let subType = null;
        if (convertType.startsWith("json:") || convertType.startsWith("jseval:")) {
            let fields = convertType.split(":");
            convertType = fields[0];
            subType = fields[1];
        }
        let convertedVal : HibikiVal = null;
        if (convertType === "json" || convertType === "jseval") {
            if (value == null || value === "") {
                convertedVal = null;
            }
            else if (convertType === "json") {
                convertedVal = JSON.parse(value);
            }
            else {
                let evalVal = eval("(" + value + ")");
                if (typeof(evalVal) === "function") {
                    evalVal = evalVal();
                }
                convertedVal = evalVal;
            }
            if (subType === "array") {
                if (convertedVal != null && !mobx.isArrayLike(convertedVal)) {
                    throw new Error("JSON value is not an array");
                }
            }
            if (subType === "map" || subType === "struct") {
                if (convertedVal != null && !isObject(convertedVal)) {
                    throw new Error("JSON value is not an object");
                }
            }
        }
        else {
            convertedVal = DataCtx.convertSimpleType(convertType, value, ctx.resolveAttrVal("converterrorvalue"));
        }
        if (convertLV != null) {
            convertLV.set(convertedVal);
        }
        if (convertErrorLV != null) {
            convertErrorLV.set(null);
        }
    }
    catch (e) {
        let errObj = {message: sprintf("Error converting value: %s", e), err: e};
        if (convertLV != null) {
            convertLV.set(null);
        }
        if (convertErrorLV != null) {
            convertErrorLV.set(errObj);
        }
    }
    return value;
}

function makeHandlers(node : HibikiNode, injectedAttrs : InjectedAttrsObj, libContext : string, handlerPrefixes : string[]) : Record<string, HandlerValType> {
    let handlers : Record<string, HandlerValType> = {};
    if (injectedAttrs != null) {
        for (let iname in injectedAttrs.handlers) {
            let hname = sprintf("//@event/%s", iname);
            let ehandler : EHandlerType = injectedAttrs.handlers[iname];
            handlers[hname] = {
                block: ehandler.handler,
                node: ehandler.node,
                boundDataenv: ehandler.dataenv,
            };
        }
    }
    if (node.handlers != null) {
        for (let eventName in node.handlers) {
            if (node.handlers[eventName] == null) {
                continue;
            }
            let hname = sprintf("//@event/%s", eventName);
            if (hname in handlers) {
                continue;
            }
            handlers[hname] = {block: new DataCtx.HActionBlock("handler", node.handlers[eventName], libContext), node: node};
        }
    }
    if (handlerPrefixes != null && node.list != null) {
        let contextVars : DataCtx.ContextVarType[] = [];
        for (let subNode of node.list) {
            if (subNode.tag === "define-vars") {
                if (subNode.contextVars) {
                    contextVars.push(...subNode.contextVars);
                }
                continue;
            }
            if (subNode.tag === "define-handler") {
                let attrs = getRawAttrs(subNode);
                if (attrs.name == null) {
                    continue;
                }
                if (subNode.handlers == null || subNode.handlers["handler"] == null) {
                    continue;
                }
                let hname = attrs.name;
                let prefixOk = false;
                for (let j=0; j<handlerPrefixes.length; j++) {
                    if (hname.startsWith(sprintf("//@%s/", handlerPrefixes[j]))) {
                        prefixOk = true;
                        break;
                    }
                }
                if (prefixOk) {
                    let actionBlock = new DataCtx.HActionBlock("handler", subNode.handlers["handler"], libContext);
                    let htype : HandlerValType = {block: actionBlock, node: subNode};
                    if (contextVars.length > 0) {
                        htype.contextVars = contextVars;
                    }
                    handlers[hname] = htype;
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
        if (node.list[i].tag === tag) {
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
        if (node.list[i].tag === tag) {
            return node.list[i];
        }
    }
    return null;
}

function getRawAttrs(node : HibikiNode) : Record<string, string> {
    if (node == null || node.attrs == null) {
        return {};
    }
    let rtn : Record<string, string> = {};
    for (let attrName in node.attrs) {
        rtn[attrName] = DataCtx.rawAttrStr(node.attrs[attrName]);
    }
    return rtn;
}

export {BLOCKED_ELEMS, INLINE_ELEMS, SPECIAL_ATTRS, BLOB_ATTRS, SUBMIT_ELEMS, MANAGED_ATTRS, NON_INJECTABLE, renderTextSpan, renderTextData, parseArgsDecl, handleConvertType, makeHandlers, subNodesByTag, firstSubNodeByTag, getManagedType, getRawAttrs};
