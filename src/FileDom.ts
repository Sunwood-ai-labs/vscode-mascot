import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { env, Uri, window, workspace } from 'vscode';
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

enum SystemType {
    WINDOWS = 'Windows_NT',
    MACOS = 'Darwin',
    LINUX = 'Linux'
}

// workbench target detection removed from top level to prevent activation issues
export class FileDom {
    private readonly extName = "vscodeMascot";
    private readonly systemType: string;
    private bakStatus: boolean = false;
    private bakJsContent: string = '';
    private workbenchTarget: WorkbenchTarget | undefined;

    constructor() {
        this.systemType = os.type();
    }

    private getWorkbenchTarget(): WorkbenchTarget {
        if (this.workbenchTarget) return this.workbenchTarget;

        const pickByName = (name: string): WorkbenchTarget | undefined => {
            return WORKBENCH_TARGETS.find((target) => target.name === name && fs.existsSync(path.join(target.root, target.js)));
        };

        if (env.remoteName === 'ssh-remote' || (env.appName || '').toLowerCase().includes('server')) {
            const serverTarget = pickByName('code-server');
            if (serverTarget) return serverTarget;
        }

        this.workbenchTarget = pickByName('desktop') || pickByName('code-server') || WORKBENCH_TARGETS[0];
        return this.workbenchTarget;
    }

    private get JS_FILE_PATH() {
        const target = this.getWorkbenchTarget();
        return path.join(target.root, target.js);
    }

    private get BAK_FILE_PATH() {
        const target = this.getWorkbenchTarget();
        return path.join(target.root, target.bak);
    }

    public async install(): Promise<boolean> {
        console.log('[VSCode Mascot] Starting install process...');
        if (!(await this.checkFileExists())) {
            return false;
        }
        await this.ensureBackup();
        return await this.applyPatch();
    }

    private async checkFileExists(): Promise<boolean> {
        const isExist = await fse.pathExists(this.JS_FILE_PATH);
        if (!isExist) {
            console.error(`[VSCode Mascot] Core file not found: ${this.JS_FILE_PATH}`);
            await window.showErrorMessage(`Core file not found: ${this.JS_FILE_PATH}`);
            return false;
        }
        return true;
    }

    private async ensureBackup(): Promise<void> {
        const bakExist = await fse.pathExists(this.BAK_FILE_PATH);
        if (!bakExist) {
            this.bakStatus = true;
            console.log('[VSCode Mascot] Creating backup...');
            window.setStatusBarMessage(`First time setup: Backing up workbench file...`, 10000);
        }
    }

    private async applyPatch(): Promise<boolean> {
        const lockPath = path.join(os.tmpdir(), 'vscode-mascot.lock');
        let release: (() => Promise<void>) | undefined;

        try {
            if (!(await fse.pathExists(lockPath))) {
                await fse.writeFile(lockPath, '', 'utf8');
            }
            release = await lockfile.lock(lockPath, { retries: 5, stale: 20000 });

            console.log('[VSCode Mascot] Applying patch...');
            const patchContent = this.getJs(); // Tags are now included here with enough spacing
            const currentContent = await this.getContent(this.JS_FILE_PATH);

            // Check if we need to update
            if (currentContent.includes(patchContent.trim())) {
                console.log('[VSCode Mascot] Patch already up to date.');
                return true;
            }

            console.log('[VSCode Mascot] Patch needs update.');

            // Check for corruption: if start exists but end is missing, or markers appear mangled
            const hasStart = currentContent.includes(`/*ext-${this.extName}-start*/`);
            const hasEnd = currentContent.includes(`/*ext-${this.extName}-end*/`);

            let sourceContent = currentContent;
            if ((hasStart && !hasEnd) || (currentContent.includes('endrt'))) {
                console.warn('[VSCode Mascot] Corruption detected. Restoring from backup...');
                if (await fse.pathExists(this.BAK_FILE_PATH)) {
                    sourceContent = await this.getContent(this.BAK_FILE_PATH);
                } else {
                    throw new Error('Workbench file corrupted and no backup found. Please reinstall VS Code.');
                }
            }

            // Safe cleaning
            let cleanContent = this.clearContent(sourceContent, 'backgroundCover');
            cleanContent = this.clearContent(cleanContent, this.extName);

            if (this.bakStatus) {
                this.bakJsContent = cleanContent;
                await this.bakFile();
            }

            // Append patch at the end, but before any existing sourceMappingURL if possible
            // Most VSCode JS files end with sourceMappingURL.
            const smMarker = '//# sourceMappingURL=';
            let newContent: string;

            if (cleanContent.includes(smMarker)) {
                const parts = cleanContent.split(smMarker);
                // Insert before the last occurrence of sourcemapping
                const mapPart = parts.pop();
                newContent = parts.join(smMarker) + patchContent + '\n' + smMarker + mapPart;
            } else {
                newContent = cleanContent + patchContent;
            }

            await this.saveContent(newContent);
            console.log('[VSCode Mascot] Patch applied successfully.');
            return true;

        } catch (error: any) {
            console.error('[VSCode Mascot] Installation failed:', error);
            await window.showErrorMessage(`Installation failed: ${error.message}`);
            return false;
        } finally {
            if (release) await release();
        }
    }

