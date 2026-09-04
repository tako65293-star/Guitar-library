# Guitar Library

自分専用のコード譜・TAB譜ライブラリ。ログイン不要・サーバー不要・完全ローカル保存(IndexedDB)の個人用PWAです。

## 公開してiPhoneで使う(推奨: GitHub Pages)

1. このフォルダの中身(index.html / style.css / app.js / manifest.json / sw.js / icons/)をGitHubリポジトリにアップロード
2. リポジトリの Settings → Pages で公開(ブランチをルートで指定)
3. 発行されたURL(例: `https://ユーザー名.github.io/リポジトリ名/`)をiPhoneのSafariで開く
4. 共有ボタン → 「ホーム画面に追加」

これでホーム画面のアイコンをタップするだけでアプリとして起動します。

## 注意

- データは端末のブラウザ内(IndexedDB)にのみ保存されます。他の端末とは同期されません。
- iPhone Safariは長期間アクセスがないサイトのデータを消すことがあるため、設定画面の「書き出す」で定期的にバックアップ(JSON)を保存してください。
- コードのタップでダイアグラムが出るのは、よく使う開放コード・簡単なバレーコードのみです(未対応のコードは名前のみ表示)。

## 今後の拡張予定(設計済み・未実装)

- 音源ファイルからのコード自動検出(ブラウザ内で完結させる想定)
- 自動検出結果を自分で修正して保存する編集フロー

データ構造(`songs` ストア: title, artist, key, capo, chords, tab, memo, thumbnail, playCount, lastPlayedAt, createdAt)はこの拡張を見据えて素直な形にしてあります。
