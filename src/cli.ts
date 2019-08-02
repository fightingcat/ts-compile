#!/usr/bin/env node
import * as fs from 'fs';
import { Command } from 'commander';
import { compile, watch, reportDiagnosticColored } from './compile';

function executeCommand(program: Command) {
    const opts = program.opts();

    if (!opts.project || !opts.project) {
        program.outputHelp();
        return process.exit(1);
    }
    if (!fs.existsSync(opts.project)) {
        console.error(`Specified config file not exists.\n`);
        return process.exit(3);
    }
    if (opts.bundleModule) {
        if (opts.bundleModule !== 'es6' && opts.bundleModule !== 'commonjs') {
            console.error(`Unkown module format "${opts.bundleModule}".\n`);
            program.outputHelp();
            return process.exit(2);
        }
    }
    if (opts.watch) {
        watch({
            compilerOptions: {
                bundleOutput: opts.bundleOutput,
                bundleModule: opts.bundleModule,
                bundleGlobal: opts.bundleGlobal,
            },
            project: opts.project,
            reportWatchStatus: reportDiagnosticColored,
            reportDiagnostic: reportDiagnosticColored,
        });
    }
    else {
        compile({
            compilerOptions: {
                bundleOutput: opts.bundleOutput,
                bundleModule: opts.bundleModule,
                bundleGlobal: opts.bundleGlobal,
            },
            project: opts.project,
            reportDiagnostic: reportDiagnosticColored
        })
    }
}

executeCommand(new Command()
    .version(require('../package.json').version)
    .option('-w, --watch', 'compile in watch mode')
    .option('-p, --project <path>', 'tsconfig.json path')
    .option('-o, --bundleOutput <path>', 'file path to output bundle file')
    .option('-m, --bundleModule [format]', 'export top-level names (format: "es6", "commonjs")')
    .option('-g, --bundleGlobal [namespace]', 'export top-level names to a namespace')
    .parse(process.argv)
);