// Copyright 2021 Dashborg Inc

import * as mobx from "mobx";
import {v4 as uuidv4} from 'uuid';
import nearley from "nearley";
import hibikiGrammar from "./hibiki-grammar.js";
import {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import {RtContext, getShortEMsg, HibikiError} from "./error";
import {makeUrlParamsFromObject, SYM_PROXY, SYM_FLATTEN, isObject, unpackPositionalArgs, nodeStr} from "./utils";
import {PathPart, PathType, PathUnionType, DataCtxErrorObjType, EventType, HandlerValType, HibikiAction} from "./types";
import {HibikiRequest} from "./request";

declare var window : any;

const MAX_ARRAY_SIZE = 10000;

type HExpr = {
    etype    : string,
    filter?  : string,
    exprs?   : HExpr[],
    op?      : string,
    fn?      : string,
    val?     : any,
    key?     : HExpr,
    path?    : PathType,
    valexpr? : HExpr,
};

type HAction = {
    type      : string,
    subtype?  : string,
    event?    : HExpr,
    setop?    : string,
    lvalue?   : PathType,
    callpath? : HExpr,
    data?     : HExpr,
    actions?  : Record<string, HAction[]>,
};

type HandlerBlock = {hibikihandler: string, ctxstr? : string} | {hibikiactions: HibikiAction[]} | HAction[];

type StmtBlock = Statement[];

type Statement = {
    stmt : string,
    data? : any,
    handler? : HExpr,
    lvalue? : PathType,
    expr? : HExpr,
    exprs? : HExpr[],
    setop? : string,
    event? : HExpr,
    context : any,
    condExpr : HExpr,
    thenBlock? : StmtBlock,
    elseBlock? : StmtBlock,
};

type TCFBlock = {
    block : StmtBlock,
    catchBlock? : StmtBlock,
    finallyBlock? : StmtBlock,
    contextStr? : string,
};

class HibikiBlob {
    mimetype : string = null;
    data : string = null;
    _type : "HibikiBlob" = "HibikiBlob";

    makeDataUrl() : string {
        return "data:" + this.mimetype + ";base64," + this.data;
    }
}

function formatVal(val : any, format : string) : string {
    let rtn = null;
    try {
        if (format == null || format == "") {
            rtn = String(val);
        }
        else if (format == "json") {
            rtn = JsonStringify(val, 2);
        }
        else if (format == "json-compact") {
            rtn = JsonStringify(val);
        }
        else if (mobx.isArrayLike(val)) {
            rtn = sprintf(format, ...val);
        }
        else {
            rtn = sprintf(format, val);
        }
    } catch (e) {
        rtn = "format-error[" + e + "]";
    }
    return rtn;
}

function formatFilter(val : any, args : Record<string, any>) {
    let {format} = unpackPositionalArgs(args, ["format"]);
    return formatVal(val, format);
}

function rtnIfType(v : any, itype : string) : any {
    if (v == null) {
        return null;
    }
    if (itype == "array") {
        if (!mobx.isArrayLike(v)) {
            return null;
        }
        return null;
    }
    else if (itype == "map") {
        if (v instanceof Map || mobx.isObservableMap(v)) {
            return v;
        }
        if (!isObject(v)) {
            return null;
        }
        return v;
    }
    else {
        return null;
    }
}

abstract class LValue {
    abstract get() : any;
    abstract set(newVal : any);
    abstract subArrayIndex(index : number) : LValue;
    abstract subMapKey(key : string) : LValue;
}

class BoundLValue extends LValue {
    path : PathType;
    dataenv : DataEnvironment
    
    constructor(path : PathType, dataenv : DataEnvironment) {
        super();
        this.path = path;
        this.dataenv = dataenv;
    }

    get() : any {
        let staticPath = evalPath(this.path, this.dataenv);
        return ResolvePath(staticPath, this.dataenv);
    }

    set(newVal : any) {
        let staticPath = evalPath(this.path, this.dataenv);
        SetPath(staticPath, this.dataenv, newVal);
    }

    subArrayIndex(index : number) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "array", pathindex: index});
        return new BoundLValue(newpath, this.dataenv);
    }

    subMapKey(key : string) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "map", pathkey: key});
        return new BoundLValue(newpath, this.dataenv);
    }
}

class ReadOnlyLValue extends LValue {
    wrappedLV : LValue;

    constructor(lv : LValue) {
        super();
        this.wrappedLV = lv;
    }

    get() : any {
        return this.wrappedLV.get();
    }

    set(newVal : any) {
        return;
    }

    subArrayIndex(index : number) : LValue {
        let rtn = this.wrappedLV.subArrayIndex(index);
        return new ReadOnlyLValue(rtn);
    }

    subMapKey(key : string) : LValue {
        let rtn = this.wrappedLV.subMapKey(key);
        return new ReadOnlyLValue(rtn);
    }
}

function CreateReadOnlyLValue(val : any, debugName : string) : LValue {
    let box = mobx.observable.box(val, {deep: false, name: debugName});
    let lvalue = new ObjectLValue(null, box);
    return new ReadOnlyLValue(lvalue);
}

class ObjectLValue extends LValue {
    path : PathType;
    root : mobx.IObservableValue<any>;

    constructor(path? : PathType, root? : mobx.IObservableValue<any>, name? : string) {
        super();
        if (path == null) {
            path = [{pathtype: "root", pathkey: "global"}];
        }
        if (root == null) {
            root = mobx.observable.box(null, {name: (name || "ObjectLValue")});
        }
        this.path = path;
        this.root = root;
    }

    get() : any {
        return quickObjectResolvePath(this.path, this.root.get());
    }

    set(newVal : any) {
        this.root.set(quickObjectSetPath(this.path, this.root.get(), newVal));
    }

    subArrayIndex(index : number) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "array", pathindex: index});
        return new ObjectLValue(newpath, this.root);
    }

    subMapKey(key : string) : LValue {
        let newpath = this.path.slice();
        newpath.push({pathtype: "map", pathkey: key});
        return new ObjectLValue(newpath, this.root);
    }
}

class BoundValue {
    isroot : boolean;
    rootbox : mobx.IObservableValue<any>;
    parent : BoundValue;
    pathpart : PathPart;
    isconst : boolean;

    constructor(parent : BoundValue, pp : PathPart) {
        if (parent == null) {
            this.isroot = true;
            this.rootbox = mobx.observable.box(null);
            return;
        }
        else {
            this.parent = parent;
            this.pathpart = pp;
        }
    }

    subArray(index : number) : BoundValue {
        return new BoundValue(this, {pathtype: "array", pathindex: index});
    }

    subMap(key : string) : BoundValue {
        return new BoundValue(this, {pathtype: "map", pathkey: key});
    }

    isConst() : boolean {
        if (this.isroot) {
            return this.isconst;
        }
        return this.parent.isConst();
    }

    pathString() : string {
        if (this.isroot) {
            return "$";
        }
        let pathstr = this.parent.pathString();
        if (this.pathpart.pathtype == "array") {
            return sprintf("%s[%d]", pathstr, this.pathpart.pathindex);
        }
        return sprintf("%s.%s", pathstr, this.pathpart.pathkey);
    }

    get() : any {
        if (this.isroot) {
            return this.rootbox.get();
        }
        let pval = this.parent.get();
        if (pval == null) {
            return null;
        }
        let pp = this.pathpart;
        if (pp.pathtype == "array") {
            let index = pp.pathindex;
            if (index < 0) {
                return null;
            }
            if (!mobx.isArrayLike(pval)) {
                return null;
            }
            if (index >= pval.length) {
                return null;
            }
            return pval[index];
        }
        if (pp.pathtype == "map") {
            let pathkey = pp.pathkey;
            if (pathkey == null) {
                return null;
            }
            if (!isObject(pval)) {
                return null;
            }
            if (pval instanceof Map || mobx.isObservableMap(pval)) {
                return pval.get(pathkey);
            }
            return pval[pathkey];
        }
        throw new Error("invalid pathtype=" + pp.pathtype);
    }

