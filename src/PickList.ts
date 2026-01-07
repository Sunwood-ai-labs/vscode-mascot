import {
    QuickPick,
    window,
    commands
} from 'vscode';
import { ImgItem } from './ImgItem';
import { getContext } from './global';
import { FileDom } from './FileDom';

export enum ActionType {
    SelectPet = 1,
    TogglePet = 2
}

export class PickList {
    private quickPick: QuickPick<ImgItem> | undefined;

    constructor() { }

    public handleAction(type: ActionType) {
        switch (type) {
            case ActionType.SelectPet: this.showPetSelection(); break;
            case ActionType.TogglePet: this.togglePet(); break;
        }
    }

    private getPetSelectionItems(): ImgItem[] {
        const currentPet = getContext().globalState.get('backgroundCoverPetType', 'akita');
        const pets = [
            { label: 'Akita (Dog)', value: 'akita', desc: '秋田犬' },
            { label: 'Totoro', value: 'totoro', desc: 'トトロ' },
            { label: 'Fox', value: 'fox', desc: 'キツネ' },
            { label: 'Pika', value: 'pika', desc: 'ピカチュウ' },
            { label: 'Deno2', value: 'deno2', desc: '恐竜2' },
            { label: 'Clippy', value: 'clippy', desc: 'クリッピー' },
            { label: 'Rubber Duck', value: 'rubber-duck', desc: 'アヒル隊長' },
            { label: 'Crab', value: 'crab', desc: 'カニ' },
            { label: 'Zappy', value: 'zappy', desc: 'ザッピー' },
            { label: 'Cockatiel', value: 'cockatiel', desc: 'オカメインコ' },
            { label: 'Snake', value: 'snake', desc: 'ヘビ' },
            { label: 'Chicken', value: 'chicken', desc: 'ニワトリ' },
            { label: 'Turtle', value: 'turtle', desc: 'カメ' },
            { label: 'Panda', value: 'panda', desc: 'パンダ' },
            { label: 'Snail', value: 'snail', desc: 'カタツムリ' },
            { label: 'Deno', value: 'deno', desc: '恐竜' },
            { label: 'Morph', value: 'morph', desc: 'モーフ' },
        ];

        return pets.map(p => ({
            label: `$(github) ${p.label}`,
            detail: `${p.desc} ${currentPet === p.value ? '$(check)' : ''}`,
            imageType: ActionType.SelectPet,
            path: p.value
        }));
    }

    private showPetSelection() {
        this.quickPick = window.createQuickPick<ImgItem>();
        this.quickPick.items = this.getPetSelectionItems();
        this.quickPick.onDidAccept(() => {
            if (this.quickPick && this.quickPick.selectedItems.length > 0) {
                const selected = this.quickPick.selectedItems[0];
                if (selected.path) {
                    getContext().globalState.update('backgroundCoverPetType', selected.path).then(() => {
                        this.updateDom();
                    });
                    this.quickPick.hide();
                }
            }
        });
        this.quickPick.onDidHide(() => {
            this.dispose();
        });
        this.quickPick.show();
    }

    private togglePet() {
        const context = getContext();
        const currentValue = context.globalState.get('backgroundCoverPetEnabled', false);
        context.globalState.update('backgroundCoverPetEnabled', !currentValue).then(() => {
            if (!currentValue) {
                window.showInformationMessage('Mascot Enabled! / マスコットを有効にしました！');
            } else {
                window.showInformationMessage('Mascot Disabled! / マスコットを無効にしました！');
            }
            this.updateDom();
        });
    }

    private async updateDom() {
        // Initialize FileDom to apply changes
        // We pass dummy config because we removed most config deps, but FileDom constructor signature might still need check
        // We will refactor FileDom next, so let's assume a simpler constructor or just no args if possible?
        // Original FileDom took (config, imagePath, opacity, ...)
        // We will simplify FileDom to take nothing or just context implicitly.

        try {
            const fileDom = new FileDom();
            await fileDom.install();

            // Reload prompt since modifying core files often needs reload, 
            // BUT the original extension tried to do hot reload for CSS. 
            // JS changes usually require reload. The mascot is injected via JS.
            // So we probably need a reload window.
            const action = await window.showInformationMessage('Configuration changed. Restart VS Code to apply?', 'Restart', 'Later');
            if (action === 'Restart') {
                commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (e) {
            window.showErrorMessage('Failed to update: ' + e);
        }
    }

    private dispose() {
        if (this.quickPick) {
            this.quickPick.hide();
            this.quickPick = undefined;
        }
    }
}