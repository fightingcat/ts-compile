import * as ts from 'typescript';

export function sortSourceFiles(program: ts.Program, sourceFiles: readonly ts.SourceFile[]) {
    const checker = program.getTypeChecker();
    const dependencies = new Map<ts.SourceFile, Set<ts.SourceFile>>();
    const funcBranches = new Map<ts.Block, Set<ts.Expression>>();
    const maxCallDepth = new Map<ts.Node, number>();
    const sortedFiles: ts.SourceFile[] = [];
    const sorted = new Set();
    const visited = new Set();

    let currentFile: ts.SourceFile;
    let currentFunc: Set<ts.Expression> | undefined;

    sourceFiles.forEach(visitSourceFile);
    sourceFiles.forEach(sortSourceFile);
    return sortedFiles;

    function sortSourceFile(file: ts.SourceFile) {
        if (visited.has(file)) {
            return;
        }
        if (dependencies.has(file)) {
            visited.add(file);
            dependencies.get(file)!.forEach(sortSourceFile);
            visited.delete(file);
        }
        if (!sorted.has(file.fileName)) {
            sortedFiles.push(file);
            sorted.add(file.fileName);
        }
    }

    function addDependency(node: ts.SourceFile, dependency: ts.SourceFile) {
        ts.updateSourceFileNode(
            node,
            node.statements,
            node.isDeclarationFile,
            [...node.referencedFiles, dependency],
            node.typeReferenceDirectives,
            node.hasNoDefaultLib,
            node.libReferenceDirectives
        );
        if (dependencies.has(node)) {
            dependencies.get(node)!.add(dependency);
        }
        else {
            dependencies.set(node, new Set([dependency]));
        }
    }

    function getSourceFileOfNode(node: ts.Node): ts.SourceFile | undefined {
        while (node && node.kind != ts.SyntaxKind.SourceFile) {
            node = node.parent!;
        }
        return <ts.SourceFile>node;
    }

    function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
        if (node && node.modifiers) {
            return !!node.modifiers.find(mod => mod.kind == kind);
        }
        return false;
    }

    function isCommaExpression(node: ts.Expression): node is ts.BinaryExpression {
        return node.kind == ts.SyntaxKind.BinaryExpression &&
            (<ts.BinaryExpression>node).operatorToken.kind == ts.SyntaxKind.CommaToken;
    }

    function escapeParenthesized(node: ts.Expression): ts.Expression {
        while (node.kind == ts.SyntaxKind.ParenthesizedExpression) {
            node = (<ts.ParenthesizedExpression>node).expression;
        }
        if (isCommaExpression(node)) {
            do {
                visitExpression(node.left, 0);
                node = node.right;

            } while (isCommaExpression(node));
        }
        return node;
    }

    // fix stack overflow caused by self reference
    function updateDepth(node: ts.Node, depth: number): boolean {
        if (depth > (maxCallDepth.has(node) ? maxCallDepth.get(node)! : -1)) {
            maxCallDepth.set(node, depth);
            return true;
        }
        return false;
    }

    function visitReference(node: ts.Node, depth: number): void {
        const symbol = checker.getSymbolAtLocation(node);

        if (symbol && symbol.declarations) {
            symbol.declarations.forEach(declaration => {
                const destFile = getSourceFileOfNode(declaration);

                if (destFile && !destFile.isDeclarationFile) {
                    if (destFile.fileName != currentFile.fileName) {
                        addDependency(currentFile, destFile);
                    }
                    if (updateDepth(declaration, depth)) {
                        const previousFile = currentFile;
                        currentFile = destFile;
                        visitDeclaration(declaration, depth);
                        currentFile = previousFile;
                    }
                }
            });
        }
    }

    function visitDeclaration(node: ts.Declaration, depth: number): void {
        if (node) switch (node.kind) {
            // Import alias
            case ts.SyntaxKind.ImportEqualsDeclaration:
                const moduleReference = (<ts.ImportEqualsDeclaration>node).moduleReference;

                if (moduleReference.kind != ts.SyntaxKind.ExternalModuleReference) {
                    visitReference(moduleReference, 0);
                }
                break;

            // namespace
            case ts.SyntaxKind.ModuleDeclaration:
                visitModule(<ts.ModuleDeclaration>node, depth);
                break;

            // enum
            case ts.SyntaxKind.EnumDeclaration:
                visitEnum(<ts.EnumDeclaration>node, depth);
                break;

            // class
            case ts.SyntaxKind.ClassDeclaration:
                visitClassLike(<ts.ClassDeclaration>node, depth);
                break;

            // function
            case ts.SyntaxKind.FunctionDeclaration:
                visitFunctionLike(<ts.FunctionDeclaration>node, depth);
                break;

            // non-statement
            case ts.SyntaxKind.Parameter:
            case ts.SyntaxKind.EnumMember:
            case ts.SyntaxKind.BindingElement:
            case ts.SyntaxKind.PropertyAssignment:
            case ts.SyntaxKind.PropertySignature:
            case ts.SyntaxKind.PropertyDeclaration:
            case ts.SyntaxKind.VariableDeclaration:
                visitExpression((<ts.HasExpressionInitializer>node).initializer, depth);
                break;
        }
    }

    function visitSourceFile(node: ts.SourceFile) {
        const previousFile = currentFile;
        currentFile = node;
        visitStatements(node.statements)
        currentFile = previousFile;
    }

    function visitStatements(statements: ts.NodeArray<ts.Statement>): void {
        statements.forEach(statement => {
            // skip declare statements.
            if (statement && !hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
                visitStatement(statement);
            }
        });
    }

    function visitStatement(node: ts.Statement | undefined): void {
        if (node) switch (node.kind) {
            default:
                visitDeclaration(<ts.DeclarationStatement>node, 0);
                break;

            case ts.SyntaxKind.ExpressionStatement:
                visitExpression((<ts.ExpressionStatement>node).expression, 0);
                break;

            case ts.SyntaxKind.VariableStatement:
                visitVariableList((<ts.VariableStatement>node).declarationList, 0);
                break;

            case ts.SyntaxKind.Block:
                visitStatements((<ts.Block>node).statements);
                break;

            case ts.SyntaxKind.IfStatement:
                visitExpression((<ts.IfStatement>node).expression, 0);
                visitStatement((<ts.IfStatement>node).thenStatement);
                visitStatement((<ts.IfStatement>node).elseStatement);
                break;

            case ts.SyntaxKind.DoStatement:
            case ts.SyntaxKind.WhileStatement:
                type LoopStatement = ts.DoStatement | ts.WhileStatement;
                visitExpression((<LoopStatement>node).expression, 0);
                visitStatement((<LoopStatement>node).statement);
                break;

            case ts.SyntaxKind.ForStatement:
                const stmtFor = <ts.ForStatement>node;

                visitExpression(stmtFor.condition, 0);
                visitExpression(stmtFor.incrementor, 0);

                if (stmtFor.initializer) {
                    if (stmtFor.initializer.kind == ts.SyntaxKind.VariableDeclarationList) {
                        visitVariableList(<ts.VariableDeclarationList>stmtFor.initializer, 0);
                    }
                    else {
                        visitExpression(<ts.Expression>stmtFor.initializer, 0);
                    }
                }
                break;

            case ts.SyntaxKind.ForInStatement:
            case ts.SyntaxKind.ForOfStatement:
                const stmtForOf = <ts.ForInOrOfStatement>node;

                visitExpression(stmtForOf.expression, 0);
                visitStatement(stmtForOf.statement);

                if (stmtForOf.initializer.kind == ts.SyntaxKind.VariableDeclarationList) {
                    visitVariableList(<ts.VariableDeclarationList>stmtForOf.initializer, 0);
                }
                else {
                    visitExpression(<ts.Expression>stmtForOf.initializer, 0);
                }
                break;

            case ts.SyntaxKind.ReturnStatement:
                const stmtReturn = <ts.ReturnStatement>node;

                if (stmtReturn.expression && currentFunc) {
                    currentFunc.add(stmtReturn.expression);
                }
                break;

            case ts.SyntaxKind.WithStatement:
                visitExpression((<ts.WithStatement>node).expression, 0);
                visitStatement((<ts.WithStatement>node).statement);
                break;

            case ts.SyntaxKind.SwitchStatement:
                const stmtSwitch = <ts.SwitchStatement>node;

                visitExpression(stmtSwitch.expression, 0);

                stmtSwitch.caseBlock.clauses.forEach(clause => {
                    if (clause.kind == ts.SyntaxKind.CaseClause) {
                        return visitExpression((<ts.CaseClause>clause).expression, 0);
                    }
                    (<ts.DefaultClause>clause).statements.forEach(statement => {
                        visitStatement(statement);
                    });
                });
                break;

            case ts.SyntaxKind.LabeledStatement:
                visitStatement((<ts.LabeledStatement>node).statement);
                break;

            case ts.SyntaxKind.ThrowStatement:
                visitExpression((<ts.ThrowStatement>node).expression, 0);
                break;

            case ts.SyntaxKind.TryStatement:
                const stmtTry = <ts.TryStatement>node;

                visitStatements(stmtTry.tryBlock.statements);

                if (stmtTry.finallyBlock) {
                    visitStatements(stmtTry.finallyBlock.statements);
                }
                if (stmtTry.catchClause) {
                    visitStatements(stmtTry.catchClause.block.statements);
                }
                break;
        }
    }

    function visitExpression(node: ts.Expression | undefined, depth: number): void {
        if (node) switch (node.kind) {
            // primary
            case ts.SyntaxKind.Identifier:
                visitReference(node, depth);
                break;

            case ts.SyntaxKind.PropertyAccessExpression:
                visitExpression((<ts.PropertyAccessExpression>node).expression, 0);
                visitReference(node, depth);
                break;

            case ts.SyntaxKind.ElementAccessExpression:
                visitExpression((<ts.ElementAccessExpression>node).expression, depth);
                visitExpression((<ts.ElementAccessExpression>node).argumentExpression, 0);
                break;

            case ts.SyntaxKind.ArrayLiteralExpression:
                (<ts.ArrayLiteralExpression>node).elements.forEach(expression => {
                    visitExpression(expression, depth);
                });
                break;

            case ts.SyntaxKind.ObjectLiteralExpression:
                visitObjectLiteralExpression(<ts.ObjectLiteralExpression>node, depth);
                break;

            case ts.SyntaxKind.ClassExpression:
                visitClassLike(<ts.ClassExpression>node, depth);
                break;

            case ts.SyntaxKind.FunctionExpression:
            case ts.SyntaxKind.ArrowFunction:
                visitFunctionLike(<ts.FunctionExpression>node, depth);
                break;

            // call
            case ts.SyntaxKind.NewExpression:
            case ts.SyntaxKind.CallExpression:
                visitCallExpression(<ts.CallExpression>node, depth);
                break;

            // template, tagged template
            case ts.SyntaxKind.TemplateExpression:
                (<ts.TemplateExpression>node).templateSpans.forEach(span => {
                    visitExpression(span.expression, 0);
                });
                break;

            case ts.SyntaxKind.TaggedTemplateExpression:
                visitExpression((<ts.TaggedTemplateExpression>node).tag, depth + 1);
                visitExpression((<ts.TaggedTemplateExpression>node).template, 0);
                break;

            // unary, binary, ternary:
            case ts.SyntaxKind.PrefixUnaryExpression:
            case ts.SyntaxKind.PostfixUnaryExpression:
                /**
                 * 这里忽略了某些情况下的前向引用检查，例如：+ { valueOf() { ... } }
                 */
                type UnaryExpression = ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
                visitExpression((<UnaryExpression>node).operand, 0);
                break;

            case ts.SyntaxKind.BinaryExpression:
                switch ((<ts.BinaryExpression>node).operatorToken.kind) {
                    case ts.SyntaxKind.AmpersandAmpersandToken:
                    case ts.SyntaxKind.BarBarToken:
                    case ts.SyntaxKind.EqualsToken:
                        visitExpression((<ts.BinaryExpression>node).left, depth);
                        visitExpression((<ts.BinaryExpression>node).right, depth);
                        break;
                    default:
                        visitExpression((<ts.BinaryExpression>node).left, 0);
                        visitExpression((<ts.BinaryExpression>node).right, 0);
                        break;
                }
                break;

            case ts.SyntaxKind.ConditionalExpression:
                visitExpression((<ts.ConditionalExpression>node).condition, 0);
                visitExpression((<ts.ConditionalExpression>node).whenTrue, depth);
                visitExpression((<ts.ConditionalExpression>node).whenFalse, depth);
                break;

            case ts.SyntaxKind.ParenthesizedExpression:
                visitExpression(escapeParenthesized(node), depth);
                break;

            // everything that holds a expression.
            case ts.SyntaxKind.TypeAssertionExpression:
            case ts.SyntaxKind.AwaitExpression:
            case ts.SyntaxKind.YieldExpression:
            case ts.SyntaxKind.SpreadElement:
            case ts.SyntaxKind.AsExpression:
            case ts.SyntaxKind.NonNullExpression:
                type InvariantExpressions = ts.AssertionExpression | ts.NonNullExpression |
                    ts.AsExpression | ts.SpreadElement | ts.YieldExpression | ts.AwaitExpression;
                visitExpression((<InvariantExpressions>node).expression, depth);
                break;

            case ts.SyntaxKind.DeleteExpression:
            case ts.SyntaxKind.TypeOfExpression:
            case ts.SyntaxKind.VoidExpression:
                type SimpleExpressions = ts.DeleteExpression | ts.TypeOfExpression | ts.VoidExpression;
                visitExpression((<SimpleExpressions>node).expression, 0);
                break;

            // have nothing to do with
            case ts.SyntaxKind.MetaProperty:
                break;
        }
    }

    function visitCallExpression(node: ts.CallExpression, depth: number): void {
        const expression = escapeParenthesized(node.expression);

        if (node.arguments) {
            node.arguments.forEach(expression => {
                visitExpression(expression, 0);
            });
        }
        visitExpression(expression, depth + 1);
    }

    function visitVariableList(node: ts.VariableDeclarationList, depth: number): void {
        if (node) node.declarations.forEach(declaration => {
            visitExpression(declaration.initializer, depth);
        });
    }

    function visitModule(node: ts.ModuleDeclaration, depth: number): void {
        if (!updateDepth(node, depth)) {
            return;
        }
        if (node.body) {
            if (node.body.kind == ts.SyntaxKind.ModuleDeclaration) {
                visitStatement(node.body);
            }
            else if (node.body.kind == ts.SyntaxKind.ModuleBlock) {
                visitStatements(node.body.statements);
            }
        }
        visitReference(node, 0);
    }

    function visitEnum(node: ts.EnumDeclaration, depth: number) {
        if (!updateDepth(node, depth)) {
            return;
        }
        node.members.forEach(member => {
            visitExpression(member.initializer, 0);
        });
    }

    function visitClassLike(node: ts.ClassLikeDeclaration, depth: number): void {
        if (!updateDepth(node, depth)) {
            return;
        }
        if (node.heritageClauses) {
            const heritage = node.heritageClauses.find(clause => {
                return clause.token == ts.SyntaxKind.ExtendsKeyword;
            });

            if (heritage && heritage.types) {
                heritage.types.forEach(superClass => {
                    visitReference(superClass.expression, depth);
                });
            }
        }
        if (node.decorators) {
            node.decorators.forEach(decorator => {
                visitExpression(decorator.expression, 1);
            });
        }
        if (node.members) node.members.forEach(member => {
            switch (member.kind) {
                case ts.SyntaxKind.Constructor:
                    visitFunctionLike(<ts.ConstructorDeclaration>member, depth);
                    break;

                case ts.SyntaxKind.SetAccessor:
                case ts.SyntaxKind.MethodDeclaration:
                    visitFunctionLike(<ts.FunctionLikeDeclaration>member, 0);
                    break;

                case ts.SyntaxKind.PropertyDeclaration:
                    visitClassMember(<ts.PropertyDeclaration>member, depth);
                    break;
            }
        });
    }

    function visitClassMember(node: ts.PropertyDeclaration, depth: number): void {
        if (node.decorators) {
            node.decorators.forEach(decorator => {
                visitExpression(decorator.expression, 1);
            });
        }
        if (depth > 0 || hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
            visitExpression((<ts.PropertyDeclaration>node).initializer, 0);
        }
    }

    function visitFunctionLike(node: ts.FunctionLikeDeclaration, depth: number): void {
        if (node.decorators) {
            node.decorators.forEach(decorator => {
                visitExpression(decorator.expression, 1);
            });
        }
        node.parameters.forEach(parameter => {
            if (parameter.decorators) {
                parameter.decorators.forEach(decorator => {
                    visitExpression(decorator.expression, 1);
                });
            }
        });
        if (depth > 0 && node.body) {
            if (node.body.kind == ts.SyntaxKind.Block) {
                visitFunctionBody(<ts.Block>node.body, depth);
            }
            else {
                visitExpression(<ts.Expression>node.body, depth);
            }
        }
    }

    function visitFunctionBody(node: ts.Block, depth: number) {
        if (!funcBranches.has(node)) {
            const previousFunc = currentFunc;

            funcBranches.set(node, currentFunc = new Set());
            visitStatements(node.statements);
            currentFunc = previousFunc;
        }
        funcBranches.get(node)!.forEach(expression => {
            visitExpression(expression, depth - 1);
        });
    }

    function visitObjectLiteralExpression(node: ts.ObjectLiteralExpression, depth: number): void {
        node.properties.forEach(element => {
            switch (element.kind) {
                case ts.SyntaxKind.PropertyAssignment:
                    visitExpression((<ts.PropertyAssignment>element).initializer, depth);
                    break;
                case ts.SyntaxKind.ShorthandPropertyAssignment:
                    visitExpression((<ts.ShorthandPropertyAssignment>element).objectAssignmentInitializer, depth);
                    break;
                case ts.SyntaxKind.SpreadAssignment:
                    visitExpression((<ts.SpreadAssignment>element).expression, depth);
                    break;
            }
        });
    }
}
