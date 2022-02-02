# Copyright 2021-2022 Dashborg Inc

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

// we define the URLPATH token to accept a superset of valid URLs and module URLs to prevent
// weird lexing tokens.  parseUrl will sort out the invalid URLs later
//
// method            = (?:(?:GET|POST|PUT|PATCH|DELETE|DYN)\s+)
// prefix            = (?:http:|https:|\/\/)
// maxurl            = [^(); \t\r\n]+
//
// URLPATH = method maxurl | prefix maxurl

let lexer = moo.states({
    main: {
        URLPATH: { match: /(?:(?:GET|POST|PUT|PATCH|DELETE|DYN)\s+)[^(); \t\r\n]+|(?:http:|https:|\/\/)[^(); \t\r\n]+/ },
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
        COMMENT:     { match: /\/\*[^]*?\*\// },
        DOLLAR:   "$",
        ATID:     { match: /@[a-zA-Z][a-zA-Z_0-9]*/, value: (v) => v.substr(1) },
        ATSIGN:   "@",
        FN:       { match: /fnx?:[a-zA-Z_][a-zA-Z_0-9]*/ },
        ID:       { match: /[a-zA-Z_][a-zA-Z_0-9]*/,
                    type: moo.keywords({
                        KW_TRUE: "true",
                        KW_FALSE: "false",
                        KW_NULL: "null",
                        KW_NOATTR: "noattr",
                        KW_CALLHANDLER: "callhandler",
                        KW_SETRETURN: "setreturn",
                        KW_RETURN: "return",
                        KW_INVALIDATE: "invalidate",
                        KW_FIRE: "fire",
                        KW_NOP: "nop",
                        KW_BUBBLE: "bubble",
                        KW_LOG: "log",
                        KW_ALERT: "alert",
                        KW_EXPR: "expr",
                        KW_LOCAL: "local",
                        KW_IF: "if",
                        KW_ELSE: "else",
                        KW_THROW: "throw",
                        KW_REF: "ref",
                        KW_ISREF: "isref",
                        KW_REFINFO: "refinfo",
                        KW_RAW: "raw",
                        KW_IN: "in",
                        KW_INVOKE: "invoke",
                        KW_LAMBDA: "lambda",
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
        if (tok && (tok.type == "WS" || tok.type == "COMMENT")) {
            continue;
        }
        return tok;
    }
}

%}

@lexer lexer

# EXTERNAL RULES

ext_fullExpr              -> fullExpr              {% id %}
ext_statementBlock        -> statementBlock        {% id %}
ext_callStatementNoAssign -> callStatementNoAssign {% id %}
ext_contextAssignList     -> contextAssignList     {% id %}
ext_refAttribute          -> refAttribute          {% id %}
ext_pathExprNonTerm       -> pathExprNonTerm       {% id %}
ext_iteratorExpr          -> iteratorExpr          {% id %}

# INTERNAL RULES

fullExpr -> filterExpr {% id %}

# returns HAction[]
statementBlock -> anyStatement:+  {% (data) => {
        let rtn = data[0].filter((v) => (v != null));
        return rtn;
    } %}

anyStatement ->
      %SEMI                 {% (data) => null %}
    | statement %SEMI       {% (data) => data[0] %}
    | statementNoSemi       {% id %}

lastStatement ->
      statement %SEMI:?     {% (data) => data[0] %}
    | statementNoSemi       {% id %}

statementNoSemi ->
      ifStatement           {% id %}

iteratorExpr ->
      %ATID %KW_IN fullExpr {% 
          (data) => ({data: data[2], itemvar: data[0].value}) 
      %}
    | %LPAREN %ATID (%COMMA %ATID):? %RPAREN %KW_IN fullExpr {% (data) => {
          let rtn = {data: data[5], itemvar: data[1].value};
          if (data[2] != null) {
              rtn.keyvar = data[2][1].value;
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
    | alertStatement        {% id %}
    | exprStatement         {% id %}
    | throwStatement        {% id %}
    | returnStatement       {% id %}
    | nopStatement          {% id %}

throwStatement -> %KW_THROW callParamsSingle {% (data) => ({actiontype: "throw", data: data[1]}) %}

returnStatement -> 
      %KW_SETRETURN %LPAREN fullExpr %RPAREN {% (data) => ({actiontype: "setreturn", data: data[2], exithandler: false}) %}
    | %KW_RETURN %LPAREN fullExpr:? %RPAREN {% (data) => ({actiontype: "setreturn", data: data[2], exithandler: true}) %}
    | %KW_RETURN {% (data) => ({actiontype: "setreturn", data: null, exithandler: true}) %}

ifStatement -> %KW_IF %LPAREN fullExpr %RPAREN %LBRACE statementBlock %RBRACE (%KW_ELSE %LBRACE statementBlock %RBRACE):? {% (data) => {
        let rtn = {actiontype: "ifblock", data: data[2], actions: {}};
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

dynCallStatement -> %KW_CALLHANDLER namedCallParams {% (data) => {
          return {actiontype: "callhandler", data: data[1]};
      } %}

staticCallStatement -> %URLPATH namedCallParams {% (data) => {
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
    %KW_BUBBLE %DASHGT (idOrKeyword %COLON):? idOrKeyword namedCallParams {% (data) => {
        let eventName = data[3].value;
        if (data[2] != null) {
            eventName = data[2][0].value + ":" + eventName;
        }
        let rtn = {actiontype: "fireevent", bubble: true, event: {etype: "literal", val: eventName}, data: data[4]};
        return rtn;
    } %}

fireStatement ->
    %KW_FIRE %DASHGT (idOrKeyword %COLON):? idOrKeyword namedCallParams {% (data) => {
        let eventName = data[3].value;
        if (data[2] != null) {
            eventName = data[2][0].value + ":" + eventName;
        }
        let rtn = {actiontype: "fireevent", event: {etype: "literal", val: eventName}, data: data[4]};
        return rtn;
    } %}

logStatement -> %KW_LOG namedCallParams {% (data) => ({actiontype: "log", data: data[1]}) %}

alertStatement -> %KW_ALERT namedCallParams {% (data) => ({actiontype: "log", alert: true, data: data[1]}) %}

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
lvaluePath -> pathExprNonTerm {% (data) => data[0].path %}

refAttribute -> fullPathExpr {% (data) => ({etype: "ref", pathexpr: data[0]}) %}

fullPathExpr -> ternaryPathExpr {% id %}

ternaryPathExpr ->
      %KW_NOATTR         {% (data) => ({etype: "noattr"}) %}
    | %KW_NULL           {% (data) => ({etype: "literal", val: null}) %}
    | pathExprNonTerm    {% id %}
    | fullExpr %QUESTION fullPathExpr %COLON fullPathExpr {% (data) => {
          return {etype: "op", op: "?:", exprs: [data[0], data[2], data[4]]};
      } %}

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
    | %DASH unaryExpr {% (data) => ({etype: "op", op: "u-", exprs: [data[1]]}) %}
    | %PLUS unaryExpr {% (data) => ({etype: "op", op: "u+", exprs: [data[1]]}) %}

pathExpr -> 
      primaryExpr     {% id %}

primaryExpr ->
      literalVal      {% id %}
    | literalArray    {% id %}
    | literalMap      {% id %}
    | fnExpr          {% id %}
    | invokeExpr      {% id %}
    | lambdaExpr      {% id %}
    | refExpr         {% id %}
    | %LPAREN fullExpr %RPAREN {% (data) => data[1] %}
    | pathExprNonTerm {% id %}


fnExpr -> 
      %FN %LPAREN optionalLiteralArrayElements %RPAREN {% (data) => {
          return {etype: "fn", fn: data[0].value, exprs: data[2]};
      } %}

refExpr -> 
      %KW_REF %LPAREN fullPathExpr %RPAREN {% (data) => ({etype: "ref", pathexpr: data[2]}) %}
    | %KW_ISREF %LPAREN fullExpr %RPAREN {% (data) => ({etype: "isref", exprs: [data[2]]}) %}
    | %KW_REFINFO %LPAREN fullExpr %RPAREN {% (data) => ({etype: "refinfo", exprs: [data[2]]}) %}
    | %KW_RAW %LPAREN fullPathExpr %RPAREN {% (data) => ({etype: "raw", exprs: [data[2]]}) %}

invokeExpr -> %KW_INVOKE %LPAREN fullExpr %RPAREN {% (data) => {
          return {etype: "invoke", exprs: [data[2]]};
      } %}

lambdaExpr -> %KW_LAMBDA %LPAREN fullExpr %RPAREN {% (data) => {
          return {etype: "lambda", exprs: [data[2]]};
      } %}

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
    | %KW_NOATTR {% (data) => ({etype: "noattr"}) %}

pathExprNonTerm ->
      globalPathExpr  {% id %}
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

caretPathExpr -> %CARET contextPathExpr  {% (data) => { data[1].path[0].caret = 1; return data[1]; } %}

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

pathPartDot ->
      %DOT idOrKeyword {% (data) => ({pathtype: "map", pathkey: data[1].value}) %}
    | %DOT %ATID       {% (data) => ({pathtype: "map", pathkey: "@" + data[1].value}) %}

pathPartDyn ->
      pathPartDynSimple {% id %}

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
    | %KW_NOATTR {% id %}
    | %KW_FIRE   {% id %}
    | %KW_NOP    {% id %}
    | %KW_BUBBLE {% id %}
    | %KW_LOG    {% id %}
    | %KW_ALERT  {% id %}
    | %KW_EXPR   {% id %}
    | %KW_LOCAL  {% id %}
    | %KW_IF     {% id %}
    | %KW_ELSE   {% id %}
    | %KW_THROW  {% id %}
    | %KW_RAW    {% id %}
    | %KW_REF    {% id %}
    | %KW_ISREF  {% id %}
    | %KW_REFINFO     {% id %}
    | %KW_SETRETURN   {% id %}
    | %KW_RETURN      {% id %}
    | %KW_INVALIDATE  {% id %}
    | %KW_CALLHANDLER {% id %}
    | %KW_NAVTO       {% id %}
    | %KW_IN          {% id %}
    | %KW_INVOKE      {% id %}
    | %KW_LAMBDA      {% id %}

_ -> %WS:*

