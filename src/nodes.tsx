// Copyright 2021-2022 Dashborg Inc

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from 'autobind-decorator'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {v4 as uuidv4} from 'uuid';

import type {ComponentType, LibraryType, HibikiExtState, LibComponentType, HibikiVal, HibikiValObj, HibikiReactProps} from "./types";
import {DBCtx, makeDBCtx, makeCustomDBCtx, InjectedAttrsObj, createInjectObj, resolveArgsRoot} from "./dbctx";
import * as DataCtx from "./datactx";
import {HibikiState, DataEnvironment} from "./state";
import {resolveNumber, isObject, textContent, SYM_PROXY, SYM_FLATTEN, jseval, nodeStr, getHibiki, addToArrayDupCheck, removeFromArray, valInArray, subMapKey, unbox, bindLibContext, cnArrToClassAttr} from "./utils";
import {parseHtml, HibikiNode, NodeAttrType} from "./html-parser";
import * as NodeUtils from "./nodeutils";
import {RtContext, HibikiError} from "./error";
import type {HAction} from "./datactx";
import type {EHandlerType} from "./state";

declare var window : any;

let welcomeMessage = false;
let usageFired = false;

@mobxReact.observer
class ErrorMsg extends React.Component<{message: string}, {}> {
    render() : React.ReactNode {
        return (
            <div>{this.props.message}</div>
        );
    }
}

@mobxReact.observer
class HibikiRootNode extends React.Component<{hibikiState : HibikiExtState}, {}> {
    constructor(props : any) {
        super(props);
    }

    getHibikiState() : HibikiState {
        return (this.props.hibikiState as any).state;
    }

    getDataenv() : DataEnvironment {
        return this.getHibikiState().pageDataenv();
    }
    
    componentDidMount() {
        let dbstate = this.getHibikiState();
        let flowerEmoji = String.fromCodePoint(0x1F338);
        if (dbstate.allowUsageImg() && !usageFired) {
            usageFired = true;
            let versionStr = getHibiki().VERSION + "|" + getHibiki().BUILD;
            let usageImg = new Image();
            usageImg.src = sprintf("https://hibikihtml.com/hibiki-usage.gif?version=%s&build=%s", getHibiki().VERSION, getHibiki().BUILD);
            usageImg.onload = function() {};
        }
        if (dbstate.allowWelcomeMessage() && !welcomeMessage) {
            welcomeMessage = true;
            let versionStr = getHibiki().VERSION + " " + getHibiki().BUILD;
            console.log(flowerEmoji + sprintf(" Hibiki HTML https://github.com/dashborg/hibiki [%s] | Developed by Dashborg Inc https://dashborg.net", versionStr));
        }
    }

    getHibikiNode() : HibikiNode {
        return this.getHibikiState().findCurrentPage();
    }
    
    render() : React.ReactNode {
        let dbstate = this.getHibikiState();
        let node = this.getHibikiNode();
        let dataenv = this.getDataenv();
        let ctx = makeCustomDBCtx(node, dataenv, null);
        return <NodeList list={ctx.node.list} ctx={ctx} isRoot={true}/>;
    }
}

function evalOptionChildren(node : HibikiNode, dataenv : DataEnvironment) : string {
    if (node.list == null) {
        return null;
    }
    let textRtn = null;
    for (let i=0; i<node.list.length; i++) {
        let text = staticEvalTextNode(node.list[i], dataenv);
        if (text != null) {
            textRtn = (textRtn ?? "") + text;
        }
    }
    return textRtn;
}

function ctxRenderHtmlChildren(ctx : DBCtx, dataenv? : DataEnvironment) : (Element | string)[] {
    if (dataenv == null) {
        dataenv = ctx.dataenv;
    }
    if (ctx.node.tag == "option") {
        return [evalOptionChildren(ctx.node, dataenv)];
    }
    let rtn = baseRenderHtmlChildren(ctx.node.list, dataenv, false);
    return rtn;
}