    public async uninstall(): Promise<boolean> {
        try {
            const content = this.clearContent(await this.getContent(this.JS_FILE_PATH), this.extName);
            await this.saveContent(content);
            return true;
        } catch (error) {
            await window.showErrorMessage(`Uninstall failed: ${error}`);
            return false;
        }
    }

    private async getContent(filePath: string): Promise<string> {
        return await fse.readFile(filePath, 'utf8');
    }

    private async saveContent(content: string): Promise<boolean> {
        await this.writeWithPermission(this.JS_FILE_PATH, content);
        return true;
    }

    private async writeWithPermission(filePath: string, content: string): Promise<void> {
        try {
            await fse.writeFile(filePath, content, 'utf8');
        } catch (err) {
            console.log('[VSCode Mascot] Permission denied, trying sudo...');
            await this.getFilePermission(filePath);
            await fse.writeFile(filePath, content, 'utf8');
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
            await fse.writeFile(this.BAK_FILE_PATH, this.bakJsContent, 'utf8');
        } catch (err) {
            if (this.systemType === SystemType.WINDOWS) {
                await SudoPromptHelper.exec(`echo. > "${this.BAK_FILE_PATH}"`);
                await SudoPromptHelper.exec(`icacls "${this.BAK_FILE_PATH}" /grant Users:F`);
            } else {
                await SudoPromptHelper.exec(`touch "${this.BAK_FILE_PATH}"`);
                await SudoPromptHelper.exec(`chmod 666 "${this.BAK_FILE_PATH}"`);
            }
            await fse.writeFile(this.BAK_FILE_PATH, this.bakJsContent, 'utf8');
        }
    }

    private getJs(): string {
        return `
\n/*ext-${this.extName}-start*/
/*ext.${this.extName}.ver.${version}*/
${this.getLoaderJs()}
/*ext-${this.extName}-end*/\n`;
    }

    private clearContent(content: string, extName: string): string {
        const regex = new RegExp(`\\/\\*ext-${extName}-start\\*\\/[\\s\\S]*?\\/\\*ext-${extName}-end\\*\\/`, 'g');
        return content.replace(regex, '').replace(/\n\s*\n/g, '\n').trim();
    }

    private getLoaderJs(): string {
        const petConfig = this.getPetConfig();
        const context = getContext();
        if (!context) {
            return '';
        }

        const mascotJsPath = path.join(context.extensionPath, 'resources', 'mascot.js');
        if (!fs.existsSync(mascotJsPath)) {
            console.error(`[VSCode Mascot] mascot.js not found at ${mascotJsPath}`);
            return '';
        }

        let mascotJs = fs.readFileSync(mascotJsPath, 'utf-8');

        // Replace placeholders globally
        mascotJs = mascotJs
            .replace(/__PET_ENABLED__/g, String(petConfig.enabled))
            .replace(/__PET_WALK_URLS__/g, JSON.stringify(petConfig.walkUrls))
            .replace(/__PET_IDLE_URLS__/g, JSON.stringify(petConfig.idleUrls))
            .replace(/__PET_EMOTE_URLS__/g, JSON.stringify(petConfig.emoteUrls))
            .replace(/__EDGE_CONFIG__/g, JSON.stringify(petConfig.edges))
            .replace(/__SPEECH_CONFIG__/g, JSON.stringify(petConfig.speech));

        return mascotJs;
    }

