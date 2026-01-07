import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { env, Uri, window } from 'vscode';
import * as lockfile from 'proper-lockfile';
import version from './version';
import { SudoPromptHelper } from './SudoPromptHelper';
import * as fse from 'fs-extra';
import { getContext } from './global';

interface WorkbenchTarget {
    name: string;
    root: string;
    js: string;
    css: string;
    bak: string;
}

const WORKBENCH_TARGETS: WorkbenchTarget[] = [
    {
        name: 'desktop',
        root: path.join(env.appRoot, "out", "vs", "workbench"),
        js: 'workbench.desktop.main.js',
        css: 'workbench.desktop.main.css',
        bak: 'workbench.desktop.main.js.bak'
    },
    {
        name: 'code-server',
        root: path.join(env.appRoot, "out", "vs", "code", "browser", "workbench"),
        js: 'workbench.js',
        css: 'workbench.css',
        bak: 'workbench.js.bak'
    }
];

function getWorkbenchTarget(): WorkbenchTarget {
    const pickByName = (name: string): WorkbenchTarget | undefined => {
        return WORKBENCH_TARGETS.find((target) => target.name === name && fs.existsSync(path.join(target.root, target.js)));
    };
    // Simplified detection logic
    if (env.remoteName === 'ssh-remote' || (env.appName || '').toLowerCase().includes('server')) {
        const serverTarget = pickByName('code-server');
        if (serverTarget) return serverTarget;
    }
    return pickByName('desktop') || pickByName('code-server') || WORKBENCH_TARGETS[0];
}

const selectedWorkbench = getWorkbenchTarget();
const JS_FILE_PATH = path.join(selectedWorkbench.root, selectedWorkbench.js);
const BAK_FILE_PATH = path.join(selectedWorkbench.root, selectedWorkbench.bak);

enum SystemType {
    WINDOWS = 'Windows_NT',
    MACOS = 'Darwin',
    LINUX = 'Linux'
}

export class FileDom {
    private readonly filePath: string;
    private readonly extName = "vscodeMascot"; // changed from backgroundCover
    private readonly systemType: string;
    private bakStatus: boolean = false;
    private bakJsContent: string = '';

    constructor() {
        this.filePath = JS_FILE_PATH;
        this.systemType = os.type();
    }

    public async install(): Promise<boolean> {
        if (!(await this.checkFileExists())) {
            return false;
        }
        await this.ensureBackup();
        return await this.applyPatch();
    }

    private async checkFileExists(): Promise<boolean> {
        const isExist = await fse.pathExists(this.filePath);
        if (!isExist) {
            await window.showErrorMessage(`Core file not found: ${this.filePath}`);
            return false;
        }
        return true;
    }

    private async ensureBackup(): Promise<void> {
        const bakExist = await fse.pathExists(BAK_FILE_PATH);
        if (!bakExist) {
            this.bakStatus = true;
            window.setStatusBarMessage(`First time setup: Backing up workbench file...`, 10000);
        }
    }

    private async applyPatch(): Promise<boolean> {
        const lockPath = path.join(os.tmpdir(), 'vscode-mascot.lock');
        let release: (() => Promise<void>) | undefined;

        try {
            if (!(await fse.pathExists(lockPath))) {
                await fse.writeFile(lockPath, '', 'utf-8');
            }
            release = await lockfile.lock(lockPath, { retries: 5, stale: 20000 });

            const content = this.getJs().trim();
            const currentContent = await this.getContent(this.filePath);

            // Check if we need to update
            const match = currentContent.match(new RegExp(`\\/\\*ext-${this.extName}-start\\*\\/([\\s\\S]*?)\\/\\*ext-${this.extName}-end\\*\\/`));
            if (match && match[0].trim() === content.trim()) {
                console.log('Patch already applied and up to date.');
                return true;
            }

            // Remove old mascot patch if exists (or old background-cover patch)
            let cleanContent = this.clearContent(currentContent, 'backgroundCover'); // Clean legacy
            cleanContent = this.clearContent(cleanContent, this.extName); // Clean current

            if (this.bakStatus) {
                this.bakJsContent = cleanContent;
                await this.bakFile();
            }

            const newContent = cleanContent + content;
            return await this.saveContent(newContent);

        } catch (error: any) {
            await window.showErrorMessage(`Installation failed: ${error.message}`);
            return false;
        } finally {
            if (release) await release();
        }
    }

