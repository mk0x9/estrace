import { parseScript } from 'esprima';
import {
    ExpressionStatement,
    Program,
    CallExpression,
    FunctionExpression,
    Statement,
    FunctionDeclaration,
    Identifier,
    BlockStatement
} from 'estree';
import estraverse from 'estraverse';

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
    f: FunctionDeclaration | FunctionExpression
) {
    let functionName: string | null;
    if (f.id) {
        functionName = f.id.name;
    } else {
        functionName = null;
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
                            raw: JSON.stringify(f.id)
                        },
                        ...(f.params.filter(
                            param => param.type === 'Identifier'
                        ) as Identifier[])
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
            if (node.type === 'ReturnStatement') {
                // wrap return into block and decrease stack size
                if (
                    parent &&
                    (parent.type !== 'BlockStatement' || // do not process already wrapped returns
                        (parent.type === 'BlockStatement' &&
                            parent.body.length !== 2 &&
                            parent.body[0] !== decrementStackSize))
                ) {
                    const block: BlockStatement = {
                        type: 'BlockStatement',
                        body: [decrementStackSize, node]
                    };

                    return block;
                }
            }
            if (
                node.type === 'FunctionDeclaration' ||
                node.type === 'FunctionExpression'
            ) {
                instrumentFunction(fileUrl, node);
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
