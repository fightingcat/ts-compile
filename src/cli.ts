#!/usr/bin/env node
import fs from 'fs';
import { Command } from 'commander';
import { compile, watch } from './compile';

function executeCommand(program: Command) {
    const opts = program.opts();

    if (!opts.outFile || !opts.config) {
        program.outputHelp();
        return process.exit(1);
    }
    if (!fs.existsSync(opts.config)) {
        console.error(`Specified config file not exists.`);
        return process.exit(2);
    }
    if (opts.watch) watch(opts.config, opts.outFile);
    else compile(opts.config, opts.outFile);
}

executeCommand(new Command()
    .version('1.0.0')
    .option('-w, --watch', 'watch mode')
    .option('-c, --config <path>', 'config file')
    .option('-o, --outFile <path>', 'output file')
    .parse(process.argv)
);