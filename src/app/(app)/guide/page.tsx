import {
  ArrowRight,
  Copy,
  Headphones,
  Highlighter,
  Library,
  MessageCircleQuestion,
  Mic,
  Phone,
  Quote,
  Repeat2,
  Scissors,
  Settings,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MATERIAL_LEVELS, type MaterialLevel } from '@/types/database';

export const metadata = {
  title: 'ご利用ガイド',
};

// MATERIAL_LEVELS（label / hint）に「探し方」を足すためのメモ。レベルの定義自体は types 側が正典。
const LEVEL_TIPS: Record<MaterialLevel, string> = {
  1: 'YouTube で「英会話 フレーズ 聞き流し」「日常英会話 和訳付き」などで検索。ネイティブ音声＋日本語訳つきで、ゆっくり短い文の動画を選ぶ。',
  2: '「English conversation practice」「learn English speaking」など英語で検索。英語だけで教える学習者向けチャンネル。英語字幕を頼りにできる。',
  3: '自分の好きなテーマ（料理・ゲーム・旅行など）を英語で検索し、ネイティブ向けの本物のチャンネルを見つける。「この人みたいに話したい」と思える人を探す。',
  4: '好きな海外ドラマ・映画の、公式に公開されている名シーンや予告編のクリップ。速く語彙も難しいので、慣れてから最後に。',
};

type Step = {
  no: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  optional?: boolean;
  body: React.ReactNode;
  points?: string[];
  levels?: boolean;
  cta?: { href: string; label: string };
};

const STEPS: Step[] = [
  {
    no: 'STEP 0',
    title: 'なぜ英語か、を1行で決める',
    icon: Settings,
    optional: true,
    body: (
      <>
        伸びるのは「英語の先に理解したい何かがある人」。設定で
        <span className="font-medium">「英語の先に理解したい何か」</span>
        を書くと、ホームに常時出て続ける芯になります。1日の独り言の目標（1〜10分）もここで選べます。飛ばしても始められます。
      </>
    ),
    cta: { href: '/settings', label: '設定を開く' },
  },
  {
    no: 'STEP 1',
    title: '素材を1本登録する',
    icon: Library,
    body: (
      <>
        「この人みたいに話したい」と思えるネイティブの動画を選び、
        <span className="font-medium">YouTube の URL を貼る</span>
        だけ。タイトル・チャンネル名・サムネイルは自動で取得します。最初は L1（和訳付きフレーズ動画）か L2（英語学習者向けチャンネル）が扱いやすいです。
      </>
    ),
    points: [
      '素材はネイティブの生音声＝「完成された英語」を100のまま受け取るための材料',
      'URL は watch?v= / youtu.be / shorts などどの形でもOK',
    ],
    levels: true,
    cta: { href: '/materials', label: '素材を追加する' },
  },
  {
    no: 'STEP 2',
    title: '30秒くらいの区間を切り出す',
    icon: Scissors,
    body: (
      <>
        動画を再生しながら「ここから」「ここまで」を打って
        <span className="font-medium">クリップ</span>
        を作ります。30秒が目安（45秒を超えると注意が出ます）。作る前にループ再生で区間を確認できます。
      </>
    ),
    points: ['「この部分かっこいい、こう喋れるようになりたい」と思う30秒を選ぶ'],
  },
  {
    no: 'STEP 3',
    title: 'ワークスペースで作り込む',
    icon: Highlighter,
    body: (
      <>
        紙とペンでやっていた作業の代わりです。クリップを開くと、左にプレイヤーと録音、右にスクリプトと解析が並びます。ここがリプロダクションの中心。
      </>
    ),
    points: [
      '「1回再生して止める」— 区間の終わりで自動停止。音が被らないので誤魔化せない（シャドーイングとの違い）',
      '再生速度 0.5 / 0.75 / 1.0。0.5倍速は「音を顕微鏡で覗く」ため',
      'YouTube の「文字起こしを表示」からコピペ →「タイムスタンプを除去」（自動取得はしない仕様）',
      '「AI で音を解析」で和訳と発音記号（強勢・脱落・リンキングなど7種）の下書きを作り、おかしい所は手で直す',
      '録音して「交互に聴き比べ」（お手本 → 自分 → お手本 …）',
      '「独り言で使えるフレーズを抽出」→ ストックへ。これが②へ渡る橋渡し',
    ],
  },
  {
    no: 'STEP 4',
    title: '独り言で、0から英語を作る',
    icon: Mic,
    body: (
      <>
        スマホ片手・歩きながらを前提にした画面です。今日のお題に沿って、大きな録音ボタンで
        <span className="font-medium">「1人電話」</span>
        のように話し続けます。まず1分から。
      </>
    ),
    points: [
      '「今日使うフレーズ」に STEP 3 で貯めた型が出る。使えたらタップして回数を加算',
      '「言えなかったこと」を日本語でメモ → AI が自然な英語＋例文に変換 → そのままストックへ',
      '録音は聞き返すためではなく「やった事実の可視化」のため',
    ],
    cta: { href: '/monologue', label: '独り言を始める' },
  },
];