function baseRenderOneNode(node : HibikiNode, dataenv : DataEnvironment, injectedAttrs : InjectedAttrsObj, isRoot : boolean) : [any, boolean, DataEnvironment] {
    if (node.tag == "#text") {
        return [node.text, false, dataenv];
    }
    else if (node.tag == "#comment") {
        return [null, false, null];
    }
    else if (NodeUtils.BLOCKED_ELEMS[node.tag]) {
        return [null, false, null];
    }
    else if (node.tag == "if-break") {
        let ifBreakCtx = makeCustomDBCtx(node, dataenv, null);
        let [ifAttr, exists] = ifBreakCtx.resolveAttrValPair("condition");
        if (!exists) {
            return [<ErrorMsg message="<if-break> requires 'condition' attribute"/>, false, null];
        }
        if (!ifAttr) {
            return [null, false, null];
        }
        return [<AnyNode node={node} dataenv={dataenv} injectedAttrs={injectedAttrs}/>, true, null];
    }
    else if (node.tag == "define-vars") {
        let setCtx = makeCustomDBCtx(node, dataenv, null);
        let contextAttr = setCtx.resolveAttrStr("context");
        if (contextAttr == null) {
            contextAttr = textContent(node).trim();
            if (contextAttr === "") {
                contextAttr = null;
            }
        }
        if (contextAttr == null) {
            return [<ErrorMsg message="<define-vars> no context attribute"/>, false, null];
        }
        try {
            let ctxDataenv = DataCtx.ParseAndCreateContextThrow(contextAttr, "context", dataenv, "<define-vars>");
            return [null, false, ctxDataenv];
        }
        catch (e) {
            return [<ErrorMsg message={"<define-vars> Error parsing/executing context block: " + e}/>, false, null];
        }
        return [null, false, null];
    }
    else if (node.tag == "define-handler") {
        let attrs = node.attrs || {};
        if (!isRoot) {
            return [<ErrorMsg message={"<define-handler> is only allowed at root of <hibiki>, <page>, or <define-component> nodes"}/>, false, null];
        }
        return [null, false, null];
    }
    else {
        return [<AnyNode node={node} dataenv={dataenv} injectedAttrs={injectedAttrs}/>, false, null];
    }
}

