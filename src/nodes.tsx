// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {v4 as uuidv4} from 'uuid';

import type {ComponentType, LibraryType, HibikiExtState, LibComponentType, HibikiVal, HibikiValObj, HibikiReactProps} from "./types";
import {DBCtx, makeDBCtx, makeCustomDBCtx, InjectedAttrsObj, createInjectObj, resolveArgsRoot, bindNodeList, expandChildrenNode} from "./dbctx";
import * as DataCtx from "./datactx";
import {HibikiState, DataEnvironment} from "./state";
import {resolveNumber, isObject, textContent, SYM_PROXY, SYM_FLATTEN, jseval, nodeStr, getHibiki, addToArrayDupCheck, removeFromArray, valInArray, subMapKey, unbox, bindLibContext, cnArrToClassAttr, callHook} from "./utils";
import {parseHtml, HibikiNode, NodeAttrType} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {RtContext, HibikiError} from "./error";
import type {HAction} from "./datactx";
import type {EHandlerType, DataEnvironmentOpts} from "./state";

declare var window : any;

@mobxReact.observer
class ErrorMsg extends React.Component<{message: string}, {}> {
    render() : React.ReactNode {
        return (
            <div>{this.props.message}</div>
        );
    }
}

@mobxReact.observer
class HibikiRootNode extends React.Component<{hibikiState : HibikiExtState, parentHtmlTag : string, htmlElem : HTMLElement}, {}> {
    constructor(props : any) {
        super(props);
    }

    getHibikiState() : HibikiState {
        return (this.props.hibikiState as any).state;
    }

    getDataenv() : DataEnvironment {
        return this.getHibikiState().pageDataenv();
    }
    
    getHibikiNode() : HibikiNode {
        return this.getHibikiState().findCurrentPage();
    }

    componentDidMount() {
        let hibiki = getHibiki();
        if (hibiki.GlobalConfig.postRenderHook != null) {
            callHook("postRenderHook", hibiki.GlobalConfig.postRenderHook, this.props.hibikiState, this.props.htmlElem);
        }
    }
    
    render() : React.ReactNode {
        let dbstate = this.getHibikiState();
        let node = this.getHibikiNode();
        let dataenv = this.getDataenv();
        let ctx = makeCustomDBCtx(node, dataenv, null);
        ctx.isRoot = true;
        let parentHtmlTag = this.props.parentHtmlTag ?? "div";
        return <NodeList list={ctx.node.list} ctx={ctx} isRoot={true} parentHtmlTag={parentHtmlTag}/>;
    }
}

function evalOptionChildren(node : HibikiNode, dataenv : DataEnvironment) : string {
    if (node.list == null) {
        return null;
    }
    let textRtn = null;
    let ctxList = bindNodeList(node.list, dataenv, false);
    for (let i=0; i<ctxList.length; i++) {
        let ctx = ctxList[i];
        let text = ctx.evalAsText();
        if (text != null) {
            textRtn = (textRtn ?? "") + text;
        }
    }
    return textRtn;
}

function ctxRenderHtmlChildren(ctx : DBCtx, htmlTag? : string) : React.ReactNode[] {
    if (ctx.getHtmlTagName() === "option") {
        return [evalOptionChildren(ctx.node, ctx.dataenv)];
    }
    let rtn = baseRenderHtmlChildren(ctx.node.list, ctx.dataenv, false, htmlTag);
    return rtn;
}

function baseRenderHtmlChildren(list : HibikiNode[], dataenv : DataEnvironment, isRoot : boolean, parentHtmlTag : string) : React.ReactNode[] {
    let ctxList = bindNodeList(list, dataenv, isRoot);
    return renderCtxList(ctxList, parentHtmlTag);
}

@mobxReact.observer
class NodeList extends React.Component<{list : HibikiNode[], ctx : DBCtx, isRoot? : boolean, parentHtmlTag : string}> {
    render() : React.ReactNode {
        let {list, ctx} = this.props;
        let rtn = baseRenderHtmlChildren(list, ctx.dataenv, this.props.isRoot, this.props.parentHtmlTag);
        if (rtn == null) {
            return null;
        }
        return <React.Fragment>{rtn}</React.Fragment>;
    }
}

const NO_WHITESPACE_TAGS = {
    "thead": true,
    "tbody": true,
    "tfoot": true,
    "tr": true,
    "table": true,
    "colgroup": true,
    "frameset": true,
};

function renderCtx(ctx : DBCtx, index : number, parentHtmlTag : string) : React.ReactNode {
    let nodeKey = ctx.resolveAttrStr("key") ?? index;
    if (NO_WHITESPACE_TAGS[parentHtmlTag] && ctx.isWhiteSpaceNode()) {
        return null;
    }
    return <AnyNode key={nodeKey} node={ctx.node} dataenv={ctx.dataenv} injectedAttrs={ctx.injectedAttrs} parentHtmlTag={parentHtmlTag}/>;
}

