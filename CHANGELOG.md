# Changelog

## 1.2.0 (2026-01-08)

### 日本語 / Japanese
- **機能**: マスコットが移動できる端（上、左、右、下）を個別に設定できる機能を追加。
- **改善**: マスコットの移動ロジックを刷新し、ワープや逆さまになる問題を修正。
- **改善**: 左右の端を歩く際、壁をよじ登るような向きになるよう修正。
- **最適化**: 起動パフォーマンス向上のため、拡張機能の読み込みタイミングを調整。

### 英語 / English
- **Feature**: Added individual settings to enable/disable movement on specific edges (Top, Left, Right, Bottom).
- **Improvement**: Refactored movement logic to prevent teleporting and fixed orientation issues.
- **Improvement**: Adjusted mascot rotation on left/right edges to appear as climbing the wall.
- **Optimization**: Changed activation event to `onStartupFinished` for better startup performance.

---

## 1.1.0 (2026-01-08)

### 日本語 / Japanese
- **修正**: 拡張機能の起動失敗と、マスコット切り替え時の選択リフレッシュの問題を修正。
- **改善**: マスコットキャラクターのパス処理の安定性を向上。

### 英語 / English
- **Fix**: Resolved activation failure and character selection refresh issues.
- **Improvement**: Enhanced stability of mascot character path handling.

---

## 1.0.1 (2026-01-07)

### 日本語 / Japanese
- **機能**: 新しいマスコット（秋田犬、トトロ、ピカチュウ、恐竜など）を追加。
- **機能**: 設定項目の日本語ローカライズを完了。
- **改善**: マスコット表示の背景処理を最適化。

### 英語 / English
- **Feature**: Added new mascot characters (Akita, Totoro, Pika, Deno, etc.).
- **Feature**: Completed Japanese localization for settings.
- **Improvement**: Optimized background processing for mascot display.

---

## 1.0.0 (2026-01-07)

### 日本語 / Japanese
- **リリース**: `vscode-mascot` の初期リリース！
- **機能**: VSCodeの右下に可愛いマスコットを表示する機能。
- **機能**: 10種類以上のバリエーション豊かなキャラクターを選択可能。

### 英語 / English
- **Release**: Initial release of `vscode-mascot`!
- **Feature**: Display a cute mascot in the bottom right corner of VSCode.
- **Feature**: Over 10 varied characters to choose from.