    getWithIntention(itype : string) : any {
        if (itype != "array" && itype != "map") {
            return null;
        }
        let ival = (itype == "array" ? [] : {});
        let val = null;
        if (this.isroot) {
            val = this.rootbox.get();
            if (val == null) {
                this.rootbox.set(ival);
                return this.rootbox.get();
            }
            return rtnIfType(val, itype);
        }
        let pp = this.pathpart;
        val = this.parent.getWithIntention(pp.pathtype);
        if (val == null) {
            return null;
        }
        if (pp.pathtype == "array") {
            if (!mobx.isArrayLike(val)) {
                return null;
            }
            if (pp.pathindex < 0 || pp.pathindex > MAX_ARRAY_SIZE) {
                return null;
            }
            if (mobx.isObservableArray(val) && pp.pathindex >= val.length) {
                val.length = pp.pathindex;
            }
            let rtn = val[pp.pathindex];
            if (rtn == null) {
                val[pp.pathindex] = ival;
                return val[pp.pathindex];
            }
            return rtnIfType(rtn, itype);
        }
        else {  // itype == "map"
            if (!isObject(val)) {
                return null;
            }
            if (val instanceof Map || mobx.isObservableMap(val)) {
                let rtn = val.get(pp.pathkey);
                if (rtn == null) {
                    val.set(pp.pathkey, ival);
                    return val.get(pp.pathkey);
                }
                return rtnIfType(rtn, itype);
            }
            else {
                let rtn = val[pp.pathkey];
                if (rtn == null) {
                    val[pp.pathkey] = ival;
                    return val[pp.pathkey];
                }
                return rtnIfType(rtn, itype);
            }
        }
    }

    set(newval : any) : boolean {
        if (this.isConst()) {
            return false;
        }
        if (this.isroot) {
            this.rootbox.set(newval);
            return true;
        }
        let pp = this.pathpart;
        let pval = this.parent.getWithIntention(pp.pathtype);
        if (pval == null) {
            return false;
        }
        if (pp.pathtype == "array") {
            if (pp.pathindex < 0 || pp.pathindex > MAX_ARRAY_SIZE) {
                return false;
            }
            if (mobx.isObservableArray(pval) && pp.pathindex >= pval.length) {
                pval.length = pp.pathindex;
            }
            pval[pp.pathindex] = newval;
            return true;
        }
        else {  // pathtype == "map"
            if (pval instanceof Map || mobx.isObservableMap(pval)) {
                pval.set(pp.pathkey, newval);
            }
            else {
                pval[pp.pathkey] = newval;
            }
            return true;
        }
    }
}

function StringPath(path : PathUnionType) : string {
    if (typeof(path) == "string") {
        return path;
    }
    if (path.length == 0) {
        return ".";
    }
    let rtn = "";
    for (let i=0; i<path.length; i++) {
        let pp = path[i];
        if (pp.pathtype == "root") {
            if (i == 0) {
                if (pp.pathkey == "global" || pp.pathkey == null) {
                    rtn = "$";
                }
                else if (pp.pathkey == "context") {
                    rtn = "@";
                }
                else if (pp.pathkey == "currentcontext") {
                    rtn = "@";
                }
                else if (pp.pathkey == "local") {
                    rtn = ".";
                }
                else {
                    rtn = "$" + pp.pathkey;
                }
            }
            continue;
        }
        else if (pp.pathtype == "dot") {
            continue;
        }
        else if (pp.pathtype == "array") {
            rtn = rtn + sprintf("[%d]", pp.pathindex);
        }
        else if (pp.pathtype == "dyn") {
            rtn = rtn + "[dyn]";
        }
        else if (pp.pathtype == "dynfind") {
            rtn = rtn + "[*dynfind]";
        }
        else if (pp.pathtype == "deref") {
            rtn = rtn + "$(deref)";
        }
        else if (pp.pathtype == "map") {
            if (pp.pathkey == null) {
                continue;
            }
            let partStr = _pathPartStr(rtn, pp.pathkey);
            rtn += partStr;
        }
    }
    return rtn;
}

function _pathPartStr(curPath : string, key : string) : string {
    if (key.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        if (curPath == "." || curPath == "@") {
            return key;
        }
        return "." + key;
    }
    else {
        return sprintf("[%s]", JSON.stringify(key));
    }
}

function ParseBlock(blockStr : string) : StmtBlock {
    try {
        return ParseBlockThrow(blockStr);
    }
    catch (e) {
        console.log("ERROR during ParseBlock [[", blockStr, "]]", e);
        return null;
    }
}

function ParseBlockThrow(blockStr : string) : StmtBlock {
    let g = nearley.Grammar.fromCompiled(hibikiGrammar);
    g.ParserStart = g.start = "statementBlock";
    let blockParser = new nearley.Parser(g);
    try {
        blockParser.feed(blockStr);
    }
    catch (e) {
        let emsg = getShortEMsg(e);
        throw new Error(emsg);
    }
    // console.log(blockParser);
    if (blockParser.results == null || blockParser.results.length == 0) {
        throw new Error("Error parsing block, unterminated statement: " + blockStr);
    }
    let block = blockParser.results[0];
    if (blockParser.results.length > 1) {
        console.log("Ambiguous parse of block", blockStr, blockParser.results);
    }
    return block;
}

function ParsePath(path : string) : PathType {
    try {        
        return ParsePathThrow(path);
    }
    catch (e) {
        console.log("ERROR during ParsePath", "[[", path, "]]", e);
        return null;
    }
}

function ParsePathThrow(pathStr : string) : PathType {
    let g = nearley.Grammar.fromCompiled(hibikiGrammar, "pathExprNonTerm");
    g.ParserStart = g.start = "pathExprNonTerm";
    let exprParser = new nearley.Parser(nearley.Grammar.fromCompiled(hibikiGrammar));
    try {
        exprParser.feed(pathStr);
    }
    catch (e) {
        let emsg = getShortEMsg(e);
        throw new Error(emsg);
    }
    if (exprParser.results == null || exprParser.results.length == 0) {
        throw new Error("Error parsing path, unterminated expression: + " + pathStr);
    }
    let path = exprParser.results[0].path;
    for (let i=0; i<path.length; i++) {
        if (path[i].pathtype == "dyn") {
            throw new Error("Error parsing path, path must be static (no dynamic references allowed): + " + pathStr);
        }
        if (path[i].pathtype == "deref") {
            throw new Error("Error parsing path, path must be static (no dereferencing allowed): + " + pathStr);
        }
    }
    return path;
}

function ParseSetPath(setpath : string) : { op : string, path : PathType } {
    try {
        return ParseSetPathThrow(setpath);
    }
    catch (e) {
        console.log("ERROR during ParseSetPath", "[[", setpath, "]]", e);
        return null;
    }
}

function ParseSetPathThrow(setpath : string) : { op : string, path : PathType } {
    let found = setpath.match(/^([a-z][a-z0-9]*)\:(.+)/);
    if (found == null) {
        let rtnPath = ParsePathThrow(setpath);
        return {op : "set", path: rtnPath};
    }
    let rtnPath = ParsePathThrow(found[2]);
    return {op: found[1], path: rtnPath};
}

