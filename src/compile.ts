import * as path from 'path';
import * as ts from 'typescript';
import { getTopLevelNames, modulizeCJS, modulizeDTS, modulizeESM, modulizeGlobal } from './export';
import { sortSourceFiles } from './sort';

export type EmitResult = ts.EmitResult;
export type WriteFileCallback = ts.WriteFileCallback;
export type DiagnosticReporter = ts.DiagnosticReporter;
export type WatchStatusReporter = ts.WatchStatusReporter;
export type EmitResultCallback = (result: EmitResult) => void;
export type WatchProgram = ts.Watch<ts.BuilderProgram>;

export interface CompilerOptions extends ts.CompilerOptions {
    bundleOutput?: string;
    bundleGlobal?: string;
    bundleModule?: "commonjs" | "es6";
}

export interface Program extends ts.Program {
    getCompilerOptions(): CompilerOptions;
}

export interface CompileOptions {
    project: string | string[];
    compilerOptions?: CompilerOptions;
    transformers?: ts.CustomTransformers;
    onEmitFile?: WriteFileCallback;
    onEmitResult?: EmitResultCallback;
    reportDiagnostic?: DiagnosticReporter;
}

export interface WatchOptions extends CompileOptions {
    reportWatchStatus?: WatchStatusReporter;
}

const formatHost: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: path => path,
    getNewLine: () => ts.sys.newLine,
};

export function reportDiagnostic(diagnostics: ts.Diagnostic) {
    console.info(ts.formatDiagnostic(diagnostics, formatHost));
}

export function reportDiagnosticColored(diagnostics: ts.Diagnostic) {
    console.info(ts.formatDiagnosticsWithColorAndContext([diagnostics], formatHost));
}

export function compile(options: CompileOptions): Program | undefined {
    const { errors, fileNames, options: compilerOptions } = getParsedCommandline(options);
    const program = ts.createProgram(fileNames, compilerOptions, undefined, undefined, errors);
    const onEmitFile = hookWriteFile(compilerOptions, options.onEmitFile || ts.sys.writeFile);

    if (program) {
        const result = program.emit(
            undefined, onEmitFile, undefined, undefined,
            getTransformers(program, options.transformers)
        );
        if (result.diagnostics && options.reportDiagnostic) {
            result.diagnostics.forEach(options.reportDiagnostic);
        }
        if (options.onEmitResult) {
            options.onEmitResult(result);
        }
    }
    return program;
}

export function watch(options: WatchOptions): WatchProgram {
    interface WatchHost {
        createProgram: ts.CreateProgram<ts.BuilderProgram>
    }
    function hookWatchHost<T extends WatchHost>(host: T) {
        const createProgram = host.createProgram;

        host.createProgram = (rootNames, _, host, ...rest) => {
            const { options: compilerOptions } = getParsedCommandline(options);
            const program = createProgram(rootNames, compilerOptions, host, ...rest);
            const { getSemanticDiagnostics, emit } = program;
            const onEmitFile = hookWriteFile(compilerOptions, options.onEmitFile);

            // suppress TS2449: blah blah used before its declaration.
            program.getSemanticDiagnostics = (...rest) => {
                return getSemanticDiagnostics(...rest)
                    .filter(diagnostic => diagnostic.code !== 2449);
            };
            program.emit = (sourceFile, _writeFile, cancellationToken, writeBOM) => {
                const transformers = getTransformers(program.getProgram(), options.transformers);
                const result = emit(sourceFile, onEmitFile, cancellationToken, writeBOM, transformers);

                if (options.onEmitResult) options.onEmitResult(result);
                return result;
            };
            return program;
        }
        return host;
    }
    if (Array.isArray(options.project)) {
        const host = ts.createWatchCompilerHost(options.project, {}, ts.sys, undefined, options.reportDiagnostic, options.reportWatchStatus);
        return ts.createWatchProgram(hookWatchHost(host));
    }
    if (typeof options.project === 'string') {
        const host = ts.createWatchCompilerHost(options.project, {}, ts.sys, undefined, options.reportDiagnostic, options.reportWatchStatus);
        return ts.createWatchProgram(hookWatchHost(host));
    }
    throw Error(`Option "project" should be either an Array or a string: ${typeof options.project}`);
}

function normalizeConfigJSON(raw: any) {
    delete raw.bundleOutput;
    delete raw.bundleGlobal;
    delete raw.bundleOutput;
    return raw;
}

