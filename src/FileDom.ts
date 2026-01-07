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
                await fse.writeFile(lockPath, '', 'utf-8');
            }
            release = await lockfile.lock(lockPath, { retries: 5, stale: 20000 });

            console.log('[VSCode Mascot] Applying patch...');
            const content = this.getJs().trim();
            const currentContent = await this.getContent(this.JS_FILE_PATH);

            // Check if we need to update
            const match = currentContent.match(new RegExp(`\\/\\*ext-${this.extName}-start\\*\\/([\\s\\S]*?)\\/\\*ext-${this.extName}-end\\*\\/`));
            if (match && match[0].trim() === content.trim()) {
                console.log('[VSCode Mascot] Patch already applied and up to date.');
                // Even if up to date, we return true to indicate success.
                // But we could return a different value if we wanted to skip the restart prompt.
                return true;
            }

            console.log('[VSCode Mascot] Patch needs update or initial application.');
            // Remove old mascot patch if exists (or old background-cover patch)
            let cleanContent = this.clearContent(currentContent, 'backgroundCover'); // Clean legacy
            cleanContent = this.clearContent(cleanContent, this.extName); // Clean current

            if (this.bakStatus) {
                this.bakJsContent = cleanContent;
                await this.bakFile();
            }

            const newContent = cleanContent + "\n" + content; // Ensure newline before patch
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
        return await fse.readFile(filePath, 'utf-8');
    }

    private async saveContent(content: string): Promise<boolean> {
        await this.writeWithPermission(this.JS_FILE_PATH, content);
        return true;
    }

    private async writeWithPermission(filePath: string, content: string): Promise<void> {
        try {
            await fse.writeFile(filePath, content, { encoding: 'utf-8' });
        } catch (err) {
            console.log('[VSCode Mascot] Permission denied, trying sudo...');
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
            await fse.writeFile(this.BAK_FILE_PATH, this.bakJsContent, { encoding: 'utf-8' });
        } catch (err) {
            // Permission handling for backup creation if needed
            if (this.systemType === SystemType.WINDOWS) {
                await SudoPromptHelper.exec(`echo. > "${this.BAK_FILE_PATH}"`);
                await SudoPromptHelper.exec(`icacls "${this.BAK_FILE_PATH}" /grant Users:F`);
            } else {
                await SudoPromptHelper.exec(`touch "${this.BAK_FILE_PATH}"`);
                await SudoPromptHelper.exec(`chmod 666 "${this.BAK_FILE_PATH}"`);
            }
            await fse.writeFile(this.BAK_FILE_PATH, this.bakJsContent, { encoding: 'utf-8' });
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
        return `
        (function() {
            // Pet Config
            const petEnabled = ${petConfig.enabled};
            const petWalkUrl = '${this.escapeTemplateLiteral(petConfig.walkUrl)}';
            const petIdleUrl = '${this.escapeTemplateLiteral(petConfig.idleUrl)}';
            const edgeConfig = ${JSON.stringify(petConfig.edges)};

            // Little Assistant Logic
            try {
                if (!petEnabled) {
                    const assistant = document.getElementById('vscode-mascot-assistant');
                    if (assistant) assistant.remove();
                } else {
                    const assistantId = 'vscode-mascot-assistant';
                    
                    // Inject CSS for animations
                    const styleId = 'vscode-mascot-assistant-style';
                    if (!document.getElementById(styleId)) {
                        const style = document.createElement('style');
                        style.id = styleId;
                        style.textContent = \`
                            .pet-message {
                                position: absolute;
                                bottom: 100%;
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
                                top: 100%;
                                left: 50%;
                                margin-left: -4px;
                                border-width: 4px;
                                border-style: solid;
                                border-color: rgba(255, 255, 255, 0.9) transparent transparent transparent;
                            }
                        \`;
                        document.head.appendChild(style);
                    }

                    const initAssistant = () => {
                        if (document.getElementById(assistantId)) return;
                        
                        const assistant = document.createElement('div');
                        assistant.id = assistantId;
                        
                        const petImage = document.createElement('img');
                        petImage.src = petIdleUrl;
                        petImage.style.width = '30px'; 
                        petImage.style.height = 'auto';
                        petImage.style.imageRendering = 'pixelated';
                        
                        assistant.appendChild(petImage);

                        assistant.style.position = 'fixed';
                        assistant.style.zIndex = '99999';
                        assistant.style.top = '0px'; 
                        assistant.style.left = '0px';
                        assistant.style.pointerEvents = 'none';
                        assistant.style.willChange = 'transform';
                        // Initialize transform
                        assistant.style.transform = 'translate(0px, 0px)';
                        
                        // State variables
                        // Edges: 0=TOP, 1=RIGHT, 2=BOTTOM, 3=LEFT
                        let currentEdge = 0; 
                        let currentOffset = 0; // Pixels from start of edge (Clockwise)
                        
                        // Edge Validation
                        const isValidEdge = (e) => {
                            if (e === 0) return edgeConfig.top;
                            if (e === 1) return edgeConfig.right;
                            if (e === 2) return edgeConfig.bottom;
                            if (e === 3) return edgeConfig.left;
                            return false;
                        };

                        // Find closest valid edge if current is invalid
                        if (!isValidEdge(currentEdge)) {
                            for(let i=0; i<4; i++) {
                                if(isValidEdge(i)) {
                                    currentEdge = i;
                                    break;
                                }
                            }
                        }

                        // Helper to calculate coordinates based on Edge + Offset
                        const getCoords = (edge, offset) => {
                            const w = window.innerWidth;
                            const h = window.innerHeight;
                            const size = 30; // Mascot size approx

                            let x = 0, y = 0, rot = 0;

                            // Coordinate definitions (Classic Clockwise)
                            // Top:    (0,0) -> (W,0)
                            // Right:  (W,0) -> (W,H)
                            // Bottom: (W,H) -> (0,H)
                            // Left:   (0,H) -> (0,0)
                            
                            switch(edge) {
                                case 0: // TOP
                                    x = offset;
                                    y = 0;
                                    rot = 0;
                                    break;
                                case 1: // RIGHT
                                    x = w - size;
                                    y = offset;
                                    rot = -90; // Feet point Right (Outside) -> Head points Left (Inside)
                                    break;
                                case 2: // BOTTOM
                                    x = w - size - offset;
                                    y = h - size;
                                    rot = 0; // Upright
                                    break;
                                case 3: // LEFT
                                    x = 0;
                                    y = h - size - offset;
                                    rot = 90; // Feet point Left (Outside) -> Head points Right (Inside)
                                    break;
                            }
                            return { x, y, rot };
                        };

                        const updateVisuals = (x, y, rot, facingDir) => {
                            // dir: 1 = walking forward (clockwise), -1 = walking backward
                            
                            // Adjust facing for rotation
                            // Top (0deg): Walk Right (+dir) -> Face Right -> scaleX(1)
                            
                            // Right (-90deg, Native Up): 
                            //   Walk Down (+dir) -> Want Face Down -> Native Up flipped -> scaleX(-1)
                            
                            // Bottom (0deg, Native Right): 
                            //   Walk Left (+dir) -> Want Face Left -> Native Right flipped -> scaleX(-1)
                            
                            // Left (90deg, Native Down): 
                            //   Walk Up (+dir) -> Want Face Up -> Native Down flipped -> scaleX(-1)

                            // Simplified Formula:
                            // Top: scale = dir
                            // Others: scale = -dir
                            
                            let finalScaleX = (currentEdge === 0) ? facingDir : -facingDir;

                            assistant.style.setProperty('--currX', x + 'px');
                            assistant.style.setProperty('--currY', y + 'px');
                            assistant.style.setProperty('--rot', rot + 'deg');
                            assistant.style.setProperty('--dir', finalScaleX.toString());
                            assistant.style.transform = \`translate(\${x}px, \${y}px) rotate(\${rot}deg) scaleX(\${finalScaleX})\`;
                        };

                        // Initial Place
                        const startCoords = getCoords(currentEdge, currentOffset);
                        updateVisuals(startCoords.x, startCoords.y, startCoords.rot, 1);
                        document.body.appendChild(assistant);

                        const messages = [
                            "Hello!", "Coding...", "Need coffee?", "休憩しよう！", "バグ？", "VS Code 最高！",
                            "AI使ってる？", "TypeScript!", "Commit often!", "Don't panic"
                        ];

                        function showMessage() {
                            const msg = messages[Math.floor(Math.random() * messages.length)];
                            const bubble = document.createElement('div');
                            bubble.className = 'pet-message';
                            bubble.textContent = msg;
                            // Reset text rotation
                            // If mascot is rotated 90, bubble needs -90
                            const currentRot = assistant.style.getPropertyValue('--rot').replace('deg','');
                            const currentScale = assistant.style.getPropertyValue('--dir');
                            bubble.style.transform = \`translateX(-50%) rotate(\${-currentRot}deg) scaleX(\${currentScale})\`;
                            
                            assistant.appendChild(bubble);
                            void bubble.offsetWidth;
                            bubble.classList.add('show');
                            setTimeout(() => {
                                bubble.classList.remove('show');
                                setTimeout(() => bubble.remove(), 300);
                            }, 3000);
                        }

                        // Main Logic Loop (Recursive via setTimeout)
                        function nextMove() {
                            if (!document.body.contains(assistant)) return;

                            const w = window.innerWidth;
                            const h = window.innerHeight;
                            const size = 30;
                            // Calculate length of current edge
                            const edgeLen = (currentEdge % 2 === 0) ? w : h;
                            const maxOffset = edgeLen - size; // Stop before overflowing cornner

                            // Decide Target
                            // We can go to 0 (CCW neighbor) or maxOffset (CW neighbor) or random point
                            const targets = [];
                            
                            // Always allow going to corners
                            targets.push(0);
                            targets.push(maxOffset);
                            // Add a random midpoint
                            targets.push(Math.floor(Math.random() * maxOffset));

                            // Pick one target different from current
                            let target = currentOffset;
                            for (let i=0; i<5; i++) {
                                let t = targets[Math.floor(Math.random() * targets.length)];
                                if (Math.abs(t - currentOffset) > 20) {
                                    target = t;
                                    break;
                                }
                            }
                            // If stuck, force move to other end
                            if (Math.abs(target - currentOffset) <= 20) {
                                target = (currentOffset < maxOffset / 2) ? maxOffset : 0;
                            }

                            // Move Duration
                            const dist = Math.abs(target - currentOffset);
                            const speed = 50; // px per sec
                            const duration = Math.max(0.5, dist / speed);

                            // Apply Transition
                            petImage.src = petWalkUrl;
                            assistant.style.transition = 'transform ' + duration + 's linear';
                            
                            // Visual update for Target
                            const direction = target > currentOffset ? 1 : -1;
                            const targetCoords = getCoords(currentEdge, target);
                            
                            // Update Visuals (Translate)
                            // Note: Rotation stays same during straight walk
                            updateVisuals(targetCoords.x, targetCoords.y, targetCoords.rot, direction);

                            // Wait for arrival
                            setTimeout(() => {
                                currentOffset = target;
                                petImage.src = petIdleUrl;
                                
                                // AT ARRIVAL: Check if we are at a corner to Switch Edge
                                let switched = false;
                                
                                // Re-calc maxOffset in case window resized
                                const currW = window.innerWidth;
                                const currH = window.innerHeight;
                                const currLen = (currentEdge % 2 === 0) ? currW : currH;
                                const currMax = currLen - 30;

                                if (currentOffset >= currMax) {
                                    // At Clockwise End -> Try Next Edge (CW)
                                    const nextEdge = (currentEdge + 1) % 4;
                                    if (isValidEdge(nextEdge)) {
                                        // Valid! Switch.
                                        // Old End -> New Start (Offset 0)
                                        assistant.style.transition = 'none'; // Instant switch to new coord system (should be visually same point)
                                        currentEdge = nextEdge;
                                        currentOffset = 0;
                                        const newCoords = getCoords(currentEdge, currentOffset);
                                        updateVisuals(newCoords.x, newCoords.y, newCoords.rot, 1);
                                        switched = true;
                                    } else {
                                        // Dead end, just stay here and next loop will send us back
                                    }
                                } else if (currentOffset <= 0) {
                                    // At Counter-Clockwise End -> Try Prev Edge (CCW)
                                    const prevEdge = (currentEdge + 3) % 4; // -1 + 4
                                    if (isValidEdge(prevEdge)) {
                                        // Valid! Switch.
                                        // Old Start -> New End (Max Offset)
                                        assistant.style.transition = 'none';
                                        
                                        // Calc max of prev edge
                                        const prevLen = (prevEdge % 2 === 0) ? currW : currH;
                                        const prevMax = prevLen - 30;
                                        
                                        currentEdge = prevEdge;
                                        currentOffset = prevMax;
                                        
                                        const newCoords = getCoords(currentEdge, currentOffset);
                                        updateVisuals(newCoords.x, newCoords.y, newCoords.rot, -1); 
                                        switched = true;
                                    }
                                }

                                // Random message
                                if (Math.random() < 0.3) showMessage();

                                // Schedule next move
                                // If we just switched edges, move immediately to look continuous? 
                                // Or pause? A small pause feels natural.
                                setTimeout(nextMove, 1000 + Math.random() * 2000);

                            }, duration * 1000);

                        } // End nextMove

                        // Kickoff
                        setTimeout(nextMove, 1000);
                    };

                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', initAssistant);
                    } else {
                        initAssistant();
                    }
                    
                    let observer = new MutationObserver((mutations) => {
                        if (!document.getElementById(assistantId)) {
                             initAssistant();
                        }
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                }

            } catch (e) {
                console.error('[VSCode Mascot] Error:', e);
            }
        })();
        `;
    }

    private getPetConfig(): { enabled: boolean, walkUrl: string, idleUrl: string, edges: { top: boolean, right: boolean, bottom: boolean, left: boolean } } {
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

            console.log(`[VSCode Mascot] Config - Enabled: ${enabled}, Type: ${type}, Edges: ${JSON.stringify(edges)}`);

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

            const mascotMapping = mapping[type] || mapping['akita'];
            const context = getContext();
            const extensionRoot = context ? context.extensionPath : '';
            console.log(`[VSCode Mascot] Extension Root: ${extensionRoot}`);

            let walkUrl = '';
            let idleUrl = '';

            if (extensionRoot) {
                const walkPath = path.join(extensionRoot, 'resources', 'pet', mascotMapping.folder, mascotMapping.walk);
                const idlePath = path.join(extensionRoot, 'resources', 'pet', mascotMapping.folder, mascotMapping.idle);

                walkUrl = Uri.file(walkPath).with({ scheme: 'vscode-file', authority: 'vscode-app' }).toString();
                idleUrl = Uri.file(idlePath).with({ scheme: 'vscode-file', authority: 'vscode-app' }).toString();
            }

            return { enabled, walkUrl, idleUrl, edges };
        } catch (e) {
            console.error('[VSCode Mascot] getPetConfig Error:', e);
            return { enabled: false, walkUrl: '', idleUrl: '', edges: { top: true, right: true, bottom: true, left: true } };
        }
    }

    private escapeTemplateLiteral(value: string): string {
        if (!value) return value;
        return value.replace(/\\\\/g, '\\\\\\\\').replace(/`/g, '\\\\`').replace(/\\\\\$\{/g, '\\\\\\${');
    }
}
