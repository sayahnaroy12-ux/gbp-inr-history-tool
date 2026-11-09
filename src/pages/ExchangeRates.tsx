import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, RefreshCw, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type RatePoint = {
  date: string;
  rate: number;
};

type LiveRatePoint = {
  timestamp: number;
  rate: number;
};

type LiveRateResponse = {
  success: boolean;
  base: string;
  timestamp: number;
  rates: Record<string, number>;
  error?: { info?: string };
};

type LiveRateHistoryResponse = {
  success: boolean;
  base: string;
  rates: Record<string, Record<string, number>>;
  error?: { info?: string };
};

type RiskPoint = {
  date: string;
  value: number;
};

type GeopoliticalModel = {
  currentIndex: number;
  currentDate: string;
  percentile: number;
  indexChange30d: number;
  adjustmentInr: number;
  correlation: number;
  rSquared: number;
  monthsCompared: number;
};

type FrankfurterResponse = {
  amount: number;
  base: string;
  end_date: string;
  rates: Record<string, { INR: number }>;
  start_date: string;
  updated_at?: string;
};

type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  context: string;
};

type NewsFeedResponse = {
  status: string;
  items: {
    title: string;
    link: string;
    pubDate: string;
    description: string;
  }[];
};

type RangeKey = '1D' | '2D' | '3D' | '4D' | '5D' | '1W' | '1M' | '1Y' | '2Y' | '5Y';

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: '1D', label: '1D' },
  { key: '2D', label: '2D' },
  { key: '3D', label: '3D' },
  { key: '4D', label: '4D' },
  { key: '5D', label: '5D' },
  { key: '1W', label: '1W' },
  { key: '1M', label: '1M' },
  { key: '1Y', label: '1Y' },
  { key: '2Y', label: '2Y' },
  { key: '5Y', label: '5Y' },
];

const RANGE_DAYS: Record<RangeKey, number> = {
  '1D': 1,
  '2D': 2,
  '3D': 3,
  '4D': 4,
  '5D': 5,
  '1W': 7,
  '1M': 30,
  '1Y': 365,
  '2Y': 365 * 2,
  '5Y': 365 * 5,
};

const numberFormat = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatRate = (value: number) => `₹${numberFormat.format(value)}`;

const formatDate = (date: string, options: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
}) => new Intl.DateTimeFormat('en-IN', options).format(new Date(`${date}T00:00:00Z`));

const formatUtcTimestamp = (date: Date) => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
}).format(date);