function baseRenderHtmlChildren(list : HibikiNode[], dataenv : DataEnvironment, isRoot : boolean) : Element[] {
    let rtn : any[] = [];
    if (list == null || list.length == 0) {
        return null;
    }
    for (let child of list) {
        let [elem, stopLoop, newDataenv] = baseRenderOneNode(child, dataenv, null, isRoot);
        if (elem != null) {
            rtn.push(elem);
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

@mobxReact.observer
class NodeList extends React.Component<{list : HibikiNode[], ctx : DBCtx, isRoot? : boolean}> {
    render() : React.ReactNode {
        let {list, ctx} = this.props;
        let rtn = baseRenderHtmlChildren(list, ctx.dataenv, this.props.isRoot);
        if (rtn == null) {
            return null;
        }
        return <React.Fragment>{rtn}</React.Fragment>;
    }
}

function staticEvalTextNode(node : HibikiNode, dataenv : DataEnvironment) : string {
    let ctx = makeCustomDBCtx(node, dataenv, null);
    let tagName = ctx.node.tag;
    if (tagName == "#text") {
        return node.text;
    }
    if (tagName != "h-text") {
        return nodeStr(node);
    }
    if (!ctx.isEditMode()) {
        let [ifAttr, exists] = ctx.resolveAttrValPair("if");
        if (exists) {
            ifAttr = DataCtx.resolveLValue(ifAttr);
            if (!ifAttr) {
                return null;
            }
        }
    }
    // TODO foreach
    let rtn = NodeUtils.renderTextData(ctx, true);
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
            let content = this.renderInner(childCtx, true);
            if (content != null) {
                rtnContent.push(content);
            }
            index++;
        }
        return rtnContent
    }
    
    renderInner(ctx : DBCtx, iterating : boolean) : any {
        let node = ctx.node;
        let tagName = ctx.node.tag;
        if (tagName.startsWith("hibiki-")) {
            return null;
        }
        let dataenv = ctx.dataenv;
        let dbstate = dataenv.dbstate;
        let compName = ctx.resolveAttrStr("component") ?? tagName;
        let component = dbstate.ComponentLibrary.findComponent(compName, node.libContext);
        if (!ctx.isEditMode()) {
            if (!iterating && node.foreachAttr != null) {
                return this.renderForeach(ctx);
            }
            let ifExists = ctx.hasRawAttr("if");
            if (ifExists) {
                let ifAttrVal = DataCtx.resolveLValue(ctx.resolveAttrVal("if"));
                if (!ifAttrVal) {
                    return null;
                }
            }
            let unwrapExists = ctx.hasRawAttr("unwrap");
            if (unwrapExists) {
                let unwrapAttrVal = DataCtx.resolveLValue(ctx.resolveAttrVal("unwrap"));
                if (unwrapAttrVal) {
                    return <FragmentNode component={component} node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs}/>;
                }
            }
        }
        if (component != null) {
            if (component.componentType == "react-custom") {
                this.nodeType = "react-component";
                return <CustomReactNode component={component} node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs}/>;
            }
            else if (component.componentType == "hibiki-native") {
                this.nodeType = "component";
                let ImplNode = component.impl.get();
                if (ImplNode == null && component.libName == "main") {
                    ImplNode = getHibiki().LocalNativeComponents.get(component.name);
                }
                if (ImplNode == null) {
                    return null;
                }
                return <ImplNode node={node} dataenv={dataenv}/>;
            }
            else if (component.componentType == "hibiki-html") {
                this.nodeType = "hibiki-html-component";
                return <CustomNode component={component} node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs}/>;
            }
            else {
                this.nodeType = "unknown";
                return <div>&lt;{compName}&gt;</div>;
            }
        }
        if (compName.startsWith("html-") || compName.indexOf("-") == -1) {
            this.nodeType = "rawhtml";
            return <RawHtmlNode node={node} dataenv={dataenv} injectedAttrs={ctx.injectedAttrs}/>
        }
        this.nodeType = "unknown";
        return <div>&lt;{compName}&gt;</div>;
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
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleMountEvent();
    }
    
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let dataenv = ctx.dataenv;
        let component = this.props.component;
        let implBox = component.reactimpl;
        let reactImpl = implBox.get();
        if (reactImpl == null && component.libName == "main") {
            reactImpl = getHibiki().LocalReactComponents.get(component.name);
        }
        if (reactImpl == null) {
            return null;
        }
        let reactProps : Record<string, any> = DataCtx.DeepCopy(ctx.resolveAttrVals(), {resolve: true}) as HibikiValObj;
        reactProps["hibikicontext"] = ctx;
        let nodeVar = NodeUtils.makeNodeVar(ctx, false);
        let htmlContext = sprintf("react:%s", nodeStr(ctx.node));
        let childEnv = ctx.dataenv.makeChildEnv({node: nodeVar}, {htmlContext: htmlContext, libContext: component.libName});
        let rtnElems = baseRenderHtmlChildren(ctx.node.list, childEnv, false)
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
    constructor(props : any) {
        super(props);
        let ctx = makeDBCtx(this);
    }

    componentDidMount() {
        let ctx = makeDBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleMountEvent();
    }

    @boundMethod handleFileOnChange(e : any) {
        let ctx = makeDBCtx(this);
        let isMultiple = !!ctx.resolveAttrStr("multiple");
        let valueLV = ctx.resolveLValueAttr("value");
        let p = convertBlobArray(e.target.files);
        p.then((hblobArr) => {
            if (isMultiple) {
                if (hblobArr.length == 0) {
                    hblobArr = null;
                }
                ctx.handleOnChange(hblobArr);
                if (valueLV != null) {
                    valueLV.set(hblobArr);
                }
            }
            else {
                let blob : DataCtx.HibikiBlob = null;
                if (hblobArr.length > 0) {
                    blob = hblobArr[0];
                }
                ctx.handleOnChange(blob);
                if (valueLV != null) {
                    valueLV.set(blob);
                }
            }
        });
    }

    @boundMethod handleSelectOnChange(e : any) {
        let ctx = makeDBCtx(this);
        let valueLV = ctx.resolveLValueAttr("value");
        let isMulti = !!ctx.resolveAttrStr("multiple");
        let newValue : (string | string[]) = null;
        if (isMulti) {
            newValue = Array.from(e.target.selectedOptions, (option : HTMLOptionElement) => option.value);
        }
        else {
            newValue = e.target.value;
        }
        ctx.handleOnChange(newValue);
        if (valueLV != null) {
            valueLV.set(newValue);
        }
    }

    @boundMethod handleValueOnChange(e : any) {
        let ctx = makeDBCtx(this);
        let valueLV = ctx.resolveLValueAttr("value");
        let newValue = e.target.value;
        NodeUtils.handleConvertType(ctx, newValue);
        ctx.handleOnChange(newValue);
        if (valueLV != null) {
            valueLV.set(newValue);
        }
        ctx.handleAfterChange(newValue);
    }

    @boundMethod handleRadioOnChange(e : any) {
        let ctx = makeDBCtx(this);
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        let newValue = e.target.checked;
        ctx.handleOnChange(newValue);
        if (formValueLV != null) {
            let radioValue = ctx.resolveAttrStr("value") ?? "on";
            formValueLV.set(radioValue);
        }
        ctx.handleAfterChange(newValue);
    }

    @boundMethod handleCheckboxOnChange(e : any) {
        let ctx = makeDBCtx(this);
        let checkedLV = ctx.resolveLValueAttr("checked");
        let formValueLV = ctx.resolveLValueAttr("formvalue");
        let newValue = e.target.checked;
        ctx.handleOnChange(newValue);
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
        ctx.handleAfterChange(newValue);
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
            k = k.toLowerCase();
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
            if (k == "download" && strVal == "1") {
                elemProps["download"] = "";
                continue;
            }
            elemProps[k] = strVal;
        }
        if (!managedAttrs["value"] && elemProps["value"] == null && ctx.getRawAttr("value") == "") {
            elemProps["value"] = "";
        }
        
        if (!ctx.isEditMode()) {
            // forms are managed if submit.handler
            if (tagName == "form" && ctx.hasHandler("submit")) {
                elemProps.onSubmit = ctx.handleOnSubmit;
            }

            if (ctx.hasHandler("click")) {
                elemProps.onClick = ctx.handleOnClick;
                // anchors with click.handler work like links (not locations)
                if (tagName == "a" && elemProps["href"] == null) {
                    elemProps["href"] = "#";
                }
            }
            
            if (managedType != null) {
                if (managedType == "value") {
                    this.setupManagedValue(ctx, elemProps);
                }
                else if (managedType == "radio") {
                    this.setupManagedRadio(ctx, elemProps);
                }
                else if (managedType == "checkbox") {
                    this.setupManagedCheckbox(ctx, elemProps);
                }
                else if (managedType == "file") {
                    this.setupManagedFile(ctx, elemProps);
                }
                else if (managedType == "select") {
                    this.setupManagedSelect(ctx, elemProps);
                }
                else if (managedType == "hidden") {
                    this.setupManagedHidden(ctx, elemProps);
                }
                else {
                    console.log("Invalid managedType", managedType);
                }
            }
        }

        let style = ctx.resolveStyleMap();
        let cnArr = ctx.resolveCnArray();
        if (Object.keys(style).length > 0) {
            elemProps["style"] = style;
        }
        if (Object.keys(cnArr).length > 0) {
            elemProps["className"] = cnArrToClassAttr(cnArr);
        }
        let elemChildren = ctxRenderHtmlChildren(ctx);
        return React.createElement(tagName, elemProps, elemChildren);
    }
}

