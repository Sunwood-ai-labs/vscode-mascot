import {
    QuickPick,
    window,
    workspace
} from 'vscode';
import { ImgItem } from './ImgItem';

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
        const config = workspace.getConfiguration('vscodeMascot');
        const currentPet = config.get<string>('type', 'akita');
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
            { label: 'Deno2', value: 'deno2', desc: '恐竜2' },
            { label: 'Morph', value: 'morph', desc: 'モーフ' },
            { label: 'Fox Mini 1', value: 'fox_mini1', desc: 'キツネ(ミニ1)' },
            { label: 'Togemaru', value: 'togemaru', desc: 'とげまる' },
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
        this.quickPick.onDidAccept(async () => {
            if (this.quickPick && this.quickPick.selectedItems.length > 0) {
                const selected = this.quickPick.selectedItems[0];
                if (selected.path) {
                    console.log(`[VSCode Mascot] Selected pet: ${selected.path}`);
                    await workspace.getConfiguration('vscodeMascot').update('type', selected.path, true);
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
        const config = workspace.getConfiguration('vscodeMascot');
        const currentValue = config.get<boolean>('enabled', false);
        config.update('enabled', !currentValue, true).then(() => {
            if (!currentValue) {
                window.showInformationMessage('Mascot Enabled! / マスコットを有効にしました！');
            } else {
                window.showInformationMessage('Mascot Disabled! / マスコットを無効にしました！');
            }
        });
    }

    private dispose() {
        if (this.quickPick) {
            this.quickPick.hide();
            this.quickPick = undefined;
        }
    }
}