// function internalResolvePath(path : PathType, localRoot : any, globalRoot : any, specials : any, level : number) : any {
function internalResolvePath(path : PathType, irData : any, dataenv : DataEnvironment, level : number) : any {
    if (level >= path.length) {
        return irData;
    }
    let pp = path[level];
    if (pp.pathtype == "root") {
        if (level != 0) {
            throw new Error(sprintf("Root($) path invalid in ResolvePath except at level 0, path=%s, level=%d", StringPath(path), level));
        }
        if (pp.pathkey == "expr") {
            let newIrData = pp.value;
            return internalResolvePath(path, newIrData, dataenv, level+1);
        }
        let newIrData = null;
        try {
            newIrData = dataenv.resolveRoot(pp.pathkey, {caret: pp.caret});
        }
        catch (e) {
            throw new Error(sprintf("Invalid root path, path=%s, pathkey=%s, level=%d", StringPath(path), pp.pathkey, level));
        }
        return internalResolvePath(path, newIrData, dataenv, level+1);
    }
    else if (pp.pathtype == "array") {
        if (irData == null) {
            return null;
        }
        if (irData instanceof LValue) {
            return internalResolvePath(path, irData.subArrayIndex(pp.pathindex), dataenv, level+1);
        }
        if (!mobx.isArrayLike(irData)) {
            throw new Error(sprintf("Cannot resolve array index (non-array) in ResolvePath, path=%s, level=%d", StringPath(path), level));
        }
        if (pp.pathindex < 0) {
            throw new Error(sprintf("Bad array index: %d in ResolvePath, path=%s, level=%d", pp.pathindex, StringPath(path), level));
        }
        if (pp.pathindex >= irData.length) {
            return null;
        }
        return internalResolvePath(path, irData[pp.pathindex], dataenv, level+1);
    }
    else if (pp.pathtype == "map") {
        if (irData == null) {
            return null;
        }
        if (irData instanceof LValue) {
            return internalResolvePath(path, irData.subMapKey(pp.pathkey), dataenv, level+1);
        }
        if (typeof(irData) != "object") {
            throw new Error(sprintf("Cannot resolve map key (non-object) in ResolvePath, path=%s, level=%d", StringPath(path), level));
        }
        if ((irData instanceof Map) || mobx.isObservableMap(irData)) {
            return internalResolvePath(path, irData.get(pp.pathkey), dataenv, level+1);
        }
        return internalResolvePath(path, irData[pp.pathkey], dataenv, level+1);
    }
    else if (pp.pathtype == "dynfind") {
        if (dataenv == null) {
            throw new Error(sprintf("Cannot resolve array dyn-index in ResolvePath without DataEnvironment, path=%s", StringPath(path)));
        }
        if (irData == null) {
            return null;
        }
        if (irData instanceof LValue) {
            let lvalArr = irData.get();
            if (lvalArr == null) {
                return null;
            }
            if (!mobx.isArrayLike(lvalArr)) {
                throw new Error(sprintf("Cannot resolve array index (non-array) in ResolvePath, path=%s, level=%d", StringPath(path), level));
            }
            let dynindex = resolveDynfind(lvalArr, pp.expr, dataenv);
            if (dynindex == null) {
                return null;
            }
            return internalResolvePath(path, irData.subArrayIndex(dynindex), dataenv, level+1);
        }
        if (!mobx.isArrayLike(irData)) {
            throw new Error(sprintf("Cannot resolve array index (non-array) in ResolvePath, path=%s, level=%d", StringPath(path), level));
        }
        let dynindex = resolveDynfind(irData, pp.expr, dataenv);
        if (dynindex == null) {
            return null;
        }
        return internalResolvePath(path, irData[dynindex], dataenv, level+1);
    }
    else {
        throw new Error(sprintf("Bad PathPart in ResolvePath, path=%s, pathtype=%s, level=%d", StringPath(path), pp.pathtype, level));
    }
    return null;
}

function resolveDynfind(arr : any[], expr : any, dataenv : DataEnvironment) : number {
    for (let i=0; i<arr.length; i++) {
        let htmlContext = sprintf("dynfind[%d]", i);
        let childEnv = dataenv.makeChildEnv({"index": i}, {htmlContext: htmlContext, localData: arr[i]});
        let e1 = evalExprAst(expr, childEnv);
        if (!!e1) {
            return i;
        }
    }
    return null;
}

function ResolvePath(pathUnion : PathUnionType, dataenv : DataEnvironment) : any {
    try {
        return ResolvePathThrow(pathUnion, dataenv);
    }
    catch (e) {
        console.log("ResolvePath Error", e);
        return null;
    }
}

function ResolvePathThrow(pathUnion : PathUnionType, dataenv : DataEnvironment) : any {
    let path : PathType = null;
    if (typeof(pathUnion) == "string") {
        path = ParsePath(pathUnion);
    }
    else {
        path = pathUnion;
    }
    if (path == null) {
        return null;
    }
    return internalResolvePath(path, null, dataenv, 0);
}

function appendData(path : PathType, curData : any, newData : any) : any {
    if (curData == null) {
        return [newData];
    }
    if (Array.isArray(curData) || mobx.isArrayLike(curData)) {
        curData.push(newData);
        return curData;
    }
    if (typeof(curData) == "string" && newData == null) {
        return curData;
    }
    if (typeof(curData) == "string" && typeof(newData) == "string") {
        return curData + newData;
    }
    throw new Error(sprintf("SetPath cannot append newData, path=%s, typeof=%s", StringPath(path), typeof(curData)));
}

function appendArrData(path : PathType, curData : any, newData : any) : any {
    if (newData == null) {
        return curData;
    }
    if (!Array.isArray(newData) && !mobx.isArrayLike(newData)) {
        return curData;
    }
    if (curData == null) {
        return newData;
    }
    if (Array.isArray(curData) || mobx.isArrayLike(curData)) {
        for (let v of newData) {
            curData.push(v);
        }
        return curData;
    }
    throw new Error(sprintf("SetPath cannot appendarr newData, path=%s, typeof=%s", StringPath(path), typeof(curData)));
}