@mobxReact.observer
class CustomNode extends React.Component<HibikiReactProps & {component : ComponentType}, {}> {
    constructor(props : any) {
        super(props);
        this.makeCustomChildEnv(true);
    }
    
    makeCustomChildEnv(initialize : boolean) : DataEnvironment {
        let ctx = makeDBCtx(this);
        let component = this.props.component;
        let implNode = component.node;
        let rawImplAttrs : Record<string, NodeAttrType> = implNode.attrs || {};
        let nodeVar = NodeUtils.makeNodeVar(ctx, false);
        let componentName = DataCtx.rawAttrStr(rawImplAttrs.name);
        let ctxHandlers = NodeUtils.makeHandlers(ctx.node, ctx.injectedAttrs, null, null);
        let eventCtx = sprintf("%s", nodeStr(ctx.node));
        let eventDE = ctx.dataenv.makeChildEnv(null, {eventBoundary: "hard", handlers: ctxHandlers, htmlContext: eventCtx});
        let nodeDataLV = ctx.getNodeDataLV(componentName);
        let specials : Record<string, any> = {};
        specials.children = new DataCtx.ChildrenVar(ctx.node.list, ctx.dataenv);
        specials.node = nodeVar;
        let argsRoot = resolveArgsRoot(ctx);
        let handlers = NodeUtils.makeHandlers(implNode, null, component.libName, ["event"]);
        let envOpts = {
            componentRoot: unbox(ctx.getNodeData(componentName)),
            argsRoot: argsRoot,
            handlers: handlers,
            htmlContext: sprintf("<define-component %s>", componentName),
            libContext: component.libName,
            eventBoundary: "soft",
        };
        let childEnv = eventDE.makeChildEnv(specials, envOpts);
        if (initialize && rawImplAttrs.defaults != null) {
            try {
                DataCtx.ParseAndCreateContextThrow(DataCtx.rawAttrStr(rawImplAttrs.defaults), "c", childEnv, sprintf("<define-component %s>:defaults", componentName));
            }
            catch (e) {
                console.log(sprintf("ERROR parsing/executing 'defaults' in <define-component %s>", componentName), e);
            }
            let implCtx = makeCustomDBCtx(implNode, childEnv, null);
            implCtx.handleInitEvent();
        }
        return childEnv;
    }

