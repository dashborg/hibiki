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

// TODO - create 'path' lex token - /foo/bar, @local/wizard, /hello
let lexer = moo.states({
    main: {
        CALLPATH: { match: /(?:(?:\/@[a-zA-Z_][a-zA-Z0-9_]*\/?|(?:\/@[a-zA-Z_][a-zA-Z0-9_]*)?\/[a-zA-Z0-9._\/-]+)(?::@?[a-zA-Z][a-zA-Z0-9_-]*)?)/ },
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
        ATSIGN:   "@",
        FN:       { match: /fn:[a-zA-Z_][a-zA-Z_0-9]*/, value: (v) => v.substr(3) },
        ID:       { match: /[a-zA-Z][a-zA-Z_0-9]*/,
                    type: moo.keywords({
                        KW_TRUE: "true",
                        KW_FALSE: "false",
                        KW_NULL: "null",
                        KW_CALL: "call",
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
        UNDERSCORE: "_",
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

fullExpr -> ternaryExpr {% id %}

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

statement ->
      callStatement         {% id %}
    | assignmentStatement   {% id %}
    | invalidateStatement   {% id %}
    | fireStatement         {% id %}
    | bubbleStatement       {% id %}
    | logStatement          {% id %}
    | alertStatement        {% id %}
    | exprStatement         {% id %}
    | ifStatement           {% id %}
    | throwStatement        {% id %}
    | reportErrorStatement  {% id %}
    | switchAppStatement    {% id %}
    | pushAppStatement      {% id %}
    | popAppStatement       {% id %}
    | navToStatement        {% id %}
    | nopStatement          {% id %}

throwStatement -> %KW_THROW fullExpr {% (data) => ({stmt: "throw", expr: data[1]}) %}

switchAppStatement -> %KW_SWITCHAPP %LPAREN fullExpr (%COMMA fullExpr):? %RPAREN {% (data) => {
        let rtn = {stmt: "switchapp", appexpr: data[2]};
        if (data[3] != null) {
            rtn.params = data[3][1];
        }
        return rtn;
    } %}

pushAppStatement -> %KW_PUSHAPP %LPAREN fullExpr (%COMMA fullExpr):? %RPAREN {% (data) => {
        let rtn = {stmt: "pushapp", appexpr: data[2]};
        if (data[3] != null) {
            rtn.params = data[3][1];
        }
        return rtn;
    } %}

popAppStatement -> %KW_POPAPP (%LPAREN %RPAREN):? {% (data) => ({stmt: "popapp"}) %}

navToStatement -> %KW_NAVTO %LPAREN fullExpr (%COMMA fullExpr):? %RPAREN {% (data) => {
        let rtn = {stmt: "navto", pageexpr: data[2]};
        if (data[3] != null) {
            rtn.params = data[3][1];
        }
        return rtn;
    } %}

ifStatement -> %KW_IF %LPAREN fullExpr %RPAREN %LBRACE statementBlock %RBRACE (%KW_ELSE %LBRACE statementBlock %RBRACE):? {% (data) => {
        let rtn = {stmt: "if", condExpr: data[2], thenBlock: data[5]};
        if (data[7] != null) {
            rtn.elseBlock = data[7][2];
        }
        return rtn;
    } %}

exprOrExprArray -> fullExpr (%COMMA fullExpr):*  {% (data) => {
    let arr = [];
    let dataExpr = data[0];
    arr.push(dataExpr);
    if (data[1] != null && data[1].length > 0) {
        arr.push(...data[1].map((v) => v[1]));
    }
    return {etype: "array", exprs: arr};
} %}

callStatement -> (lvalue %EQUAL):? callStatementNoAssign {% (data) => {
        if (data[0]) {
            let lvalueArr = data[0][0];
            data[1].lvalue = lvalueArr[1];
            data[1].setop = lvalueArr[0];
        }
        return data[1];
    } %}

callStatementNoAssign ->
      staticCallStatement  {% id %}
    | %KW_CALL fullExpr (%COMMA fullExpr):?  {% (data) => {
          let dataExpr = null;
          if (data[2]!= null) {
              dataExpr = data[2][1];
          }
          return {stmt: "call", handler: data[1], data: dataExpr}
      } %}

staticCallStatement -> %CALLPATH (%LPAREN exprOrExprArray:? %RPAREN):?    {% (data) => {
      let dataExpr = null;
      if (data[1] != null) {
          dataExpr = data[1][1];
      }
      return {stmt: "call", handler: {etype: "literal", val: data[0].value}, data: dataExpr};
  } %}

assignmentStatement ->
      lvalue %EQUAL fullExpr {% (data) => {
          return {stmt: "assign", lvalue: data[0][1], setop: data[0][0], expr: data[2]};
      } %}

exprStatement -> %KW_EXPR fullExpr {% (data) => ({stmt: "expr", expr: data[1]}) %}

invalidateStatement -> %KW_INVALIDATE literalArrayElements:? {% (data) => ({stmt: "invalidate", exprs: data[1]}) %}

bubbleStatement ->
    %KW_BUBBLE idOrKeyword (%LPAREN fullExpr:? %RPAREN):? {% (data) => {
        let rtn = {stmt: "bubble", event: {etype: "literal", val: data[1].value}};
        if (data[2] != null) {
            rtn.context = data[2][1];
        }
        return rtn;
    } %}

nopStatement -> %KW_NOP {% (data) => ({stmt: "nop"}) %}

fireStatement -> 
    %KW_FIRE fullExpr %COMMA fullExpr (%COMMA fullExpr):? {% (data) => {
        let rtn = {stmt: "fire", target: data[1], event: data[3]};
        if (data[4] != null) {
            rtn.context = data[4][1];
        }
        return rtn;
    } %}

  | %KW_FIRE fullExpr %DASHGT idOrKeyword (%LPAREN fullExpr:? %RPAREN):? {% (data) => {
        let rtn = {stmt: "fire", target: data[1], event: {etype: "literal", val: data[3].value}};
        if (data[4] != null) {
            rtn.context = data[4][1];
        }
        return rtn;
    } %}

logStatement -> %KW_LOG literalArrayElements {% (data) => ({stmt: "log", exprs: data[1]}) %}

alertStatement -> %KW_ALERT literalArrayElements {% (data) => ({stmt: "alert", exprs: data[1]}) %}

reportErrorStatement -> %KW_REPORTERROR fullExpr {% (data) => {
        return {stmt: "reporterror", expr: data[1]};
    } %}

lvalue ->
    (idOrKeyword %COLON):? lvaluePath {% (data) => {
        let setop = "set";
        if (data[0] != null) {
            setop = data[0][0].value;
        }
        return [setop, data[1]];
    } %}

lvaluePath -> pathExprNonTerm {% id %}

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
      %FN %LPAREN optionalLiteralArrayElements %RPAREN {% (data) => ({etype: "fn", fn: data[0].value, exprs: data[2]}) %}
    | %KW_REF %LPAREN lvaluePath %RPAREN {% (data) => ({etype: "ref", path: data[2]}) %}

literalArray ->
      %LBRACK optionalLiteralArrayElements %RBRACK {% (data) => ({etype: "array", exprs: data[1]}) %}
      | %LBRACK fullExpr %DOTDOT fullExpr %RBRACK {% (data) => ({etype: "array-range", exprs: [data[1], data[3]]}) %}

optionalLiteralArrayElements -> literalArrayElements:? {% (data) => {
        if (data[0] == null) {
            return [];
        }
        return data[0];
    } %}

literalArrayElements -> fullExpr (%COMMA fullExpr):* %COMMA:? {% (data) => {
        let rtn = [];
        rtn.push(data[0]);
        rtn.push(...data[1].map((v) => v[1]));
        return rtn;
    } %}

literalMap -> %LBRACE literalMapElements:? %RBRACE {% (data) => ({etype: "map", exprs: data[1]}) %}

literalMapElements -> literalMapElement (%COMMA literalMapElement):* %COMMA:? {% (data) => {
        let rtn = [];
        rtn.push(data[0]);
        rtn.push(...data[1].map((v) => v[1]));
        return rtn;
    } %}

literalMapElement -> literalMapKey %COLON fullExpr {% (data) => ({etype: "kv", key: data[0], val: data[2]}) %}

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

contextPathExpr -> %ATSIGN pathPartBareMap pathPartAny:* {% (data) => {
          let rtn = [];
          rtn.push({pathtype: "root", pathkey: "context"});
          rtn.push(data[1]);
          rtn.push(...data[2]);
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
    | %KW_INVALIDATE {% id %}
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
    | %KW_REF    {% id %}
    | %KW_REPORTERROR {% id %}
    | %KW_SWITCHAPP   {% id %}
    | %KW_PUSHAPP     {% id %}
    | %KW_POPAPP      {% id %}
    | %KW_NAVTO       {% id %}

_ -> %WS:*