function renderCtxList(ctxList : DBCtx[], parentHtmlTag : string) : React.ReactNode[] {
    if (ctxList == null || ctxList.length === 0) {
        return null;
    }
    let rtn : React.ReactNode[] = [];
    for (let i=0; i<ctxList.length; i++) {
        let rnode = renderCtx(ctxList[i], i, parentHtmlTag);
        if (rnode != null) {
            rtn.push(rnode);
        }
    }
    return rtn;
}

@mobxReact.observer
class AnyNode extends React.Component<HibikiReactProps, {}> {
    nodeType : string = "unknown";

    renderForeach(ctx : DBCtx) : any {
        let node = ctx.node;
        let iterator = DataCtx.makeIteratorFromExpr(node.foreachAttr, ctx.dataenv);
        let rtnContent = [];
        let index = 0;
        for (let ctxVars of iterator) {
            let htmlContext = sprintf("%s:%d", nodeStr(ctx.node), index);
            let childEnv = ctx.dataenv.makeChildEnv(ctxVars, {htmlContext: htmlContext});
            let childCtx = makeCustomDBCtx(node, childEnv, this.props.injectedAttrs);
            let content = this.renderInner(childCtx, true, index);
            if (content != null) {
                rtnContent.push(content);
            }
            index++;
        }
        return rtnContent
    }
    
    renderInner(ctx : DBCtx, iterating : boolean, keyIndex? : number) : any {
        let node = ctx.node;
        let tagName = ctx.node.tag;
        if (tagName.startsWith("hibiki-")) {
            return null;
        }
        if (tagName === "#text") {
            return node.text;
        }
        let dataenv = ctx.dataenv;
        let dbstate = dataenv.dbstate;
        let compName = ctx.resolveAttrStr("component") ?? tagName;
        let component = dbstate.ComponentLibrary.findComponent(compName, node.libContext);
        if (!iterating && node.foreachAttr != null) {
            return this.renderForeach(ctx);
        }
        let [ifVal, ifExists] = ctx.resolveConditionAttr("if");
        if (ifExists && !ifVal) {
            return null;
        }
        let nodeKey = ctx.resolveAttrStr("key") ?? keyIndex;
        let [unwrapVal, unwrapExists] = ctx.resolveConditionAttr("unwrap");
        if (unwrapExists && unwrapVal) {
            return <FragmentNode key={nodeKey} node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs} parentHtmlTag={this.props.parentHtmlTag}/>;
        }
        if (component != null) {
            if (component.componentType === "react-custom") {
                this.nodeType = "react-component";
                return <CustomReactNode key={nodeKey} component={component} node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs} parentHtmlTag={this.props.parentHtmlTag}/>;
            }
            else if (component.componentType === "hibiki-native") {
                this.nodeType = "component";
                let ImplNode = component.impl.get();
                if (ImplNode == null && component.libName === "main") {
                    ImplNode = getHibiki().LocalNativeComponents.get(component.name);
                }
                if (ImplNode == null) {
                    return null;
                }
                return <ImplNode key={nodeKey} node={node} dataenv={dataenv} parentHtmlTag={this.props.parentHtmlTag}/>;
            }
            else if (component.componentType === "hibiki-html") {
                this.nodeType = "hibiki-html-component";
                return <CustomNode key={nodeKey} component={component} node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs} parentHtmlTag={this.props.parentHtmlTag}/>;
            }
            else {
                this.nodeType = "unknown";
                return <div key={nodeKey}>&lt;{compName}&gt;</div>;
            }
        }
        if (compName.startsWith("html-") || compName.indexOf("-") === -1) {
            this.nodeType = "rawhtml";
            return <RawHtmlNode key={nodeKey} node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs} parentHtmlTag={this.props.parentHtmlTag}/>
        }
        this.nodeType = "unknown";
        return <div key={nodeKey}>&lt;{compName}&gt;</div>;
    }

    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let content = this.renderInner(ctx, false)
        return content;
    }
}

@mobxReact.observer
class CustomReactNode extends React.Component<HibikiReactProps & {component : ComponentType}, {}> {
    componentDidMount() {
        let ctx = makeDBCtx(this);
        ctx.handleMountEvent();
    }
    
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let dataenv = ctx.dataenv;
        let component = this.props.component;
        let implBox = component.reactimpl;
        let reactImpl = implBox.get();
        if (reactImpl == null && component.libName === "main") {
            reactImpl = getHibiki().LocalReactComponents.get(component.name);
        }
        if (reactImpl == null) {
            return null;
        }
        let reactProps : Record<string, any> = DataCtx.DeepCopy(ctx.resolveAttrVals(), {resolve: true}) as HibikiValObj;
        reactProps["hibikicontext"] = ctx;
        let nodeVar = ctx.makeNodeVar(false);
        let htmlContext = sprintf("react:%s", nodeStr(ctx.node));
        let childEnv = ctx.dataenv.makeChildEnv({node: nodeVar}, {htmlContext: htmlContext, libContext: component.libName});
        let rtnElems = baseRenderHtmlChildren(ctx.node.list, childEnv, false, this.props.parentHtmlTag)
        let reactElem = React.createElement(reactImpl, reactProps, rtnElems);
        return reactElem;
    }
}

