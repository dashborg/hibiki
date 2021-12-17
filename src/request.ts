// Copyright 2021 Dashborg Inc

import type {RtContext} from "./error";
import type {HibikiAction, HibikiExtState, HandlerPathType} from "./types";

class HibikiRequest {
    callpath : HandlerPathType;
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

    setData(setpath : string, data : any) {
        this.actions.push({
            actiontype: "setdata",
            setpath: setpath,
            data: data,
        });
    }

    invalidate(...regexArr : string[]) {
        if (regexArr == null || regexArr.length == 0) {
            this.actions.push({actiontype: "invalidate"});
        }
        else {
            this.actions.push({
                actiontype: "invalidate",
                data: regexArr,
            });
        }
    }

    setHtml(html : string) {
        this.actions.push({
            actiontype: "html",
            data: html,
        });
    }

    setReturn(rtnVal : any) {
        this.actions.push({
            actiontype: "setreturn",
            data: rtnVal,
        });
    }
}

export {HibikiRequest};
