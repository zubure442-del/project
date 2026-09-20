import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { HR_SMOOTH_MAX_GAP, STRESS_ZONE_BOUNDS, niceTicks, smoothHeart, splitSegments, type SleepStage } from '../domain';
import type { DayPoint, DaySnapshot } from '../storage';
import { Plot } from './Plot';
import { colors, spacing, withAlpha } from './theme';

/** Стресс: разрыв больше 45 минут линией не затягиваем. */
export const STRESS_MAX_GAP = 45 * 60;

const STAGE_COLOR: Record<SleepStage, string> = {
  deep: colors.accent,
  light: withAlpha(colors.accent, 0.55),
  awake: colors.textFaint,
};
const STAGE_ROW: Record<SleepStage, number> = { awake: 2, light: 1, deep: 0 };
const STAGE_LABEL: Record<SleepStage, string> = { awake: 'Бодр.', light: 'Лёгкий', deep: 'Глубокий' };

/** Пульс: бледные точки — замеры, яркая линия — скользящая медиана ±45 мин, с разрывами. */
export function HeartChart({ points, width }: { points: DayPoint[]; width: number }) {
  const values = points.map((p) => p.v);
  const yMin = points.length ? Math.min(...values) - 5 : 40;
  const yMax = points.length ? Math.max(...values) + 5 : 120;
  const segments = splitSegments(
    smoothHeart(points.map((p) => ({ ts: p.m * 60, value: p.v }))),
    HR_SMOOTH_MAX_GAP,
  );
  return (
    <Plot width={width} yMin={yMin} yMax={yMax} yTicks={niceTicks(yMin, yMax, 4)} empty={points.length < 2}>
      {(s) => (
        <>
          {points.map((p, i) => (
            <Circle key={i} cx={s.x(p.m)} cy={s.y(p.v)} r={2.6} fill={withAlpha(colors.accent, 0.45)} />
          ))}
          {segments.map((seg, i) =>
            seg.length === 1 ? (
              <Circle key={i} cx={s.x(seg[0].ts / 60)} cy={s.y(seg[0].value)} r={3} fill={colors.accent} />
            ) : (
              <Path
                key={i}
                d={seg.map((p, j) => `${j ? 'L' : 'M'}${s.x(p.ts / 60)} ${s.y(p.value)}`).join(' ')}
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ),
          )}
        </>
      )}
    </Plot>
  );
}

/** Кислород: редкие одиночные замеры. Линией не соединяем — между ними кольцо не мерило. */
export function Spo2Chart({ points, width }: { points: DayPoint[]; width: number }) {
  return (
    <Plot width={width} yMin={90} yMax={100} yTicks={[90, 92, 94, 96, 98, 100]} yFormat={(v) => `${v}%`} empty={!points.length}>
      {(s) => (
        <>
          {points.map((p, i) => (
            <Circle key={i} cx={s.x(p.m)} cy={s.y(Math.max(90, p.v))} r={3.5} fill={colors.accent} />
          ))}
        </>
      )}
    </Plot>
  );
}

/** Стресс за день: линия 0–100 с границами зон 30, 60 и 80; при разрыве больше 45 минут линия рвётся. */
export function StressChart({ points, width }: { points: DayPoint[]; width: number }) {
  const sorted = [...points].sort((a, b) => a.m - b.m);
  const segments = splitSegments(sorted.map((p) => ({ ts: p.m * 60, value: p.v })), STRESS_MAX_GAP);
  return (
    <Plot width={width} yMin={0} yMax={100} yTicks={[0, ...STRESS_ZONE_BOUNDS, 100]} empty={!sorted.length}>
      {(s) => (
        <>
          {segments.map((seg, i) =>
            seg.length === 1 ? (
              <Circle key={i} cx={s.x(seg[0].ts / 60)} cy={s.y(seg[0].value)} r={3} fill={colors.accent} />
            ) : (
              <Path
                key={i}
                d={seg.map((p, j) => `${j ? 'L' : 'M'}${s.x(p.ts / 60)} ${s.y(p.value)}`).join(' ')}
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                fill="none"
              />
            ),
          )}
        </>
      )}
    </Plot>
  );
}