async function convertBlobArray(blobArr : Blob[]) : Promise<DataCtx.HibikiBlob[]> {
    let rtn : DataCtx.HibikiBlob[] = [];
    for (let i=0; i<blobArr.length; i++) {
        rtn[i] = await DataCtx.BlobFromBlob(blobArr[i]);
    }
    return rtn;
}

@mobxReact.observer
class RawHtmlNode extends React.Component<HibikiReactProps, {}> {
    dragDepth : number = 0;
    
    constructor(props : any) {
        super(props);
        let ctx = makeDBCtx(this);
    }

    componentDidMount() {
        let ctx = makeDBCtx(this);
        ctx.handleMountEvent();
    }

    @boundMethod handleFileOnChange(reactEvent : any) {
        let ctx = makeDBCtx(this);
        let isMultiple = !!ctx.resolveAttrStr("multiple");
        let valueLV = ctx.resolveLValueAttr("value");
        let p = convertBlobArray(reactEvent.target.files);
        p.then((hblobArr) => {
            if (isMultiple) {
                if (hblobArr.length === 0) {
                    hblobArr = null;
                }
                ctx.handleOnChange(reactEvent, hblobArr);
                if (valueLV != null) {
                    valueLV.set(hblobArr);
                }
            }
            else {
                let blob : DataCtx.HibikiBlob = null;
                if (hblobArr.length > 0) {
                    blob = hblobArr[0];
                }
                ctx.handleOnChange(reactEvent, blob);
                if (valueLV != null) {
                    valueLV.set(blob);
                }
            }
        });
    }

    @boundMethod handleSelectOnChange(reactEvent : any) {
        let ctx = makeDBCtx(this);
        let valueLV = ctx.resolveLValueAttr("value");
        let isMulti = !!ctx.resolveAttrStr("multiple");
        let newValue : (string | string[]) = null;
        if (isMulti) {
            newValue = Array.from(reactEvent.target.selectedOptions, (option : HTMLOptionElement) => option.value);
        }
        else {
            newValue = reactEvent.target.value;
        }
        ctx.handleOnChange(reactEvent, newValue);
        if (valueLV != null) {
            valueLV.set(newValue);
        }
    }

    @boundMethod handleValueOnChange(reactEvent : any) {
        let ctx = makeDBCtx(this);
        let valueLV = ctx.resolveLValueAttr("value");
        let newValue = reactEvent.target.value;
        NodeUtils.handleConvertType(ctx, newValue);
        ctx.handleOnChange(reactEvent, newValue);
        if (valueLV != null) {
            valueLV.set(newValue);
        }
        ctx.handleAfterChange(reactEvent, newValue);
    }

    @boundMethod handleRadioOnChange(reactEvent : any) {
        let ctx = makeDBCtx(this);
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        let newValue = reactEvent.target.checked;
        ctx.handleOnChange(reactEvent, newValue);
        if (formValueLV != null) {
            let radioValue = ctx.resolveAttrStr("value") ?? "on";
            formValueLV.set(radioValue);
        }
        ctx.handleAfterChange(reactEvent, newValue);
    }

    @boundMethod handleCheckboxOnChange(reactEvent : any) {
        let ctx = makeDBCtx(this);
        let checkedLV = ctx.resolveLValueAttr("checked");
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        let newValue = reactEvent.target.checked;
        ctx.handleOnChange(reactEvent, newValue);
        if (checkedLV != null) {
            checkedLV.set(newValue);
        }
        else if (formValueLV != null) {
            let checkboxValue = ctx.resolveAttrStr("value") ?? "on";
            if (newValue) {
                let newFormValue = addToArrayDupCheck(formValueLV.get(), checkboxValue);
                formValueLV.set(newFormValue);
            }
            else {
                let newFormValue = removeFromArray(formValueLV.get(), checkboxValue);
                formValueLV.set(newFormValue);
            }
        }
        ctx.handleAfterChange(reactEvent, newValue);
    }

    @boundMethod handleDragOver(reactEvent : any) {
        let ctx = makeDBCtx(this);
        reactEvent.preventDefault();

        let dropEffect = ctx.resolveAttrStr("dropeffect");
        if (dropEffect != null) {
            reactEvent.dataTransfer.dropEffect = dropEffect;
        }
    }