function getExtensionOptions(raw: any) {
    const options: CompilerOptions = {};

    if (raw.hasOwnProperty('bundleOutput')) {
        options.bundleOutput = raw.bundleOutput;
    }
    if (raw.hasOwnProperty('bundleGlobal')) {
        options.bundleGlobal = raw.bundleGlobal;
    }
    if (raw.hasOwnProperty('bundleModule')) {
        options.bundleModule = raw.bundleModule;
    }
    return options;
}

function mergeCompilerOptions(options: ts.CompilerOptions, ...others: (CompilerOptions | undefined)[]) {
    const merged = Object.assign(options, ...others);

    if (merged.bundleOutput) {
        options.outFile = merged.bundleOutput;
        // override module option
        switch (merged.module) {
            case ts.ModuleKind.None:
            case ts.ModuleKind.AMD:
            case ts.ModuleKind.System:
                break;
            default:
                merged.module = ts.ModuleKind.None;
        }
    }
    return merged;
}

function getParsedCommandline(options: CompileOptions): ts.ParsedCommandLine {
    if (typeof options.project === 'string') {
        const configFile = ts.readConfigFile(options.project, ts.sys.readFile);
        const extensions = getExtensionOptions(configFile.config);
        const normalized = normalizeConfigJSON(configFile.config);
        const parsedConfig = ts.parseJsonConfigFileContent(normalized, {
            useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
            readDirectory: ts.sys.readDirectory,
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
        }, path.dirname(options.project));

        if (configFile.error) {
            parsedConfig.errors.unshift(configFile.error);
        }
        parsedConfig.options = mergeCompilerOptions(
            parsedConfig.options,
            extensions,
            options.compilerOptions
        );
        return parsedConfig;
    }
    return {
        errors: [],
        fileNames: options.project,
        options: Object.assign({}, options.compilerOptions)
    };
}

function safeWriteFile(fileName: string, data: string, writeBOM: boolean, onError?: (message: string) => void) {
    try {
        ts.sys.writeFile(fileName, data, writeBOM);
    }
    catch (error) {
        if (onError) onError(error.message);
    }
}

function hookWriteFile(options: ts.CompilerOptions, writeFileCallback: ts.WriteFileCallback = safeWriteFile): ts.WriteFileCallback {
    if (!options.bundleModule) return writeFileCallback;

    return function (fileName: string, data: string, ...rest) {
        const extname = path.extname(fileName);
        const basename = path.basename(fileName, extname);

        if (extname === '.ts' && path.extname(basename) === '.d') {
            const sourceFile = ts.createSourceFile(fileName, data, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            const modulized = modulizeDTS(sourceFile);
            data = ts.createPrinter().printFile(modulized);
        }
        return writeFileCallback(fileName, data, ...rest);
    }
}

function getTransformers(program: ts.Program, transformers?: ts.CustomTransformers): ts.CustomTransformers {
    const exports = new Map<string, string[]>();

    function preTransformer(context: ts.TransformationContext) {
        return {
            transformSourceFile(node: ts.SourceFile) {
                return node;
            },
            transformBundle(node: ts.Bundle) {
                node.sourceFiles.forEach(sourceFile => {
                    exports.set(sourceFile.fileName, getTopLevelNames(sourceFile));
                });
                return ts.updateBundle(node, sortSourceFiles(program, node.sourceFiles));
            },
        };
    }

    function postTransformer(context: ts.TransformationContext) {
        const options = context.getCompilerOptions();
        return {
            transformSourceFile(node: ts.SourceFile) {
                return node;
            },
            transformBundle(node: ts.Bundle) {
                const sourceFiles = node.sourceFiles.map(sourceFile => {
                    const names = exports.get(sourceFile.fileName);

                    if (names) {
                        if (typeof options.bundleGlobal === 'string') {
                            sourceFile = modulizeGlobal(sourceFile, names, options.bundleGlobal);
                        }
                        if (options.bundleModule === 'commonjs') {
                            sourceFile = modulizeCJS(sourceFile, names);
                        }
                        if (options.bundleModule === 'es6') {
                            sourceFile = modulizeESM(sourceFile, names);
                        }
                    }
                    return sourceFile;
                });
                exports.clear();
                return ts.updateBundle(node, sourceFiles);
            }

        };
    }
    return {
        before: [preTransformer, ...(transformers && transformers.before || [])],
        after: [postTransformer, ...(transformers && transformers.after || [])],
        afterDeclarations: [...(transformers && transformers.afterDeclarations || [])]
    }
}