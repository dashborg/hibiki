// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {v4 as uuidv4} from 'uuid';
import type {DataEnvironment} from "./state";
import {sprintf} from "sprintf-js";
import type {HibikiNode} from "./html-parser";
import {HibikiWrappedObj} from "./utils";
import type {HibikiVal} from "./types";

type RtContextItem = {
    desc : string,
    handlerName? : string,
    handlerEnv? : DataEnvironment,
    handlerNode? : HibikiNode,
};

type RtContextOpts = {
    handlerName? : string,
    handlerEnv? : DataEnvironment,
    handlerNode? : HibikiNode,
};

function rtItemAsString(rtci : RtContextItem) : string {
    // if (rtci.handlerName != null && rtci.handlerEnv != null) {
    //     return sprintf("[%s %s] %s", rtci.handlerName, rtci.handlerEnv.getFullHtmlContext(), rtci.desc);
    // }
    return rtci.desc;
}

class RtContext {
    rtid : string;
    actionCounter : number;
    stack : RtContextItem[];

    constructor() {
        this.rtid = uuidv4();
        this.actionCounter = 0;
        this.stack = [];
    }

    replaceContext(desc : string, opts : RtContextOpts) {
        opts = opts || {};
        this.stack[this.stack.length-1] = {desc: desc, handlerName: opts.handlerName, handlerEnv: opts.handlerEnv, handlerNode : opts.handlerNode};
    }

    copy() : RtContext {
        let rtn = new RtContext();
        rtn.stack = [...this.stack];
        rtn.actionCounter = this.actionCounter;
        return rtn;
    }

    getTopHandlerContext() : RtContextItem {
        for (let i=this.stack.length-1; i>=0; i--) {
            let item = this.stack[i];
            if (item.handlerName != null && item.handlerEnv != null) {
                return item;
            }
        }
        return null;
    }

    isRunningErrorHandler() : boolean {
        for (let item of this.stack) {
            if (item.handlerName === "error") {
                return true;
            }
        }
        return false;
    }

    isHandlerInStack(env : DataEnvironment, handlerName : string) : boolean {
        for (let i=this.stack.length-1; i>=0; i--) {
            let item = this.stack[i];
            if (item.handlerEnv == null) {
                continue;
            }
            if (item.handlerEnv == env && item.handlerName == handlerName) {
                return true;
            }
        }
        return false;
    }

    getLastContext() : string {
        if (this.stack.length == 0) {
            return null;
        }
        return this.stack[this.stack.length-1].desc;
    }

    pushContext(desc : string, opts : RtContextOpts) {
        opts = opts || {};
        this.stack.push({desc: desc, handlerName: opts.handlerName, handlerEnv: opts.handlerEnv, handlerNode: opts.handlerNode});
    }

    pushErrorContext(err : any) {
        let emsg = err.toString();
        emsg = emsg.replace(/\n/g, "\\n");
        if (emsg.length > 80) {
            emsg = emsg.substr(0, 77) + "...";
        }
        this.pushContext(sprintf("Throwing error: <<%s>>", emsg), null);
    }

    popContext() {
        if (this.stack.length == 0) {
            return;
        }
        this.stack.pop();
    }

    asString(indentStr? : string) : string {
        let st = this.getStackTrace();
        if (indentStr != null) {
            st = st.map((s) => indentStr + s);
        }
        return st.join("\n");
    }

    getStackTrace() : string[] {
        return this.stack.slice().reverse().map((ctx) => rtItemAsString(ctx));
    }

    stackSize() : number {
        return this.stack.length;
    }

    revertStack(size : number) {
        if (size < this.stack.length) {
            this.stack.length = size;
        }
    }

    makeCopy() : RtContext {
        let rtn = new RtContext();
        rtn.stack = this.stack.slice();
        return rtn;
    }
}

const ERROR_ALLOWED_GETTERS : Record<string, boolean> = {
    "event": true,
    "node": true,
    "context": true,
    "stack": true,
    "jsstack": true,
    "message": true,
    "type": true,
    "data": true,
};

class HibikiError extends HibikiWrappedObj {
    _type : "HibikiError";
    message : string;
    rtctx : RtContext;
    err : any;
    errorType : string;
    errorData : HibikiVal;
    
    constructor(msg : string, err? : any, rtctx? : RtContext) {
        super();
        this._type = "HibikiError";
        this.errorType = "base";
        this.message = msg;
        this.err = err;
        if (rtctx != null) {
            this.rtctx = rtctx.copy();
        }
        this.errorData = null;
        if (this.err != null && this.err instanceof Error) {
            if (this.err["hibikiErrorType"] != null) {
                this.errorType = this.err["hibikiErrorType"];
            }
            if (this.err["hibikiErrorData"] != null) {
                this.errorData = this.err["hibikiErrorData"];
            }
        }
    }

    allowedGetters() : string[] {
        return Object.keys(ERROR_ALLOWED_GETTERS);
    }

    isAllowedGetter(key : string) : boolean {
        return ERROR_ALLOWED_GETTERS[key];
    }

    get type() : string {
        return this.errorType;
    }

    get data() : HibikiVal {
        return this.errorData;
    }

    get event() : string {
        if (this.rtctx == null) {
            return null;
        }
        let rtitem = this.rtctx.getTopHandlerContext();
        if (rtitem == null) {
            return null;
        }
        return rtitem.handlerName;
    }

    get node() : HibikiNode {
        if (this.rtctx == null) {
            return null;
        }
        let rtitem = this.rtctx.getTopHandlerContext();
        if (rtitem == null) {
            return null;
        }
        return rtitem.handlerNode;
    }

    get context() : string {
        return this.rtctx.asString();
    }

    get stack() : string {
        let errStr = sprintf("Hibiki Error (%s) | %s\n", this.errorType, this.message);
        if (this.rtctx != null) {
            errStr += this.rtctx.asString("> ") + "\n";
        }
        return errStr;
    }

    get jsstack() : string {
        return this.toString();
    }

    toString() : string {
        let errStr = this.stack;
        if (this.err != null && this.err.stack != null) {
            errStr += "\nJavaScript Error: " + this.err.stack + "\n";
        }
        return errStr;
    }

    asString() : string {
        let emsg = this.message;
        emsg = emsg.replace(/\n/g, "\\n");
        if (emsg.length > 80) {
            emsg = emsg.substr(0, 77) + "...";
        }
        return sprintf("[error:%s]", emsg);
    }

    hibikiTypeOf() : string {
        return "hibiki:error";
    }
}

function getShortEMsg(err : any) {
    let emsg = err.toString();
    emsg = emsg.replace(/ Instead, I was(.|\n)*/, "");
    return emsg;
}

export {RtContext, getShortEMsg, HibikiError};