    public async uninstall(): Promise<boolean> {
        try {
            const content = this.clearContent(await this.getContent(this.filePath), this.extName);
            await this.saveContent(content);
            return true;
        } catch (error) {
            await window.showErrorMessage(`Uninstall failed: ${error}`);
            return false;
        }
    }

    private async getContent(filePath: string): Promise<string> {
        return await fse.readFile(filePath, 'utf-8');
    }

    private async saveContent(content: string): Promise<boolean> {
        await this.writeWithPermission(this.filePath, content);
        return true;
    }

    private async writeWithPermission(filePath: string, content: string): Promise<void> {
        try {
            await fse.writeFile(filePath, content, { encoding: 'utf-8' });
        } catch (err) {
            await this.getFilePermission(filePath);
            await fse.writeFile(filePath, content, { encoding: 'utf-8' });
        }
    }

    private async getFilePermission(filePath: string): Promise<void> {
        try {
            switch (this.systemType) {
                case SystemType.WINDOWS:
                    await SudoPromptHelper.exec(`takeown /f "${filePath}" /a`);
                    await SudoPromptHelper.exec(`icacls "${filePath}" /grant Users:F`);
                    break;
                case SystemType.MACOS:
                    await SudoPromptHelper.exec(`chmod a+rwx "${filePath}"`);
                    break;
                case SystemType.LINUX:
                    await SudoPromptHelper.exec(`chmod 666 "${filePath}"`);
                    break;
            }
        } catch (error) {
            throw error;
        }
    }

    private async bakFile(): Promise<void> {
        try {
            await fse.writeFile(BAK_FILE_PATH, this.bakJsContent, { encoding: 'utf-8' });
        } catch (err) {
            // Permission handling for backup creation if needed
            if (this.systemType === SystemType.WINDOWS) {
                await SudoPromptHelper.exec(`echo. > "${BAK_FILE_PATH}"`);
                await SudoPromptHelper.exec(`icacls "${BAK_FILE_PATH}" /grant Users:F`);
            } else {
                await SudoPromptHelper.exec(`touch "${BAK_FILE_PATH}"`);
                await SudoPromptHelper.exec(`chmod 666 "${BAK_FILE_PATH}"`);
            }
            await fse.writeFile(BAK_FILE_PATH, this.bakJsContent, { encoding: 'utf-8' });
        }
    }

    private getJs(): string {
        return `
        /*ext-${this.extName}-start*/
        /*ext.${this.extName}.ver.${version}*/
        ${this.getLoaderJs()}
        /*ext-${this.extName}-end*/
        `;
    }

    private clearContent(content: string, extName: string): string {
        const regex = new RegExp(`\\/\\*ext-${extName}-start\\*\\/[\\s\\S]*?\\/\\*ext-${extName}-end\\*\\/`, 'g');
        return content.replace(regex, '').trim();
    }