    @boundMethod handleOnDrop(reactEvent : any) {
        let ctx = makeDBCtx(this);
        reactEvent.preventDefault();
        let textData = reactEvent.dataTransfer.getData("text");
        let data = {value: textData};
        let blobp : Promise<DataCtx.HibikiBlob[]> = null;
        if (reactEvent.dataTransfer.files.length > 0) {
            blobp = convertBlobArray(reactEvent.dataTransfer.files);
        }
        this.dragDepth = 0;
        let targetLV = ctx.resolveLValueAttr("droptargeting");
        if (targetLV != null) {
            targetLV.set(false);
        }
        Promise.resolve(blobp).then((blobs) => {
            if (blobs != null) {
                data["dragfiles"] = blobs;
            }
            let allTypes = {};
            for (let tname of reactEvent.dataTransfer.types) {
                allTypes[tname] = reactEvent.dataTransfer.getData(tname);
            }
            data["dragtypes"] = allTypes;
            ctx.handleEvent(reactEvent, "drop", data);
        });
    }

    @boundMethod handleDragEnd(reactEvent : any) {
        let ctx = makeDBCtx(this);
        let draggingLV = ctx.resolveLValueAttr("dragging");
        if (draggingLV != null) {
            draggingLV.set(null);
        }
        ctx.handleEvent(reactEvent, "dragend", {});
    }

    @boundMethod handleDragEnter(reactEvent : any) {
        let ctx = makeDBCtx(this);
        this.dragDepth++;
        let targetLV = ctx.resolveLValueAttr("droptargeting");
        if (targetLV != null) {
            targetLV.set(true);
        }
        if (this.dragDepth === 1) {
            ctx.handleEvent(reactEvent, "dragenter", {});
        }
    }

    @boundMethod handleDragLeave(reactEvent : any) {
        let ctx = makeDBCtx(this);
        this.dragDepth--;
        let targetLV = ctx.resolveLValueAttr("droptargeting");
        if (targetLV != null && this.dragDepth <= 0) {
            targetLV.set(false);
        }
        if (this.dragDepth === 0) {
            ctx.handleEvent(reactEvent, "dragleave", {});
        }
    }

    @boundMethod handleDragStart(reactEvent : any) {
        let ctx = makeDBCtx(this);
        let dragValue = DataCtx.resolveLValue(ctx.resolveAttrVal("dragvalue"));
        if (dragValue != null) {
            let [dragObj, isObj] = DataCtx.asPlainObject(dragValue, false);
            if (isObj) {
                for (let key in dragObj) {
                    let strVal = DataCtx.valToString(dragObj[key]);
                    if (strVal != null) {
                        reactEvent.dataTransfer.setData(key, strVal);
                    }
                }
            }
            else {
                let dragStrVal = DataCtx.valToString(dragValue);
                reactEvent.dataTransfer.setData("text", dragStrVal);
            }
        }
        let dragEffectAllowed = ctx.resolveAttrStr("drageffectallowed");
        if (dragEffectAllowed != null) {
            reactEvent.dataTransfer.dragEffectAllowed = dragEffectAllowed;
        }
        let dragImageVal = DataCtx.resolveLValue(ctx.resolveAttrVal("dragimage"));
        if (dragImageVal != null) {
            let [dragImageArr, isArr] = DataCtx.asArray(dragImageVal, false);
            if (!isArr) {
                dragImageArr = [dragImageVal];
            }
            let [dragImage, offsetXRaw, offsetYRaw] = dragImageArr;
            let offsetX : number = (offsetXRaw == null ? undefined : DataCtx.valToNumber(offsetXRaw));
            let offsetY : number = (offsetYRaw == null ? undefined : DataCtx.valToNumber(offsetYRaw));
            let imgUrl : string = null;
            if (dragImage instanceof DataCtx.HibikiBlob) {
                if (dragImage.mimetype.startsWith("image/")) {
                    imgUrl = dragImage.makeDataUrl();
                }
            }
            else {
                imgUrl = DataCtx.valToString(dragImage);
            }
            if (imgUrl != null) {
                if (imgUrl.startsWith("#")) {
                    let img = document.getElementById(imgUrl.substr(1));
                    reactEvent.dataTransfer.setDragImage(img, offsetX, offsetY);
                }
                else {
                    let img = new Image();
                    img.src = imgUrl;
                    reactEvent.dataTransfer.setDragImage(img, offsetX, offsetY);
                }
            }
        }
        let draggingLV = ctx.resolveLValueAttr("dragging");
        if (draggingLV != null) {
            let [draggingVal, hasDraggingVal] = ctx.resolveAttrValPair("draggingvalue");
            if (hasDraggingVal) {
                draggingLV.set(draggingVal);
            }
            else {
                draggingLV.set(true);
            }
        }
        ctx.handleEvent(reactEvent, "dragstart", {value: dragValue});
    }

    setupDraggable(ctx : DBCtx, elemProps : Record<string, any>) {
        elemProps["onDragStart"] = this.handleDragStart;
        elemProps["onDragEnd"] = this.handleDragEnd;
    }