function setPathWrapper(op : string, path : PathType, dataenv : DataEnvironment, setData : any, opts : {allowContext : boolean}) {
    let allowContext = opts.allowContext;
    if (path == null) {
        throw new Error(sprintf("Invalid set path expression, null path"));
    }
    let rootpp = path[0];
    if (rootpp.pathtype != "root") {
        throw new Error(sprintf("Invalid non-rooted path expression [[%s]]", StringPath(path)));
    }
    if ((rootpp.pathkey == "global") || (rootpp.pathkey == "data")) {
        if (path.length == 1 && op == "set") {
            dataenv.dbstate.DataRoots["global"].set(setData);
            return;
        }
        let irData = dataenv.resolveRoot(rootpp.pathkey);
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    if (path.length <= 1) {
        throw new Error(sprintf("Invalid set path expression, cannot set raw root [[%s]] %s", StringPath(path), rootpp.pathkey));
    }
    else if (rootpp.pathkey == "state") {
        let irData = dataenv.resolveRoot("state");
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey == "context" && allowContext) {
        let irData = dataenv.resolveRoot("context", {caret: rootpp.caret});
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey == "currentcontext" && allowContext) {
        let irData = dataenv.resolveRoot("currentcontext", {caret: rootpp.caret});
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey == "c" || rootpp.pathkey == "component") {
        let irData = dataenv.resolveRoot("c");
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else if (rootpp.pathkey == "local") {
        let irData = dataenv.resolveRoot("local", {caret: rootpp.caret});
        internalSetPath(dataenv, op, path, irData, setData, 1);
        return;
    }
    else {
        if (allowContext) {
            throw new Error(sprintf("Cannot SetPath except $data ($), $state, $local (.), $c, or $context (@) roots, path=%s", StringPath(path)));
        }
        else {
            throw new Error(sprintf("Cannot SetPath except $data ($), $state, $local (.), roots, path=%s", StringPath(path)));
        }
    }
    
}

function ObjectSetPath(pathStr : string, localRoot : any, setData : any) : any {
    let {op, path} = ParseSetPath(pathStr);
    if (path == null || path.length <= 1) {
        return;
    }
    let rootpp = path[0];
    if (rootpp.pathtype != "root" || rootpp.pathkey != "global") {
        return;
    }
    return internalSetPath(null, op, path, localRoot, setData, 1, {nomap: true});
}

function quickObjectResolvePath(path : PathType, localRoot : any) : any {
    if (path == null || path.length == 0) {
        return null;
    }
    let rootpp = path[0];
    if (rootpp.pathtype != "root" || rootpp.pathkey != "global") {
        return;
    }
    try {
        return internalResolvePath(path, localRoot, null, 1);
    }
    catch (e) {
        console.log("Error getting object path", e);
        return null;
    }
}

function quickObjectSetPath(path : PathType, localRoot : any, setData : any) : any {
    if (path == null || path.length == 0) {
        return null;
    }
    let rootpp = path[0];
    if (rootpp.pathtype != "root" || rootpp.pathkey != "global") {
        return;
    }
    try {
        return internalSetPath(null, "set", path, localRoot, setData, 1, {nomap: true});
    }
    catch (e) {
        console.log("Error setting object path", e);
        return null;
    }
}

function internalSetPath(dataenv : DataEnvironment, op : string, path : PathType, localRoot : any, setData : any, level : number, opts? : any) : any {
    if (mobx.isBoxedObservable(localRoot)) {
        throw new Error("Bad localRoot -- cannot be boxed observable.");
    }
    opts = opts || {};
    if (level >= path.length) {
        if (localRoot instanceof LValue) {
            if (op != "set") {
                throw new Error(sprintf("Invalid setPath op=%s for LValue bindpath", op));
            }
            localRoot.set(setData);
            return localRoot;
        }
        if (op == "append") {
            return appendData(path, localRoot, setData);
        }
        if (op == "appendarr") {
            return appendArrData(path, localRoot, setData);
        }
        else if (op == "set") {
            return setData;
        }
        else if (op == "setunless") {
            if (localRoot != null) {
                return localRoot;
            }
            return setData;
        }
        else if (op == "blobext") {
            return blobExtDataPath(path, localRoot, setData);
        }
        else {
            throw new Error(sprintf("Invalid setPath op=%s", op));
        }
    }
    let pp = path[level];
    if (pp.pathtype == "root") {
        throw new Error(sprintf("Invalid path, root path not first part, path=%s, level=%d", StringPath(path), level));
    }
    else if (pp.pathtype == "array") {
        if (pp.pathindex < 0 || pp.pathindex > MAX_ARRAY_SIZE) {
            throw new Error(sprintf("SetPath bad array index=%d, path=%s, level=%d", pp.pathindex, StringPath(path), level));
        }
        if (localRoot == null) {
            localRoot = [];
        }
        if (localRoot instanceof LValue) {
            internalSetPath(dataenv, op, path, localRoot.subArrayIndex(pp.pathindex), setData, level+1, opts);
            return localRoot;
        }
        if (!mobx.isArrayLike(localRoot)) {
            throw new Error(sprintf("SetPath cannot resolve array index through non-array, path=%s, level=%d", StringPath(path), level));
        }
        if (localRoot.length < pp.pathindex + 1) {
            localRoot.length = pp.pathindex + 1;
        }
        let newVal = internalSetPath(dataenv, op, path, localRoot[pp.pathindex], setData, level+1, opts);
        localRoot[pp.pathindex] = newVal;
        return localRoot;
    }
    else if (pp.pathtype == "dynfind") {
        if (dataenv == null) {
            throw new Error(sprintf("Cannot resolve array dyn-index in SetPath without DataEnvironment, path=%s", StringPath(path)));
        }
        if (localRoot == null) {
            localRoot = [];
        }
        if (localRoot instanceof LValue) {
            let lvalArr = localRoot.get();
            if (lvalArr == null) {
                lvalArr = [];
            }
            if (!mobx.isArrayLike(lvalArr)) {
                throw new Error(sprintf("SetPath cannot resolve array dyn-index through non-array, path=%s, level=%d", StringPath(path), level));
            }
            let dynindex = resolveDynfind(lvalArr, pp.expr, dataenv);
            if (dynindex == null) {
                console.log("Warning, cannot resolve dyn-index in SetPath, path=%s, ignoring set", StringPath(path));
                return localRoot;
            }
            internalSetPath(dataenv, op, path, localRoot.subArrayIndex(dynindex), setData, level+1, opts);
            return localRoot;
        }
        if (!mobx.isArrayLike(localRoot)) {
            throw new Error(sprintf("SetPath cannot resolve array dyn-index through non-array, path=%s, level=%d", StringPath(path), level));
        }
        let dynindex = resolveDynfind(localRoot, pp.expr, dataenv);
        if (dynindex == null) {
            console.log("Warning, cannot resolve dyn-index in SetPath, path=%s, ignoring set", StringPath(path));
            return localRoot;
        }
        let newVal = internalSetPath(dataenv, op, path, localRoot[dynindex], setData, level+1, opts);
        localRoot[dynindex] = newVal;
        return localRoot;
    }
    else if (pp.pathtype == "map") {
        if (localRoot == null) {
            if (opts.nomap) {
                localRoot = {};
            }
            else {
                localRoot = new Map();
            }
        }
        if (typeof(localRoot) != "object") {
            throw new Error(sprintf("SetPath cannot resolve map key through non-object, path=%s, level=%d", StringPath(path), level));
        }
        if (localRoot instanceof LValue) {
            internalSetPath(dataenv, op, path, localRoot.subMapKey(pp.pathkey), setData, level+1, opts);
        }
        else if ((localRoot instanceof Map) || mobx.isObservableMap(localRoot)) {
            let newVal = internalSetPath(dataenv, op, path, localRoot.get(pp.pathkey), setData, level+1, opts);
            localRoot.set(pp.pathkey, newVal);
        }
        else {
            let newVal = internalSetPath(dataenv, op, path, localRoot[pp.pathkey], setData, level+1, opts);
            localRoot[pp.pathkey] = newVal;
        }
        return localRoot;
    }
    else {
        throw new Error(sprintf("Bad PathPart in SetPath, path=%s, level=%d", StringPath(path), level));
    }
    return null;
}

// function SetPath(path : PathUnionType, localRoot : any, setData : any, globalRoot? : any) : any {
function SetPath(path : PathUnionType, dataenv : DataEnvironment, setData : any) {
    try {
        SetPathThrow(path, dataenv, setData);
    }
    catch (e) {
        console.log("SetPath Error", StringPath(path), e);
    }
}

function SetPathThrow(pathUnion : PathUnionType, dataenv : DataEnvironment, setData : any) {
    let path : PathType = null;
    let op : string = "";
    if (typeof(pathUnion) == "string") {
        let spr = ParseSetPath(pathUnion);
        if (spr == null) {
            return;
        }
        path = spr.path;
        op = spr.op;
    }
    else {
        path = pathUnion;
        op = "set";
    }
    if (path == null) {
        return;
    }
    setPathWrapper(op, path, dataenv, setData, {allowContext: false});
}

function LValueMapReplacer(lvMap : any, key : string, value : any) : any {
    if (this[key] instanceof LValue) {
        let id = uuidv4();
        lvMap[id] = this[key];
        return {_type: "HibikiLValue", lvalueref: id};
    }
    return MapReplacer.bind(this)(key, value);
}

function MapReplacer(key : string, value : any) : any {
    if (this[key] instanceof Map) {
        let rtn = {};
        let m = this[key];
        for (let [k,v] of m) {
            rtn[k] = v;
        }
        return rtn;
    }
    else if (this[key] instanceof HibikiBlob) {
        let bloblen = 0;
        if (this[key].data != null) {
            bloblen = this[key].data.length;
        }
        return sprintf("[blob type=%s, len=%s]", this[key].mimetype, Math.ceil((bloblen/4)*3));
    }
    else if (this[key] instanceof LValue) {
        return this[key].get();
    }
    else if (this[key] instanceof DataEnvironment) {
        return "[DataEnvironment]";
    }
    else if (this[key] instanceof HibikiError) {
        return this[key].toString();
    }
    else if (this[key] instanceof HibikiRequest) {
        return "[HibikiRequest]";
    }
    else {
        return value;
    }
}

// does not copy blobs correctly
function DeepCopy(data : any) : any {
    return JSON.parse(JSON.stringify(data, MapReplacer));
}

function DeepEqual(data1 : any, data2 : any) : boolean {
    if (data1 == data2) {
        return true;
    }
    if (data1 instanceof LValue) {
        data1 = data1.get();
    }
    if (data2 instanceof LValue) {
        data2 = data2.get();
    }
    if (data1 == null || data2 == null) {
        return false;
    }
    if (typeof(data1) == "number" && typeof(data2) == "number") {
        if (isNaN(data1) && isNaN(data2)) {
            return true;
        }
        return false;
    }
    let d1arr = mobx.isArrayLike(data1);
    let d2arr = mobx.isArrayLike(data2);
    if (d1arr && d2arr) {
        if (data1.length != data2.length) {
            return false;
        }
        for (let i=0; i<data1.length; i++) {
            if (!DeepEqual(data1[i], data2[i])) {
                return false;
            }
        }
        return true;
    }
    if (d1arr || d2arr) {
        return false;
    }
    if (data1 instanceof HibikiBlob && data2 instanceof HibikiBlob) {
        return data1.mimetype == data2.mimetype && data1.data == data2.data;
    }
    if (data1 instanceof HibikiBlob || data2 instanceof HibikiBlob) {
        return false;
    }
    if (data1 instanceof DataEnvironment || data2 instanceof DataEnvironment) {
        return (data1 instanceof DataEnvironment) && (data2 instanceof DataEnvironment);
    }
    if (typeof(data1) != typeof(data2)) {
        return false;
    }
    if (typeof(data1) != "object" || typeof(data2) != "object") {
        return false;
    }
    if (data1._type == "HibikiNode" || data2._type == "HibikiNode") {
        return data1.uuid == data2.uuid;
    }
    // objects and maps...
    let d1map = (data1 instanceof Map || mobx.isObservableMap(data1));
    let d2map = (data2 instanceof Map || mobx.isObservableMap(data2));
    let d1keys = (d1map ? Array.from(data1.keys()) : Object.keys(data1));
    let d2keys = (d2map ? Array.from(data2.keys()) : Object.keys(data2));
    if (d1keys.length != d2keys.length) {
        return false;
    }
    for (let i=0; i<d1keys.length; i++) {
        let k1 : any = d1keys[i];
        let v1 = (d1map ? data1.get(k1) : data1[k1]);
        let v2 = (d2map ? data2.get(k1) : data2[k1]);
        if (!DeepEqual(v1, v2)) {
            return false;
        }
    }
    return true;
}

function demobxInternal(v : any) : [any, boolean] {
    if (v == null) {
        return [null, false];
    }
    if (typeof(v) == "object" && v[SYM_PROXY]) {
        return [v[SYM_FLATTEN], true];
    }
    if (mobx.isObservable(v)) {
        return [mobx.toJS(v), true];
    }
    if (Array.isArray(v)) {
        let rtn = [];
        let arrUpdated = false;
        for (let i=0; i<v.length; i++) {
            let [elem, updated] = demobxInternal(v[i]);
            if (updated) {
                arrUpdated = true;
            }
            rtn.push(elem);
        }
        if (arrUpdated) {
            return [rtn, true];
        }
        return [v, false];
    }
    if (typeof(v) != "object") {
        return [v, false];
    }
    if (v instanceof HibikiBlob || v instanceof LValue || v instanceof DataEnvironment || v._type == "HibikiNode") {
        return [v, false];
    }
    if (v instanceof Map) {
        let rtn = new Map();
        let mapUpdated = false;
        for (let [mapKey, mapVal] of v) {
            let [elem, updated] = demobxInternal(mapVal);
            if (updated) {
                mapUpdated = true;
            }
            rtn.set(mapKey, elem);
        }
        if (mapUpdated) {
            return [rtn, true];
        }
        return [v, false];
    }
    let objRtn = {};
    let objUpdated = false;
    for (let objKey in v) {
        let objVal = v[objKey];
        let [elem, updated] = demobxInternal(objVal);
        if (updated) {
            objUpdated = true;
        }
        objRtn[objKey] = elem;
    }
    if (objUpdated) {
        return [objRtn, true];
    }
    return [v, false];
}

function demobx(v : any) : any {
    let [rtn, updated] = demobxInternal(v);
    return rtn;
}

function JsonStringify(v : any, space? : number) : string {
    v = demobx(v);
    return JSON.stringify(v, MapReplacer, space);
}

function JsonStringifyForCall(lvMap : any, v : any, space? : number) : string {
    v = demobx(v);
    let rfn = function(key, val) {
        return LValueMapReplacer.bind(this)(lvMap, key, val);
    };
    return JSON.stringify(v, rfn, space);
}

function evalFnAst(fnAst : any, dataenv : DataEnvironment) : any {
    let state = dataenv.dbstate;
    let stateFn = state.JSFuncs[fnAst.fn.toLowerCase()];
    if (stateFn != null) {
        let elist = evalExprArray(fnAst.exprs, dataenv);
        if (!stateFn.native) {
            elist = demobx(elist);
        }
        return stateFn.fn(...elist);
    }
    else {
        throw new Error(sprintf("Invalid function: '%s'", fnAst.fn));
    }
}

function evalPath(path : PathType, dataenv : DataEnvironment) : any {
    let staticPath = [];
    for (let i=0; i<path.length; i++) {
        let pp = path[i];
        if (pp.pathtype == "dyn") {
            let e = evalExprAst(pp.expr, dataenv);
            if (typeof(e) == "number") {
                staticPath.push({pathtype: "array", pathindex: e});
            }
            else {
                staticPath.push({pathtype: "map", pathkey: String(e)});
            }
        }
        else if (pp.pathtype == "deref") {
            let e = evalExprAst(pp.expr, dataenv);
            if (e == null || typeof(e) != "string") {
                staticPath.push({pathtype: "root", pathkey: "null"});
                continue;
            }
            let newpath = ParsePathThrow(e);
            staticPath.push(...newpath);
        }
        else {
            staticPath.push(pp);
        }
    }
    return staticPath;
}

function evalExprArray(exprArray : HExpr[], dataenv : DataEnvironment) : any[] {
    if (exprArray == null || exprArray.length == 0) {
        return [];
    }
    let rtn = [];
    for (let i=0; i<exprArray.length; i++) {
        let expr = evalExprAst(exprArray[i], dataenv);
        rtn.push(expr);
    }
    return rtn;
}

function evalExprAst(exprAst : HExpr, dataenv : DataEnvironment) : any {
    if (exprAst == null) {
        return null;
    }
    if (exprAst.etype == "path") {
        let staticPath = evalPath(exprAst.path, dataenv);
        let val = internalResolvePath(staticPath, null, dataenv, 0);
        if (val instanceof LValue) {
            return val.get();
        }
        return val;
    }
    else if (exprAst.etype == "literal") {
        let val = exprAst.val;
        return val;
    }
    else if (exprAst.etype == "array") {
        let rtn = evalExprArray(exprAst.exprs, dataenv);
        return rtn;
    }
    else if (exprAst.etype == "array-range") {
        let e1 = parseInt(evalExprAst(exprAst.exprs[0], dataenv));
        let e2 = parseInt(evalExprAst(exprAst.exprs[1], dataenv));
        if (isNaN(e1) || isNaN(e2) || e1 > e2) {
            return [];
        }
        let rtn = [];
        for (let i=e1; i<=e2; i++) {
            rtn.push(i);
        }
        return rtn;
    }
    else if (exprAst.etype == "map") {
        let rtn = {};
        if (exprAst.exprs == null || exprAst.exprs.length == 0) {
            return rtn;
        }
        for (let i=0; i<exprAst.exprs.length; i++) {
            let k = evalExprAst(exprAst.exprs[i].key, dataenv);
            let v = evalExprAst(exprAst.exprs[i].valexpr, dataenv);
            rtn[k] = v;
        }
        return rtn;
    }
    else if (exprAst.etype == "ref") {
        let lv = new BoundLValue(exprAst.path, dataenv);
        return lv;
    }
    else if (exprAst.etype == "fn") {
        return evalFnAst(exprAst, dataenv);
    }
    else if (exprAst.etype == "filter") {
        let filter = exprAst.filter;
        if (filter == "format") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let args = evalExprAst(exprAst.exprs[1], dataenv);
            return formatFilter(e1, args);
        }
        else {
            throw new Error(sprintf("Invalid filter '%s' (only format is allowed)", exprAst.filter));
        }
    }
    else if (exprAst.etype == "op") {
        if (exprAst.op == "&&") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            if (!e1) {
                return e1;
            }
            return evalExprAst(exprAst.exprs[1], dataenv);
        }
        else if (exprAst.op == "||") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            if (!!e1) {
                return e1;
            }
            return evalExprAst(exprAst.exprs[1], dataenv);
        }
        else if (exprAst.op == "??") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            if (e1 != null) {
                return e1;
            }
            return evalExprAst(exprAst.exprs[1], dataenv);
        }
        else if (exprAst.op == "*") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? 0;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? 0;
            return e1 * e2;
        }
        else if (exprAst.op == "+") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? 0;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? 0;
            return e1 + e2;
        }
        else if (exprAst.op == "/") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? 0;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? 0;
            return e1 / e2;
        }
        else if (exprAst.op == "%") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? 0;
            let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? 0;
            return e1 % e2;
        }
        else if (exprAst.op == ">=") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let e2 = evalExprAst(exprAst.exprs[1], dataenv);
            return e1 >= e2;
        }
        else if (exprAst.op == "<=") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let e2 = evalExprAst(exprAst.exprs[1], dataenv);
            return e1 <= e2;
        }
        else if (exprAst.op == ">") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let e2 = evalExprAst(exprAst.exprs[1], dataenv);
            return e1 > e2;
        }
        else if (exprAst.op == "<") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let e2 = evalExprAst(exprAst.exprs[1], dataenv);
            return e1 < e2;
        }
        else if (exprAst.op == "==") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let e2 = evalExprAst(exprAst.exprs[1], dataenv);
            return e1 == e2;
        }
        else if (exprAst.op == "!=") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            let e2 = evalExprAst(exprAst.exprs[1], dataenv);
            return e1 != e2;
        }
        else if (exprAst.op == "!") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv);
            return !e1;
        }
        else if (exprAst.op == "-") {
            if (exprAst.exprs.length == 1) {
                let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? 0;
                return -e1;
            }
            else {
                let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? 0;
                let e2 = evalExprAst(exprAst.exprs[1], dataenv) ?? 0;
                console.log("minus", e1, e2);
                return e1 - e2;
            }
        }
        else if (exprAst.op == "+") {
            let e1 = evalExprAst(exprAst.exprs[0], dataenv) ?? 0;
            return +e1;
        }
        else if (exprAst.op == "?:") {
            let econd = evalExprAst(exprAst.exprs[0], dataenv);
            if (econd) {
                return evalExprAst(exprAst.exprs[1], dataenv);
            }
            else {
                return evalExprAst(exprAst.exprs[2], dataenv);
            }
        }
        else {
            throw new Error(sprintf("Invalid expression op type: '%s'", exprAst.op));
        }
    }
    else {
        throw new Error(sprintf("Invalid expression etype: '%s'", exprAst.etype));
    }
}

