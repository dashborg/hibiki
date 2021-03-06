// Copyright 2021-2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import nearley from "nearley";
import hibikiGrammar from "./hibiki-grammar.js";
import {sprintf} from "sprintf-js";
import {getShortEMsg} from "./error";

function doParse(str : string, nonTerm : string) : any {
    let nonTermLogStr = nonTerm.replace("ext_", "");
    let g = nearley.Grammar.fromCompiled(hibikiGrammar);
    g.ParserStart = g.start = nonTerm;
    let parser = new nearley.Parser(g);
    try {
        parser.feed(str);
    }
    catch (e) {
        let emsg = getShortEMsg(e);
        throw new Error(emsg);
    }
    if (parser.results == null || parser.results.length == null || parser.results.length == 0) {
        throw new Error(sprintf("Error parsing %s, unterminated expr", nonTermLogStr));
    }
    if (parser.results.length > 1) {
        console.log(sprintf("Ambiguous parse of %s: ", nonTermLogStr), str, parser.results);
    }
    let parseResult = parser.results[0];
    return parseResult;
}

export {doParse};