    setupDropTarget(ctx : DBCtx, elemProps : Record<string, any>) {
        elemProps["onDragOver"] = this.handleDragOver;
        elemProps["onDrop"] = this.handleOnDrop;
        elemProps["onDragEnter"] = this.handleDragEnter;
        elemProps["onDragLeave"] = this.handleDragLeave;
    }

    setupManagedValue(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let valueLV = ctx.resolveLValueAttr("value");
        if (valueLV != null) {
            // 2-way data-binding
            elemProps["onChange"] = this.handleValueOnChange;
            elemProps["value"] = valueLV.get() ?? "";
        }
        else if (isBound) {
            // 1-way data-binding
            let value = ctx.resolveAttrStr("value");
            elemProps["onChange"] = this.handleValueOnChange;
            elemProps["value"] = value ?? "";
        }
        else {
            // not managed
            let value = ctx.resolveAttrStr("value");
            if (value != null) {
                elemProps["defaultValue"] = value;
            }
            elemProps["onChange"] = this.handleValueOnChange;
        }
    }

    setupManagedFile(ctx : DBCtx, elemProps : Record<string, any>) {
        elemProps["onChange"] = this.handleFileOnChange;
    }

    setupManagedHidden(ctx : DBCtx, elemProps : Record<string, any>) {
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        if (formValueLV != null) {
            let value = ctx.resolveAttrStr("value") ?? "";
            if (DataCtx.valToAttrStr(formValueLV.get()) !== value) {
                setTimeout(() => formValueLV.set(value), 0);
            }
        }
    }

    setupManagedRadio(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        if (formValueLV != null) {
            // 2-way data-binding
            let radioValue = ctx.resolveAttrStr("value") ?? "on";
            let checked = (formValueLV.get() == radioValue);
            elemProps["checked"] = checked;
            elemProps["onChange"] = this.handleRadioOnChange;
        }
        else if (isBound) {
            // 1-way data-binding
            let checked = ctx.resolveAttrStr("checked");
            elemProps["checked"] = !!checked;
            elemProps["onChange"] = this.handleRadioOnChange;
        }
        else {
            // not managed
            let checked = ctx.resolveAttrStr("checked");
            if (checked) {
                elemProps["defaultChecked"] = true;
            }
            elemProps["onChange"] = this.handleRadioOnChange;
        }
    }