async function ExecuteHAction(action : HAction, dataenv : DataEnvironment, rtctx : RtContext) : Promise<any> {
    rtctx.pushContext(sprintf("%s action", action.type), null);
    if (action.type == "setdata") {
        let lvaluePath = evalAssignLVThrow(action.lvalue, dataenv);
        let expr = evalExprAst(action.data, dataenv);
        let setop = action.setop ?? "set";
        setPathWrapper(setop, lvaluePath, dataenv, expr, {allowContext: true});
        return null;
    }
    if (action.type == "if") {
        let condVal = evalExprAst(action.data, dataenv);
        let actions = action.actions ?? {};
        if (condVal) {
            rtctx.pushContext("then clause", null);
            await ExecuteHandlerBlock(actions["then"], dataenv, rtctx);
        }
        else {
            rtctx.pushContext("else clause", null);
            await ExecuteHandlerBlock(actions["else"], dataenv, rtctx);
        }
        return null;
    }
    if (action.type == "setreturn") {
        let val = evalExprAst(action.data, dataenv);
        return val;
    }
    if (action.type == "callhandler") {
        let callPath = evalExprAst(action.callpath, dataenv);
        let data = demobx(evalExprAst(action.data, dataenv));
        rtctx.replaceContext(sprintf("Calling handler %s", callPath), null);
        let pactions = dataenv.dbstate.callHandlerRtnBlock(callPath, data, false, {rtContext: rtctx, dataenv: dataenv});
        let actions = await pactions;
        let handlerEnv = dataenv.makeChildEnv(null, {blockLocalData: true});
        let rtnVal = await ExecuteHandlerBlock(actions, handlerEnv, rtctx);
        if (action.lvalue != null) {
            let lvaluePath = evalAssignLVThrow(action.lvalue, dataenv);
            let setop = action.setop ?? "set";
            setPathWrapper(setop, lvaluePath, dataenv, rtnVal, {allowContext: true});
        }
        return rtnVal;
    }
    if (action.type == "invalidate") {
        let ivVal = evalExprAst(action.data, dataenv);
        if (ivVal == null) {
            dataenv.dbstate.invalidateAll();
        }
        else {
            let ivArr = (mobx.isArrayLike(ivVal) ? ivVal : [ivVal]);
            for (let i=0; i<ivArr.length; i++) {
                let iv = ivArr[i];
                if (iv != null) {
                    dataenv.dbstate.invalidateRegex(String(iv));
                }
            }
        }
        return null;
    }
    if (action.type == "fire") {
        let eventStr = evalExprAst(action.event, dataenv);
        if (eventStr == null || eventStr == "") {
            return null;
        }
        let bubble = (action.subtype == "bubble");
        let datacontext = evalExprAst(action.data, dataenv);
        if (datacontext != null && !isObject(datacontext)) {
            datacontext = {value: datacontext};
        }
        let event = {event: eventStr, datacontext, bubble};
        let ehandler = dataenv.resolveEventHandler(event, true);
        if (ehandler == null) {
            if (bubble) {
                dataenv.dbstate.unhandledEvent(event, rtctx);
            }
            return null;
        }
        let htmlContext = sprintf("event%s(%s)", (event.bubble ? "-bubble" : ""), event.event);
        let eventEnv = ehandler.dataenv.makeChildEnv(event.datacontext, {htmlContext: htmlContext});
        let ctxStr = sprintf("Running %s:%s.handler (in [[%s]])", nodeStr(ehandler.node), event.event, ehandler.dataenv.getFullHtmlContext());
        rtctx.pushContext(ctxStr, {handlerEnv: eventEnv, handlerName: event.event});
        return ExecuteHandlerBlock(ehandler.handler, eventEnv, rtctx);
    }
    if (action.type == "log") {
    }
    if (action.type == "throw") {
    }
    if (action.type == "context") {
    }
    if (action.type == "nop") {
        return null;
    }
    return null;
}

