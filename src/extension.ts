import {
	commands,
	ExtensionContext,
	workspace,
	window
} from 'vscode';
import { PickList, ActionType } from './PickList';
import { setContext } from './global';
import { FileDom } from './FileDom';

export function activate(context: ExtensionContext) {
	console.log('[VSCode Mascot] Activating extension...');
	setContext(context);

	let togglePetField = commands.registerCommand('extension.vscodeMascot.togglePet', () => {
		console.log('[VSCode Mascot] Command: togglePet triggered');
		new PickList().handleAction(ActionType.TogglePet);
	});
	let switchPetField = commands.registerCommand('extension.vscodeMascot.switchPet', () => {
		console.log('[VSCode Mascot] Command: switchPet triggered');
		new PickList().handleAction(ActionType.SelectPet);
	});

	context.subscriptions.push(togglePetField);
	context.subscriptions.push(switchPetField);

	console.log('[VSCode Mascot] Commands registered.');

	// Listen for configuration changes with a simple lock to prevent concurrent installs
	let isInstalling = false;
	context.subscriptions.push(workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration('vscodeMascot')) {
			console.log('[VSCode Mascot] Configuration changed.');
			if (isInstalling) return;
			isInstalling = true;

			try {
				const fileDom = new FileDom();
				const success = await fileDom.install();
				if (success) {
					const action = await window.showInformationMessage('Mascot configuration updated. Restart VS Code to apply changes?', 'Restart', 'Later');
					if (action === 'Restart') {
						commands.executeCommand('workbench.action.reloadWindow');
					}
				}
			} catch (err: any) {
				console.error('[VSCode Mascot] Failed to update mascot:', err);
				window.showErrorMessage(`Failed to update mascot: ${err.message || err}`);
			} finally {
				isInstalling = false;
			}
		}
	}));
	console.log('[VSCode Mascot] Extension activated.');
}

export function deactivate() {
}