    setupManagedCheckbox(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let checkedLV = ctx.resolveLValueAttr("checked");
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        if (checkedLV != null) {
            // 2-way simple data-binding
            elemProps["checked"] = !!checkedLV.get();
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else if (formValueLV != null) {
            // 2-way group data-binding
            let checkboxValue = ctx.resolveAttrStr("value") ?? "on";
            let checked = valInArray(formValueLV.get(), checkboxValue);
            elemProps["checked"] = checked;
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else if (isBound) {
            // 1-way data-binding
            let checked = ctx.resolveAttrStr("checked");
            elemProps["checked"] = !!checked;
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
        else {
            // not managed
            let checked = ctx.resolveAttrStr("checked");
            if (checked) {
                elemProps["defaultChecked"] = true;
            }
            elemProps["onChange"] = this.handleCheckboxOnChange;
        }
    }

    setupManagedSelect(ctx : DBCtx, elemProps : Record<string, any>) {
        let isBound = !!ctx.resolveAttrStr("bound");
        let valueLV = ctx.resolveLValueAttr("value");
        let isMulti = !!ctx.resolveAttrStr("multiple");
        if (valueLV != null) {
            // 2-way data-binding
            elemProps["onChange"] = this.handleSelectOnChange;
            if (isMulti) {
                elemProps["value"] = valueLV.get() ?? [];
            }
            else {
                elemProps["value"] = valueLV.get() ?? "";
            }
        }
        else if (isBound) {
            // 1-way data-binding
            let value = ctx.resolveAttrStr("value");
            elemProps["onChange"] = this.handleSelectOnChange;
            if (isMulti) {
                elemProps["value"] = value ?? [];
            }
            else {
                elemProps["value"] = value ?? "";
            }
        }
        else {
            // not managed
            elemProps["onChange"] = this.handleSelectOnChange;
        }
    }
    
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let tagName = ctx.getHtmlTagName();
        let elemProps : Record<string, any> = {};
        let attrVals : Record<string, HibikiVal> = ctx.resolveAttrVals();
        let typeAttr = DataCtx.valToAttrStr(attrVals["type"]);
        let managedType = NodeUtils.getManagedType(tagName, typeAttr);
        let managedAttrs = NodeUtils.MANAGED_ATTRS[managedType] ?? {};
        for (let [k,v] of Object.entries(attrVals)) {
            if (k.startsWith("html-")) {
                delete attrVals[k];
                attrVals[k.substr(5)] = v;
            }
        }
        let draggable = false;
        let isDropTarget = false;
        for (let [k,v] of Object.entries(attrVals)) {
            if (NodeUtils.SPECIAL_ATTRS[k] || managedAttrs[k]) {
                continue;
            }
            if (k.startsWith("on")) {
                continue;
            }
            if (k.endsWith(".bindpath") || k.endsWith(".handler") || k.endsWith(".default")) {
                continue;
            }
            if (k.startsWith("class.") || k.indexOf(":class") != -1) {
                continue;
            }
            if (v instanceof DataCtx.HibikiBlob) {
                if (NodeUtils.BLOB_ATTRS[k]) {
                    elemProps[k] = v.makeDataUrl();
                }
                else {
                    elemProps[k] = DataCtx.blobPrintStr(v);
                }
                continue;
            }
            let strVal = DataCtx.valToAttrStr(v);
            if (k === "download" && strVal === "1") {
                elemProps["download"] = "";
                continue;
            }
            if (k === "draggable" || k === "droptarget") {
                if (strVal === "0") {
                    strVal = "false";
                }
                else if (strVal === "1") {
                    strVal = "true";
                }
                else {
                    strVal = (DataCtx.valToBool(v) ? "true" : "false");
                }
                if (k === "draggable") {
                    if (strVal === "true") {
                        draggable = true;
                    }
                    elemProps["draggable"] = strVal;
                }
                else if (k === "droptarget") {
                    if (strVal === "true") {
                        isDropTarget = true;
                    }
                }
                continue;
            }
            if (k === "colspan") {
                k = "colSpan";
            }
            elemProps[k] = strVal;
        }
        if (!managedAttrs["value"] && elemProps["value"] == null && ctx.getRawAttr("value") === "") {
            elemProps["value"] = "";
        }
        
        // forms are managed if submit.handler
        if (tagName === "form" && ctx.hasHandler("submit")) {
            elemProps.onSubmit = ctx.handleOnSubmit;
        }
        
        if (ctx.hasHandler("click")) {
            elemProps.onClick = ctx.handleOnClick;
            // anchors with click.handler work like links (not locations)
            if (tagName === "a" && elemProps["href"] == null) {
                elemProps["href"] = "#";
            }
        }
            
        if (managedType != null) {
            if (managedType === "value") {
                this.setupManagedValue(ctx, elemProps);
            }
            else if (managedType === "radio") {
                this.setupManagedRadio(ctx, elemProps);
            }
            else if (managedType === "checkbox") {
                this.setupManagedCheckbox(ctx, elemProps);
            }
            else if (managedType === "file") {
                this.setupManagedFile(ctx, elemProps);
            }
            else if (managedType === "select") {
                this.setupManagedSelect(ctx, elemProps);
            }
            else if (managedType === "hidden") {
                this.setupManagedHidden(ctx, elemProps);
            }
            else {
                console.log("Invalid managedType", managedType);
            }
        }
        if (draggable) {
            this.setupDraggable(ctx, elemProps);
        }
        if (isDropTarget) {
            this.setupDropTarget(ctx, elemProps);
        }

        let style = ctx.resolveStyleMap();
        let cnArr = ctx.resolveCnArray();
        if (Object.keys(style).length > 0) {
            elemProps["style"] = style;
        }
        if (Object.keys(cnArr).length > 0) {
            elemProps["className"] = cnArrToClassAttr(cnArr);
        }
        let elemChildren = ctxRenderHtmlChildren(ctx, tagName);
        return React.createElement(tagName, elemProps, elemChildren);
    }
}

@mobxReact.observer
class CustomNode extends React.Component<HibikiReactProps & {component : ComponentType}, {}> {
    hasImplMount : boolean;
    
    constructor(props : any) {
        super(props);
        this.hasImplMount = false;
        this.makeCustomChildEnv(true);
    }
    
    makeCustomChildEnv(initialize : boolean) : DataEnvironment {
        let ctx = makeDBCtx(this);
        let component = this.props.component;
        let implNode = component.node;
        let rawImplAttrs : Record<string, NodeAttrType> = implNode.attrs || {};
        let nodeVar = ctx.makeNodeVar(false);
        let componentName = DataCtx.rawAttrStr(rawImplAttrs.name);
        let ctxHandlers = NodeUtils.makeHandlers(ctx.node, ctx.injectedAttrs, null, null);
        let eventCtx = sprintf("%s", nodeStr(ctx.node));
        let eventDE = ctx.dataenv.makeChildEnv(null, {eventBoundary: "hard", handlers: ctxHandlers, htmlContext: eventCtx});
        let specials : Record<string, any> = {};
        specials.children = ctx.makeChildrenVar();
        specials.node = nodeVar;
        let argsRoot = resolveArgsRoot(ctx);
        let handlers = NodeUtils.makeHandlers(implNode, null, component.libName, ["event"]);
        if (handlers != null && handlers["//@event/mount"] != null) {
            this.hasImplMount = true;
        }
        let envOpts : DataEnvironmentOpts = {
            componentRoot: {},
            argsRoot: argsRoot,
            handlers: handlers,
            htmlContext: sprintf("<define-component %s>", componentName),
            libContext: component.libName,
            eventBoundary: "soft",
        };
        let childEnv = eventDE.makeChildEnv(specials, envOpts);
        if (initialize && implNode.contextVars != null) {
            let htmlContext = sprintf("<define-component %s>:componentdata", componentName);
            let componentDataObj : HibikiValObj = {};
            try {
                componentDataObj = DataCtx.EvalContextVarsThrow(implNode.contextVars, childEnv, htmlContext);
            }
            catch (e) {
                console.log(sprintf("ERROR evaluating 'componentdata' in %s", nodeStr(implNode)), e);
            }
            childEnv.componentRoot = unbox(ctx.getNodeData(componentName, componentDataObj));
        }
        else {
            childEnv.componentRoot = unbox(ctx.getNodeData(componentName));
        }
        return childEnv;
    }

    componentDidMount() {
        let prtn : Promise<any> = null;
        if (this.hasImplMount) {
            let childEnv = this.makeCustomChildEnv(false);
            let implNode = this.props.component.node;
            let implCtx = makeCustomDBCtx(implNode, childEnv, null);
            prtn = implCtx.handleEvent(null, "mount", null);
        }
        if (prtn == null) {
            prtn = Promise.resolve(true);
        }
        prtn.then(() => {
            let ctx = makeDBCtx(this);
            ctx.handleMountEvent();
        });
    }

    componentWillUnmount() {
        let ctx = makeDBCtx(this);
        ctx.unregisterUuid();
    }

    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        ctx.registerUuid();
        let component = this.props.component;
        let implNode = component.node;
        let childEnv = this.makeCustomChildEnv(false);
        let rtnElems = baseRenderHtmlChildren(implNode.list, childEnv, true, this.props.parentHtmlTag)
        if (rtnElems == null) {
            return null;
        }
        return <React.Fragment>{rtnElems}</React.Fragment>
    }
}

@mobxReact.observer
class TextNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        return NodeUtils.renderTextData(ctx);
    }
}