function parseRates(payload: FrankfurterResponse): RatePoint[] {
  if (payload.base !== 'GBP' || !payload.rates || typeof payload.rates !== 'object') {
    throw new Error('The rate service returned an unexpected response.');
  }

  const rates = Object.entries(payload.rates)
    .map(([date, currencies]) => ({ date, rate: currencies.INR }))
    .filter(({ date, rate }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(rate) && rate > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (rates.length === 0) {
    throw new Error('No GBP/INR history is available from the rate service.');
  }
  return rates;
}

function parseGeopoliticalRiskPage(html: string): RiskPoint[] {
  const marker = '"name":"30-day Average"';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('The geopolitical risk source did not contain its 30-day index series.');
  }

  const scriptStart = html.lastIndexOf('<script type="application/json"', markerIndex);
  const jsonStart = html.indexOf('>', scriptStart) + 1;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  if (scriptStart < 0 || jsonStart <= 0 || jsonEnd < 0) {
    throw new Error('The geopolitical risk source chart data could not be read.');
  }

  const widget = JSON.parse(html.slice(jsonStart, jsonEnd)) as {
    x?: { data?: { name?: string; x?: unknown[]; y?: unknown[] }[] };
  };
  const series = widget.x?.data?.find(trace => trace.name === '30-day Average');
  if (!series?.x || !series.y || series.x.length !== series.y.length) {
    throw new Error('The geopolitical risk source returned an invalid index series.');
  }

  const points = series.x.flatMap((date, index) => {
    const value = series.y?.[index];
    return typeof date === 'string' && Number.isFinite(value)
      ? [{ date, value: Number(value) }]
      : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (points.length === 0) {
    throw new Error('The geopolitical risk source contains no usable index observations.');
  }
  return points;
}

function getNewsContext(title: string) {
  const headline = title.toLowerCase();
  const mentionsUk = /\b(uk|britain|british|england|boe|sterling|pound|gbp)\b/.test(headline);
  const mentionsIndia = /\b(india|indian|rbi|rupee|inr)\b/.test(headline);
  const currency = mentionsUk && mentionsIndia ? 'GBP and INR' : mentionsUk ? 'GBP' : 'INR';

  if (/\b(oil|crude|energy prices)\b/.test(headline) && mentionsIndia) {
    return 'Possible INR channel: oil-price changes can affect India’s import bill and external balance; higher costs may weigh on INR, all else equal. The effect on GBP/INR is uncertain and also depends on GBP.';
  }
  if (/\b(rate|rates|inflation|cpi|monetary|central bank|rbi|bank of england|interest)\b/.test(headline)) {
    return `Possible ${currency} channel: policy, inflation, or interest-rate news may shift expected central-bank policy and yield differentials. A relative shift toward tighter policy can support a currency, all else equal; this headline alone does not establish the direction or size of any GBP/INR move.`;
  }
  return `Possible ${currency} channel: this development may affect growth expectations or market risk appetite. The GBP/INR effect is uncertain; no directional move is inferred from the headline.`;
}

function parseNews(payload: NewsFeedResponse): NewsItem[] {
  if (payload.status !== 'ok' || !Array.isArray(payload.items)) {
    throw new Error('The economic news feed returned an unexpected response.');
  }

  return payload.items.flatMap(item => {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const timestamp = typeof item.pubDate === 'string'
      ? new Date(`${item.pubDate.replace(' ', 'T')}Z`)
      : new Date(Number.NaN);
    const description = typeof item.description === 'string' ? item.description : '';
    const source = new DOMParser()
      .parseFromString(description, 'text/html')
      .body.textContent?.trim()
      .split(/\s{2,}/)
      .pop() ?? '';

    try {
      const url = new URL(item.link);
      if (!title || !source || !Number.isFinite(timestamp.getTime()) || url.protocol !== 'https:') return [];
      return [{
        id: item.link,
        title,
        url: url.href,
        source,
        publishedAt: timestamp,
        context: getNewsContext(title),
      }];
    } catch {
      return [];
    }
  });
}

function getRangeStart(range: RangeKey, latestDate: string): string | null {
  const start = new Date(`${latestDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - RANGE_DAYS[range]);
  return start.toISOString().slice(0, 10);
}

function isIntradayRange(range: RangeKey): boolean {
  return range === '1D' || range === '2D' || range === '3D' || range === '4D'
    || range === '5D' || range === '1W';
}

function getMonthlyAverages(points: RatePoint[]) {
  const months = new Map<string, { total: number; count: number }>();
  points.forEach(({ date, rate }) => {
    const month = date.slice(0, 7);
    const aggregate = months.get(month) ?? { total: 0, count: 0 };
    aggregate.total += rate;
    aggregate.count += 1;
    months.set(month, aggregate);
  });
  return Array.from(months, ([month, { total, count }]) => ({
    date: month,
    rate: total / count,
  }));
}

function getForecast(monthlyRates: RatePoint[], latestDate: string) {
  const completedMonths = monthlyRates
    .filter(({ date }) => date < latestDate.slice(0, 7))
    .slice(-12);
  if (completedMonths.length < 3) return null;

  const meanX = (completedMonths.length - 1) / 2;
  const meanY = completedMonths.reduce((sum, point) => sum + point.rate, 0) / completedMonths.length;
  const numerator = completedMonths.reduce(
    (sum, point, index) => sum + (index - meanX) * (point.rate - meanY),
    0,
  );
  const denominator = completedMonths.reduce(
    (sum, _point, index) => sum + (index - meanX) ** 2,
    0,
  );
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const lastCompletedMonth = completedMonths[completedMonths.length - 1].date;
  const [basisYear, basisMonth] = lastCompletedMonth.split('-').map(Number);
  const [latestYear, latestMonth] = latestDate.slice(0, 7).split('-').map(Number);
  const monthsFromBasis = (year: number, month: number) => (year - basisYear) * 12 + month - basisMonth;
  const estimatedRate = (monthOffset: number) => intercept + slope * (completedMonths.length - 1 + monthOffset);
  const formatMonth = (year: number, month: number) => {
    const date = new Date(Date.UTC(year, month - 1, 1));
    return date.toISOString().slice(0, 7);
  };
  const chartData = completedMonths.map((point, index) => ({
    month: point.date,
    historical: point.rate,
    estimate: index === completedMonths.length - 1 ? estimatedRate(0) : null,
  }));
  const projections = [1, 2, 3].map(monthsAhead => {
    const absoluteMonth = latestMonth + monthsAhead - 1;
    const year = latestYear + Math.floor(absoluteMonth / 12);
    const month = (absoluteMonth % 12) + 1;
    const monthOffset = monthsFromBasis(year, month);
    return {
      month: formatMonth(year, month),
      historical: null,
      estimate: estimatedRate(monthOffset),
    };
  });
  const finalEstimate = projections[projections.length - 1].estimate;
  const currentRate = monthlyRates[monthlyRates.length - 1]?.rate;

  return {
    chartData: [...chartData, ...projections],
    rate: finalEstimate,
    change: currentRate === undefined ? null : finalEstimate - currentRate,
    changePercent: currentRate === undefined ? null : ((finalEstimate - currentRate) / currentRate) * 100,
    basisStart: completedMonths[0].date,
    basisEnd: lastCompletedMonth,
    monthsUsed: completedMonths.length,
    horizon: projections[projections.length - 1].month,
  };
}

function getMonthForecast(
  dailyRates: RatePoint[],
  monthlyRates: RatePoint[],
  selectedMonth: string,
  latestDate: string,
  geopoliticalAdjustment = 0,
) {
  const completedMonths = monthlyRates
    .filter(({ date }) => date < latestDate.slice(0, 7))
    .slice(-12);
  if (completedMonths.length < 3) return null;

  const meanX = (completedMonths.length - 1) / 2;
  const meanY = completedMonths.reduce((sum, point) => sum + point.rate, 0) / completedMonths.length;
  const numerator = completedMonths.reduce(
    (sum, point, index) => sum + (index - meanX) * (point.rate - meanY),
    0,
  );
  const denominator = completedMonths.reduce(
    (sum, _point, index) => sum + (index - meanX) ** 2,
    0,
  );
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const [basisYear, basisMonth] = completedMonths[completedMonths.length - 1].date.split('-').map(Number);
  const [forecastYear, forecastMonth] = selectedMonth.split('-').map(Number);
  const forecastMonthIndex = (forecastYear - basisYear) * 12 + forecastMonth - basisMonth;
  const daysInMonth = new Date(Date.UTC(forecastYear, forecastMonth, 0)).getUTCDate();
  const actualRates = new Map(dailyRates.map(point => [point.date, point.rate]));
  const latestActual = dailyRates.filter(point => point.date <= latestDate).at(-1);
  const isCurrentRateMonth = selectedMonth === latestDate.slice(0, 7);
  const modelAtDay = (day: number) => (
    intercept + slope * (completedMonths.length - 1 + forecastMonthIndex + (day - 1) / daysInMonth)
  );
  const anchorModel = isCurrentRateMonth && latestActual
    ? modelAtDay(Number(latestActual.date.slice(-2)))
    : null;
  const projectedRates = Array.from({ length: daysInMonth }, (_, index) => {
    const date = `${selectedMonth}-${String(index + 1).padStart(2, '0')}`;
    const day = index + 1;
    const actualRate = actualRates.get(date);
    if (actualRate !== undefined) {
      return { date, rate: actualRate, publishedRate: actualRate, estimateRate: null, kind: 'published' as const };
    }

    if (date <= latestDate) {
      return { date, rate: null, publishedRate: null, estimateRate: null, kind: 'no-publication' as const };
    }

    const trendRate = anchorModel !== null && latestActual
      ? latestActual.rate + modelAtDay(day) - anchorModel
      : modelAtDay(day);
    const rate = Math.max(0, trendRate + geopoliticalAdjustment);
    return { date, rate, publishedRate: null, estimateRate: rate, kind: 'estimate' as const };
  }).filter(point => point.kind !== 'no-publication');
  const anchor = isCurrentRateMonth && latestActual
    ? projectedRates.find(point => point.date === latestActual.date)
    : null;
  if (anchor) anchor.estimateRate = anchor.rate;
  const forecastValues = projectedRates.flatMap(point => point.rate === null ? [] : [point.rate]);
  const average = forecastValues.reduce((sum, rate) => sum + rate, 0) / forecastValues.length;
  const firstRate = projectedRates.find(point => point.rate !== null)?.rate ?? 0;
  const lastRate = [...projectedRates].reverse().find(point => point.rate !== null)?.rate ?? 0;

  return {
    dailyRates: projectedRates,
    average,
    firstRate,
    lastRate,
    geopoliticalAdjustment,
    basisStart: completedMonths[0].date,
    basisEnd: completedMonths[completedMonths.length - 1].date,
    monthsUsed: completedMonths.length,
    currentRate: monthlyRates[monthlyRates.length - 1]?.rate ?? null,
  };
}

function getGeopoliticalModel(riskPoints: RiskPoint[], rates: RatePoint[]): GeopoliticalModel | null {
  if (riskPoints.length === 0 || rates.length === 0) return null;

  const riskByMonth = new Map<string, { total: number; count: number }>();
  riskPoints.forEach(({ date, value }) => {
    const month = date.slice(0, 7);
    const bucket = riskByMonth.get(month) ?? { total: 0, count: 0 };
    bucket.total += value;
    bucket.count += 1;
    riskByMonth.set(month, bucket);
  });
  const ratesByMonth = new Map<string, { total: number; count: number }>();
  rates.forEach(({ date, rate }) => {
    const month = date.slice(0, 7);
    const bucket = ratesByMonth.get(month) ?? { total: 0, count: 0 };
    bucket.total += rate;
    bucket.count += 1;
    ratesByMonth.set(month, bucket);
  });

  const sharedMonths = Array.from(riskByMonth.keys())
    .filter(month => ratesByMonth.has(month))
    .sort();
  const monthlyPairs = sharedMonths.map(month => {
    const riskBucket = riskByMonth.get(month)!;
    const rateBucket = ratesByMonth.get(month)!;
    return {
      month,
      risk: riskBucket.total / riskBucket.count,
      rate: rateBucket.total / rateBucket.count,
    };
  });
  const monthlyChanges = monthlyPairs.slice(1).map((current, index) => ({
    risk: current.risk - monthlyPairs[index].risk,
    rate: current.rate - monthlyPairs[index].rate,
  }));
  if (monthlyChanges.length < 24) return null;

  const meanRiskChange = monthlyChanges.reduce((sum, point) => sum + point.risk, 0) / monthlyChanges.length;
  const meanRateChange = monthlyChanges.reduce((sum, point) => sum + point.rate, 0) / monthlyChanges.length;
  const covariance = monthlyChanges.reduce(
    (sum, point) => sum + (point.risk - meanRiskChange) * (point.rate - meanRateChange),
    0,
  );
  const riskVariance = monthlyChanges.reduce((sum, point) => sum + (point.risk - meanRiskChange) ** 2, 0);
  const rateVariance = monthlyChanges.reduce((sum, point) => sum + (point.rate - meanRateChange) ** 2, 0);
  if (riskVariance === 0 || rateVariance === 0) return null;
  const correlation = covariance / Math.sqrt(riskVariance * rateVariance);
  const slope = covariance / riskVariance;
  const latestRisk = riskPoints[riskPoints.length - 1];
  const cutoff = new Date(`${latestRisk.date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const comparisonDate = cutoff.toISOString().slice(0, 10);
  const priorRisk = riskPoints.filter(point => point.date <= comparisonDate).at(-1);
  if (!priorRisk) return null;

  const latestChange = latestRisk.value - priorRisk.value;
  const percentile = (riskPoints.filter(point => point.value <= latestRisk.value).length / riskPoints.length) * 100;
  return {
    currentIndex: latestRisk.value,
    currentDate: latestRisk.date,
    percentile,
    indexChange30d: latestChange,
    adjustmentInr: slope * latestChange,
    correlation,
    rSquared: correlation ** 2,
    monthsCompared: monthlyChanges.length,
  };
}

function getFutureMonths(latestDate: string, count = 12) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const firstMonth = currentMonth > latestDate.slice(0, 7) ? currentMonth : latestDate.slice(0, 7);
  const [firstYear, firstMonthNumber] = firstMonth.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(firstYear, firstMonthNumber - 1 + index, 1));
    const value = date.toISOString().slice(0, 7);
    return {
      value,
      label: `${formatDate(`${value}-01`, { month: 'long', year: 'numeric' })}${value === currentMonth ? ' (current month)' : ''}`,
    };
  });
}

function DailyChange({ change, percent }: { change: number; percent: number }) {
  const isUp = change >= 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  const color = isUp
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${color}`}>
      <Icon className="h-4 w-4" />
      {change > 0 ? '+' : ''}{numberFormat.format(change)} ({percent > 0 ? '+' : ''}{percent.toFixed(2)}%)
    </span>
  );
}

function LiveMarketChart({
  rates,
  loading,
  range,
  onRangeChange,
  ratesUpdatedAt,
}: {
  rates: RatePoint[];
  loading: boolean;
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  ratesUpdatedAt: string | null;
}) {
  const [livePoints, setLivePoints] = useState<LiveRatePoint[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const latestAvailableDaily = rates.at(-1);
  const dailyStartDate = latestAvailableDaily ? getRangeStart(range, latestAvailableDaily.date) : null;
  const recentRates = dailyStartDate
    ? rates.filter(({ date }) => date >= dailyStartDate)
    : rates;
  const latestDaily = rates.at(-1);
  const previousDaily = rates.at(-2);
  const latestLive = livePoints.at(-1);
  const previousLive = livePoints.at(-2);
  const dailyChange = latestDaily && previousDaily ? latestDaily.rate - previousDaily.rate : null;
  const isIntraday = isIntradayRange(range);
  useEffect(() => {
    if (!isIntradayRange(range)) {
      setLiveLoading(false);
      return;
    }

    const controller = new AbortController();
    const apiKey = 'fxr_demo_lmasdg193';
    const loadLiveRate = async () => {
      try {
        const response = await fetch(
          `https://api.fxratesapi.com/latest?api_key=${apiKey}&base=GBP&currencies=INR&resolution=1m&amount=1&places=6&format=json`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (!response.ok) {
          throw new Error(`The live rate feed returned HTTP ${response.status}.`);
        }
        const payload = await response.json() as LiveRateResponse;
        const rate = payload.rates?.INR;
        if (!payload.success || payload.base !== 'GBP' || !Number.isFinite(payload.timestamp) || !Number.isFinite(rate) || rate <= 0) {
          throw new Error(payload.error?.info || 'The live rate feed returned an invalid GBP/INR quote.');
        }
        const point = { timestamp: payload.timestamp * 1000, rate };
        setLivePoints(current => {
          const last = current.at(-1);
          if (last?.timestamp === point.timestamp) return [...current.slice(0, -1), point];
          if (last && point.timestamp < last.timestamp) return current;
          return [...current, point].slice(-300);
        });
        setCheckedAt(new Date());
        setLiveError(null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setLiveError(loadError instanceof Error ? loadError.message : 'The live GBP/INR quote could not be loaded.');
      }
    };

    const loadInitialHistory = async () => {
      setLiveLoading(true);
      setLivePoints([]);
      try {
        const end = Math.floor((Date.now() - 2 * 60 * 1000) / 60_000) * 60_000;
        const start = end - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
        const params = new URLSearchParams({
          api_key: apiKey,
          start_date: new Date(start).toISOString().slice(0, 19),
          end_date: new Date(end).toISOString().slice(0, 19),
          accuracy: '1m',
          base: 'GBP',
          currencies: 'INR',
          format: 'json',
        });
        const response = await fetch(`https://api.fxratesapi.com/timeseries?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`The live rate history returned HTTP ${response.status}.`);
        }
        const payload = await response.json() as LiveRateHistoryResponse;
        if (!payload.success || payload.base !== 'GBP' || !payload.rates || typeof payload.rates !== 'object') {
          throw new Error(payload.error?.info || 'The live rate history returned an invalid response.');
        }
        const points = Object.entries(payload.rates)
          .map(([date, currencies]) => ({ timestamp: Date.parse(date), rate: currencies.INR }))
          .filter(point => Number.isFinite(point.timestamp) && Number.isFinite(point.rate) && point.rate > 0)
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-10_080);
        if (points.length === 0) {
          throw new Error('No recent GBP/INR market snapshots were returned.');
        }
        setLivePoints(points);
        setCheckedAt(new Date());
        setLiveError(null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setLiveError(loadError instanceof Error ? loadError.message : 'The live GBP/INR chart history could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLiveLoading(false);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadLiveRate();
    };
    void loadInitialHistory();
    const intervalId = window.setInterval(refreshWhenVisible, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [range, refreshVersion]);

  return (
    <section aria-label="GBP/INR live rate tracker" className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">GBP/INR rate tracker</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Intraday charts use 1-minute provider snapshots; longer ranges show actual daily reference rates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" aria-label="Tracker time range">
            {RANGE_OPTIONS.map(option => (
              <button
                key={option.key}
                type="button"
                onClick={() => onRangeChange(option.key)}
                aria-pressed={range === option.key}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${range === option.key ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {isIntraday && (
            <>
              <button type="button" onClick={() => setRefreshVersion(version => version + 1)} disabled={liveLoading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <RefreshCw className={`h-4 w-4 ${liveLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </>
          )}
        </div>
      </div>
      {isIntraday ? (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{latestLive ? formatRate(latestLive.rate) : liveLoading ? 'Loading…' : '—'}</span>
          {latestLive && previousLive && (
            <>
              <DailyChange
                change={latestLive.rate - previousLive.rate}
                percent={((latestLive.rate - previousLive.rate) / previousLive.rate) * 100}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">vs previous captured snapshot</span>
            </>
          )}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {latestLive ? `Provider quote: ${formatUtcTimestamp(new Date(latestLive.timestamp))}` : 'Waiting for a live quote'}
            {checkedAt ? ` · Checked ${formatUtcTimestamp(checkedAt)}` : ''}
          </span>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{latestDaily ? formatRate(latestDaily.rate) : loading ? 'Loading…' : '—'}</span>
          {latestDaily && dailyChange !== null && previousDaily && (
            <DailyChange change={dailyChange} percent={(dailyChange / previousDaily.rate) * 100} />
          )}
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {latestDaily ? `Latest published rate: ${formatDate(latestDaily.date)}` : 'No daily rate available'}
          </span>
        </div>
      )}
      {isIntraday && liveError && (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          {liveError} {latestLive ? 'Showing the last successful quote.' : 'The daily reference-rate view is still available.'}
        </p>
      )}
      <div className="h-72">
        {isIntraday ? livePoints.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            {liveLoading ? 'Loading live rate snapshots…' : 'No live rate snapshots yet.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={livePoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={[livePoints[0]?.timestamp ?? 'dataMin', livePoints.at(-1)?.timestamp ?? 'dataMax']}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={value => new Intl.DateTimeFormat('en-IN', range === '1D'
                  ? { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }
                  : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' },
                ).format(new Date(Number(value)))}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={58}
                domain={['auto', 'auto']}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickFormatter={value => `₹${Number(value).toFixed(2)}`}
              />
              <Tooltip
                labelFormatter={value => formatUtcTimestamp(new Date(Number(value)))}
                formatter={value => [formatRate(Number(value)), 'Live market snapshot']}
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgb(15 23 42 / 0.1)' }}
              />
              <Line type="monotone" dataKey="rate" name="Market rate" stroke="#0891b2" strokeWidth={2} dot={livePoints.length < 150} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : loading && rates.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">Loading daily rates…</div>
        ) : recentRates.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">Daily rate history is unavailable.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={recentRates} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={32} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={value => formatDate(String(value), { day: 'numeric', month: 'short' })} />
              <YAxis axisLine={false} tickLine={false} width={58} domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={value => `₹${Number(value).toFixed(2)}`} />
              <Tooltip labelFormatter={value => formatDate(String(value))} formatter={value => [formatRate(Number(value)), 'Reference rate']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgb(15 23 42 / 0.1)' }} />
              <Line type="monotone" dataKey="rate" name="Rate" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        {isIntraday
          ? <>Source: <a href="https://fxratesapi.com/" target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400">FXRatesAPI</a>, requested at 1-minute resolution for the selected {RANGE_DAYS[range]}-day window; this page refreshes the latest quote every 5 minutes while visible. Timestamps are from the provider. These are indicative aggregated FX rates, not exchange transaction prints, a guaranteed live executable quote, or tick-by-tick trades. </>
          : <>Source: <a href="https://www.frankfurter.dev/" target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400">Frankfurter / ECB</a>. Each point is the actual published daily reference observation in the selected {RANGE_OPTIONS.find(option => option.key === range)?.label} range; no monthly averaging or interpolation is applied. These business-day reference rates are not intraday prices. {ratesUpdatedAt ? `Dataset synchronized ${new Date(ratesUpdatedAt).toLocaleString()}.` : ''}</>}
      </p>
    </section>
  );
}

export default function ExchangeRates() {
  const [rates, setRates] = useState<RatePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('1Y');
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedForecastMonth, setSelectedForecastMonth] = useState('');
  const [expandedYear, setExpandedYear] = useState<string | null | undefined>(undefined);
  const [riskPoints, setRiskPoints] = useState<RiskPoint[]>([]);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskCheckedAt, setRiskCheckedAt] = useState<Date | null>(null);
  const [riskRefreshVersion, setRiskRefreshVersion] = useState(0);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsCheckedAt, setNewsCheckedAt] = useState<Date | null>(null);
  const [newsRefreshVersion, setNewsRefreshVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const loadRates = async () => {
      setLoading(true);
      setError(null);
      try {
        const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');
        const dataUrl = `${import.meta.env.BASE_URL}data/daily-rates.json`;
        const sourceUrls = apiBase
          ? [`${apiBase}/api/rates`, dataUrl, 'https://api.frankfurter.dev/v1/2000-01-01..?from=GBP&to=INR']
          : [dataUrl, 'https://api.frankfurter.dev/v1/2000-01-01..?from=GBP&to=INR'];
        let payload: FrankfurterResponse | null = null;
        let lastError: Error | null = null;
        for (const url of sourceUrls) {
          try {
            const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
            payload = await response.json() as FrankfurterResponse;
            break;
          } catch (sourceError) {
            if (controller.signal.aborted) return;
            lastError = sourceError instanceof Error ? sourceError : new Error('Unknown rate source error.');
          }
        }
        if (!payload) throw lastError ?? new Error('No rate data source was available.');
        setRates(parseRates(payload));
        setRatesUpdatedAt(payload.updated_at ?? null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Rate history could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadRates();
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const loadRiskIndex = async () => {
      setRiskLoading(true);
      setRiskError(null);
      try {
        const response = await fetch('https://www.matteoiacoviello.com/gpr.htm', {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`The geopolitical risk index could not be loaded (HTTP ${response.status}).`);
        }
        const html = await response.text();
        setRiskPoints(parseGeopoliticalRiskPage(html));
        setRiskCheckedAt(new Date());
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setRiskError(loadError instanceof Error ? loadError.message : 'The geopolitical risk index could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setRiskLoading(false);
      }
    };

    void loadRiskIndex();
    return () => controller.abort();
  }, [riskRefreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const loadNews = async () => {
      setNewsLoading(true);
      setNewsError(null);
      const query = '("Bank of England" OR RBI OR sterling OR rupee OR GBP OR INR OR "UK inflation" OR "India inflation") when:7d';
      const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN%3Aen`;
      const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Economic news could not be loaded (HTTP ${response.status}).`);
        }
        const payload = await response.json() as NewsFeedResponse;
        const parsedNews = parseNews(payload);
        setNews(parsedNews);
        setNewsCheckedAt(new Date());
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setNewsError(loadError instanceof Error ? loadError.message : 'Economic news could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setNewsLoading(false);
      }
    };

    void loadNews();
    return () => controller.abort();
  }, [newsRefreshVersion]);

  const latest = rates[rates.length - 1];
  const previous = rates[rates.length - 2];
  const selectedRates = useMemo(() => {
    if (!latest) return [];
    const startDate = getRangeStart(range, latest.date);
    return startDate ? rates.filter(({ date }) => date >= startDate) : rates;
  }, [latest, range, rates]);
  const trendRates = selectedRates;
  const yearlyTimelines = useMemo(() => {
    const years = new Map<string, { date: string; rate: number; change: number | null; changePercent: number | null }[]>();
    rates.forEach((point, index) => {
      const year = point.date.slice(0, 4);
      const previousPoint = rates[index - 1];
      const change = previousPoint ? point.rate - previousPoint.rate : null;
      const timeline = years.get(year) ?? [];
      timeline.push({
        ...point,
        change,
        changePercent: previousPoint ? (change! / previousPoint.rate) * 100 : null,
      });
      years.set(year, timeline);
    });
    return Array.from(years, ([year, timeline]) => ({
      year,
      timeline,
      increaseCount: timeline.filter(point => point.change !== null && point.change > 0).length,
    })).reverse();
  }, [rates]);
  const activeYear = expandedYear === undefined ? yearlyTimelines[0]?.year ?? null : expandedYear;
  const geopoliticalModel = useMemo(
    () => getGeopoliticalModel(riskPoints, rates),
    [riskPoints, rates],
  );
  const forecast = useMemo(
    () => latest ? getForecast(getMonthlyAverages(rates), latest.date) : null,
    [latest, rates],
  );
  const futureMonths = useMemo(() => latest ? getFutureMonths(latest.date) : [], [latest]);
  const forecastMonth = futureMonths.find(month => month.value === selectedForecastMonth)?.value
    ?? futureMonths[0]?.value
    ?? '';
  const monthForecast = useMemo(
    () => latest && forecastMonth
      ? getMonthForecast(rates, getMonthlyAverages(rates), forecastMonth, latest.date, geopoliticalModel?.adjustmentInr ?? 0)
      : null,
    [forecastMonth, geopoliticalModel, latest, rates],
  );
  const recentDailyRates = useMemo(() => rates.slice(-16).reverse(), [rates]);
  const yearAgoRate = useMemo(() => {
    if (!latest) return null;
    const yearAgo = new Date(`${latest.date}T00:00:00Z`);
    yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
    const yearAgoDate = yearAgo.toISOString().slice(0, 10);
    return rates.filter(({ date }) => date <= yearAgoDate).at(-1) ?? null;
  }, [latest, rates]);
  const yearChange = latest && yearAgoRate
    ? {
      value: latest.rate - yearAgoRate.rate,
      percent: ((latest.rate - yearAgoRate.rate) / yearAgoRate.rate) * 100,
    }
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400">
            <Activity className="h-4 w-4" />
            <span>Currency markets</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">GBP / INR history</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Historical reference rate and daily movement for £1 in Indian rupees.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshVersion(version => version + 1)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:self-center"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh rates
        </button>
      </header>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300 sm:flex-row sm:items-center sm:justify-between">
          <p>{error} Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => setRefreshVersion(version => version + 1)}
            className="shrink-0 font-semibold underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      )}

      <section aria-label="Latest rate summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Latest reference rate</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {loading && !latest ? 'Loading…' : latest ? formatRate(latest.rate) : '—'}
            </p>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              GBP → INR
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {latest ? `As of ${formatDate(latest.date)}` : 'Waiting for the latest available rate'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Change vs previous rate</p>
          {latest && previous ? (
            <div className="mt-2">
              <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{formatRate(latest.rate)}</p>
              <div className="mt-1 text-sm">
                <DailyChange
                  change={latest.rate - previous.rate}
                  percent={((latest.rate - previous.rate) / previous.rate) * 100}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Compared with {formatDate(previous.date)}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{loading ? 'Loading…' : '—'}</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">12-month movement</p>
          {yearChange ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-500" />
                <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {yearChange.value > 0 ? '+' : ''}{formatRate(yearChange.value)}
                </p>
              </div>
              <p className={`mt-1 text-sm font-medium ${yearChange.percent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {yearChange.percent > 0 ? '+' : ''}{yearChange.percent.toFixed(2)}% since {formatDate(yearAgoRate!.date)}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              {loading ? 'Loading…' : 'A full year of history is not available yet.'}
            </p>
          )}
        </div>
      </section>

      <LiveMarketChart rates={rates} loading={loading} range={range} onRangeChange={setRange} ratesUpdatedAt={ratesUpdatedAt} />

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Rate trend</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Actual published ECB reference rates for the selected {RANGE_OPTIONS.find(option => option.key === range)?.label} range; no monthly averaging or interpolation.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" aria-label="Rate trend range">
            {RANGE_OPTIONS.map(option => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                aria-pressed={range === option.key}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  range === option.key
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-72">
          {loading && rates.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">Loading historical rates…</div>
          ) : trendRates.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">No rates available for this range.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendRates} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gbpInrFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={value => formatDate(String(value), range === '1Y' || range === '2Y' || range === '5Y'
                    ? { month: 'short', year: '2-digit' }
                    : { day: 'numeric', month: 'short' })}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  domain={['auto', 'auto']}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={value => `₹${Number(value).toFixed(0)}`}
                />
                <Tooltip
                  labelFormatter={value => formatDate(String(value))}
                  formatter={(value) => [formatRate(Number(value)), 'Published reference rate']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgb(15 23 42 / 0.1)' }}
                />
                <Area type="monotone" dataKey="rate" stroke="#2563eb" strokeWidth={2} fill="url(#gbpInrFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Economic news &amp; possible FX context</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Recent UK and India monetary-policy and currency coverage</p>
            </div>
            <button
              type="button"
              onClick={() => setNewsRefreshVersion(version => version + 1)}
              disabled={newsLoading}
              className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:self-center"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${newsLoading ? 'animate-spin' : ''}`} />
              Refresh news
            </button>
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Google News search • last 7 days</span>
            {newsCheckedAt && <span>Feed checked {formatUtcTimestamp(newsCheckedAt)}</span>}
          </div>
          {newsError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <span>{newsError} Rate history and forecast remain available.</span>
              <button type="button" onClick={() => setNewsRefreshVersion(version => version + 1)} className="font-semibold underline underline-offset-2">Try again</button>
            </div>
          )}
          {newsLoading && news.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading recent coverage…</p>
          ) : news.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No matching recent economic stories were found.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {news.slice(0, 8).map(item => (
                <article key={item.id} className="rounded-xl border border-slate-100 p-4 dark:border-slate-800">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="font-semibold text-blue-700 dark:text-blue-400">{item.source}</span>
                    <time dateTime={item.publishedAt.toISOString()} className="text-slate-500 dark:text-slate-400">
                      Published {formatUtcTimestamp(item.publishedAt)}
                    </time>
                  </div>
                  <p className="text-sm font-semibold leading-5 text-slate-900 dark:text-white">
                    <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400">
                      {item.title}
                    </a>
                  </p>
                  <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-300">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">Possible FX channel, not a reported outcome: </span>
                    {item.context}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Geopolitical risk: measured index and historical FX link</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Global news-based risk index, compared with observed GBP/INR monthly moves.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRiskRefreshVersion(version => version + 1)}
              disabled={riskLoading}
              className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:self-center"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${riskLoading ? 'animate-spin' : ''}`} />
              Refresh risk data
            </button>
          </div>
          {riskError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <span>{riskError} The last successfully loaded index remains in use, if available.</span>
              <button type="button" onClick={() => setRiskRefreshVersion(version => version + 1)} className="font-semibold underline underline-offset-2">Try again</button>
            </div>
          )}
          {riskLoading && riskPoints.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading dated geopolitical risk data…</p>
          ) : !geopoliticalModel ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">There is not enough overlapping geopolitical-risk and GBP/INR history to calculate an observed relationship.</p>
          ) : (
            <>
              {riskCheckedAt && (
                <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                  Latest index observation: {formatDate(geopoliticalModel.currentDate)} · retrieved {formatUtcTimestamp(riskCheckedAt)}
                </p>
              )}
              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">30-day global risk index</p>
                  <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{numberFormat.format(geopoliticalModel.currentIndex)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Historical percentile</p>
                  <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{geopoliticalModel.percentile.toFixed(0)}th</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">vs daily observations since 1985</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Index change over ~30 days</p>
                  <p className={`mt-1 text-xl font-bold ${geopoliticalModel.indexChange30d >= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {geopoliticalModel.indexChange30d > 0 ? '+' : ''}{numberFormat.format(geopoliticalModel.indexChange30d)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Index points, not a currency move</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Observed FX co-movement</p>
                  <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{(geopoliticalModel.rSquared * 100).toFixed(2)}% R²</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{geopoliticalModel.monthsCompared} monthly changes · r={geopoliticalModel.correlation.toFixed(2)}</p>
                </div>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={riskPoints.slice(-1095)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="globalRiskFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={value => formatDate(value, { month: 'short', year: '2-digit' })}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={54}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                    />
                    <Tooltip
                      labelFormatter={value => formatDate(String(value))}
                      formatter={value => [numberFormat.format(Number(value)), '30-day global risk index']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgb(15 23 42 / 0.1)' }}
                    />
                    <Area type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2} fill="url(#globalRiskFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                Source:{' '}
                <a href="https://www.matteoiacoviello.com/gpr.htm" target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline underline-offset-2 dark:text-blue-400">
                  Caldara–Iacoviello Global Geopolitical Risk Index
                </a>
                {' '}30-day average (the publisher updates daily observations weekly). This is a global newspaper-coverage proxy, not a direct measure of all events or their severity and not a UK- or India-specific index. The historical comparison is a linear fit between monthly changes in this index and monthly GBP/INR reference-rate averages over {geopoliticalModel.monthsCompared} overlapping months. It explains only {(geopoliticalModel.rSquared * 100).toFixed(2)}% of observed monthly FX variation in this sample. The weak association is not evidence that geopolitical events caused the currency changes.
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Choose a month for its full forecast</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                See a dated trend estimate for every calendar day in a future month.
              </p>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              Forecast month
              <select
                value={forecastMonth}
                onChange={event => setSelectedForecastMonth(event.target.value)}
                disabled={futureMonths.length === 0}
                className="min-w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                {futureMonths.map(month => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
            </label>
          </div>

          {loading && rates.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Preparing the selected month forecast…</p>
          ) : !monthForecast ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              At least three completed months of history are needed to estimate this month.
            </p>
          ) : (
            <>
              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-900/20">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Month average (observed + trend)
                  </p>
                  <p className="mt-1 text-xl font-bold text-amber-900 dark:text-amber-200">{formatRate(monthForecast.average)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Historical index adjustment</p>
                  <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{riskLoading && !geopoliticalModel
                    ? 'Loading index…'
                    : geopoliticalModel
                      ? `${monthForecast.geopoliticalAdjustment > 0 ? '+' : ''}₹${monthForecast.geopoliticalAdjustment.toFixed(4)}`
                      : 'Unavailable'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {geopoliticalModel
                      ? `Trend-only: ${formatRate(monthForecast.average - monthForecast.geopoliticalAdjustment)}`
                      : 'Showing trend-only estimate'}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Estimated first-day rate</p>
                  <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{formatRate(monthForecast.firstRate)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Estimated last-day rate</p>
                  <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{formatRate(monthForecast.lastRate)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Estimated month range</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                    {formatRate(Math.min(...monthForecast.dailyRates.map(point => point.rate)))}–{formatRate(Math.max(...monthForecast.dailyRates.map(point => point.rate)))}
                  </p>
                </div>
              </div>

              <div className="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="h-0.5 w-4 bg-blue-600" /> Published rate
                <span className="ml-3 h-0.5 w-4 bg-amber-500" /> Trend estimate
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthForecast.dailyRates} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={value => formatDate(value, { day: 'numeric', month: 'short' })}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={54}
                      domain={['auto', 'auto']}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={value => `₹${Number(value).toFixed(0)}`}
                    />
                    <Tooltip
                      labelFormatter={value => formatDate(String(value))}
                      formatter={(value, name) => [formatRate(Number(value)), name === 'publishedRate' ? 'Published rate' : 'Trend estimate']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgb(15 23 42 / 0.1)' }}
                    />
                    <Line type="monotone" dataKey="publishedRate" name="publishedRate" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="estimateRate" name="estimateRate" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-5">
                <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">Daily date-by-date estimates</h3>
                <div className="max-h-80 overflow-auto rounded-lg border border-slate-100 dark:border-slate-800">
                  <table className="w-full min-w-[320px] text-left text-sm">
                    <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-400 dark:bg-slate-900">
                      <tr>
                        <th scope="col" className="px-3 py-2.5 font-medium">Date</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">Rate / estimate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {monthForecast.dailyRates.map(point => (
                        <tr key={point.date}>
                          <th scope="row" className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                            <time dateTime={point.date}>{formatDate(point.date, { weekday: 'short', day: 'numeric', month: 'short' })}</time>
                          </th>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {point.rate === null ? (
                              <span className="text-slate-400">No rate published</span>
                            ) : (
                              <span className={point.kind === 'published' ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}>
                                {formatRate(point.rate)}
                                <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                                  {point.kind === 'published' ? 'actual' : 'estimate'}
                                </span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                <p className="font-semibold">How to interpret this estimate</p>
                <p className="mt-1">
                  A straight-line regression over {monthForecast.monthsUsed} completed monthly averages from {formatDate(`${monthForecast.basisStart}-01`, { month: 'short', year: 'numeric' })} through {formatDate(`${monthForecast.basisEnd}-01`, { month: 'short', year: 'numeric' })} is extended across the selected month. When the selected month is already underway, published rates are shown as actual and only dates after the latest available rate are projected. For a future month, all dates are estimates. Daily values are a smooth monthly trend, not independent daily forecasts; they do not capture day-to-day volatility, weekends, holidays, scheduled events, or news shocks. Economic headlines above provide context only and do not adjust these numbers.
                </p>
                <p className="mt-1">
                  {geopoliticalModel
                    ? `The displayed historical index adjustment is calculated from the observed 30-day change in the Global Geopolitical Risk Index and its linear relationship with historical monthly GBP/INR changes. It is included transparently even when small; the index explains only ${geopoliticalModel.rSquared * 100 < 0.01 ? '<0.01' : (geopoliticalModel.rSquared * 100).toFixed(2)}% of historical monthly FX variation in this sample, so it should not be read as a reliable or causal event effect.`
                    : 'The geopolitical risk index is unavailable, so no index adjustment is applied; the displayed estimate is based on the historical GBP/INR trend only.'}
                </p>
                <p className="mt-1 font-semibold">Indicative historical trend only—not a guaranteed exchange rate or financial advice.</p>
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Historical trend estimate</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A simple 3-month GBP/INR projection</p>
            </div>
            {forecast && (
              <div className="rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-900/20">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Estimate for {formatDate(`${forecast.horizon}-01`, { month: 'short', year: 'numeric' })}</p>
                <p className="mt-0.5 text-xl font-bold text-amber-900 dark:text-amber-200">{formatRate(forecast.rate)}</p>
                {forecast.change !== null && forecast.changePercent !== null && (
                  <p className={`text-xs font-medium ${forecast.change >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {forecast.change > 0 ? '+' : ''}{formatRate(forecast.change)} ({forecast.changePercent > 0 ? '+' : ''}{forecast.changePercent.toFixed(2)}%) vs latest
                  </p>
                )}
              </div>
            )}
          </div>
          {loading && rates.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500 dark:text-slate-400">Preparing estimate…</div>
          ) : !forecast ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              At least three completed months of history are needed to calculate an estimate.
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 bg-blue-600" />Monthly average</span>
                <span className="inline-flex items-center gap-2"><span className="w-4 border-t-2 border-dashed border-amber-500" />Trend estimate</span>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={forecast.chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={value => formatDate(`${value}-01`, { month: 'short', year: '2-digit' })}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={54}
                      domain={['auto', 'auto']}
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickFormatter={value => `₹${Number(value).toFixed(0)}`}
                    />
                    <Tooltip
                      labelFormatter={value => formatDate(`${value}-01`, { month: 'long', year: 'numeric' })}
                      formatter={(value, name) => [formatRate(Number(value)), name === 'estimate' ? 'Trend estimate' : 'Monthly average']}
                      contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgb(15 23 42 / 0.1)' }}
                    />
                    <Line type="monotone" dataKey="historical" name="Monthly average" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="estimate" name="Trend estimate" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" connectNulls dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Method: straight-line regression over {forecast.monthsUsed} completed monthly averages from {formatDate(`${forecast.basisStart}-01`, { month: 'short', year: 'numeric' })} to {formatDate(`${forecast.basisEnd}-01`, { month: 'short', year: 'numeric' })}, extrapolated three calendar months beyond the latest rate month. It assumes the recent linear trend continues; it does not model seasonality, policy changes, or market shocks.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Qualitative event overlay: review the recent headlines above for possible policy, inflation, and market drivers. They provide context that could reinforce or disrupt the historical trend, but are not converted into a numerical adjustment because headline-only effects are uncertain and may already be priced in.
              </p>
              <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                Indicative estimate only — not a guaranteed exchange rate or financial advice.
              </p>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Year-by-year dated rate timeline</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Open a calendar year to see every published date, its GBP/INR rate, and the movement from the previous available rate.
              </p>
            </div>
          </div>
          {loading && rates.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading dated rate history…</p>
          ) : yearlyTimelines.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No dated rate history is available.</p>
          ) : (
            <div className="space-y-3">
              {yearlyTimelines.map(({ year, timeline, increaseCount }) => {
                const isExpanded = activeYear === year;
                return (
                <div
                  key={year}
                  className="group rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedYear(isExpanded ? null : year)}
                    className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-base font-semibold text-slate-900 dark:text-white">{year}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {timeline.length.toLocaleString('en-IN')} published rates
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        {increaseCount.toLocaleString('en-IN')} increases
                      </span>
                      <span aria-hidden="true" className={`text-xs text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-100 dark:border-slate-800">
                      <div className="border-b border-slate-100 px-4 py-4 dark:border-slate-800">
                        <div className="mb-3">
                          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{year} rate movement</h3>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">One point per published date. Hover or focus the chart to see the date and exact rate.</p>
                        </div>
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                              <defs>
                                <linearGradient id={`yearRateFill-${year}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                              <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                minTickGap={32}
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                tickFormatter={value => formatDate(value, { day: 'numeric', month: 'short' })}
                              />
                              <YAxis
                                axisLine={false}
                                tickLine={false}
                                width={54}
                                domain={['auto', 'auto']}
                                tick={{ fill: '#94a3b8', fontSize: 11 }}
                                tickFormatter={value => `₹${Number(value).toFixed(0)}`}
                              />
                              <Tooltip
                                labelFormatter={value => formatDate(String(value))}
                                formatter={value => [formatRate(Number(value)), 'GBP/INR']}
                                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgb(15 23 42 / 0.1)' }}
                              />
                              <Area type="monotone" dataKey="rate" stroke="#2563eb" strokeWidth={2} fill={`url(#yearRateFill-${year})`} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="max-h-[520px] overflow-auto px-4">
                        <ol className="min-w-[400px] divide-y divide-slate-100 dark:divide-slate-800">
                      {timeline.map((point, index) => (
                        <li key={point.date} className="relative grid grid-cols-[minmax(90px,1fr)_minmax(90px,1fr)_minmax(140px,1.5fr)] items-center gap-3 py-2.5 text-sm">
                          <span className="flex items-center gap-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${
                              point.change === null ? 'bg-slate-300 dark:bg-slate-600'
                                : point.change > 0 ? 'bg-emerald-500'
                                  : point.change < 0 ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'
                            }`} />
                            <time dateTime={point.date}>{formatDate(point.date, { day: 'numeric', month: 'short' })}</time>
                          </span>
                          <span className="whitespace-nowrap text-right font-medium tabular-nums text-slate-900 dark:text-white">
                            {formatRate(point.rate)}
                          </span>
                          <span className="whitespace-nowrap text-right tabular-nums">
                            {point.change === null || point.changePercent === null ? (
                              <span className="text-xs text-slate-400">
                                {index === 0 ? 'First available rate' : '—'}
                              </span>
                            ) : (
                              <DailyChange change={point.change} percent={point.changePercent} />
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            A date appears when the reference source publishes a business-day rate; weekends and holidays are skipped. The movement compares with the previous available published rate, including across year boundaries.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Daily rate changes</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Compared with the previous available reference rate</p>
          </div>
          {loading && rates.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading daily rates…</p>
          ) : recentDailyRates.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No daily rates available.</p>
          ) : (
            <div className="max-h-[390px] overflow-auto">
              <table className="w-full min-w-[380px] text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-400 dark:bg-slate-900">
                  <tr>
                    <th scope="col" className="pb-3 pr-3 font-medium">Date</th>
                    <th scope="col" className="pb-3 pr-3 text-right font-medium">Rate</th>
                    <th scope="col" className="pb-3 text-right font-medium">Daily change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recentDailyRates.map((point, index) => {
                    const earlierPoint = rates[rates.length - 2 - index];
                    const change = earlierPoint ? point.rate - earlierPoint.rate : null;
                    const percent = earlierPoint ? (change! / earlierPoint.rate) * 100 : null;
                    return (
                      <tr key={point.date}>
                        <th scope="row" className="whitespace-nowrap py-3 pr-3 font-medium text-slate-700 dark:text-slate-200">
                          {formatDate(point.date, { day: 'numeric', month: 'short' })}
                        </th>
                        <td className="whitespace-nowrap py-3 pr-3 text-right font-medium tabular-nums text-slate-900 dark:text-white">
                          {formatRate(point.rate)}
                        </td>
                        <td className="whitespace-nowrap py-3 text-right tabular-nums">
                          {change === null || percent === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <DailyChange change={change} percent={percent} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </section>

      <footer className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
        <strong className="font-semibold text-slate-700 dark:text-slate-300">Source &amp; methodology:</strong>{' '}
        Historical reference rates from{' '}
        <a
          href="https://www.frankfurter.dev/"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400"
        >
          Frankfurter
        </a>
        , an open API for European Central Bank reference data. Each rate means 1 GBP = the displayed INR amount. The ECB publishes rates on business days, so daily change compares with the previous available rate (weekends and bank holidays are skipped). Monthly trend and forecast values use arithmetic averages of available daily rates; yearly history is shown as individual published dates and is not averaged.
        {' '}News headlines are from Google News’ recent UK/India currency and central-bank search, delivered through RSS2JSON. Publisher names and publication timestamps are shown as supplied by the feed (displayed in UTC); “Feed checked” is the time this app retrieved it. Headlines are source-reported, while FX channels are general, conditional context—not verified causal effects. News is a qualitative overlay and is not converted into a numeric forecast adjustment.
      </footer>
    </div>
  );
}
