import * as url from 'url';
import * as http from 'http';
import httpProxy from 'http-proxy';
import { parseScript, Program } from 'esprima';
import escodegen from 'escodegen';
import zlib from 'zlib';

import processAst from './process';

const { argv } = process;

const lastArg = argv[argv.length - 1];
const passedUrl = url.parse(lastArg);

const PORT = 8080;
const BIND_HOST = '127.0.0.1';

console.log(
    `proxying http://${BIND_HOST}:${PORT}/abc to http://${passedUrl.host}${
        passedUrl.port !== null && passedUrl.port !== '80'
            ? ':' + passedUrl.port
            : ''
    }/abc`
);

const proxy = httpProxy.createProxyServer({
    ws: false,
    xfwd: false,
    preserveHeaderKeyCase: true,
    target: passedUrl,
    selfHandleResponse: true
});

proxy.on(
    'proxyRes',
    (
        proxyRes: http.IncomingMessage,
        req: http.IncomingMessage,
        res: http.ServerResponse
    ) => {
        let body = Buffer.alloc(0);
        proxyRes.on('data', data => {
            body = Buffer.concat([body, data]);
        });
        proxyRes.on('end', () => {
            const contentEncoding = (
                proxyRes.headers['content-encoding'] || ''
            ).toLowerCase();

            const isGzipped = contentEncoding === 'gzip';
            const isBrotli = contentEncoding === 'br';

            let sBody;
            if (isGzipped) {
                sBody = zlib.gunzipSync(body).toString();
            } else if (isBrotli) {
                sBody = zlib.brotliDecompressSync(body).toString();
            } else {
                sBody = body.toString();
            }

            let ast: Program | undefined;
            if (sBody.trim() !== '') {
                try {
                    ast = parseScript(sBody);
                } catch {}
            }

            // if (ast) {
            //    console.log(req.url);
            //    console.log('got ast:');
            //    console.log(ast);
            // }

            const headers: http.IncomingHttpHeaders = {};
            for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
                const headerName = proxyRes.rawHeaders[i];
                const headerValue = proxyRes.rawHeaders[i + 1];

                if (
                    /^content-security-policy/i.test(headerName) ||
                    (ast && /^content-length/i.test(headerName)) ||
                    ((isGzipped || isBrotli) &&
                        ast &&
                        /^content-encoding/i.test(headerName))
                ) {
                    continue;
                }

                headers[headerName] = headerValue;
            }

            res.writeHead(
                proxyRes.statusCode || 200,
                proxyRes.statusMessage,
                headers
            );
            if (!ast) {
                res.end(body);
            } else {
                res.end(escodegen.generate(processAst(ast)));
            }
        });
    }
);

const server = http.createServer((req, res) => {
    req.headers.host = passedUrl.host;

    proxy.web(req, res);
});

proxy.on('error', error => {
    console.error('error', error);
});

server.listen(PORT);
