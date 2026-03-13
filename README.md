# My Outliner

アウトライン形式のタスク管理アプリ。Firebase（認証・Firestore）とNext.jsで構築。

## セットアップ手順

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Firebase の設定

#### Firebaseコンソールでの作業

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication** → 「始める」→ **匿名**を有効化
3. **Firestore Database** → 「データベースを作成」→ 本番モードで開始
4. Firestoreの**ルール**タブを開き、以下のルールを設定：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

5. プロジェクトの設定 → 「アプリを追加」→ Webアプリを追加 → SDK の設定をコピー

#### 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` を開いて、Firebaseの値を貼り付ける：

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123...
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) をブラウザで開く。

---

## Vercel へのデプロイ

### 方法A: GitHub連携（推奨）

1. このプロジェクトをGitHubにpush
2. [vercel.com](https://vercel.com) にアクセスし、リポジトリをimport
3. **Environment Variables** に `.env.local` の内容を追加
4. Deploy ボタンをクリック

### 方法B: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

デプロイ後、Vercelダッシュボードの **Settings → Environment Variables** に `.env.local` の内容を追加し、再デプロイ：

```bash
vercel --prod
```

---

## キーボードショートカット

| キー | 動作 |
|------|------|
| `Enter` | 新しいノードを追加 |
| `Tab` | インデント（子ノードにする） |
| `Shift + Tab` | アンインデント（親階層に戻す） |
| `Backspace`（空のノード）| ノードを削除 |
| `↑ / ↓` | フォーカス移動 |

---

## 注意事項

- 匿名認証を使用するため、**ブラウザ単位でデータが保存**されます
- `.env.local` は `.gitignore` に含まれているので、APIキーがGitHubに漏れません
- Firestoreのセキュリティルールを必ず設定してください