    private getPetConfig(): { enabled: boolean, walkUrls: string[], idleUrls: string[], emoteUrls: string[], edges: { top: boolean, right: boolean, bottom: boolean, left: boolean }, speech: { enabled: boolean, fontSize: string } } {
        try {
            const config = workspace.getConfiguration('vscodeMascot');
            const enabled = config.get<boolean>('enabled', false);
            const type = config.get<string>('type', 'akita');
            const edges = {
                top: config.get<boolean>('enableTopEdge', true),
                right: config.get<boolean>('enableRightEdge', true),
                bottom: config.get<boolean>('enableBottomEdge', true),
                left: config.get<boolean>('enableLeftEdge', true)
            };
            const speech = {
                enabled: config.get<boolean>('speech.enabled', true),
                fontSize: config.get<string>('speech.fontSize', '12px')
            };

            console.log(`[VSCode Mascot] Config - Enabled: ${enabled}, Type: ${type}, Edges: ${JSON.stringify(edges)}`);

            const mapping: { [key: string]: { folder: string, idle: string[], walk: string[], emote?: string[] } } = {
                'akita': { folder: 'dog', idle: ['akita_idle_8fps.gif'], walk: ['akita_walk_8fps.gif'] },
                'totoro': { folder: 'totoro', idle: ['gray_idle_8fps.gif'], walk: ['gray_walk_8fps.gif'] },
                'fox': { folder: 'fox', idle: ['red_idle_8fps.gif'], walk: ['red_walk_8fps.gif'] },
                'clippy': { folder: 'clippy', idle: ['black_idle_8fps.gif'], walk: ['brown_walk_8fps.gif'] },
                'rubber-duck': { folder: 'rubber-duck', idle: ['yellow_idle_8fps.gif'], walk: ['yellow_walk_8fps.gif'] },
                'crab': { folder: 'crab', idle: ['red_idle_8fps.gif'], walk: ['red_walk_8fps.gif'] },
                'zappy': { folder: 'zappy', idle: ['yellow_idle_8fps.gif'], walk: ['yellow_walk_8fps.gif'] },
                'cockatiel': { folder: 'cockatiel', idle: ['brown_idle_8fps.gif'], walk: ['brown_walk_8fps.gif'] },
                'snake': { folder: 'snake', idle: ['green_idle_8fps.gif'], walk: ['green_walk_8fps.gif'] },
                'chicken': { folder: 'chicken', idle: ['white_idle_8fps.gif'], walk: ['white_walk_8fps.gif'] },
                'turtle': { folder: 'turtle', idle: ['green_idle_8fps.gif'], walk: ['green_walk_8fps.gif'] },
                'panda': { folder: 'panda', idle: ['black_idle_8fps.gif'], walk: ['black_walk_8fps.gif'] },
                'snail': { folder: 'snail', idle: ['brown_idle_8fps.gif'], walk: ['brown_walk_8fps.gif'] },
                'deno': { folder: 'deno', idle: ['green_idle_8fps.gif'], walk: ['green_walk_8fps.gif'] },
                'deno2': { folder: 'deno2', idle: ['deno2_idle_8fps.gif'], walk: ['deno2_walk_8fps.gif'] },
                'morph': { folder: 'morph', idle: ['purple_idle_8fps.gif'], walk: ['purple_walk_8fps.gif'] },
                'pika': { folder: 'pika', idle: ['pika_still.gif'], walk: ['pika_run.gif'] },
                'fox_mini1': { folder: 'fox_mini1', idle: ['fox_mini1_idle_2fps.gif'], walk: ['fox_mini1_walk_2fps.gif'] },
                'togemaru': {
                    folder: 'togemaru',
                    idle: ['togemaru_idle_1.gif', 'togemaru_idle_2.gif'],
                    walk: ['togemaru_walk_1.gif', 'togemaru_walk_2.gif'],
                    emote: ['togemaru_emote_1.gif']
                },
                'senshi-a': {
                    folder: 'senshi-a',
                    idle: ['senshi_a_idle.png'],
                    walk: ['senshi_a_walk.png']
                },
            };

            const mascotMapping = mapping[type] || mapping['akita'];
            const context = getContext();
            const extensionRoot = context ? context.extensionPath : '';
            console.log(`[VSCode Mascot] Extension Root: ${extensionRoot}`);

            const walkUrls: string[] = [];
            const idleUrls: string[] = [];
            const emoteUrls: string[] = [];

            if (extensionRoot) {
                const mapToUrl = (file: string) => {
                    const filePath = path.join(extensionRoot, 'resources', 'pet', mascotMapping.folder, file);
                    return Uri.file(filePath).with({ scheme: 'vscode-file', authority: 'vscode-app' }).toString();
                };

                mascotMapping.walk.forEach(f => walkUrls.push(mapToUrl(f)));
                mascotMapping.idle.forEach(f => idleUrls.push(mapToUrl(f)));
                if (mascotMapping.emote) {
                    mascotMapping.emote.forEach(f => emoteUrls.push(mapToUrl(f)));
                }
            }

            return { enabled, walkUrls, idleUrls, emoteUrls, edges, speech };
        } catch (e) {
            console.error('[VSCode Mascot] getPetConfig Error:', e);
            return { enabled: false, walkUrls: [], idleUrls: [], emoteUrls: [], edges: { top: true, right: true, bottom: true, left: true }, speech: { enabled: true, fontSize: '12px' } };
        }
    }


}
