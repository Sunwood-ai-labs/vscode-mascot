(function () {
    const _petEnabled = __PET_ENABLED__;
    const _petWalkUrls = __PET_WALK_URLS__;
    const _petIdleUrls = __PET_IDLE_URLS__;
    const _petEmoteUrls = __PET_EMOTE_URLS__;
    const _edgeConfig = __EDGE_CONFIG__;
    const _speechConfig = __SPEECH_CONFIG__;

    const _pickRandom = (arr) => arr && arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null;

    try {
        if (!_petEnabled) {
            const assistant = document.getElementById('vscode-mascot-assistant');
            if (assistant) assistant.remove();
        } else {
            const assistantId = 'vscode-mascot-assistant';
            const styleId = 'vscode-mascot-assistant-style';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = '.pet-message {' +
                    'position: absolute;' +
                    'bottom: 100%;' +
                    'left: 50%;' +
                    'transform: translateX(-50%);' +
                    'background: rgba(255, 255, 255, 0.9);' +
                    'color: #000;' +
                    'padding: 4px 8px;' +
                    'border-radius: 4px;' +
                    'font-size: ' + _speechConfig.fontSize + ';' +
                    'white-space: nowrap;' +
                    'pointer-events: none;' +
                    'opacity: 0;' +
                    'transition: opacity 0.3s;' +
                    'box-shadow: 0 2px 4px rgba(0,0,0,0.2);' +
                    'z-index: 100000;' +
                    '}' +
                    '.pet-message.show {' +
                    'opacity: 1;' +
                    '}' +
                    '.pet-message::after {' +
                    'content: \'\';' +
                    'position: absolute;' +
                    'top: 100%;' +
                    'left: 50%;' +
                    'margin-left: -4px;' +
                    'border-width: 4px;' +
                    'border-style: solid;' +
                    'border-color: rgba(255, 255, 255, 0.9) transparent transparent transparent;' +
                    '}';
                document.head.appendChild(style);
            }

            const initAssistant = () => {
                if (document.getElementById(assistantId)) return;
                const assistant = document.createElement('div');
                assistant.id = assistantId;
                const petImage = document.createElement('img');
                petImage.src = _pickRandom(_petIdleUrls);
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
                assistant.style.transform = 'translate(0px, 0px)';
                petImage.style.transition = 'none';
                petImage.style.willChange = 'transform';
                let currentEdge = 0;
                let currentOffset = 0;
                const isValidEdge = (e) => {
                    if (e === 0) return _edgeConfig.top;
                    if (e === 1) return _edgeConfig.right;
                    if (e === 2) return _edgeConfig.bottom;
                    if (e === 3) return _edgeConfig.left;
                    return false;
                };
                if (!isValidEdge(currentEdge)) {
                    for (let i = 0; i < 4; i++) {
                        if (isValidEdge(i)) {
                            currentEdge = i;
                            break;
                        }
                    }
                }
                const getCoords = (edge, offset) => {
                    const w = window.innerWidth;
                    const h = window.innerHeight;
                    const size = 30;
                    let x = 0, y = 0, rot = 0;
                    switch (edge) {
                        case 0: x = offset; y = 0; rot = 0; break;
                        case 1: x = w - size; y = offset; rot = -90; break;
                        case 2: x = w - size - offset; y = h - size; rot = 0; break;
                        case 3: x = 0; y = h - size - offset; rot = 90; break;
                    }
                    return { x, y, rot };
                };
                const updateVisuals = (x, y, rot, facingDir) => {
                    let finalScaleX = (currentEdge === 0) ? facingDir : -facingDir;
                    assistant.style.setProperty('--currX', x + 'px');
                    assistant.style.setProperty('--currY', y + 'px');
                    assistant.style.setProperty('--rot', rot + 'deg');
                    assistant.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + rot + 'deg)';
                    petImage.style.transform = 'scaleX(' + finalScaleX + ')';
                };
                const startCoords = getCoords(currentEdge, currentOffset);
                updateVisuals(startCoords.x, startCoords.y, startCoords.rot, 1);
                document.body.appendChild(assistant);
                const messages = [
                    "Hello!", "Coding...", "Need coffee?",
                    "\u4f11\u61a3\u3057\u3088\u3046\uff01", // 休憩しよう！
                    "\u30d0\u30b0\uff1f", // バグ？
                    "VS Code \u6700\u9ad8\uff01", // VS Code 最高！
                    "AI\u4f7f\u3063\u3066\u308b\uff1f", // AI使ってる？
                    "TypeScript!", "Commit often!", "Don't panic"
                ];
                function showMessage() {
                    if (!_speechConfig.enabled) return;
                    const msg = messages[Math.floor(Math.random() * messages.length)];
                    const bubble = document.createElement('div');
                    bubble.className = 'pet-message';
                    bubble.textContent = msg;
                    const currentRot = assistant.style.getPropertyValue('--rot').replace('deg', '');
                    bubble.style.transform = 'translateX(-50%) rotate(' + (-currentRot) + 'deg)';
                    assistant.appendChild(bubble);
                    void bubble.offsetWidth;
                    bubble.classList.add('show');
                    if (_petEmoteUrls && _petEmoteUrls.length > 0) {
                        petImage.src = _pickRandom(_petEmoteUrls);
                    }
                    setTimeout(() => {
                        bubble.classList.remove('show');
                        setTimeout(() => {
                            bubble.remove();
                            petImage.src = _pickRandom(_petIdleUrls);
                        }, 300);
                    }, 3000);
                }
                function nextMove() {
                    if (!document.body.contains(assistant)) return;
                    const w = window.innerWidth;
                    const h = window.innerHeight;
                    const size = 30;
                    const edgeLen = (currentEdge % 2 === 0) ? w : h;
                    const maxOffset = edgeLen - size;
                    const targets = [0, maxOffset, Math.floor(Math.random() * maxOffset)];
                    let target = currentOffset;
                    for (let i = 0; i < 5; i++) {
                        let t = targets[Math.floor(Math.random() * targets.length)];
                        if (Math.abs(t - currentOffset) > 20) {
                            target = t;
                            break;
                        }
                    }
                    if (Math.abs(target - currentOffset) <= 20) {
                        target = (currentOffset < maxOffset / 2) ? maxOffset : 0;
                    }
                    const dist = Math.abs(target - currentOffset);
                    const speed = 50;
                    const duration = Math.max(0.5, dist / speed);
                    petImage.src = _pickRandom(_petWalkUrls);
                    assistant.style.transition = 'transform ' + duration + 's linear';
                    const direction = target > currentOffset ? 1 : -1;
                    const targetCoords = getCoords(currentEdge, target);
                    updateVisuals(targetCoords.x, targetCoords.y, targetCoords.rot, direction);
                    setTimeout(() => {
                        currentOffset = target;
                        if (!assistant.querySelector('.pet-message')) {
                            if (_petEmoteUrls && _petEmoteUrls.length > 0 && Math.random() < 0.2) {
                                petImage.src = _pickRandom(_petEmoteUrls);
                            } else {
                                petImage.src = _pickRandom(_petIdleUrls);
                            }
                        }
                        const currW = window.innerWidth;
                        const currH = window.innerHeight;
                        const currLen = (currentEdge % 2 === 0) ? currW : currH;
                        const currMax = currLen - 30;
                        if (currentOffset >= currMax) {
                            const nextEdge = (currentEdge + 1) % 4;
                            if (isValidEdge(nextEdge)) {
                                assistant.style.transition = 'none';
                                currentEdge = nextEdge;
                                currentOffset = 0;
                                const newCoords = getCoords(currentEdge, currentOffset);
                                updateVisuals(newCoords.x, newCoords.y, newCoords.rot, 1);
                            }
                        } else if (currentOffset <= 0) {
                            const prevEdge = (currentEdge + 3) % 4;
                            if (isValidEdge(prevEdge)) {
                                assistant.style.transition = 'none';
                                const prevMax = ((prevEdge % 2 === 0) ? currW : currH) - 30;
                                currentEdge = prevEdge;
                                currentOffset = prevMax;
                                const newCoords = getCoords(currentEdge, currentOffset);
                                updateVisuals(newCoords.x, newCoords.y, newCoords.rot, -1);
                            }
                        }
                        if (Math.random() < 0.3) showMessage();
                        setTimeout(nextMove, 1000 + Math.random() * 2000);
                    }, duration * 1000);
                }
                setTimeout(nextMove, 1000);
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initAssistant);
            } else {
                initAssistant();
            }
            new MutationObserver((mutations) => {
                if (!document.getElementById(assistantId)) {
                    initAssistant();
                }
            }).observe(document.body, { childList: true, subtree: true });
        }
    } catch (e) {
        console.error('[VSCode Mascot] Error:', e);
    }
})();