    componentDidMount() {
        let ctx = makeDBCtx(this);
        if (ctx.isEditMode()) {
            return;
        }
        ctx.handleMountEvent();
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
        let rtnElems = baseRenderHtmlChildren(implNode.list, childEnv, true)
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
class IfNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let [condAttr, exists] = ctx.resolveAttrValPair("condition");
        if (!exists) {
            return <ErrorMsg message={sprintf("<%s> node requires 'condition' attribute", ctx.node.tag)}/>
        }
        if (!condAttr) {
            return null;
        }
        return <NodeList list={ctx.node.list} ctx={ctx}/>;
    }
}

@mobxReact.observer
class FragmentNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        return <NodeList list={ctx.node.list} ctx={ctx}/>;
    }
}

@mobxReact.observer
class ScriptNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let srcAttr = ctx.resolveAttrVal("src");
        let isSync = !ctx.resolveAttrStr("async")
        if (srcAttr == null) {
            let scriptText = textContent(ctx.node);
            if (scriptText == null || scriptText.trim() == "") {
                return null;
            }
            ctx.dataenv.dbstate.queueScriptText(scriptText, isSync);
            return null;
        }
        if (srcAttr instanceof DataCtx.HibikiBlob) {
            ctx.dataenv.dbstate.queueScriptSrc(srcAttr.makeDataUrl(), isSync);
        }
        else {
            ctx.dataenv.dbstate.queueScriptSrc(DataCtx.valToAttrStr(srcAttr), isSync);
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
class WithContextNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let contextattr = ctx.resolveAttrStr("context");
        if (contextattr == null) {
            return <ErrorMsg message={sprintf("%s no context attribute", nodeStr(ctx.node))}/>;
        }
        try {
            let ctxDataenv = DataCtx.ParseAndCreateContextThrow(contextattr, "context", ctx.dataenv, nodeStr(ctx.node));
            return ctxRenderHtmlChildren(ctx, ctxDataenv);
        }
        catch (e) {
            return <ErrorMsg message={nodeStr(ctx.node) + " Error parsing/executing context block: " + e}/>;
        }
    }
}

