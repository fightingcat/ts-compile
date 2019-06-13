import ts from 'typescript';
import { sortSourceFiles } from './sort';
import { exportTopLevelSymbols } from './export';

export function compile(configPath: string, outFile: string) {
    const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, parseConfigHost);
    const program = config && ts.createProgram(config.fileNames, { ...config.options, outFile });

    if (program) {
        program.emit(undefined, undefined, undefined, undefined, {
            before: [
                getTransformerFactory(program)
            ]
        });
    }
}

export function watch(configPath: string, outFile: string) {
    const host = ts.createWatchCompilerHost(configPath, {}, ts.sys, undefined, reportDiagnostic);
    const createProgram = host.createProgram;

    host.createProgram = (rootNames, options, ...rest) => {
        const program = createProgram(rootNames, { ...options, outFile }, ...rest);
        const emit = program.emit;

        program.emit = (a, b, c, d, e) => emit(a, b, c, d, {
            before: [
                getTransformerFactory(program.getProgram())
            ]
        });
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

function getTransformerFactory(program: ts.Program) {
    function transformSourceFile(node: ts.SourceFile) {
        return node;
    }
    function transformBundle(node: ts.Bundle) {
        const sortedFiles = sortSourceFiles(program, node.sourceFiles);
        return ts.updateBundle(node, sortedFiles.map(exportTopLevelSymbols));
    }
    function nothingTransformer(context: ts.TransformationContext) {
        return transformSourceFile;
    }
    function bundleTransformer(context: ts.TransformationContext) {
        return { transformSourceFile, transformBundle };
    }
    if (program.getCompilerOptions().outFile) {
        return bundleTransformer;
    }
    return nothingTransformer;
}
