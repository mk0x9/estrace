import { parseScript } from 'esprima';
import {
    ExpressionStatement,
    Program,
    CallExpression,
    FunctionExpression,
    Statement,
    FunctionDeclaration,
    Identifier,
    BlockStatement,
    ArrayExpression,
    Expression,
    Pattern,
    Node,
    ObjectExpression,
    Literal
} from 'estree';
import escodegen from 'escodegen';
import estraverse from 'estraverse';

interface Visited {
    visited?: boolean;
}

const incrementStackSize: ExpressionStatement = {
    type: 'ExpressionStatement',
    expression: {
        type: 'UpdateExpression',
        operator: '++',
        argument: {
            type: 'MemberExpression',
            computed: false,
            object: {
                type: 'Identifier',
                name: 'window'
            },
            property: {
                type: 'Identifier',
                name: '__estrace_call_depth'
            }
        },
        prefix: true
    }
};

const decrementStackSize: ExpressionStatement = {
    type: 'ExpressionStatement',
    expression: {
        type: 'UpdateExpression',
        operator: '--',
        argument: {
            type: 'MemberExpression',
            computed: false,
            object: {
                type: 'Identifier',
                name: 'window'
            },
            property: {
                type: 'Identifier',
                name: '__estrace_call_depth'
            }
        },
        prefix: true
    }
};

function instrumentFunction(
    fileUrl: string,
    f: FunctionDeclaration | FunctionExpression,
    parent: Node | null
) {
    let functionName: string | null = null;
    if (f.id) {
        functionName = f.id.name;
    } else {
        if (
            parent &&
            parent.type === 'AssignmentExpression' &&
            parent.operator === '=' &&
            parent.right === f
        ) {
            if (
                parent.left.type === 'MemberExpression' &&
                parent.left.computed === false &&
                parent.left.property.type === 'Identifier'
            ) {
                functionName = parent.left.property.name;
            } else if (parent.left.type === 'Identifier') {
                functionName = parent.left.name;
            } else {
                // console.error(escodegen.generate(parent));
                // debugger;
            }
        } else if (
            parent &&
            parent.type === 'Property' &&
            parent.value === f &&
            parent.key.type === 'Identifier'
        ) {
            functionName = parent.key.name;
        } else if (
            parent &&
            parent.type === 'VariableDeclarator' &&
            parent.init === f &&
            parent.id.type === 'Identifier'
        ) {
            functionName = parent.id.name;
        } else {
            // console.warn(escodegen.generate(parent));
            // debugger;
        }
    }
    (f as Visited).visited = true;

    let loc: Literal | ObjectExpression;
    if (f && f.loc) {
        loc = {
            type: 'ObjectExpression',
            properties: [
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 's'
                    },
                    computed: false,
                    value: {
                        type: 'ArrayExpression',
                        elements: [
                            {
                                type: 'Literal',
                                value: f.loc.start.line,
                                raw: JSON.stringify(f.loc.start.line)
                            },
                            {
                                type: 'Literal',
                                value: f.loc.start.column,
                                raw: JSON.stringify(f.loc.start.column)
                            }
                        ]
                    },
                    kind: 'init',
                    method: false,
                    shorthand: false
                },
                {
                    type: 'Property',
                    key: {
                        type: 'Identifier',
                        name: 'e'
                    },
                    computed: false,
                    value: {
                        type: 'ArrayExpression',
                        elements: [
                            {
                                type: 'Literal',
                                value: f.loc.end.line,
                                raw: JSON.stringify(f.loc.end.line)
                            },
                            {
                                type: 'Literal',
                                value: f.loc.end.column,
                                raw: JSON.stringify(f.loc.end.column)
                            }
                        ]
                    },
                    kind: 'init',
                    method: false,
                    shorthand: false
                }
            ]
        };
    } else {
        loc = {
            type: 'Literal',
            value: null,
            raw: 'null'
        };
    }

    const instrumentation: ExpressionStatement = {
        type: 'ExpressionStatement',
        expression: {
            type: 'CallExpression',
            callee: {
                type: 'MemberExpression',
                computed: false,
                object: {
                    type: 'MemberExpression',
                    computed: false,
                    object: {
                        type: 'Identifier',
                        name: 'window'
                    },
                    property: {
                        type: 'Identifier',
                        name: '__estrace'
                    }
                },
                property: { type: 'Identifier', name: 'push' }
            },
            arguments: [
                {
                    type: 'ArrayExpression',
                    elements: [
                        {
                            type: 'Literal',
                            value: fileUrl,
                            raw: JSON.stringify(fileUrl)
                        },
                        incrementStackSize.expression,
                        {
                            type: 'Literal',
                            value: functionName,
                            raw: JSON.stringify(functionName)
                        },
                        loc,
                        ...((f.params.filter(
                            param => param.type === 'Identifier'
                        ) as Identifier[]).map(param => ({
                            type: 'ArrayExpression',
                            elements: [
                                {
                                    type: 'Literal',
                                    value: param.name,
                                    raw: JSON.stringify(param.name)
                                },
                                param
                            ]
                        })) as Expression[])
                    ]
                }
            ]
        }
    };

    f.body.body = [instrumentation, ...f.body.body, decrementStackSize];
}

function instrument(fileUrl: string, ast: Program) {
    estraverse.replace(ast, {
        enter(node, parent) {
            if ((node as Visited).visited) {
                return node;
            }

            if (node.type === 'ReturnStatement') {
                // wrap return into block and decrease stack size
                const block: BlockStatement = {
                    type: 'BlockStatement',
                    body: [decrementStackSize, node]
                };

                (node as Visited).visited = true;

                return block;
            }

            if (
                node.type === 'FunctionDeclaration' ||
                node.type === 'FunctionExpression'
            ) {
                instrumentFunction(fileUrl, node, parent);
            }

            return node;
        }
    });
}

export default function processAst(fileUrl: string, ast: Program): Program {
    const inject = parseScript(`
(function(){
    if (!('__estrace' in window)) {
        window.__estrace = [];
    }
    if (!('__estrace_call_depth' in window)) {
        window.__estrace_call_depth = 0;
    }
})();
`);

    (((inject.body[0] as ExpressionStatement).expression as CallExpression)
        .callee as FunctionExpression).body.body.push(
        ...(ast.body as Statement[])
    );

    instrument(fileUrl, ast);

    return inject;
}