    private getLoaderJs(): string {
        const petConfig = this.getPetConfig();
        const petEnabled = petConfig.enabled;
        const petWalkUrl = this.escapeTemplateLiteral(petConfig.walkUrl);
        const petIdleUrl = this.escapeTemplateLiteral(petConfig.idleUrl);

        return `
        (function() {
            // Pet Config
            const petEnabled = ${petEnabled};
            const petWalkUrl = '${petWalkUrl}';
            const petIdleUrl = '${petIdleUrl}';

            // Little Assistant Logic
            try {
                if (!petEnabled) {
                    const assistant = document.getElementById('vscode-mascot-assistant');
                    if (assistant) assistant.remove();
                } else {
                    const assistantId = 'vscode-mascot-assistant';
                    const titlebarId = 'workbench.parts.titlebar';
                    
                    // Inject CSS for animations
                    const styleId = 'vscode-mascot-assistant-style';
                    if (!document.getElementById(styleId)) {
                        const style = document.createElement('style');
                        style.id = styleId;
                        style.textContent = \`
                            @keyframes assistant-jump {
                                0% { transform: translateY(0) scaleX(var(--dir, 1)); }
                                50% { transform: translateY(-15px) scaleX(var(--dir, 1)); }
                                100% { transform: translateY(0) scaleX(var(--dir, 1)); }
                            }
                            @keyframes title-shake {
                                0% { transform: translate(1px, 1px) rotate(0deg); }
                                10% { transform: translate(-1px, -2px) rotate(-1deg); }
                                20% { transform: translate(-3px, 0px) rotate(1deg); }
                                30% { transform: translate(3px, 2px) rotate(0deg); }
                                40% { transform: translate(1px, -1px) rotate(1deg); }
                                50% { transform: translate(-1px, 2px) rotate(-1deg); }
                                60% { transform: translate(-3px, 1px) rotate(0deg); }
                                70% { transform: translate(3px, 1px) rotate(-1deg); }
                                80% { transform: translate(-1px, -1px) rotate(1deg); }
                                90% { transform: translate(1px, 2px) rotate(0deg); }
                                100% { transform: translate(1px, -2px) rotate(-1deg); }
                            }
                            .assistant-jumping {
                                animation: assistant-jump 0.5s ease;
                            }
                            .title-shaking {
                                animation: title-shake 0.5s;
                                display: inline-block;
                            }
                            .pet-message {
                                position: absolute;
                                top: 32px;
                                left: 50%;
                                transform: translateX(-50%);
                                background: rgba(255, 255, 255, 0.9);
                                color: #000;
                                padding: 4px 8px;
                                border-radius: 4px;
                                font-size: 12px;
                                white-space: nowrap;
                                pointer-events: none;
                                opacity: 0;
                                transition: opacity 0.3s;
                                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                z-index: 100000;
                            }
                            .pet-message.show {
                                opacity: 1;
                            }
                            .pet-message::after {
                                content: '';
                                position: absolute;
                                bottom: 100%;
                                left: 50%;
                                margin-left: -4px;
                                border-width: 4px;
                                border-style: solid;
                                border-color: transparent transparent rgba(255, 255, 255, 0.9) transparent;
                            }
                        \`;
                        document.head.appendChild(style);
                    }

                    const initAssistant = () => {
                        if (document.getElementById(assistantId)) return;
                        const titlebar = document.getElementById(titlebarId) || document.querySelector('.titlebar');
                        if (!titlebar) return;

                        const assistant = document.createElement('div');
                        assistant.id = assistantId;
                        
                        const petImage = document.createElement('img');
                        petImage.src = petIdleUrl;
                        petImage.style.width = '30px'; 
                        petImage.style.height = 'auto';
                        petImage.style.imageRendering = 'pixelated';
                        
                        assistant.appendChild(petImage);

                        assistant.style.position = 'absolute';
                        assistant.style.zIndex = '99999';
                        assistant.style.top = '0px'; 
                        assistant.style.pointerEvents = 'none';
                        assistant.style.transition = 'left 3s linear'; 
                        assistant.style.left = '0px';
                        assistant.style.setProperty('--dir', '1');
                        assistant.style.transform = 'scaleX(var(--dir))';
                        
                        // Append to titlebar to be visible there
                        titlebar.appendChild(assistant);

                        let currentPos = 0;
                        const messages = [
                            "Hello!", "Coding...", "Need coffee?", "休憩しよう！", "バグ？", "VS Code 最高！",
                            "AI使ってる？", "TypeScript!", "Commit often!", "Don't panic"
                        ];

                        function showMessage() {
                            const msg = messages[Math.floor(Math.random() * messages.length)];
                            const bubble = document.createElement('div');
                            bubble.className = 'pet-message';
                            bubble.textContent = msg;
                            bubble.style.transform = 'translateX(-50%) scaleX(' + assistant.style.getPropertyValue('--dir') + ')';
                            assistant.appendChild(bubble);
                            void bubble.offsetWidth;
                            bubble.classList.add('show');
                            setTimeout(() => {
                                bubble.classList.remove('show');
                                setTimeout(() => bubble.remove(), 300);
                            }, 3000);
                        }

                        function triggerJump() {
                            assistant.classList.remove('assistant-jumping');
                            void assistant.offsetWidth;
                            assistant.classList.add('assistant-jumping');
                        }

                        function move() {
                            if (!document.body.contains(assistant)) return;
                            
                            const containerWidth = titlebar.clientWidth;
                            const maxPos = containerWidth - 30;
                            const nextPos = Math.floor(Math.random() * maxPos);
                            const dist = Math.abs(nextPos - currentPos);
                            const speed = 50; 
                            const duration = dist / speed; 
                            
                            petImage.src = petWalkUrl;
                            assistant.style.transition = 'left ' + duration + 's linear';
                            
                            const dir = nextPos > currentPos ? 1 : -1;
                            assistant.style.setProperty('--dir', dir.toString());
                            assistant.style.left = nextPos + 'px';

                            // Random jump
                            if (Math.random() < 0.3) {
                                setTimeout(() => triggerJump(), Math.random() * duration * 1000);
                            }

                            currentPos = nextPos;

                            setTimeout(() => {
                                petImage.src = petIdleUrl;
                                if (Math.random() < 0.3) showMessage();
                                setTimeout(move, (1000 + Math.random() * 3000));
                            }, duration * 1000);
                        }

                        move();
                    };

                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initAssistant);
                    } else {
                        initAssistant();
                    }
                    
                    // Watch for titlebar recreation (e.g. settings change)
                    new MutationObserver(() => {
                        if (!document.getElementById(assistantId)) initAssistant();
                    }).observe(document.body, { childList: true, subtree: true });
                }

            } catch (e) {
                console.error('[VSCode Mascot] Error:', e);
            }
        })();
        `;
    }

