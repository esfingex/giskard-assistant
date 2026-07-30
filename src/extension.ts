import * as vscode from 'vscode';
import { GiskardChatWebviewProvider } from './cells/chatWebview';
import { registerSandboxCommands } from './cells/sandboxCommands';

export function activate(context: vscode.ExtensionContext) {
    console.log('🚀 Giskard Copilot Extension v0.4.0 activada');

    // 1. Célula Webview Sidebar Chat (Registrada para izquierda y explorer/derecha)
    const provider = new GiskardChatWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('giskard.chatView', provider),
        vscode.window.registerWebviewViewProvider('giskard.chatViewExplorer', provider)
    );

    // 2. Célula de Comandos Sandbox
    registerSandboxCommands(context);

    // 3. Comandos de apertura de Chat Sidebar (Izquierda / Derecha)
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-sys.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.giskard-sidebar');
        }),
        vscode.commands.registerCommand('giskard-sys.openChatRight', () => {
            vscode.commands.executeCommand('workbench.action.focusSecondarySideBar');
        })
    );

    // 4. Comando de Sincronización de Estado
    context.subscriptions.push(
        vscode.commands.registerCommand('giskard-sys.syncState', async () => {
            await provider.refreshState();
            vscode.window.showInformationMessage('✓ Estado del conector soberano sincronizado en Giskard Copilot.');
        })
    );
}

export function deactivate() {}
