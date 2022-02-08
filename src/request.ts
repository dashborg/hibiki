// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {v4 as uuidv4} from 'uuid';
import type {RtContext} from "./error";
import type {HibikiAction, HibikiExtState, HandlerPathType, HibikiValObj} from "./types";
import type {DataEnvironment} from "./state";

class HibikiRequest {
    reqid : string;
    callpath : HandlerPathType;
    data : HibikiValObj;
    rtContext : RtContext;
    state : HibikiExtState;
    dataenv : DataEnvironment;
    pure : boolean;
    actions : HibikiAction[];
    libContext : string;

    constructor(state : HibikiExtState, dataenv : DataEnvironment) {
        this.reqid = uuidv4();
        this.state = state;
        this.dataenv = dataenv;
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
