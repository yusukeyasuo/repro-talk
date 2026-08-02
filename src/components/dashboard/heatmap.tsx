import type { HeatmapCell } from '@/lib/activity';
import { cn } from '@/lib/utils';

// --muted は白地だとほぼ見えないので、空セルも輪郭が分かる濃さにする
const LEVEL_CLASS: Record<HeatmapCell['level'], string> = {
  0: 'bg-foreground/8',
  1: 'bg-foreground/25',
  2: 'bg-foreground/45',
  3: 'bg-foreground/70',
  4: 'bg-foreground/90',
};

export function Heatmap({ columns, today }: { columns: HeatmapCell[][]; today: string }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex w-fit gap-1.5">
        {columns.map((week) => (
          <div key={week[0].date} className="flex flex-col gap-1.5">
            {week.map((cell) => (
              <div
                key={cell.date}
                title={`${cell.date} — リプロ ${cell.reps}回 / 独り言 ${Math.round(
                  cell.monologueSec / 60,
                )}分`}
                className={cn(
                  'size-3.5 rounded-[4px]',
                  LEVEL_CLASS[cell.level],
                  cell.date === today &&
                    'ring-1 ring-foreground ring-offset-1 ring-offset-background',
                  cell.date > today && 'opacity-30',
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
