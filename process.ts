import { parseScript, Program } from 'esprima';

const inject = parseScript(`
(function(){
  console.log('Hi from estracer');
}());
`);

export default function processAst(ast: Program): Program {
    const newAst: Program = { ...ast };

    newAst.body = [...inject.body, ...newAst.body];

    return newAst;
}