async function ExecuteHandlerBlock(actions : HandlerBlock, dataenv : DataEnvironment, rtctx : RtContext) : Promise<any> {
    if (actions == null) {
        return null;
    }
    let actionArr : HAction[] = null;
    if ("hibikihandler" in actions) {
        let ctxstr = actions.ctxstr ?? "handler";
        rtctx.pushContext(sprintf("Parsing %s", ctxstr), null);
        let block = ParseBlockThrow(actions.hibikihandler);
        rtctx.popContext();
        // TODO set actionArr from block
        actionArr = [];
    }
    else if ("hibikiactions" in actions) {
        // TODO set actionArr from HibikiAction[]
        actionArr = [];
    }
    else {
        actionArr = actions;
    }
    let rtn = null;
    for (let i=0; i<actionArr.length; i++) {
        let action = actionArr[i];
        let actionRtn = await ExecuteHAction(action, dataenv, rtctx);
        if (action.type == "setreturn") {
            rtn = actionRtn;
        }
    }
    return rtn;
}

let ExecuteStmtRaw = function ExecuteStmtRaw(stmtAst : Statement, dataenv : DataEnvironment, rtctx : RtContext, opts : any) : Promise<any> {
    opts = opts || {};
    rtctx.pushContext(stmtAst.stmt + " stmt", null);
    if (stmtAst.stmt == "assign") {
        let lvaluePath = evalAssignLVThrow(stmtAst.lvalue, dataenv);
        let expr = evalExprAst(stmtAst.expr, dataenv);
        setPathWrapper((stmtAst.setop || "set"), lvaluePath, dataenv, expr, {allowContext: true});
        return null;
    }
    if (stmtAst.stmt == "if") {
        let condVal = evalExprAst(stmtAst.condExpr, dataenv);
        if (condVal) {
            rtctx.replaceContext("then clause", null);
            return ExecuteBlockPThrow(stmtAst.thenBlock, dataenv, rtctx);
        }
        else {
            if (stmtAst.elseBlock) {
                rtctx.replaceContext("else clause", null);
                return ExecuteBlockPThrow(stmtAst.elseBlock, dataenv, rtctx);
            }
        }
        return null;
    }
    if (opts.context) {
        if (stmtAst.stmt == "call") {
            throw new Error(sprintf("Cannot call a handler in a context block"));
        }
        throw new Error(sprintf("Invalid statement/operation for context block, only conditionals and assignment is allowed"));
    }
    if (stmtAst.stmt == "call") {
        let handler = evalExprAst(stmtAst.handler, dataenv);
        let data = null;
        if (stmtAst.data != null) {
            data = evalExprAst(stmtAst.data, dataenv);
            data = demobx(data);
        }
        rtctx.replaceContext(sprintf("Calling handler %s", handler), null);
        let p = dataenv.dbstate.callHandlerInternalAsync(handler, data, false, {rtContext: rtctx, dataenv: dataenv});
        if (stmtAst.lvalue) {
            let lvaluePath = evalAssignLVThrow(stmtAst.lvalue, dataenv);
            return p.then((rtnVal) => {
                setPathWrapper((stmtAst.setop || "set"), lvaluePath, dataenv, rtnVal, {allowContext: true});
                return null;
            });
        }
        else {
            return p;
        }
    }
    if (stmtAst.stmt == "invalidate") {
        if (stmtAst.expr == null) {
            dataenv.dbstate.invalidateAll();
            return null;
        }
        let exprs = evalExprArray(stmtAst.exprs, dataenv);
        console.log("invalidate-stmt", exprs);
        for (let i=0; i<exprs.length; i++) {
            let iexpr = String(exprs[i]);
            dataenv.dbstate.invalidateRegex(iexpr);
        }
        return null;
    }
    if (stmtAst.stmt == "bubble" || stmtAst.stmt == "fire") {
        let event = evalExprAst(stmtAst.event, dataenv);
        if (event == null || event == "") {
            return null;
        }
        let context = null;
        if (stmtAst.context != null) {
            context = evalExprAst(stmtAst.context, dataenv);
        }
        if (context != null && !isObject(context)) {
            context = {value: context};
        }
        let bubble = (stmtAst.stmt == "bubble");
        let eventDE = dataenv.getParentEventBoundary("*");
        if (eventDE == null) {
            dataenv.dbstate.unhandledEvent({event: event, datacontext: context, bubble: bubble}, rtctx);
            return null;
        }
        rtctx.replaceContext(sprintf("%s->%s", (bubble ? "bubble" : "fire"), event), null);
        return eventDE.fireEvent({event: event, bubble: bubble, datacontext: context}, rtctx);
    }
    if (stmtAst.stmt == "log" || stmtAst.stmt == "debug") {
        let exprs = demobx(evalExprArray(stmtAst.exprs, dataenv));
        exprs = exprs.map((expr) => {
            if (expr instanceof HibikiError) {
                return expr.toString();
            }
            return expr;
        });
        console.log("hibiki-log", ...exprs);
        if (stmtAst.stmt == "debug") {
            console.log("DataEnvironment Stack");
            dataenv.printStack();
            console.log("Runtime Context", rtctx);
            console.log(rtctx.asString());
        }
        return null;
    }
    if (stmtAst.stmt == "alert") {
        let exprs = demobx(evalExprArray(stmtAst.exprs, dataenv));
        alert(...exprs);
        return null;
    }
    if (stmtAst.stmt == "expr") {
        let e1 = evalExprAst(stmtAst.expr, dataenv);
        return null;
    }
    if (stmtAst.stmt == "reporterror") {
        let expr = evalExprAst(stmtAst.expr, dataenv);
        if (expr == null) {
            return null;
        }
        if (typeof(expr) == "string") {
            dataenv.dbstate.reportError(expr);
            return null;
        }
        if (typeof(expr) != "object") {
            throw new Error(sprintf("Invalid value passed to reportError, must be string or error object"));
        }
        if (expr._type == "HibikiError") {
            dataenv.dbstate.reportErrorObj(expr as HibikiError);
            return null;
        }
        else {
            let message = expr.toString();
            dataenv.dbstate.reportError(message);
            return null;
        }
    }
    if (stmtAst.stmt == "throw") {
        let e1 = evalExprAst(stmtAst.expr, dataenv);
        return Promise.reject(new Error(e1));
    }
    if (stmtAst.stmt == "nop") {
        return null;
    }
    
    throw new Error(sprintf("Invalid statement type: '%s'", stmtAst.stmt));
    return null;
}

