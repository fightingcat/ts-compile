#!/usr/bin/env node
import * as fs from 'fs';
import { Command } from 'commander';
import { compile, watch } from './compile';

function executeCommand(program: Command) {
    const opts = program.opts();
    const options = {
        config: opts.config,
        output: opts.output,
        module: opts.module,
        global: opts.global,
    };

    if (!options.config || !options.output) {
        program.outputHelp();
        return process.exit(1);
    }
    if (options.module !== 'esm' || options.module !== 'cjs') {
        console.error(`Unkown module format "${options.module}".\n`);
        program.outputHelp();
        return process.exit(2);
    }
    if (!fs.existsSync(options.config)) {
        console.error(`Specified config file not exists.\n`);
        return process.exit(3);
    }
    opts.watch ? watch(options) : compile(options);
}

executeCommand(new Command()
    .version('1.0.0')
    .option('-w, --watch', 'compile in watch mode')
    .option('-c, --config <file>', 'tsconfig file')
    .option('-o, --output <file>', 'output file')
    .option('-m, --module [format]', 'export top-level names (format: "esm", "cjs")')
    .option('-g, --global [namespace]', 'export top-level names to a namespace')
    .parse(process.argv)
);