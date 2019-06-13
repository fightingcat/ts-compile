import ts from 'typescript';

export function exportTopLevelSymbols(sourceFile: ts.SourceFile) {
    const exports: ts.Statement[] = [];

    sourceFile.statements.forEach(stmt => {
        // skip ambient declaration
        if (hasModifier(stmt, ts.SyntaxKind.DeclareKeyword)) {
            return;
        }
        // variable
        if (ts.isVariableStatement(stmt)) {
            stmt.declarationList.declarations.forEach(declaration => {
                if (isVarConst(declaration) && ts.isIdentifier(declaration.name)) {
                    exports.push(createExport(stmt.parent, declaration.name));
                }
            });
        }
        // enum
        if (ts.isEnumDeclaration(stmt)) {
            // skip const enum
            if (!hasModifier(stmt, ts.SyntaxKind.ConstKeyword)) {
                exports.push(createExport(stmt.parent, stmt.name));
            }
        }
        if (
            ts.isModuleDeclaration(stmt) ||         // namespace/module
            ts.isImportEqualsDeclaration(stmt) ||   // alias
            ts.isClassDeclaration(stmt) ||          // class
            ts.isFunctionDeclaration(stmt)          // function
        ) {
            if (stmt.name && ts.isIdentifier(stmt.name)) {
                exports.push(createExport(stmt.parent, stmt.name));
            }
        }
    });

    return ts.updateSourceFileNode(
        sourceFile,
        sourceFile.statements.concat(exports),
        sourceFile.isDeclarationFile,
        sourceFile.referencedFiles,
        sourceFile.typeReferenceDirectives,
        sourceFile.hasNoDefaultLib,
        sourceFile.libReferenceDirectives
    );
}

function isVarConst(node: ts.VariableDeclaration): boolean {
    return !!(ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    if (node && node.modifiers) {
        return !!node.modifiers.find(mod => mod.kind == kind);
    }
    return false;
}

function createExport(parent: ts.Node, identifier: ts.Identifier) {
    const module = ts.createIdentifier('module');
    const exports = ts.createPropertyAccess(module, 'exports');
    const lhs = ts.createPropertyAccess(exports, identifier.text);
    const assignment = ts.createExpressionStatement(
        ts.createAssignment(lhs, ts.createIdentifier(identifier.text))
    );
    assignment.parent = parent;
    return assignment;
}
