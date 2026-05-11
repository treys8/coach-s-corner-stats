import { Button } from "@/components/ui/button";

export function BallStrikeCounter({
  balls,
  strikes,
  onBalls,
  onStrikes,
}: {
  balls: number;
  strikes: number;
  onBalls: (n: number) => void;
  onStrikes: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Counter label="Balls" max={4} value={balls} onChange={onBalls} />
      <Counter label="Strikes" max={3} value={strikes} onChange={onStrikes} />
      <span className="font-mono-stat text-2xl text-sa-blue-deep">{balls}-{strikes}</span>
      <span className="text-xs text-muted-foreground">resets after each at-bat</span>
    </div>
  );
}

function Counter({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground w-12">{label}</span>
      <Button size="sm" variant="outline" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>−</Button>
      <span className="font-mono-stat text-xl w-6 text-center">{value}</span>
      <Button size="sm" variant="outline" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</Button>
    </div>
  );
}