let ExecuteStmt = mobx.action(ExecuteStmtRaw);

function ParseAndExecuteBlock(blockStr : string, errorHandler : ({blockStr : string, contextStr : string} | null), dataenv : DataEnvironment, rtContextUnion : string | RtContext) : Promise<any> {
    if (blockStr == null || blockStr == "" || blockStr == "1") {
        return null;
    }
    let rtctx : RtContext = null;
    if (rtContextUnion instanceof RtContext) {
        rtctx = rtContextUnion;
    }
    else {
        rtctx = new RtContext();
        rtctx.pushContext(rtContextUnion, null);
    }
    let block : StmtBlock = null;
    let errorBlock : StmtBlock = null;
    let errorContext : string = null;
    try {
        block = ParseBlockThrow(blockStr);
        if (block == null) {
            return null;
        }
        if (errorHandler != null) {
            errorBlock = ParseBlockThrow(errorHandler.blockStr);
            errorContext = errorHandler.contextStr;
        }
    }
    catch (e) {
        let msg = sprintf("Error parsing block: %s", e);
        let errObj = new HibikiError(msg, e, rtctx, blockStr);
        dataenv.dbstate.reportErrorObj(errObj);
        return null;
    }
    return ExecuteBlock({block: block, catchBlock: errorBlock, contextStr: errorContext}, dataenv, rtctx);
}

function makeErrorObj(e : any, rtctx : RtContext) : DataCtxErrorObjType {
    let message = "Error";
    if (e != null) {
        message = e.toString();
    }
    let rtnErr = new HibikiError(message, e, rtctx);
    window.HibikiLastError = rtnErr;
    return rtnErr;
}

async function ExecuteBlockPThrow(block : StmtBlock, dataenv : DataEnvironment, rtctx : RtContext) {
    let markPoint = rtctx.stackSize();
    for (let i=0; i<block.length; i++) {
        rtctx.revertStack(markPoint);
        let prtn = ExecuteStmt(block[i], dataenv, rtctx, null);
        if (prtn != null) {
            await prtn;
        }
    }
    return;
}

async function ParseAsync(blockStr : string) : Promise<StmtBlock> {
    return ParseBlockThrow(blockStr);
}

function ExecuteBlockP(block : TCFBlock, dataenv : DataEnvironment, rtctx : RtContext, topLevelCatch : boolean) : Promise<any> {
    let prtn = ExecuteBlockPThrow(block.block, dataenv, rtctx);
    if (block.catchBlock != null) {
        prtn = prtn.catch((e) => {
            let errorObj = makeErrorObj(e, rtctx);
            let htmlContext = "catch-block";
            let errorEnv = dataenv.makeChildEnv({error: errorObj}, {htmlContext: htmlContext});
            rtctx.pushContext(block.contextStr || "error handler", {handlerEnv: errorEnv, handlerName: "error"});
            let ep = ExecuteBlockPThrow(block.catchBlock, errorEnv, rtctx);
            return ep;
        });
    }
    else {
        if (rtctx.stack.length > 20) {
            return prtn;
        }
        let hctx = rtctx.getTopHandlerContext();
        if (hctx != null) {
            let handlerEnv = hctx.handlerEnv;
            if (hctx.handlerName == "error") {
                handlerEnv = handlerEnv.getParentEventBoundary("*");
            }
            else {
                handlerEnv = handlerEnv.getEventBoundary("*");
            }
            prtn = prtn.catch((e) => {
                rtctx.pushErrorContext(e);
                let errorObj = makeErrorObj(e, rtctx);
                handlerEnv.fireEvent({event: "error", bubble: true, datacontext: {error: errorObj}}, rtctx);
            });
        }
    }
    if (topLevelCatch) {
        prtn = prtn.catch((e) => {
            let errObj = new HibikiError(e.toString(), e, rtctx);
            dataenv.dbstate.reportErrorObj(errObj);
        });
    }
    return prtn;
}

