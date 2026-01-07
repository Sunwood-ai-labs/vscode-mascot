'use strict';
import {
	commands,
	ExtensionContext
} from 'vscode';
import { PickList, ActionType } from './PickList';
import { setContext } from './global';

export function activate(context: ExtensionContext) {
	setContext(context);

	let togglePetField = commands.registerCommand('extension.vscodeMascot.togglePet', () => {
		new PickList().handleAction(ActionType.TogglePet);
	});
	let switchPetField = commands.registerCommand('extension.vscodeMascot.switchPet', () => {
		new PickList().handleAction(ActionType.SelectPet);
	});

	context.subscriptions.push(togglePetField);
	context.subscriptions.push(switchPetField);

	// Check if we need to show welcome message or update
	// (Simplified for now, can add back version check logic if needed)
}

export function deactivate() {
}