/** Кислород за несколько дней: ось по дням, а не наложение суток. */
export function Spo2DaysChart({ days, width }: { days: { date: string; points: DayPoint[] }[]; width: number }) {
  const height = 150;
  const gutter = 36;
  const plotWidth = width - gutter;
  const slot = days.length ? plotWidth / days.length : plotWidth;
  const yMin = 90;
  const yMax = 100;
  const y = (v: number) => height - 20 - ((Math.max(yMin, v) - yMin) / (yMax - yMin)) * (height - 30);
  const empty = days.every((d) => !d.points.length);
  if (empty) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={styles.emptyText}>Замеров пока нет</Text>
      </View>
    );
  }
  return (
    <Svg width={width} height={height}>
      {[90, 92, 94, 96, 98, 100].map((v) => (
        <React.Fragment key={v}>
          <Line x1={gutter} x2={width} y1={y(v)} y2={y(v)} stroke={colors.track} strokeWidth={1} />
          <SvgText x={gutter - 6} y={y(v) + 4} fill={colors.textMuted} fontSize={11} textAnchor="end">
            {`${v}%`}
          </SvgText>
        </React.Fragment>
      ))}
      {days.map((d, i) => (
        <React.Fragment key={d.date}>
          {i > 0 ? (
            <Line x1={gutter + i * slot} x2={gutter + i * slot} y1={8} y2={height - 20} stroke={colors.track} strokeWidth={1} />
          ) : null}
          {d.points.map((p, j) => (
            <Circle key={j} cx={gutter + i * slot + (p.m / 1440) * slot} cy={y(p.v)} r={3.2} fill={colors.accent} />
          ))}
          <SvgText x={gutter + (i + 0.5) * slot} y={height - 4} fill={colors.textMuted} fontSize={12} textAnchor="middle">
            {dayLabel(d.date)}
          </SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}

/** Шаги по часам: 24 столбца. */
export function StepsHourChart({ hours, width }: { hours: number[]; width: number }) {
  const max = Math.max(...hours, 1);
  const empty = hours.every((v) => v === 0);
  const barWidth = Math.max(4, (width - 36) / 24 - 3);
  return (
    <Plot width={width} yMin={0} yMax={max} yTicks={niceTicks(0, max, 3)} empty={empty}>
      {(s) => (
        <>
          <Defs>
            <LinearGradient id="steps-bar" x1="0.5" y1="0" x2="0.5" y2="1">
              <Stop offset="0" stopColor={colors.arcTo} />
              <Stop offset="1" stopColor={colors.arcFrom} />
            </LinearGradient>
          </Defs>
          {hours.map((value, hour) =>
            value > 0 ? (
              <Rect
                key={hour}
                x={s.x(hour * 60 + 30) - barWidth / 2}
                y={s.y(value)}
                width={barWidth}
                height={Math.max(2, s.bottom - s.y(value))}
                rx={2}
                fill="url(#steps-bar)"
              />
            ) : null,
          )}
        </>
      )}
    </Plot>
  );
}

/** Гипнограмма: три дорожки по времени — бодрствование, лёгкий, глубокий. */
export function Hypnogram({ segments, width }: { segments: DaySnapshot['sleepSegments']; width: number }) {
  const from = segments.length ? Math.min(...segments.map((s) => s.from)) : 0;
  const to = segments.length ? Math.max(...segments.map((s) => s.to)) : 1;
  const span = to - from;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round((from + span * k) / 30) * 30);
  const rowHeight = 26;
  return (
    <Plot
      width={width}
      height={rowHeight * 3 + 42}
      gutter={66}
      xMin={from}
      xMax={to}
      xTicks={[...new Set(ticks)]}
      yMin={-0.5}
      yMax={2.5}
      yTicks={[0, 1, 2]}
      yLabels={(['awake', 'light', 'deep'] as SleepStage[]).map((stage) => ({
        value: STAGE_ROW[stage],
        label: STAGE_LABEL[stage],
      }))}
      empty={!segments.length}
    >
      {(s) => (
        <>
          {segments.map((seg, i) => (
            <Rect
              key={i}
              x={s.x(seg.from)}
              y={s.y(STAGE_ROW[seg.stage]) - rowHeight / 2 + 4}
              width={Math.max(1.5, s.x(seg.to) - s.x(seg.from))}
              height={rowHeight - 8}
              rx={3}
              fill={STAGE_COLOR[seg.stage]}
            />
          ))}
        </>
      )}
    </Plot>
  );
}

export type WeekMetric = 'total' | 'sleep' | 'steps';

export const WEEK_METRIC_LABEL: Record<WeekMetric, string> = {
  total: 'Итог',
  sleep: 'Сон',
  steps: 'Шаги',
};
export const WEEK_METRIC_CAPTION: Record<WeekMetric, string> = {
  total: 'Итог Vuelo по дням, 0–100',
  sleep: 'Сон за ночь, часы',
  steps: 'Шаги за день',
};

function weekValue(day: DaySnapshot | null, metric: WeekMetric): number | null {
  if (!day) return null;
  if (metric === 'total') return day.total;
  if (metric === 'steps') return day.steps;
  return day.sleep ? Math.round((day.sleep.totalMin / 60) * 10) / 10 : null;
}

export interface WeekDay {
  date: string;
  day: DaySnapshot | null;
}

const WEEK_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const dayLabel = (date: string) => WEEK_DAY[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Неделя: столбцы с подписанными значениями над ними. */
export function WeekChart({ days, metric, width }: { days: WeekDay[]; metric: WeekMetric; width: number }) {
  const values = days.map((d) => weekValue(d.day, metric));
  const max = Math.max(...values.map((v) => v ?? 0), 1);
  const height = 150;
  const gap = 10;
  const barWidth = days.length ? Math.max(8, (width - gap * (days.length - 1)) / days.length) : 0;
  const format = (v: number) => (metric === 'steps' ? String(Math.round(v)) : String(v));

  if (!days.length) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={styles.emptyText}>Данных за неделю пока нет</Text>
      </View>
    );
  }
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="week-bar" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor={colors.arcTo} />
          <Stop offset="1" stopColor={colors.arcFrom} />
        </LinearGradient>
      </Defs>
      {days.map((day, i) => {
        const value = values[i];
        const x = i * (barWidth + gap);
        const h = value === null ? 3 : Math.max(3, (value / max) * (height - 52));
        const y = height - 22 - h;
        return (
          <React.Fragment key={day.date}>
            <Rect x={x} y={y} width={barWidth} height={h} rx={4} fill={value === null ? colors.track : 'url(#week-bar)'} />
            <SvgText x={x + barWidth / 2} y={y - 7} fill={colors.text} fontSize={12} textAnchor="middle">
              {value === null ? '—' : format(value)}
            </SvgText>
            <SvgText x={x + barWidth / 2} y={height - 4} fill={colors.textMuted} fontSize={12} textAnchor="middle">
              {dayLabel(day.date)}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  emptyText: { color: colors.textMuted, fontSize: 14 },
  legend: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, justifyContent: 'center' },
});
