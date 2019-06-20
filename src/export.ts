import * as ts from 'typescript';

function isVarConst(node: ts.VariableDeclaration): boolean {
    return !!(ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    if (node && node.modifiers) {
        return !!node.modifiers.find(mod => mod.kind == kind);
    }
    return false;
}

function addExportModifier(node: ts.Node) {
    const modifiers: ts.Modifier[] = [
        ts.createModifier(ts.SyntaxKind.ExportKeyword)
    ];
    if (node.modifiers) node.modifiers.forEach(m => {
        if (m.kind !== ts.SyntaxKind.ExportKeyword) {
            modifiers.push(m);
        }
    })
    return modifiers;
}

function collectBindingNames(binding: ts.BindingName, output: string[]) {
    if (ts.isIdentifier(binding)) {
        output.push(binding.text);
    }
    else if (ts.isObjectBindingPattern(binding)) {
        binding.elements.forEach(element => {
            collectBindingNames(element.name, output);
        });
    }
    else if (ts.isArrayBindingPattern(binding)) {
        binding.elements.forEach(element => {
            if (!ts.isOmittedExpression(element)) {
                collectBindingNames(element.name, output);
            }
        });
    }
}

function createLHSExpression(fullName: string) {
    let names = fullName.split('.');
    let lhs: ts.Expression = ts.createIdentifier(names[0]);

    for (let i = 1; i < names.length; i++) {
        lhs = ts.createPropertyAccess(lhs, ts.createIdentifier(names[i]));
    }
    return lhs;
}

function appendStatements(sourceFile: ts.SourceFile, statements: ts.Statement[]) {
    return ts.updateSourceFileNode(
        sourceFile,
        sourceFile.statements.concat(statements),
        sourceFile.isDeclarationFile,
        sourceFile.referencedFiles,
        sourceFile.typeReferenceDirectives,
        sourceFile.hasNoDefaultLib,
        sourceFile.libReferenceDirectives
    );
}

export function getTopLevelNames(sourceFile: ts.SourceFile): string[] {
    const names: string[] = [];

    // skip declaration file.
    if (sourceFile.isDeclarationFile) {
        return names;
    }
    sourceFile.statements.forEach(stmt => {
        // skip ambient declaration.
        if (hasModifier(stmt, ts.SyntaxKind.DeclareKeyword)) {
            return;
        }
        // variable
        if (ts.isVariableStatement(stmt)) {
            const declarations = stmt.declarationList.declarations;
            const constants = declarations.filter(isVarConst);

            constants.forEach(declaration => {
                collectBindingNames(declaration.name, names);
            });
        }
        else if (
            ts.isImportEqualsDeclaration(stmt) ||   // import alias
            ts.isModuleDeclaration(stmt) ||         // namespace/module
            ts.isClassDeclaration(stmt) ||          // class
            ts.isFunctionDeclaration(stmt)          // function
        ) {
            if (stmt.name && ts.isIdentifier(stmt.name)) {
                names.push(stmt.name.text);
            }
        }
        // enum
        else if (ts.isEnumDeclaration(stmt)) {
            // skip const enum.
            if (!hasModifier(stmt, ts.SyntaxKind.ConstKeyword)) {
                names.push(stmt.name.text);
            }
        }
    });
    return names;
}

export function modulizeESM(sourceFile: ts.SourceFile, exports: string[]) {
    const specifiers = exports.map(name => ts.createExportSpecifier(undefined, name));
    const namedExport = ts.createNamedExports(specifiers);
    const statements = ts.createExportDeclaration(undefined, undefined, namedExport);

    return appendStatements(sourceFile, [statements]);
}

export function modulizeCJS(sourceFile: ts.SourceFile, exports: string[]) {
    return modulizeGlobal(sourceFile, exports, 'module.exports');
}

export function modulizeGlobal(sourceFile: ts.SourceFile, exports: string[], namespace: string) {
    const statements = exports.map(name => {
        const lhs = createLHSExpression(namespace + '.' + name);
        const statement = ts.createExpressionStatement(
            ts.createAssignment(lhs, ts.createIdentifier(name))
        );
        statement.parent = sourceFile;
        return statement;
    });
    return appendStatements(sourceFile, statements);
}

export function modulizeDTS(sourceFile: ts.SourceFile) {
    const statements = sourceFile.statements.map(statement => {
        // variable
        if (ts.isVariableStatement(statement)) {
            const declarations = statement.declarationList.declarations;

            // skip non-const
            if (!declarations.find(d => !isVarConst(d))) {
                return ts.updateVariableStatement(
                    statement,
                    addExportModifier(statement),
                    statement.declarationList
                );
            }
        }
        // enum
        else if (ts.isEnumDeclaration(statement)) {
            return ts.updateEnumDeclaration(statement,
                statement.decorators,
                addExportModifier(statement),
                statement.name,
                statement.members
            );
        }
        // namespace/module
        else if (ts.isModuleDeclaration(statement)) {
            return ts.updateModuleDeclaration(
                statement,
                statement.decorators,
                addExportModifier(statement),
                statement.name,
                statement.body
            );
        }
        // alias
        else if (ts.isImportEqualsDeclaration(statement)) {
            return ts.updateImportEqualsDeclaration(
                statement,
                statement.decorators,
                addExportModifier(statement),
                statement.name,
                statement.moduleReference
            );
        }
        // class
        else if (ts.isClassDeclaration(statement)) {
            return ts.updateClassDeclaration(
                statement,
                statement.decorators,
                addExportModifier(statement),
                statement.name,
                statement.typeParameters,
                statement.heritageClauses,
                statement.members
            );
        }
        // function
        else if (ts.isFunctionDeclaration(statement)) {
            return ts.updateFunctionDeclaration(
                statement,
                statement.decorators,
                addExportModifier(statement),
                statement.asteriskToken,
                statement.name,
                statement.typeParameters,
                statement.parameters,
                statement.type,
                statement.body
            );
        }
        return statement;
    });

    return ts.updateSourceFileNode(
        sourceFile,
        statements,
        sourceFile.isDeclarationFile,
        sourceFile.referencedFiles,
        sourceFile.typeReferenceDirectives,
        sourceFile.hasNoDefaultLib,
        sourceFile.libReferenceDirectives
    );
}