@mobxReact.observer
class FragmentNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        return <NodeList list={ctx.node.list} ctx={ctx} parentHtmlTag={this.props.parentHtmlTag}/>;
    }
}

@mobxReact.observer
class ScriptNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let srcAttr = ctx.resolveAttrVal("src");
        let isSync = !ctx.resolveAttrStr("async")
        let scriptType = ctx.resolveAttrStr("type");
        if (srcAttr == null) {
            let scriptText = textContent(ctx.node);
            if (scriptText == null || scriptText.trim() === "") {
                return null;
            }
            ctx.dataenv.dbstate.queueScriptText(scriptText, scriptType, isSync);
            return null;
        }
        if (srcAttr instanceof DataCtx.HibikiBlob) {
            ctx.dataenv.dbstate.queueScriptSrc(srcAttr.makeDataUrl(), scriptType, isSync);
        }
        else {
            ctx.dataenv.dbstate.queueScriptSrc(DataCtx.valToAttrStr(srcAttr), scriptType, isSync);
        }
        return null;
    }
}

@mobxReact.observer
class NopNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        return null;
    }
}

@mobxReact.observer
class ChildrenNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let ctxList = expandChildrenNode(ctx);
        if (ctxList == null || ctxList.length === 0) {
            return null;
        }
        let rtnElems = renderCtxList(ctxList, this.props.parentHtmlTag);
        return <React.Fragment>{rtnElems}</React.Fragment>;
    }
}

@mobxReact.observer
class DynNode extends React.Component<HibikiReactProps, {}> {
    curHtml : string = null;
    curHtmlObj : HibikiNode = null;

    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let bindVal = ctx.resolveAttrStr("bind");
        if (bindVal == null) {
            return null;
        }
        if (bindVal != this.curHtml) {
            this.curHtml = bindVal;
            this.curHtmlObj = null;
            try {
                this.curHtmlObj = parseHtml(bindVal);
                bindLibContext(this.curHtmlObj, (ctx.resolveAttrStr("libcontext") ?? "main"));
            }
            catch (e) {
                let errObj = new HibikiError(sprintf("Error parsing HTML in %s node: %s", nodeStr(ctx.node), e.toString()), e);
                ctx.dataenv.dbstate.reportErrorObj(errObj);
            }
        }
        if (this.curHtmlObj == null) {
            return null;
        }
        return <NodeList list={this.curHtmlObj.list} ctx={ctx} parentHtmlTag={this.props.parentHtmlTag}/>;
    }
}

class WatcherNode extends React.Component<HibikiReactProps, {}> {
    lastVal : HibikiVal;
    firstRun : boolean;

    constructor(props : any) {
        super(props);
        this.firstRun = true;
    }
    
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let bindVal = DataCtx.demobx(ctx.resolveAttrVal("bind"));
        let updated = !DataCtx.DeepEqual(bindVal, this.lastVal);
        if (this.firstRun) {
            let fireOnInit = ctx.resolveAttrStr("fireoninit");
            updated = (fireOnInit && fireOnInit !== "0");
        }
        if (updated) {
            setTimeout(() => {
                ctx.handleEvent(null, "update", {value: bindVal});
            }, 0);
        }
        return null;
    }
}