    private getPetConfig(): { enabled: boolean, walkUrl: string, idleUrl: string } {
        try {
            const context = getContext();
            let enabled = false;
            let type = 'akita';

            if (context) {
                enabled = context.globalState.get<boolean>('backgroundCoverPetEnabled', false);
                type = context.globalState.get<string>('backgroundCoverPetType', 'akita');
            }

            const mapping: any = {
                'akita': { folder: 'dog', idle: 'akita_idle_8fps.gif', walk: 'akita_walk_8fps.gif' },
                'totoro': { folder: 'totoro', idle: 'gray_idle_8fps.gif', walk: 'gray_walk_8fps.gif' },
                'fox': { folder: 'fox', idle: 'red_idle_8fps.gif', walk: 'red_walk_8fps.gif' },
                'clippy': { folder: 'clippy', idle: 'black_idle_8fps.gif', walk: 'brown_walk_8fps.gif' },
                'rubber-duck': { folder: 'rubber-duck', idle: 'yellow_idle_8fps.gif', walk: 'yellow_walk_8fps.gif' },
                'crab': { folder: 'crab', idle: 'red_idle_8fps.gif', walk: 'red_walk_8fps.gif' },
                'zappy': { folder: 'zappy', idle: 'yellow_idle_8fps.gif', walk: 'yellow_walk_8fps.gif' },
                'cockatiel': { folder: 'cockatiel', idle: 'brown_idle_8fps.gif', walk: 'brown_walk_8fps.gif' },
                'snake': { folder: 'snake', idle: 'green_idle_8fps.gif', walk: 'green_walk_8fps.gif' },
                'chicken': { folder: 'chicken', idle: 'white_idle_8fps.gif', walk: 'white_walk_8fps.gif' },
                'turtle': { folder: 'turtle', idle: 'green_idle_8fps.gif', walk: 'green_walk_8fps.gif' },
                'panda': { folder: 'panda', idle: 'black_idle_8fps.gif', walk: 'black_walk_8fps.gif' },
                'snail': { folder: 'snail', idle: 'brown_idle_8fps.gif', walk: 'brown_walk_8fps.gif' },
                'deno': { folder: 'deno', idle: 'green_idle_8fps.gif', walk: 'green_walk_8fps.gif' },
                'deno2': { folder: 'deno2', idle: 'deno2_idle_8fps.gif', walk: 'deno2_walk_8fps.gif' },
                'morph': { folder: 'morph', idle: 'purple_idle_8fps.gif', walk: 'purple_walk_8fps.gif' },
                'pika': { folder: 'pika', idle: 'pika_still.gif', walk: 'pika_run.gif' },
            };

            const config = mapping[type] || mapping['akita'];
            const extensionRoot = context ? context.extensionPath : '';

            let walkUrl = '';
            let idleUrl = '';

            if (extensionRoot) {
                const walkPath = path.join(extensionRoot, 'resources', 'pet', config.folder, config.walk);
                const idlePath = path.join(extensionRoot, 'resources', 'pet', config.folder, config.idle);

                walkUrl = Uri.file(walkPath).with({ scheme: 'vscode-file', authority: 'vscode-app' }).toString();
                idleUrl = Uri.file(idlePath).with({ scheme: 'vscode-file', authority: 'vscode-app' }).toString();
            }

            return { enabled, walkUrl, idleUrl };
        } catch (e) {
            return { enabled: false, walkUrl: '', idleUrl: '' };
        }
    }

    private escapeTemplateLiteral(value: string): string {
        if (!value) return value;
        return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    }
}