function ExecuteBlock(block : TCFBlock, dataenv : DataEnvironment, rtctx : RtContext) : Promise<any> {
    return mobx.action(() => {
        return ExecuteBlockP(block, dataenv, rtctx, true);
    })();
}

function CreateContextThrow(block : any,  dataenv : DataEnvironment, rtContext? : string) : any {
    if (rtContext == null) {
        rtContext = "context";
    }
    let rtctx = new RtContext();
    rtctx.pushContext(rtContext, null);
    for (let i=0; i<block.length; i++) {
        let stmt = block[i];
        ExecuteStmtRaw(stmt, dataenv, rtctx, {context: true});
    }
    return dataenv.specials;
}

function ParseAndCreateContextThrow(ctxStr : string, dataenv : DataEnvironment, htmlContext : string) : DataEnvironment {
    let ctxDataenv = dataenv.makeChildEnv({}, {htmlContext: htmlContext});
    let block = ParseBlockThrow(ctxStr);
    CreateContextThrow(block, ctxDataenv, htmlContext);
    return ctxDataenv;
}

// function EvalSimpleExpr(exprStr : string, localRoot : any, globalRoot : any, specials? : any) : any {
function EvalSimpleExpr(exprStr : string, dataenv : DataEnvironment, rtContext? : string) : any {
    if (exprStr == null || exprStr == "") {
        return null;
    }
    try {
        let exprParser = new nearley.Parser(nearley.Grammar.fromCompiled(hibikiGrammar, "fullExpr"));
        exprParser.feed(exprStr);
        if (exprParser.results == null || exprParser.results.length == 0) {
            throw new Error("Error parsing expression, unterminated expression: + " + exprStr);
        }
        if (exprParser.results.length > 1) {
            console.log("ambiguious result", exprParser.results);
        }
        let exprAst = exprParser.results[0];
        // console.log("eval-simple-expr", exprStr, exprAst);
        let val = evalExprAst(exprAst, dataenv);
        return val;
    }
    catch (e) {
        let emsg = getShortEMsg(e);
        console.log("ERROR evaluating expression", "[[", exprStr, "]]", emsg, rtContext);
        return null;
    }
}

function ApplySingleRRA(dataenv : DataEnvironment, rra : any) {
    let selector = rra.selector ?? rra.path;
    if (rra.type == "setdata") {
        SetPath(selector, dataenv, rra.data);
    }
    else if (rra.type == "blob") {
        let blob = BlobFromRRA(rra);
        SetPath(selector, dataenv, blob);
    }
    else if (rra.type == "blobext") {
        SetPath("blobext:" + selector, dataenv, rra.blobbase64);
    }
}

function BlobFromBlob(blob : Blob) : Promise<HibikiBlob> {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.onloadend = () => {
            let mimetype = blob.type;
            let semiIdx = (reader.result as string).indexOf(";");
            if (semiIdx == -1 || mimetype == null || mimetype == "") {
                reject(new Error("Invalid BLOB returned from fetch, bad mimetype or encoding"));
                return;
            }
            let dbblob = new HibikiBlob();
            dbblob.mimetype = blob.type;
            // extra 7 bytes for "base64," ... e.g. data:image/jpeg;base64,[base64data]
            dbblob.data = (reader.result as string).substr(semiIdx+1+7);
            resolve(dbblob);
        };
        reader.readAsDataURL(blob);
    });
}

function BlobFromRRA(rra : any) : HibikiBlob {
    if (rra.type != "blob") {
        return null;
    }
    let blob = new HibikiBlob();
    blob.mimetype = rra.blobmimetype;
    blob.data = rra.blobbase64;
    return blob;
}

function ExtBlobFromRRA(blob : HibikiBlob, rra : any) {
    if (blob == null) {
        throw new Error(sprintf("Cannot extend null HibikiBlob"));
    }
    blob.data += rra.blobbase64;
}

function blobExtDataPath(path : PathType, curData : any, newData : any) : any {
    if (curData == null || !(curData instanceof HibikiBlob)) {
        throw new Error(sprintf("SetPath cannot blobext a non-blob, path=%s, typeof=%s", StringPath(path), typeof(curData)));
    }
    curData.data += newData;
    return curData;
}

function JsonEqual(v1 : any, v2 : any) : boolean {
    if (v1 === v2) {
        return true;
    }
    return JsonStringify(v1) == JsonStringify(v2);
}

function ParseStaticCallStatement(str : string) : Statement {
    let g = nearley.Grammar.fromCompiled(hibikiGrammar);
    g.ParserStart = g.start = "staticCallStatement";
    let parser = new nearley.Parser(g);
    try {
        parser.feed(str);
    }
    catch (e) {
        let emsg = getShortEMsg(e);
        throw new Error(emsg);
    }
    if (parser.results == null || parser.results.length == null) {
        throw new Error("Error parsing staticCallStatement, unterminated expr");
    }
    let callStmt = parser.results[0];
    if (parser.results.length > 1) {
        console.log("Ambiguous parse of staticCallStatement: ", str, parser.results);
    }
    return callStmt;
}

function ParseLValuePathThrow(str : string, dataenv : DataEnvironment) {
    let g = nearley.Grammar.fromCompiled(hibikiGrammar);
    g.ParserStart = g.start = "lvaluePath";
    let parser = new nearley.Parser(g);
    try {
        parser.feed(str);
    }
    catch (e) {
        let emsg = getShortEMsg(e);
        throw new Error(emsg);
    }
    if (parser.results == null || parser.results.length == null) {
        throw new Error("Error parsing lvalue, unterminated expr");
    }
    let lvalue = parser.results[0];
    if (parser.results.length > 1) {
        console.log("Ambiguous parse of lvalue: ", str, parser.results);
    }
    return new BoundLValue(lvalue.path, dataenv);
}

function ParseLValuePath(str : string, dataenv : DataEnvironment) {
    try {
        return ParseLValuePathThrow(str, dataenv);
    }
    catch (e) {
        console.log("ERROR during ParseLValuePath [[" + str + "]]", e);
        return null;
    }
}

function evalAssignLVThrow(lvalue : PathType, dataenv : DataEnvironment) {
    let lvaluePath = evalPath(lvalue, dataenv);
    if (lvaluePath == null || lvaluePath.length == 0) {
        throw new Error(sprintf("Invalid lvalue-path in assignment (no terms)"));
    }
    let rootpp = lvaluePath[0];
    if (rootpp.pathtype != "root") {
        throw new Error(sprintf("Invalid lvalue-path type %s", rootpp.pathtype));
    }
    return lvaluePath;
}

function convertSimpleType(typeName : string, value : string, defaultValue : any) : any {
    if (typeName == "string") {
        return value;
    }
    if (typeName == "int") {
        let rtn = parseInt(value);
        if (isNaN(rtn)) {
            return defaultValue;
        }
        return rtn;
    }
    if (typeName == "float") {
        let rtn = parseFloat(value);
        if (isNaN(rtn)) {
            return defaultValue;
        }
        return rtn;
    }
    return value;
}

export {ParsePath, ResolvePath, SetPath, ParsePathThrow, ResolvePathThrow, SetPathThrow, StringPath, DeepCopy, MapReplacer, JsonStringify, EvalSimpleExpr, ApplySingleRRA, JsonEqual, ParseSetPathThrow, ParseSetPath, HibikiBlob, ParseBlock, ParseBlockThrow, ExecuteBlock, CreateContextThrow, ParseAndExecuteBlock, ObjectSetPath, DeepEqual, BoundValue, ParseLValuePath, ParseLValuePathThrow, LValue, BoundLValue, ObjectLValue, ReadOnlyLValue, getShortEMsg, CreateReadOnlyLValue, JsonStringifyForCall, demobx, BlobFromRRA, ExtBlobFromRRA, isObject, convertSimpleType, ParseStaticCallStatement, evalExprAst, ParseAndCreateContextThrow, ExecuteBlockP, ParseAsync, ExecuteBlockPThrow, BlobFromBlob, formatVal};

export type {PathType, TCFBlock, HandlerBlock};






