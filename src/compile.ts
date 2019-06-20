import * as path from 'path';
import * as ts from 'typescript';
import { sortSourceFiles } from './sort';
import { getTopLevelNames, modulizeGlobal, modulizeCJS, modulizeESM, modulizeDTS } from './export';

interface Options {
    config: string;
    output: string;
    global?: string;
    module?: "esm" | "cjs";
}

export function compile(options: Options) {
    const config = ts.getParsedCommandLineOfConfigFile(options.config, {}, parseConfigHost);

    if (config) {
        const mergedOptions = { ...config.options, outFile: options.output };
        const program = ts.createProgram(config.fileNames, mergedOptions);
        const transformers = getTransformers(program, options);

        if (program) {
            program.emit(undefined, transformers.fileWriter, undefined, undefined, {
                before: [transformers.preTransformer],
                after: [transformers.postTransformer],
            });
        }
    }
}

export function watch(options: Options) {
    const host = ts.createWatchCompilerHost(options.config, {}, ts.sys, undefined, reportDiagnostic);
    const createProgram = host.createProgram;

    host.createProgram = (rootNames, compilerOptions, ...rest) => {
        const mergedOptions = { ...compilerOptions, outFile: options.output };
        const program = createProgram(rootNames, mergedOptions, ...rest);
        const transformers = getTransformers(program.getProgram(), options);
        const getSemanticDiagnostics = program.getSemanticDiagnostics;
        const emit = program.emit;

        // suppress TS2449: blah blah used before its declaration.
        program.getSemanticDiagnostics = (...rest) => {
            return getSemanticDiagnostics(...rest)
                .filter(diagnostic => diagnostic.code !== 2449);
        };
        program.emit = (a, b, c, d, e) => {
            return emit(a, transformers.fileWriter, c, d, {
                before: [transformers.preTransformer],
                after: [transformers.postTransformer],
            });
        };
        return program;
    };
    ts.createWatchProgram(host);
    console.info("Auto compilation started.");
}

const parseConfigHost: ts.ParseConfigFileHost = {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    onUnRecoverableConfigFileDiagnostic: reportDiagnostic,
};

const formatHost: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: path => path,
    getNewLine: () => ts.sys.newLine,
};

function reportDiagnostic(diagnostic: ts.Diagnostic) {
    console.info(ts.formatDiagnosticsWithColorAndContext([diagnostic], formatHost));
}

function getTransformers(program: ts.Program, options: Options) {
    const exports = new Map<string, string[]>();

    function transformNothing(node: ts.SourceFile) {
        return node;
    }

    function sortBundleSourceFiles(node: ts.Bundle) {
        node.sourceFiles.forEach(sourceFile => {
            exports.set(sourceFile.fileName, getTopLevelNames(sourceFile));
        });
        return ts.updateBundle(node, sortSourceFiles(program, node.sourceFiles));
    }

    function modulizeBundleFile(node: ts.Bundle) {
        const sourceFiles = node.sourceFiles.map(sourceFile => {
            const names = exports.get(sourceFile.fileName);

            if (names) {
                if (options.global) {
                    sourceFile = modulizeGlobal(sourceFile, names, options.global);
                }
                if (options.module === 'cjs') {
                    sourceFile = modulizeCJS(sourceFile, names);
                }
                if (options.module === 'esm') {
                    sourceFile = modulizeESM(sourceFile, names);
                }
            }
            return sourceFile;
        });
        exports.clear();
        return ts.updateBundle(node, sourceFiles);
    }

    function preTransformer() {
        return {
            transformSourceFile: transformNothing,
            transformBundle: sortBundleSourceFiles,
        };
    }

    function postTransformer() {
        return {
            transformSourceFile: transformNothing,
            transformBundle: modulizeBundleFile,
        };
    }

    function fileWriter(fileName: string, data: string, writeBOM: boolean) {
        const extname = path.extname(fileName);
        const basename = path.basename(fileName, extname);

        if (extname === '.ts' && path.extname(basename) === '.d') {
            const sourceFile = ts.createSourceFile(fileName, data, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            const modulized = modulizeDTS(sourceFile);
            const printer = ts.createPrinter();
            data = printer.printFile(modulized);
        }
        return ts.sys.writeFile(fileName, data, writeBOM);
    }

    return { preTransformer, postTransformer, fileWriter };
}