@mobxReact.observer
class ChildrenNode extends React.Component<HibikiReactProps, {}> {
    render() : React.ReactNode {
        let ctx = makeDBCtx(this);
        let textStr = ctx.resolveAttrStr("text");
        if (textStr != null) {
            return textStr;
        }
        let nodeDataenv : DataEnvironment = null;
        let nodeList : HibikiNode[] = null;
        let bindVal = ctx.resolveAttrVal("bind");
        if (bindVal != null) {
            if (!(bindVal instanceof DataCtx.ChildrenVar)) {
                return <ErrorMsg message={sprintf("%s bind expression is not valid, must be [children] type", nodeStr(ctx.node))}/>;
            }
            nodeList = bindVal.list;
            nodeDataenv = bindVal.dataenv;
        }
        else if (ctx.node.list != null) {
            nodeList = ctx.node.list;
            nodeDataenv = ctx.dataenv;
        }
        if (nodeList == null || nodeList.length == 0) {
            return null;
        }
        let contextattr = ctx.resolveAttrStr("datacontext");
        if (contextattr != null) {
            try {
                let ctxEnv = DataCtx.ParseAndCreateContextThrow(contextattr, "context", ctx.dataenv, nodeStr(ctx.node));
                nodeDataenv = nodeDataenv.makeChildEnv(ctxEnv.specials, null);
            }
            catch (e) {
                return <ErrorMsg message={nodeStr(ctx.node) + " Error parsing/executing context block: " + e}/>;
            }
        }
        let rtnElems = [];
        for (let child of nodeList) {
            let toInject : InjectedAttrsObj = null;
            if (!NodeUtils.NON_INJECTABLE[child.tag] && !child.tag.startsWith("#")) {
                toInject = createInjectObj(ctx, child, nodeDataenv);
            }
            let [elem, shouldBreak, newEnv] = baseRenderOneNode(child, nodeDataenv, toInject, false);
            if (elem != null) {
                rtnElems.push(elem);
            }
            if (shouldBreak) {
                break;
            }
            if (newEnv) {
                nodeDataenv = newEnv;
            }
        }
        if (rtnElems.length == 0) {
            return null;
        }
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
        return (
            <React.Fragment>
                <NodeList list={this.curHtmlObj.list} ctx={ctx}/>
            </React.Fragment>
        );
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
                ctx.handleEvent("update", {value: bindVal});
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
                setTimeout(() => ctx.handleEvent("load", {value: queryRtn}), 10);
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
    comp.impl = mobx.observable.box(impl, {name: "@hibiki/core/" + name});
    CORE_LIBRARY.libComponents[name] = comp;
}

let CORE_LIBRARY : LibraryType = {
    name: "@hibiki/core",
    libNode: new HibikiNode("#def", {list: []}),
    libComponents: {},
    importedComponents: {},
    localHandlers: {},
    modules: {},
    handlers: {},
};

addCoreComponent("if", IfNode);
addCoreComponent("if-break", IfNode);
addCoreComponent("foreach", FragmentNode);
addCoreComponent("script", ScriptNode);
addCoreComponent("define-vars", NopNode);
addCoreComponent("define-handler", NopNode);
addCoreComponent("define-component", NopNode);
addCoreComponent("import-library", NopNode);
addCoreComponent("h-if", IfNode);
addCoreComponent("h-if-break", IfNode);
addCoreComponent("h-foreach", FragmentNode);
addCoreComponent("h-text", TextNode);
addCoreComponent("h-dyn", DynNode);
addCoreComponent("h-withcontext", WithContextNode);
addCoreComponent("h-children", ChildrenNode);
addCoreComponent("h-data", SimpleQueryNode);
addCoreComponent("h-fragment", FragmentNode);
addCoreComponent("h-watcher", WatcherNode);

export {HibikiRootNode, CORE_LIBRARY};