class SimpleQueryNode extends React.Component<HibikiReactProps, {}> {
    refreshCount : mobx.IObservableValue<number>;
    callNum : number = 0;
    autorunDisposer : () => void = null;
    nameComputed : mobx.IComputedValue<string>;

    constructor(props : any) {
        super(props);
        let self = this;
        let ctx = makeDBCtx(this);
        this.refreshCount = mobx.observable.box(0, {name: "refreshCount"});
        this.nameComputed = mobx.computed(() => {
            let ctx = makeDBCtx(self);
            let name = ctx.resolveAttrStr("name");
            if (name != null) {
                return name;
            }
            return ctx.uuid;
        }, {name: "nameComputed"});
    }

    executeQuery(ctx : DBCtx, curCallNum : number) {
        let dbstate = ctx.dataenv.dbstate;
        let rtctx = new RtContext();
        let name = ctx.resolveAttrStr("name");
        // TODO register handlerName/handlerEnv for error bubbling
        rtctx.pushContext(sprintf("Evaluating %s (in %s)", nodeStr(ctx.node), ctx.dataenv.getFullHtmlContext()), null);
        try {
            let queryStr = ctx.resolveAttrStr("query");
            if (queryStr == null) {
                return;
            }
            rtctx.pushContext("Parsing 'query' attribute (must be a data handler expression)", null);
            let callAction = DataCtx.ParseStaticCallStatement(queryStr);
            rtctx.popContext();
            let qrtn = DataCtx.ExecuteHAction(callAction, true, ctx.dataenv, rtctx);
            qrtn.then((queryRtn) => {
                if (curCallNum != this.callNum) {
                    console.log(sprintf("%s not setting stale data return", nodeStr(ctx.node)));
                    return;
                }
                let outputLV = ctx.resolveLValueAttr("output");
                if (outputLV != null) {
                    outputLV.set(queryRtn);
                }
                setTimeout(() => ctx.handleEvent(null, "load", {value: queryRtn}), 10);
            }).catch((e) => {
                let errObj = new HibikiError(e.toString(), e, rtctx);
                dbstate.reportErrorObj(errObj);
            });
        }
        catch (e) {
            let errObj = new HibikiError(e.toString(), e, rtctx);
            dbstate.reportErrorObj(errObj);
        }
    }

    @boundMethod
    doGetData() {
        let ctx = makeDBCtx(this);
        let dbstate = ctx.dataenv.dbstate;
        let version = dbstate.RenderVersion.get();
        let refreshCount = this.refreshCount.get();
        this.callNum++;
        let curCallNum = this.callNum;
        let name = this.nameComputed.get();
        dbstate.registerDataNodeState(ctx.uuid, name, this);
        setTimeout(() => this.executeQuery(ctx, curCallNum), 10);
    }

    forceRefresh() {
        this.refreshCount.set(this.refreshCount.get() + 1);
    }

    componentDidMount() {
        this.autorunDisposer = mobx.autorun(this.doGetData);
    }

    componentWillUnmount() {
        if (this.autorunDisposer != null) {
            this.autorunDisposer();
        }
    }
    
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let queryStr = ctx.resolveAttrStr("query");
        if (queryStr == null) {
            return <ErrorMsg message={sprintf("%s without query attribute", nodeStr(ctx.node))}/>;
        }
        try {
            DataCtx.ParseStaticCallStatement(queryStr);
        }
        catch (e) {
            return <ErrorMsg message={sprintf("%s error parsing query attribute", nodeStr(ctx.node))}/>;
        }
        return null;
    }
}

function addCoreComponent(name : string, impl : any) {
    let comp : LibComponentType = {componentType: "hibiki-native"};
    comp.impl = mobx.observable.box(impl, {name: "hibiki/core/" + name});
    CORE_LIBRARY.libComponents[name] = comp;
}

let CORE_LIBRARY : LibraryType = {
    name: "hibiki/core",
    libNode: new HibikiNode("#def", {list: []}),
    libComponents: {},
    importedComponents: {},
    localHandlers: {},
    modules: {},
    handlers: {},
};

addCoreComponent("script", ScriptNode);
addCoreComponent("define-vars", NopNode);
addCoreComponent("define-handler", NopNode);
addCoreComponent("define-component", NopNode);
addCoreComponent("import-library", NopNode);
addCoreComponent("h-text", TextNode);
addCoreComponent("h-fragment", FragmentNode);
addCoreComponent("h-dyn", DynNode);
addCoreComponent("h-children", ChildrenNode);
addCoreComponent("h-data", SimpleQueryNode);
addCoreComponent("h-watcher", WatcherNode);

export {HibikiRootNode, CORE_LIBRARY};
