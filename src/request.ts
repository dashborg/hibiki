// Copyright 2021 Dashborg Inc

import type {RtContext} from "./error";
import type {HibikiAction, HibikiExtState, HandlerPathType} from "./types";

class HibikiRequest {
    path : HandlerPathType;
    data : Record<string, any>;
    rtContext : RtContext;
    state : HibikiExtState;
    pure : boolean;
    actions : HibikiAction[];
    libContext : string;

    constructor(state : HibikiExtState) {
        this.state = state;
        this.actions = [];
    }

    setData(path : string, data : any) {
        this.actions.push({
            type: "setdata",
            ts: Date.now(),
            selector: path,
            data: data,
        });
    }

    invalidate(regex? : string) {
        this.actions.push({
            type: "invalidate",
            ts: Date.now(),
            selector: regex,
        });
    }

    setHtml(html : string) {
        this.actions.push({
            type: "html",
            ts: Date.now(),
            data: html,
        });
    }

    setReturn(rtnVal : any) {
        this.actions.push({
            type: "setreturn",
            ts: Date.now(),
            data: rtnVal,
        });
    }
}

export {HibikiRequest};