const TIPS: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }[] = [
  {
    icon: Repeat2,
    title: '①と②が繋がる瞬間を狙う',
    body: 'リプロダクションで入れた「100」を、独り言の「0から」で口に出せたときに両者が繋がります。フレーズの受け渡しがこのアプリの核です。',
  },
  {
    icon: Copy,
    title: '文字起こしはコピペで',
    body: 'YouTube 側の「文字起こしを表示」から貼り付けるのが正規の手順です。自動取得はしません（公式の経路が安定しないため）。',
  },
  {
    icon: Headphones,
    title: 'マイクの許可が必要',
    body: '録音と聴き比べには、ブラウザのマイク許可が要ります。初回にダイアログが出たら許可してください。',
  },
  {
    icon: Sparkles,
    title: '続けるコツ',
    body: '「いかに自分を楽しませ続けるか」という自分との心理戦です。成果を焦らず、まず1分・1本から。ホームの記録とヒートマップが積み上がります。',
  },
];

export default function GuidePage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Quote className="size-4" />
          <span className="text-xs">ご利用ガイド</span>
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          リプロダクションと独り言で、英語を続ける
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          このアプリがすることは2つだけです。①完成された英語を「100のまま」受け取る（リプロダクション）、②自力で「0から」英語を作り出す（独り言）。①で入れた表現を②で口に出せたとき、0と100が繋がります。
        </p>
      </header>

      {/* 2つの柱 */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-5">
          <div className="flex items-center gap-2">
            <Repeat2 className="size-4" />
            <span className="text-sm font-medium">① リプロダクション</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            ネイティブの生音声を1文再生 → 止める → 同じように発音する。素材から30秒を切り出し、音を書き込み、再現する。
          </p>
        </div>
        <div className="rounded-xl border p-5">
          <div className="flex items-center gap-2">
            <Mic className="size-4" />
            <span className="text-sm font-medium">② 独り言</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            お題を決めて、歩きながら「1人電話」のように話し続ける。覚えたフレーズをここで使う。
          </p>
        </div>
      </section>

      {/* はじめかた */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">はじめかた</h2>
          <p className="text-xs text-muted-foreground">
            素材を登録 → 区間を切り出す → 作り込む → 独り言で使う、の順に進みます。
          </p>
        </div>

        <ol className="space-y-3">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.no} className="rounded-xl border p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                    <Icon className="size-4" />
                  </span>
                  <Badge variant="secondary">{step.no}</Badge>
                  {step.optional && <Badge variant="outline">任意</Badge>}
                  <span className="text-sm font-medium">{step.title}</span>
                </div>

                <p className="mt-3 text-sm text-muted-foreground">{step.body}</p>

                {step.points && (
                  <ul className="mt-3 space-y-1.5">
                    {step.points.map((point, i) => (
                      <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                        <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {step.levels && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium">
                      レベル別の探し方（上から順に、慣れたら1つ上へ）
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {MATERIAL_LEVELS.map((lv) => (
                        <div key={lv.level} className="rounded-lg border bg-muted/30 p-3">
                          <p className="text-sm font-medium">{lv.label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{lv.hint}</p>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">探し方：</span>
                            {LEVEL_TIPS[lv.level]}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      どのレベルも、選ぶのは「ネイティブの生音声」「30秒を切り出せる長さ」。
                      YouTube に「文字起こし」があると STEP 3 が楽になります。
                    </p>
                  </div>
                )}

                {step.cta && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    nativeButton={false}
                    render={<Link href={step.cta.href} />}
                  >
                    {step.cta.label}
                    <ArrowRight className="size-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* コツ・困ったとき */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="size-4" />
          <h2 className="text-sm font-medium">コツと、困ったとき</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TIPS.map((tip) => {
            const Icon = tip.icon;
            return (
              <div key={tip.title} className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{tip.title}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{tip.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 一歩目 */}
      <section className="rounded-xl border border-dashed p-5">
        <div className="flex items-center gap-2">
          <Phone className="size-4" />
          <p className="text-sm">まずは1本、素材を登録するところから。</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" nativeButton={false} render={<Link href="/materials" />}>
            素材を登録する
            <ArrowRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/monologue" />}>
            独り言だけ試す
          </Button>
        </div>
      </section>

      {/* 免責 */}
      <p className="text-xs text-muted-foreground/80">
        この方法は元動画（Nanami さん / @nanamin_english）で紹介されている学習法を、1人で続けるための道具です。元動画は個人の体験談で、成果を保証するものではありません。このアプリが担保するのは習慣化と可視化です。
      </p>
    </div>
  );
}
