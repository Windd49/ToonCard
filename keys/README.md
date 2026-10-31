# keys 資料夾

把 Google Cloud 服務帳戶金鑰（.json）放在這裡，server.js 會用裡面最新的一把呼叫 Vertex AI。

- 這個資料夾裡的檔案不會上傳到 GitHub（見 `.gitignore`），本機伺服器也不會把它們提供給網頁。
- 不用 Vertex AI 的話，這個資料夾留空就好。
- 想放在別的地方：在 `config.local.json` 的 `vertex.keyFile` 填入路徑（相對於本程式資料夾，或完整路徑）。
