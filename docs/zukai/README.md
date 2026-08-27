# 卒業制作の図解（提出物）

AI-Driven School 卒業制作『自分の武器を作る』の提出用ページ。単一の `index.html` と
実スクリーンショット（`shots/`）だけで完結する静的サイト。

- 公開URL: https://repro-talk.surge.sh
- ホスティング: [surge.sh](https://surge.sh)（Free / アカウント yasuo.yusuke@gmail.com）

## 更新のしかた

`index.html` を直接編集して、このディレクトリから同じドメインへ再デプロイする。

```sh
cd docs/zukai
surge ./ repro-talk.surge.sh
```

`shots/` の画像はローカル（localhost:3000）にデモデータを入れて撮った実キャプチャ。
撮り直す場合も同じファイル名で差し替えれば HTML の変更は不要。
