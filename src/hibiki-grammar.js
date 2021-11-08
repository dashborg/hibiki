// Generated automatically by nearley, version 2.20.1
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }


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

var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "fullExpr", "symbols": ["ternaryExpr"], "postprocess": id},
    {"name": "statementBlock$ebnf$1", "symbols": []},
    {"name": "statementBlock$ebnf$1$subexpression$1", "symbols": [(lexer.has("SEMI") ? {type: "SEMI"} : SEMI), "statement"]},
    {"name": "statementBlock$ebnf$1", "symbols": ["statementBlock$ebnf$1", "statementBlock$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "statementBlock$ebnf$2", "symbols": [(lexer.has("SEMI") ? {type: "SEMI"} : SEMI)], "postprocess": id},
    {"name": "statementBlock$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "statementBlock", "symbols": ["statement", "statementBlock$ebnf$1", "statementBlock$ebnf$2"], "postprocess":  (data) => {
            let rtn = [data[0]];
            if (data[1] != null && data[1].length > 0) {
                for (let i=0; i<data[1].length; i++) {
                    let spart = data[1][i];
                    rtn.push(spart[1]);
                }
            }
            return rtn;
        } },
    {"name": "statement", "symbols": ["callStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["assignmentStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["invalidateStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["fireStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["bubbleStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["logStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["exprStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["ifStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["throwStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["reportErrorStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["switchAppStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["pushAppStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["popAppStatement"], "postprocess": id},
    {"name": "statement", "symbols": ["navToStatement"], "postprocess": id},
    {"name": "throwStatement", "symbols": [(lexer.has("KW_THROW") ? {type: "KW_THROW"} : KW_THROW), "fullExpr"], "postprocess": (data) => ({stmt: "throw", expr: data[1]})},
    {"name": "switchAppStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "switchAppStatement$ebnf$1", "symbols": ["switchAppStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "switchAppStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "switchAppStatement", "symbols": [(lexer.has("KW_SWITCHAPP") ? {type: "KW_SWITCHAPP"} : KW_SWITCHAPP), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", "switchAppStatement$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess":  (data) => {
            let rtn = {stmt: "switchapp", appexpr: data[2]};
            if (data[3] != null) {
                rtn.params = data[3][1];
            }
            return rtn;
        } },
    {"name": "pushAppStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "pushAppStatement$ebnf$1", "symbols": ["pushAppStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "pushAppStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "pushAppStatement", "symbols": [(lexer.has("KW_PUSHAPP") ? {type: "KW_PUSHAPP"} : KW_PUSHAPP), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", "pushAppStatement$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess":  (data) => {
            let rtn = {stmt: "pushapp", appexpr: data[2]};
            if (data[3] != null) {
                rtn.params = data[3][1];
            }
            return rtn;
        } },
    {"name": "popAppStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)]},
    {"name": "popAppStatement$ebnf$1", "symbols": ["popAppStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "popAppStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "popAppStatement", "symbols": [(lexer.has("KW_POPAPP") ? {type: "KW_POPAPP"} : KW_POPAPP), "popAppStatement$ebnf$1"], "postprocess": (data) => ({stmt: "popapp"})},
    {"name": "navToStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "navToStatement$ebnf$1", "symbols": ["navToStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "navToStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "navToStatement", "symbols": [(lexer.has("KW_NAVTO") ? {type: "KW_NAVTO"} : KW_NAVTO), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", "navToStatement$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess":  (data) => {
            let rtn = {stmt: "navto", pageexpr: data[2]};
            if (data[3] != null) {
                rtn.params = data[3][1];
            }
            return rtn;
        } },
    {"name": "ifStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("KW_ELSE") ? {type: "KW_ELSE"} : KW_ELSE), (lexer.has("LBRACE") ? {type: "LBRACE"} : LBRACE), "statementBlock", (lexer.has("RBRACE") ? {type: "RBRACE"} : RBRACE)]},
    {"name": "ifStatement$ebnf$1", "symbols": ["ifStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "ifStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "ifStatement", "symbols": [(lexer.has("KW_IF") ? {type: "KW_IF"} : KW_IF), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN), (lexer.has("LBRACE") ? {type: "LBRACE"} : LBRACE), "statementBlock", (lexer.has("RBRACE") ? {type: "RBRACE"} : RBRACE), "ifStatement$ebnf$1"], "postprocess":  (data) => {
            let rtn = {stmt: "if", condExpr: data[2], thenBlock: data[5]};
            if (data[7] != null) {
                rtn.elseBlock = data[7][2];
            }
            return rtn;
        } },
    {"name": "exprOrExprArray$ebnf$1", "symbols": []},
    {"name": "exprOrExprArray$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "exprOrExprArray$ebnf$1", "symbols": ["exprOrExprArray$ebnf$1", "exprOrExprArray$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "exprOrExprArray", "symbols": ["fullExpr", "exprOrExprArray$ebnf$1"], "postprocess":  (data) => {
            let arr = [];
            let dataExpr = data[0];
            arr.push(dataExpr);
            if (data[1] != null && data[1].length > 0) {
                arr.push(...data[1].map((v) => v[1]));
            }
            return {etype: "array", exprs: arr};
        } },
    {"name": "callStatement$ebnf$1$subexpression$1", "symbols": ["lvalue", (lexer.has("EQUAL") ? {type: "EQUAL"} : EQUAL)]},
    {"name": "callStatement$ebnf$1", "symbols": ["callStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "callStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "callStatement", "symbols": ["callStatement$ebnf$1", "callStatementNoAssign"], "postprocess":  (data) => {
            if (data[0]) {
                let lvalueArr = data[0][0];
                data[1].lvalue = lvalueArr[1];
                data[1].setop = lvalueArr[0];
            }
            return data[1];
        } },
    {"name": "callStatementNoAssign", "symbols": ["staticCallStatement"], "postprocess": id},
    {"name": "callStatementNoAssign$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "callStatementNoAssign$ebnf$1", "symbols": ["callStatementNoAssign$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "callStatementNoAssign$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "callStatementNoAssign", "symbols": [(lexer.has("KW_CALL") ? {type: "KW_CALL"} : KW_CALL), "fullExpr", "callStatementNoAssign$ebnf$1"], "postprocess":  (data) => {
            let dataExpr = null;
            if (data[2]!= null) {
                dataExpr = data[2][1];
            }
            return {stmt: "call", handler: data[1], data: dataExpr}
        } },
    {"name": "staticCallStatement$ebnf$1$subexpression$1$ebnf$1", "symbols": ["exprOrExprArray"], "postprocess": id},
    {"name": "staticCallStatement$ebnf$1$subexpression$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "staticCallStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "staticCallStatement$ebnf$1$subexpression$1$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)]},
    {"name": "staticCallStatement$ebnf$1", "symbols": ["staticCallStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "staticCallStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "staticCallStatement", "symbols": [(lexer.has("CALLPATH") ? {type: "CALLPATH"} : CALLPATH), "staticCallStatement$ebnf$1"], "postprocess":  (data) => {
            let dataExpr = null;
            if (data[1] != null) {
                dataExpr = data[1][1];
            }
            return {stmt: "call", handler: {etype: "literal", val: data[0].value}, data: dataExpr};
        } },
    {"name": "assignmentStatement", "symbols": ["lvalue", (lexer.has("EQUAL") ? {type: "EQUAL"} : EQUAL), "fullExpr"], "postprocess":  (data) => {
            return {stmt: "assign", lvalue: data[0][1], setop: data[0][0], expr: data[2]};
        } },
    {"name": "exprStatement", "symbols": [(lexer.has("KW_EXPR") ? {type: "KW_EXPR"} : KW_EXPR), "fullExpr"], "postprocess": (data) => ({stmt: "expr", expr: data[1]})},
    {"name": "invalidateStatement$ebnf$1", "symbols": ["literalArrayElements"], "postprocess": id},
    {"name": "invalidateStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "invalidateStatement", "symbols": [(lexer.has("KW_INVALIDATE") ? {type: "KW_INVALIDATE"} : KW_INVALIDATE), "invalidateStatement$ebnf$1"], "postprocess": (data) => ({stmt: "invalidate", exprs: data[1]})},
    {"name": "bubbleStatement$ebnf$1$subexpression$1$ebnf$1", "symbols": ["fullExpr"], "postprocess": id},
    {"name": "bubbleStatement$ebnf$1$subexpression$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "bubbleStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "bubbleStatement$ebnf$1$subexpression$1$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)]},
    {"name": "bubbleStatement$ebnf$1", "symbols": ["bubbleStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "bubbleStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "bubbleStatement", "symbols": [(lexer.has("KW_BUBBLE") ? {type: "KW_BUBBLE"} : KW_BUBBLE), "idOrKeyword", "bubbleStatement$ebnf$1"], "postprocess":  (data) => {
            let rtn = {stmt: "bubble", event: {etype: "literal", val: data[1].value}};
            if (data[2] != null) {
                rtn.context = data[2][1];
            }
            return rtn;
        } },
    {"name": "nopStatement", "symbols": [(lexer.has("KW_NOP") ? {type: "KW_NOP"} : KW_NOP)], "postprocess": (data) => ({stmt: "nop"})},
    {"name": "fireStatement$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "fireStatement$ebnf$1", "symbols": ["fireStatement$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "fireStatement$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "fireStatement", "symbols": [(lexer.has("KW_FIRE") ? {type: "KW_FIRE"} : KW_FIRE), "fullExpr", (lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr", "fireStatement$ebnf$1"], "postprocess":  (data) => {
            let rtn = {stmt: "fire", target: data[1], event: data[3]};
            if (data[4] != null) {
                rtn.context = data[4][1];
            }
            return rtn;
        } },
    {"name": "fireStatement$ebnf$2$subexpression$1$ebnf$1", "symbols": ["fullExpr"], "postprocess": id},
    {"name": "fireStatement$ebnf$2$subexpression$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "fireStatement$ebnf$2$subexpression$1", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fireStatement$ebnf$2$subexpression$1$ebnf$1", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)]},
    {"name": "fireStatement$ebnf$2", "symbols": ["fireStatement$ebnf$2$subexpression$1"], "postprocess": id},
    {"name": "fireStatement$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "fireStatement", "symbols": [(lexer.has("KW_FIRE") ? {type: "KW_FIRE"} : KW_FIRE), "fullExpr", (lexer.has("DASHGT") ? {type: "DASHGT"} : DASHGT), "idOrKeyword", "fireStatement$ebnf$2"], "postprocess":  (data) => {
            let rtn = {stmt: "fire", target: data[1], event: {etype: "literal", val: data[3].value}};
            if (data[4] != null) {
                rtn.context = data[4][1];
            }
            return rtn;
        } },
    {"name": "logStatement", "symbols": [(lexer.has("KW_LOG") ? {type: "KW_LOG"} : KW_LOG), "literalArrayElements"], "postprocess": (data) => ({stmt: "log", exprs: data[1]})},
    {"name": "reportErrorStatement", "symbols": [(lexer.has("KW_REPORTERROR") ? {type: "KW_REPORTERROR"} : KW_REPORTERROR), "fullExpr"], "postprocess":  (data) => {
            return {stmt: "reporterror", expr: data[1]};
        } },
    {"name": "lvalue$ebnf$1$subexpression$1", "symbols": ["idOrKeyword", (lexer.has("COLON") ? {type: "COLON"} : COLON)]},
    {"name": "lvalue$ebnf$1", "symbols": ["lvalue$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "lvalue$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "lvalue", "symbols": ["lvalue$ebnf$1", "lvaluePath"], "postprocess":  (data) => {
            let setop = "set";
            if (data[0] != null) {
                setop = data[0][0].value;
            }
            return [setop, data[1]];
        } },
    {"name": "lvaluePath", "symbols": ["pathExprNonTerm"], "postprocess": id},
    {"name": "ternaryExpr", "symbols": ["qqExpr"], "postprocess": id},
    {"name": "ternaryExpr", "symbols": ["qqExpr", (lexer.has("QUESTION") ? {type: "QUESTION"} : QUESTION), "fullExpr", (lexer.has("COLON") ? {type: "COLON"} : COLON), "ternaryExpr"], "postprocess": (data) => ({etype: "op", op: "?:", exprs: [data[0], data[2], data[4]]})},
    {"name": "qqExpr", "symbols": ["logicalOrExpr"], "postprocess": id},
    {"name": "qqExpr", "symbols": ["qqExpr", (lexer.has("QQ") ? {type: "QQ"} : QQ), "logicalOrExpr"], "postprocess": (data) => ({etype: "op", op: "??", exprs: [data[0], data[2]]})},
    {"name": "logicalOrExpr", "symbols": ["logicalAndExpr"], "postprocess": id},
    {"name": "logicalOrExpr", "symbols": ["logicalOrExpr", (lexer.has("LOGICAL_OR") ? {type: "LOGICAL_OR"} : LOGICAL_OR), "logicalAndExpr"], "postprocess": (data) => ({etype: "op", op: "||", exprs: [data[0], data[2]]})},
    {"name": "logicalAndExpr", "symbols": ["equalityExpr"], "postprocess": id},
    {"name": "logicalAndExpr", "symbols": ["logicalAndExpr", (lexer.has("LOGICAL_AND") ? {type: "LOGICAL_AND"} : LOGICAL_AND), "equalityExpr"], "postprocess": (data) => ({etype: "op", op: "&&", exprs: [data[0], data[2]]})},
    {"name": "equalityExpr", "symbols": ["relationalExpr"], "postprocess": id},
    {"name": "equalityExpr", "symbols": ["equalityExpr", (lexer.has("EQEQ") ? {type: "EQEQ"} : EQEQ), "relationalExpr"], "postprocess": (data) => ({etype: "op", op: "==", exprs: [data[0], data[2]]})},
    {"name": "equalityExpr", "symbols": ["equalityExpr", (lexer.has("BANGEQ") ? {type: "BANGEQ"} : BANGEQ), "relationalExpr"], "postprocess": (data) => ({etype: "op", op: "!=", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["addExpr"], "postprocess": id},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("GEQ") ? {type: "GEQ"} : GEQ), "addExpr"], "postprocess": (data) => ({etype: "op", op: ">=", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("LEQ") ? {type: "LEQ"} : LEQ), "addExpr"], "postprocess": (data) => ({etype: "op", op: "<=", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("GT") ? {type: "GT"} : GT), "addExpr"], "postprocess": (data) => ({etype: "op", op: ">", exprs: [data[0], data[2]]})},
    {"name": "relationalExpr", "symbols": ["relationalExpr", (lexer.has("LT") ? {type: "LT"} : LT), "addExpr"], "postprocess": (data) => ({etype: "op", op: "<", exprs: [data[0], data[2]]})},
    {"name": "addExpr", "symbols": ["mulExpr"], "postprocess": id},
    {"name": "addExpr", "symbols": ["addExpr", (lexer.has("PLUS") ? {type: "PLUS"} : PLUS), "mulExpr"], "postprocess": (data) => ({etype: "op", op: "+", exprs: [data[0], data[2]]})},
    {"name": "addExpr", "symbols": ["addExpr", (lexer.has("DASH") ? {type: "DASH"} : DASH), "mulExpr"], "postprocess": (data) => ({etype: "op", op: "-", exprs: [data[0], data[2]]})},
    {"name": "mulExpr", "symbols": ["unaryExpr"], "postprocess": id},
    {"name": "mulExpr", "symbols": ["mulExpr", (lexer.has("STAR") ? {type: "STAR"} : STAR), "pathExpr"], "postprocess": (data) => ({etype: "op", op: "*", exprs: [data[0], data[2]]})},
    {"name": "mulExpr", "symbols": ["mulExpr", (lexer.has("SLASH") ? {type: "SLASH"} : SLASH), "pathExpr"], "postprocess": (data) => ({etype: "op", op: "/", exprs: [data[0], data[2]]})},
    {"name": "mulExpr", "symbols": ["mulExpr", (lexer.has("PERCENT") ? {type: "PERCENT"} : PERCENT), "pathExpr"], "postprocess": (data) => ({etype: "op", op: "%", exprs: [data[0], data[2]]})},
    {"name": "unaryExpr", "symbols": ["pathExpr"], "postprocess": id},
    {"name": "unaryExpr", "symbols": [(lexer.has("BANG") ? {type: "BANG"} : BANG), "unaryExpr"], "postprocess": (data) => ({etype: "op", op: "!", exprs: [data[1]]})},
    {"name": "unaryExpr", "symbols": [(lexer.has("DASH") ? {type: "DASH"} : DASH), "unaryExpr"], "postprocess": (data) => ({etype: "op", op: "-", exprs: [data[1]]})},
    {"name": "unaryExpr", "symbols": [(lexer.has("PLUS") ? {type: "PLUS"} : PLUS), "unaryExpr"], "postprocess": (data) => ({etype: "op", op: "+", exprs: [data[1]]})},
    {"name": "pathExpr", "symbols": ["primaryExpr"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["literalVal"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["literalArray"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["literalMap"], "postprocess": id},
    {"name": "primaryExpr", "symbols": ["fnExpr"], "postprocess": id},
    {"name": "primaryExpr", "symbols": [(lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => data[1]},
    {"name": "primaryExpr", "symbols": ["pathExprNonTerm"], "postprocess": id},
    {"name": "fnExpr", "symbols": [(lexer.has("FN") ? {type: "FN"} : FN), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "optionalLiteralArrayElements", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({etype: "fn", fn: data[0].value, exprs: data[2]})},
    {"name": "fnExpr", "symbols": [(lexer.has("KW_REF") ? {type: "KW_REF"} : KW_REF), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "lvaluePath", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN)], "postprocess": (data) => ({etype: "ref", path: data[2]})},
    {"name": "literalArray", "symbols": [(lexer.has("LBRACK") ? {type: "LBRACK"} : LBRACK), "optionalLiteralArrayElements", (lexer.has("RBRACK") ? {type: "RBRACK"} : RBRACK)], "postprocess": (data) => ({etype: "array", exprs: data[1]})},
    {"name": "literalArray", "symbols": [(lexer.has("LBRACK") ? {type: "LBRACK"} : LBRACK), "fullExpr", (lexer.has("DOTDOT") ? {type: "DOTDOT"} : DOTDOT), "fullExpr", (lexer.has("RBRACK") ? {type: "RBRACK"} : RBRACK)], "postprocess": (data) => ({etype: "array-range", exprs: [data[1], data[3]]})},
    {"name": "optionalLiteralArrayElements$ebnf$1", "symbols": ["literalArrayElements"], "postprocess": id},
    {"name": "optionalLiteralArrayElements$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "optionalLiteralArrayElements", "symbols": ["optionalLiteralArrayElements$ebnf$1"], "postprocess":  (data) => {
            if (data[0] == null) {
                return [];
            }
            return data[0];
        } },
    {"name": "literalArrayElements$ebnf$1", "symbols": []},
    {"name": "literalArrayElements$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "fullExpr"]},
    {"name": "literalArrayElements$ebnf$1", "symbols": ["literalArrayElements$ebnf$1", "literalArrayElements$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "literalArrayElements$ebnf$2", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA)], "postprocess": id},
    {"name": "literalArrayElements$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "literalArrayElements", "symbols": ["fullExpr", "literalArrayElements$ebnf$1", "literalArrayElements$ebnf$2"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push(data[0]);
            rtn.push(...data[1].map((v) => v[1]));
            return rtn;
        } },
    {"name": "literalMap$ebnf$1", "symbols": ["literalMapElements"], "postprocess": id},
    {"name": "literalMap$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "literalMap", "symbols": [(lexer.has("LBRACE") ? {type: "LBRACE"} : LBRACE), "literalMap$ebnf$1", (lexer.has("RBRACE") ? {type: "RBRACE"} : RBRACE)], "postprocess": (data) => ({etype: "map", exprs: data[1]})},
    {"name": "literalMapElements$ebnf$1", "symbols": []},
    {"name": "literalMapElements$ebnf$1$subexpression$1", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA), "literalMapElement"]},
    {"name": "literalMapElements$ebnf$1", "symbols": ["literalMapElements$ebnf$1", "literalMapElements$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "literalMapElements$ebnf$2", "symbols": [(lexer.has("COMMA") ? {type: "COMMA"} : COMMA)], "postprocess": id},
    {"name": "literalMapElements$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "literalMapElements", "symbols": ["literalMapElement", "literalMapElements$ebnf$1", "literalMapElements$ebnf$2"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push(data[0]);
            rtn.push(...data[1].map((v) => v[1]));
            return rtn;
        } },
    {"name": "literalMapElement", "symbols": ["literalMapKey", (lexer.has("COLON") ? {type: "COLON"} : COLON), "fullExpr"], "postprocess": (data) => ({etype: "kv", key: data[0], val: data[2]})},
    {"name": "literalMapKey", "symbols": ["idOrKeyword"], "postprocess": (data) => ({etype: "literal", val: data[0].value})},
    {"name": "literalMapKey", "symbols": ["stringLit"], "postprocess": (data) => ({etype: "literal", val: data[0]})},
    {"name": "literalVal", "symbols": ["stringLit"], "postprocess": (data) => ({etype: "literal", val: data[0]})},
    {"name": "literalVal", "symbols": [(lexer.has("JSNUM") ? {type: "JSNUM"} : JSNUM)], "postprocess": (data) => ({etype: "literal", val: data[0].value})},
    {"name": "literalVal", "symbols": [(lexer.has("KW_TRUE") ? {type: "KW_TRUE"} : KW_TRUE)], "postprocess": (data) => ({etype: "literal", val: true})},
    {"name": "literalVal", "symbols": [(lexer.has("KW_FALSE") ? {type: "KW_FALSE"} : KW_FALSE)], "postprocess": (data) => ({etype: "literal", val: false})},
    {"name": "literalVal", "symbols": [(lexer.has("KW_NULL") ? {type: "KW_NULL"} : KW_NULL)], "postprocess": (data) => ({etype: "literal", val: null})},
    {"name": "pathExprNonTerm", "symbols": ["globalPathExpr"], "postprocess": id},
    {"name": "pathExprNonTerm", "symbols": ["localPathExpr"], "postprocess": id},
    {"name": "pathExprNonTerm", "symbols": ["contextPathExpr"], "postprocess": id},
    {"name": "pathExprNonTerm", "symbols": ["derefPathExpr"], "postprocess": id},
    {"name": "pathExprNonTerm", "symbols": ["caretPathExpr"], "postprocess": id},
    {"name": "derefPathExpr$ebnf$1", "symbols": []},
    {"name": "derefPathExpr$ebnf$1", "symbols": ["derefPathExpr$ebnf$1", "pathPartAny"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "derefPathExpr", "symbols": [(lexer.has("DOLLAR") ? {type: "DOLLAR"} : DOLLAR), (lexer.has("LPAREN") ? {type: "LPAREN"} : LPAREN), "fullExpr", (lexer.has("RPAREN") ? {type: "RPAREN"} : RPAREN), "derefPathExpr$ebnf$1"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push({pathtype: "deref", expr: data[2]});
            rtn.push(...data[4]);
            return {etype: "path", path: rtn};
        } },
    {"name": "globalPathExpr$ebnf$1", "symbols": ["idOrKeyword"], "postprocess": id},
    {"name": "globalPathExpr$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "globalPathExpr$ebnf$2", "symbols": []},
    {"name": "globalPathExpr$ebnf$2", "symbols": ["globalPathExpr$ebnf$2", "pathPartAny"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "globalPathExpr", "symbols": [(lexer.has("DOLLAR") ? {type: "DOLLAR"} : DOLLAR), "globalPathExpr$ebnf$1", "globalPathExpr$ebnf$2"], "postprocess":  (data) => {
            let rtn = [];
            let gkey = "global";
            if (data[1] != null) {
                gkey = data[1].value;
            }
            rtn.push({pathtype: "root", pathkey: gkey});
            rtn.push(...data[2]);
            return {etype: "path", path: rtn};
        } },
    {"name": "caretPathExpr", "symbols": [(lexer.has("CARET") ? {type: "CARET"} : CARET), "localPathExpr"], "postprocess": (data) => { data[1].path[0].caret = 1; return data[1]; }},
    {"name": "caretPathExpr", "symbols": [(lexer.has("CARET") ? {type: "CARET"} : CARET), "contextPathExpr"], "postprocess": (data) => { data[1].path[0].caret = 1; return data[1]; }},
    {"name": "localPathExpr$ebnf$1$subexpression$1$subexpression$1", "symbols": ["pathPartDyn"]},
    {"name": "localPathExpr$ebnf$1$subexpression$1$subexpression$1", "symbols": ["pathPartBareMap"]},
    {"name": "localPathExpr$ebnf$1$subexpression$1$ebnf$1", "symbols": []},
    {"name": "localPathExpr$ebnf$1$subexpression$1$ebnf$1", "symbols": ["localPathExpr$ebnf$1$subexpression$1$ebnf$1", "pathPartAny"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "localPathExpr$ebnf$1$subexpression$1", "symbols": ["localPathExpr$ebnf$1$subexpression$1$subexpression$1", "localPathExpr$ebnf$1$subexpression$1$ebnf$1"]},
    {"name": "localPathExpr$ebnf$1", "symbols": ["localPathExpr$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "localPathExpr$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "localPathExpr", "symbols": [(lexer.has("DOT") ? {type: "DOT"} : DOT), "localPathExpr$ebnf$1"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push({pathtype: "root", pathkey: "local"});
            if (data[1] != null) {
                rtn.push(data[1][0][0]);
                rtn.push(...data[1][1]);
            }
            return {etype: "path", path: rtn};
        } },
    {"name": "contextPathExpr$ebnf$1", "symbols": []},
    {"name": "contextPathExpr$ebnf$1", "symbols": ["contextPathExpr$ebnf$1", "pathPartAny"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "contextPathExpr", "symbols": [(lexer.has("ATSIGN") ? {type: "ATSIGN"} : ATSIGN), "pathPartBareMap", "contextPathExpr$ebnf$1"], "postprocess":  (data) => {
            let rtn = [];
            rtn.push({pathtype: "root", pathkey: "context"});
            rtn.push(data[1]);
            rtn.push(...data[2]);
            return {etype: "path", path: rtn};
        } },
    {"name": "pathPartAny", "symbols": ["pathPartDot"], "postprocess": id},
    {"name": "pathPartAny", "symbols": ["pathPartDyn"], "postprocess": id},
    {"name": "pathPartBareMap", "symbols": ["idOrKeyword"], "postprocess": (data) => ({pathtype: "map", pathkey: data[0].value})},
    {"name": "pathPartDot", "symbols": [(lexer.has("DOT") ? {type: "DOT"} : DOT), "idOrKeyword"], "postprocess": (data) => ({pathtype: "map", pathkey: data[1].value})},
    {"name": "pathPartDyn", "symbols": ["pathPartDynSimple"], "postprocess": id},
    {"name": "pathPartDyn", "symbols": ["pathPartDynFind"], "postprocess": id},
    {"name": "pathPartDynSimple", "symbols": [(lexer.has("LBRACK") ? {type: "LBRACK"} : LBRACK), "fullExpr", (lexer.has("RBRACK") ? {type: "RBRACK"} : RBRACK)], "postprocess":  (data) => {
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
        } },
    {"name": "pathPartDynFind", "symbols": [(lexer.has("LBRACK") ? {type: "LBRACK"} : LBRACK), (lexer.has("STAR") ? {type: "STAR"} : STAR), "fullExpr", (lexer.has("RBRACK") ? {type: "RBRACK"} : RBRACK)], "postprocess":  (data) => {
            return {pathtype: "dynfind", expr: data[2]};
        } },
    {"name": "stringLit$subexpression$1", "symbols": [(lexer.has("STRSTART_DQ") ? {type: "STRSTART_DQ"} : STRSTART_DQ)]},
    {"name": "stringLit$subexpression$1", "symbols": [(lexer.has("STRSTART_SQ") ? {type: "STRSTART_SQ"} : STRSTART_SQ)]},
    {"name": "stringLit$ebnf$1", "symbols": []},
    {"name": "stringLit$ebnf$1", "symbols": ["stringLit$ebnf$1", "stringLitPart"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "stringLit", "symbols": ["stringLit$subexpression$1", "stringLit$ebnf$1", (lexer.has("STREND") ? {type: "STREND"} : STREND)], "postprocess": (data) => data[1].join("")},
    {"name": "stringLitPart", "symbols": [(lexer.has("STRPART") ? {type: "STRPART"} : STRPART)], "postprocess": (data) => data[0].value},
    {"name": "stringLitPart", "symbols": [(lexer.has("STRESC") ? {type: "STRESC"} : STRESC)], "postprocess": (data) => data[0].value},
    {"name": "idOrKeyword", "symbols": [(lexer.has("ID") ? {type: "ID"} : ID)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_TRUE") ? {type: "KW_TRUE"} : KW_TRUE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_FALSE") ? {type: "KW_FALSE"} : KW_FALSE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_NULL") ? {type: "KW_NULL"} : KW_NULL)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_CALL") ? {type: "KW_CALL"} : KW_CALL)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_INVALIDATE") ? {type: "KW_INVALIDATE"} : KW_INVALIDATE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_FIRE") ? {type: "KW_FIRE"} : KW_FIRE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_NOP") ? {type: "KW_NOP"} : KW_NOP)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_BUBBLE") ? {type: "KW_BUBBLE"} : KW_BUBBLE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_LOG") ? {type: "KW_LOG"} : KW_LOG)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_EXPR") ? {type: "KW_EXPR"} : KW_EXPR)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_LOCAL") ? {type: "KW_LOCAL"} : KW_LOCAL)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_IF") ? {type: "KW_IF"} : KW_IF)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_ELSE") ? {type: "KW_ELSE"} : KW_ELSE)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_THROW") ? {type: "KW_THROW"} : KW_THROW)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_REF") ? {type: "KW_REF"} : KW_REF)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_REPORTERROR") ? {type: "KW_REPORTERROR"} : KW_REPORTERROR)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_SWITCHAPP") ? {type: "KW_SWITCHAPP"} : KW_SWITCHAPP)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_PUSHAPP") ? {type: "KW_PUSHAPP"} : KW_PUSHAPP)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_POPAPP") ? {type: "KW_POPAPP"} : KW_POPAPP)], "postprocess": id},
    {"name": "idOrKeyword", "symbols": [(lexer.has("KW_NAVTO") ? {type: "KW_NAVTO"} : KW_NAVTO)], "postprocess": id},
    {"name": "_$ebnf$1", "symbols": []},
    {"name": "_$ebnf$1", "symbols": ["_$ebnf$1", (lexer.has("WS") ? {type: "WS"} : WS)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "_", "symbols": ["_$ebnf$1"]}
]
  , ParserStart: "fullExpr"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
