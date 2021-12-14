# Copyright 2021 Dashborg Inc

@{%

let moo = require("moo");

let ESCAPES = {
    "n": "\n",
    "b": "\b",
    "f": "\f",
    "r": "\r",
    "t": "\t",
    "v": "\v",
};

function strEscValue(val) {
    let ch = val[1];
    if (ESCAPES[ch]) {
        return ESCAPES[ch];
    }
    return ch;
}

let lexer = moo.states({
    main: {
        CALLPATH: { match: /(?:(?:(?:\/@[a-zA-Z_][a-zA-Z0-9_-]*)?\/[a-zA-Z0-9._\/-]+|\/@[a-zA-Z_][a-zA-Z0-9_-]*\/?)(?::@?[a-zA-Z][a-zA-Z0-9_-]*)?)/ },
        LOGICAL_OR:  "||",
        LOGICAL_AND: "&&",
        GEQ:         ">=",
        LEQ:         "<=",
        EQEQ:        "==",
        BANGEQ:      "!=",
        QQ:          "??",
        DOTDOT:      "..",
        DASHGT:      "->",
        LT:          "<",
        GT:          ">",
        DOLLAR:   "$",
        ATID:     { match: /@[a-zA-Z][a-zA-Z_0-9]*/, value: (v) => v.substr(1) },
        ATSIGN:   "@",
        FN:       { match: /fn:[a-zA-Z_][a-zA-Z_0-9]*/, value: (v) => v.substr(3) },
        ID:       { match: /[a-zA-Z_][a-zA-Z_0-9]*/,
                    type: moo.keywords({
                        KW_TRUE: "true",
                        KW_FALSE: "false",
                        KW_NULL: "null",
                        KW_CALL: "call",
                        KW_SETRETURN: "setreturn",
                        KW_INVALIDATE: "invalidate",
                        KW_FIRE: "fire",
                        KW_NOP: "nop",
                        KW_BUBBLE: "bubble",
                        KW_LOG: "log",
                        KW_DEBUG: "debug",
                        KW_ALERT: "alert",
                        KW_EXPR: "expr",
                        KW_LOCAL: "local",
                        KW_IF: "if",
                        KW_ELSE: "else",
                        KW_THROW: "throw",
                        KW_REF: "ref",
                        KW_REPORTERROR: "reportError",
                        KW_SWITCHAPP: "switchapp",
                        KW_PUSHAPP: "pushapp",
                        KW_POPAPP: "popapp",
                        KW_NAVTO: "navto",
                    }),
                  },
        LBRACK:   "[",
        RBRACK:   "]",
        LPAREN:   "(",
        RPAREN:   ")",
        LBRACE:   "{",
        RBRACE:   "}",
        COLON:    ":",
        COMMA:    ",",
        STAR:     "*",
        DOUBLE_STAR: "**",
        CARET:    "^",
        SLASH:    "/",
        PERCENT:  "%",
        BANG:     "!",
        QUESTION: "?",
        PLUS:     "+",
        DASH:     "-",
        HASH:     "#",
        SEMI:     ";",
        EQUAL:    "=",
        PIPE:     "|",
        JSNUM:       { match: /[0-9]*\.?[0-9]+/, value: (v) => parseFloat(v) },
        DOT:      ".",
        STRSTART_DQ: {match: "\"", push: "dqstring"},
        STRSTART_SQ: {match: "'", push: "sqstring"},
        WS:          { match: /\s+/, lineBreaks: true },
    },
    dqstring: {
        STRPART: /[^"\\\n]+/,   // "
        STRESC:  {match: /\\./, value: strEscValue},
        STREND:  {match: "\"", pop: 1},
    },
    sqstring: {
        STRPART: /[^'\n]+/,
        STREND: {match: "'", pop: 1},
    },
});

let origNext = lexer.next.bind(lexer);
lexer.next = () => {
    while (true) {
        let tok = origNext();
        if (tok && tok.type == "WS") {
            continue;
        }
        return tok;
    }
}

%}

@lexer lexer

fullExpr -> filterExpr {% id %}

# returns HAction[]
statementBlock -> statement (%SEMI statement):* %SEMI:?  {% (data) => {
        let rtn = [data[0]];
        if (data[1] != null && data[1].length > 0) {
            for (let i=0; i<data[1].length; i++) {
                let spart = data[1][i];
                rtn.push(spart[1]);
            }
        }
        return rtn;
    } %}

# returns HAction
statement ->
      callStatement         {% id %}
    | assignmentStatement   {% id %}
    | invalidateStatement   {% id %}
    | fireStatement         {% id %}
    | bubbleStatement       {% id %}
    | logStatement          {% id %}
    | debugStatement        {% id %}
    | alertStatement        {% id %}
    | exprStatement         {% id %}
    | ifStatement           {% id %}
    | throwStatement        {% id %}
    | setReturnStatement    {% id %}
    | nopStatement          {% id %}

throwStatement -> %KW_THROW callParamsSingle {% (data) => ({actiontype: "throw", data: data[1]}) %}

setReturnStatement -> %KW_SETRETURN fullExpr {% (data) => ({actiontype: "setreturn", data: data[1]}) %}

ifStatement -> %KW_IF %LPAREN fullExpr %RPAREN %LBRACE statementBlock %RBRACE (%KW_ELSE %LBRACE statementBlock %RBRACE):? {% (data) => {
        let rtn = {actiontype: "if", data: data[2], actions: {}};
        rtn.actions["then"] = data[5];
        if (data[7] != null) {
            rtn.actions["else"] = data[7][2];
        }
        return rtn;
    } %}

callStatement -> (lvalue %EQUAL):? callStatementNoAssign {% (data) => {
        if (data[0]) {
            let lvalueArr = data[0][0];
            data[1].setpath = lvalueArr[1];
            data[1].setop = lvalueArr[0];
        }
        return data[1];
    } %}

callStatementNoAssign ->
      staticCallStatement  {% id %}
    | dynCallStatement     {% id %}

dynCallStatement -> %KW_CALL fullExpr namedCallParams {% (data) => {
          return {actiontype: "callhandler", callpath: data[1], data: data[2]};
      } %}

staticCallStatement -> %CALLPATH namedCallParams {% (data) => {
          let callpath = {etype: "literal", val: data[0].value};
          let rtn = {actiontype: "callhandler", callpath: callpath, data: data[1]};
          return rtn;
      } %}

contextAssignKey ->
      idOrKeyword {% (data) => data[0].value %}
    | stringLit   {% (data) => data[0] %}
    | %ATID       {% (data) => data[0].value %}

contextAssignPart -> contextAssignKey %EQUAL fullExpr {% (data) => {
          return {key: data[0], expr: data[2]};
    } %}

commaOrSemi -> %COMMA | %SEMI

# {key, expr}[]
contextAssignList -> contextAssignPart (commaOrSemi contextAssignPart):* commaOrSemi:? {% (data) => {
          let rtn = [data[0]];
          rtn.push(...data[1].map((v) => v[1]));
          return rtn;
    } %}

namedParamKey -> 
      idOrKeyword {% (data) => ({etype: "literal", val: data[0].value}) %}
    | stringLit   {% (data) => ({etype: "literal", val: data[0]}) %}
    | %ATID       {% (data) => ({etype: "literal", val: "@" + data[0].value}) %}
    | %LPAREN fullExpr %RPAREN {% (data) => data[1] %}

namedParamPart -> namedParamKey %EQUAL fullExpr {% (data) => {
          return {etype: "kv", key: data[0], valexpr: data[2]};
      } %}

namedParamList -> namedParamPart (%COMMA namedParamPart):*   {% (data) => {
          let kwExprs = [];
          kwExprs.push(data[0]);
          kwExprs.push(...data[1].map((v) => v[1]));
          return {etype: "map", exprs: kwExprs};
      } %}

namedCallParams -> 
      null                   {% (data) => { return null; } %}
    | %LPAREN %RPAREN        {% (data) => { return null; } %}
    | %LPAREN literalArrayElements %RPAREN {% (data) => {
          let arrData = {etype: "array", exprs: data[1]};
          let argsExpr = {etype: "kv", key: {etype: "literal", val: "*args"}, valexpr: arrData};
          let mapData = {etype: "map", exprs: [argsExpr]};
          return mapData;
      } %}
    | %LPAREN namedParamList %RPAREN {% (data) => { return data[1]; } %}
    | %LPAREN literalArrayElementsNoComma %COMMA namedParamList %RPAREN {% (data) => {
          let arrData = {etype: "array", exprs: data[1]};
          let mapData = data[3];
          let argsExpr = {etype: "kv", key: {etype: "literal", val: "*args"}, valexpr: arrData};
          mapData.exprs.push(argsExpr);
          return mapData;
      } %}

callParams -> %LPAREN literalArrayElements:? %RPAREN {% (data) => data[1] %}

optCallParams -> callParams:? {% (data) => data[0] %}

callParamsSingle -> %LPAREN fullExpr:? %RPAREN {% (data) => data[1] %}

optCallParamsSingle -> callParamsSingle:? {% (data) => data[0] %}

assignmentStatement ->
      lvalue %EQUAL fullExpr {% (data) => {
          return {actiontype: "setdata", setpath: data[0][1], setop: data[0][0], data: data[2]};
      } %}

exprStatement -> %KW_EXPR fullExpr {% (data) => ({actiontype: "setdata", data: data[1]}) %}

invalidateStatement -> %KW_INVALIDATE optCallParams {% (data) => {
        if (data[1] == null) {
            return {actiontype: "invalidate"};
        }
        return {actiontype: "invalidate", data: {etype: "array", exprs: data[1]}};
    } %}

nopStatement -> %KW_NOP (%LPAREN %RPAREN):? {% (data) => ({actiontype: "nop"}) %}

bubbleStatement ->
    %KW_BUBBLE %DASHGT idOrKeyword optCallParamsSingle {% (data) => {
        let rtn = {actiontype: "fireevent", bubble: true, event: {etype: "literal", val: data[2].value}, data: data[3]};
        return rtn;
    } %}

fireStatement ->
    %KW_FIRE %DASHGT idOrKeyword optCallParamsSingle {% (data) => {
        let rtn = {actiontype: "fireevent", event: {etype: "literal", val: data[2].value}, data: data[3]};
        return rtn;
    } %}

logStatement -> %KW_LOG callParams {% (data) => ({actiontype: "log", data: {etype: "array", exprs: data[1]}}) %}

debugStatement -> %KW_DEBUG callParams {% (data) => ({actiontype: "log", debug: true, data: {etype: "array", exprs: data[1]}}) %}

alertStatement -> %KW_ALERT callParams {% (data) => ({actiontype: "log", alert: true, data: {etype: "array", exprs: data[1]}}) %}

# [setop : string, PathType]
lvalue ->
    (idOrKeyword %COLON):? lvaluePath {% (data) => {
        let setop = "set";
        if (data[0] != null) {
            setop = data[0][0].value;
        }
        return [setop, data[1]];
    } %}

# PathType
lvaluePath -> pathExprNonTerm {% (data) => { return data[0].path } %}

filterExpr -> 
      ternaryExpr {% id %}
    | ternaryExpr %PIPE idOrKeyword namedCallParams {% (data) => {
          return {etype: "filter", filter: data[2].value, exprs: [data[0], data[3]]};
      } %}

ternaryExpr ->
      qqExpr {% id %}
    | qqExpr %QUESTION fullExpr %COLON ternaryExpr {% (data) => ({etype: "op", op: "?:", exprs: [data[0], data[2], data[4]]}) %}

qqExpr ->
      logicalOrExpr {% id %}
    | qqExpr %QQ logicalOrExpr {% (data) => ({etype: "op", op: "??", exprs: [data[0], data[2]]}) %}

logicalOrExpr -> 
      logicalAndExpr {% id %}
    | logicalOrExpr %LOGICAL_OR logicalAndExpr {% (data) => ({etype: "op", op: "||", exprs: [data[0], data[2]]}) %}

logicalAndExpr ->
      equalityExpr {% id %}
    | logicalAndExpr %LOGICAL_AND equalityExpr {% (data) => ({etype: "op", op: "&&", exprs: [data[0], data[2]]}) %}

equalityExpr ->
      relationalExpr {% id %}
    | equalityExpr %EQEQ relationalExpr   {% (data) => ({etype: "op", op: "==", exprs: [data[0], data[2]]}) %}
    | equalityExpr %BANGEQ relationalExpr {% (data) => ({etype: "op", op: "!=", exprs: [data[0], data[2]]}) %}

relationalExpr ->
      addExpr {% id %}
    | relationalExpr %GEQ addExpr {% (data) => ({etype: "op", op: ">=", exprs: [data[0], data[2]]}) %}
    | relationalExpr %LEQ addExpr {% (data) => ({etype: "op", op: "<=", exprs: [data[0], data[2]]}) %}
    | relationalExpr %GT addExpr  {% (data) => ({etype: "op", op: ">", exprs: [data[0], data[2]]}) %}
    | relationalExpr %LT addExpr  {% (data) => ({etype: "op", op: "<", exprs: [data[0], data[2]]}) %}

addExpr ->
      mulExpr {% id %}
    | addExpr %PLUS mulExpr      {% (data) => ({etype: "op", op: "+", exprs: [data[0], data[2]]}) %}
    | addExpr %DASH mulExpr      {% (data) => ({etype: "op", op: "-", exprs: [data[0], data[2]]}) %}

mulExpr ->
      unaryExpr {% id %}
    | mulExpr %STAR pathExpr     {% (data) => ({etype: "op", op: "*", exprs: [data[0], data[2]]}) %}
    | mulExpr %SLASH pathExpr    {% (data) => ({etype: "op", op: "/", exprs: [data[0], data[2]]}) %}
    | mulExpr %PERCENT pathExpr  {% (data) => ({etype: "op", op: "%", exprs: [data[0], data[2]]}) %}

unaryExpr ->
      pathExpr {% id %}
    | %BANG unaryExpr {% (data) => ({etype: "op", op: "!", exprs: [data[1]]}) %}
    | %DASH unaryExpr {% (data) => ({etype: "op", op: "-", exprs: [data[1]]}) %}
    | %PLUS unaryExpr {% (data) => ({etype: "op", op: "+", exprs: [data[1]]}) %}

pathExpr -> 
      primaryExpr     {% id %}

primaryExpr ->
      literalVal      {% id %}
    | literalArray    {% id %}
    | literalMap      {% id %}
    | fnExpr          {% id %}
    | %LPAREN fullExpr %RPAREN {% (data) => data[1] %}
    | pathExprNonTerm {% id %}


fnExpr -> 
      %FN %LPAREN optionalLiteralArrayElements %RPAREN {% (data) => {
          return {etype: "fn", fn: data[0].value, exprs: data[2]};
      } %}
    | %KW_REF %LPAREN lvaluePath %RPAREN {% (data) => ({etype: "ref", path: data[2]}) %}

literalArray ->
      %LBRACK optionalLiteralArrayElements %RBRACK {% (data) => {
          return {etype: "array", exprs: data[1]};
      } %}
      | %LBRACK fullExpr %DOTDOT fullExpr %RBRACK {% (data) => ({etype: "array-range", exprs: [data[1], data[3]]}) %}

optionalLiteralArrayElements -> literalArrayElements:? {% (data) => {
        if (data[0] == null) {
            return [];
        }
        return data[0];
    } %}

literalArrayElementsNoComma -> fullExpr (%COMMA fullExpr):* {% (data) => {
        let rtn = [];
        rtn.push(data[0]);
        rtn.push(...data[1].map((v) => v[1]));
        return rtn;
    } %}

literalArrayElements -> literalArrayElementsNoComma %COMMA:? {% (data) => {
        return data[0];
    } %}

literalMap -> %LBRACE literalMapElements:? %RBRACE {% (data) => ({etype: "map", exprs: data[1]}) %}

literalMapElements -> literalMapElement (%COMMA literalMapElement):* %COMMA:? {% (data) => {
        let rtn = [];
        rtn.push(data[0]);
        rtn.push(...data[1].map((v) => v[1]));
        return rtn;
    } %}

literalMapElement -> literalMapKey %COLON fullExpr {% (data) => ({etype: "kv", key: data[0], valexpr: data[2]}) %}

literalMapKey -> 
      idOrKeyword {% (data) => ({etype: "literal", val: data[0].value}) %}
    | stringLit  {% (data) => ({etype: "literal", val: data[0]}) %}

literalVal ->
      stringLit  {% (data) => ({etype: "literal", val: data[0]}) %}
    | %JSNUM     {% (data) => ({etype: "literal", val: data[0].value}) %}
    | %KW_TRUE   {% (data) => ({etype: "literal", val: true}) %}
    | %KW_FALSE  {% (data) => ({etype: "literal", val: false}) %}
    | %KW_NULL   {% (data) => ({etype: "literal", val: null}) %}

pathExprNonTerm ->
      globalPathExpr  {% id %}
    | localPathExpr   {% id %}
    | contextPathExpr {% id %}
    | derefPathExpr   {% id %}
    | caretPathExpr   {% id %}

derefPathExpr -> %DOLLAR %LPAREN fullExpr %RPAREN pathPartAny:* {% (data) => {
          let rtn = [];
          rtn.push({pathtype: "deref", expr: data[2]});
          rtn.push(...data[4]);
          return {etype: "path", path: rtn};
      } %}

globalPathExpr -> %DOLLAR idOrKeyword:? pathPartAny:* {% (data) => {
          let rtn = [];
          let gkey = "global";
          if (data[1] != null) {
              gkey = data[1].value;
          }
          rtn.push({pathtype: "root", pathkey: gkey});
          rtn.push(...data[2]);
          return {etype: "path", path: rtn};
      } %}

caretPathExpr ->
      %CARET localPathExpr    {% (data) => { data[1].path[0].caret = 1; return data[1]; } %}
    | %CARET contextPathExpr  {% (data) => { data[1].path[0].caret = 1; return data[1]; } %}

localPathExpr -> %DOT ((pathPartDyn | pathPartBareMap) pathPartAny:*):? {% (data) => {
          let rtn = [];
          rtn.push({pathtype: "root", pathkey: "local"});
          if (data[1] != null) {
              rtn.push(data[1][0][0]);
              rtn.push(...data[1][1]);
          }
          return {etype: "path", path: rtn};
      } %}

contextPathExpr -> %ATID pathPartAny:* {% (data) => {
          let rtn = [];
          rtn.push({pathtype: "root", pathkey: "context"});
          rtn.push({pathtype: "map", pathkey: data[0].value});
          rtn.push(...data[1]);
          return {etype: "path", path: rtn};
      } %}

pathPartAny -> 
      pathPartDot {% id %}
    | pathPartDyn {% id %}

pathPartBareMap -> idOrKeyword {% (data) => ({pathtype: "map", pathkey: data[0].value}) %}

pathPartDot -> %DOT idOrKeyword {% (data) => ({pathtype: "map", pathkey: data[1].value}) %}

pathPartDyn ->
      pathPartDynSimple {% id %}
    | pathPartDynFind   {% id %}

pathPartDynSimple -> %LBRACK fullExpr %RBRACK {% (data) => {
        let expr = data[1];
        if (expr.etype == "literal") {
            if (typeof(expr.val) == "number") {
                return {pathtype: "array", pathindex: expr.val};
            }
            return {pathtype: "map", pathkey: expr.val};
        }
        else {
            return {pathtype: "dyn", expr: data[1]};
        }
    } %}

pathPartDynFind -> %LBRACK %STAR fullExpr %RBRACK {% (data) => {
        return {pathtype: "dynfind", expr: data[2]};
    } %}

stringLit -> 
    (%STRSTART_DQ | %STRSTART_SQ) stringLitPart:* %STREND {% (data) => data[1].join("") %}

stringLitPart -> 
      %STRPART {% (data) => data[0].value %}
    | %STRESC  {% (data) => data[0].value %}

idOrKeyword -> 
      %ID        {% id %}
    | %KW_TRUE   {% id %}
    | %KW_FALSE  {% id %}
    | %KW_NULL   {% id %}
    | %KW_CALL   {% id %}
    | %KW_SETRETURN {% id %}
    | %KW_INVALIDATE {% id %}
    | %KW_FIRE   {% id %}
    | %KW_NOP    {% id %}
    | %KW_BUBBLE {% id %}
    | %KW_LOG    {% id %}
    | %KW_DEBUG  {% id %}
    | %KW_ALERT  {% id %}
    | %KW_EXPR   {% id %}
    | %KW_LOCAL  {% id %}
    | %KW_IF     {% id %}
    | %KW_ELSE   {% id %}
    | %KW_THROW  {% id %}
    | %KW_REF    {% id %}
    | %KW_REPORTERROR {% id %}
    | %KW_SWITCHAPP   {% id %}
    | %KW_PUSHAPP     {% id %}
    | %KW_POPAPP      {% id %}
    | %KW_NAVTO       {% id %}

_ -> %WS:*

