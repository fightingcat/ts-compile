#!/usr/bin/env node
import * as fs from 'fs';
import * as ts from 'typescript';
import { Command } from 'commander';
import { compile, watch } from './compile';

const formatHost: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: path => path,
    getNewLine: () => ts.sys.newLine,
};

function reportDiagnostic(diagnostics: ts.Diagnostic) {
    console.info(ts.formatDiagnosticsWithColorAndContext([diagnostics], formatHost));
}

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
            reportWatchStatus: reportDiagnostic,
            reportDiagnostic,
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
            reportDiagnostic
        })
    }
}

executeCommand(new Command()
    .version(require('../package.json').version)
    .option('-w, --watch', 'compile in watch mode')
    .option('-p, --project <file>', 'project path or tsconfig.json path')
    .option('-o, --bundleOutput <file>', 'file path to output bundle file')
    .option('-m, --bundleModule [format]', 'export top-level names (format: "es6", "commonjs")')
    .option('-g, --bundleGlobal [namespace]', 'export top-level names to a namespace')
    .parse(process.argv)
);