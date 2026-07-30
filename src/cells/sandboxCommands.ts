/**
 * Giskard-Sys VSCode Extension — Cell: Sandbox Commands
 */

import * as vscode from 'vscode';
import { fetchSandboxList, fetchSandboxRead } from '../core/api';

export function registerSandboxCommands(context: vscode.ExtensionContext) {
    let listCmd = vscode.commands.registerCommand('giskard-sys.listSandbox', async () => {
        try {
            const data: any = await fetchSandboxList('.');
            if (data.success) {
                const files = data.data.map((f: any) => `${f.is_dir ? '📁' : '📄'} ${f.name}`).join('\n');
                vscode.window.showInformationMessage(`Archivos del Sandbox:\n${files}`);
            } else {
                vscode.window.showErrorMessage(`Error: ${data.error}`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Fallo al conectar: ${err.message}`);
        }
    });

    let readCmd = vscode.commands.registerCommand('giskard-sys.readSandboxFile', async () => {
        const filePath = await vscode.window.showInputBox({ prompt: 'Ruta relativa en el sandbox:' });
        if (!filePath) return;

        try {
            const data: any = await fetchSandboxRead(filePath);
            if (data.success) {
                const doc = await vscode.workspace.openTextDocument({ content: data.data });
                await vscode.window.showTextDocument(doc);
            } else {
                vscode.window.showErrorMessage(`Error al leer archivo: ${data.error}`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Error de conexión: ${err.message}`);
        }
    });

    context.subscriptions.push(listCmd, readCmd);
}
