import { useState, useMemo } from 'react';
import { firstStatisticsYear, type Book, type BookHistory, type DailyTotal, type Statistics } from '../../../packages/contracts';
import { Icon } from './visual';

type ViewMode = 'day' | 'month';
const shanghaiDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function StatsView({ stats, openEdit }: { stats: Statistics; openEdit: (book: Book) => void }) {
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [expandedBook, setExpandedBook] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const today = shanghaiDate.format(new Date());
  const currentYear = Number(today.slice(0, 4));
  const year = Math.min(selectedYear ?? currentYear, currentYear);

  return (
    <main className="page-view stats-view">
      <header className="page-heading">
        <h1>统计</h1>
      </header>

      {/* 正在阅读的书籍 */}
      {stats.reading.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">正在阅读</h2>
          <ul className="book-list">
            {stats.reading.map(book => (
              <li className="panel book-row" key={book.id}>
                <span className="book-icon">
                  <Icon name="book" />
                </span>
                <div>
                  <strong>{book.title}</strong>
                  <p>{book.currentPage} / {book.totalPages} 页</p>
                </div>
                <button className="text-button" onClick={() => openEdit(book)}>
                  编辑
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 阅读量统计图 */}
      <section className="stats-section">
        <div className="stats-section-header">
          <h2 className="stats-section-title">阅读量统计</h2>
          <div className="view-mode-tabs">
            <button
              aria-pressed={viewMode === 'day'}
              onClick={() => setViewMode('day')}
            >
              日
            </button>
            <button
              aria-pressed={viewMode === 'month'}
              onClick={() => setViewMode('month')}
            >
              月
            </button>
          </div>
        </div>
        <div className="panel chart-panel">
          {viewMode === 'month' && currentYear >= firstStatisticsYear && (
            <div className="stats-year-selector">
              {Array.from({ length: currentYear - firstStatisticsYear + 1 }, (_, index) => {
                const optionYear = currentYear - index;
                return (
                  <button
                    key={optionYear}
                    className="year-tab"
                    aria-pressed={year === optionYear}
                    onClick={() => setSelectedYear(optionYear)}
                  >
                    {optionYear}
                  </button>
                );
              })}
            </div>
          )}
          {viewMode === 'day' && <div className="stats-year-placeholder" />}
          <ReadingVolumeChart dailyTotals={stats.dailyTotals} viewMode={viewMode} today={today} year={year} />
        </div>
      </section>

      {/* 已读完的书籍 */}
      {stats.completed.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">已读完</h2>
          <ul className="completed-list">
            {stats.completed.map(book => (
              <li key={book.id} className="panel completed-item">
                <button
                  className="completed-header"
                  onClick={() => setExpandedBook(expandedBook === book.id ? null : book.id)}
                >
                  <span className="book-icon">
                    <Icon name="book" />
                  </span>
                  <div className="completed-info">
                    <strong>{book.title}</strong>
                    <p>共 {book.totalPages} 页 · {book.completedOn}</p>
                  </div>
                  <Icon name={expandedBook === book.id ? 'close' : 'right'} size={20} />
                </button>
                {expandedBook === book.id && (
                  <div className="book-chart">
                    <BookProgressChart book={book} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats.reading.length === 0 && stats.completed.length === 0 && (
        <div className="panel empty-list">
          <Icon name="book" size={38} />
          <p>还没有书籍</p>
        </div>
      )}
    </main>
  );
}

function ReadingVolumeChart({ dailyTotals, viewMode, today, year }: {
  dailyTotals: DailyTotal[]; viewMode: ViewMode; today: string; year: number;
}) {
  const chartData = useMemo(() => {
    const buckets = new Map<string, { label: string; pages: number }>();

    if (viewMode === 'day') {
      // 找到第一条记录的日期，如果没有记录则使用今天
      const firstDate = dailyTotals.length > 0
        ? dailyTotals[0].date
        : today;
      const startDate = new Date(firstDate + 'T00:00:00Z');

      // 从第一条记录日期开始，往后30天
      for (let i = 0; i < 30; i++) {
        const date = new Date(startDate);
        date.setUTCDate(startDate.getUTCDate() + i);
        buckets.set(date.toISOString().slice(0, 10), {
          label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`, pages: 0,
        });
      }
    } else {
      for (let month = 1; month <= 12; month++) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        buckets.set(key, { label: `${month}月`, pages: 0 });
      }
    }

    for (const { date, pages } of dailyTotals) {
      const bucket = buckets.get(viewMode === 'day' ? date : date.slice(0, 7));
      if (bucket) bucket.pages += pages;
    }

    const maxPages = Math.max(...Array.from(buckets.values(), bucket => bucket.pages));
    return { buckets, maxPages };
  }, [dailyTotals, viewMode, today, year]);

  const isEmpty = chartData.maxPages === 0;
  if (viewMode === 'day' && isEmpty) {
    return <div className="chart-empty">暂无阅读数据</div>;
  }

  return (
    <div className={viewMode === 'month' ? 'bar-chart bar-chart-months' : 'bar-chart'}>
      <div className="bar-chart-bars">
        {isEmpty && <div className="bar-chart-empty">暂无阅读数据</div>}
        {Array.from(chartData.buckets, ([date, { label, pages }]) => (
          <div key={date} className="bar-wrapper">
            <div className="bar-container">
              <div
                className="bar"
                style={{ height: `${(pages / (chartData.maxPages || 1)) * 100}%` }}
                title={`${pages} 页`}
              >
                {pages > 0 && <span className="bar-value">{pages}</span>}
              </div>
            </div>
            <span className="bar-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookProgressChart({ book }: { book: BookHistory }) {
  const chartData = useMemo(() => {
    if (book.checkIns.length === 0) return { points: [], maxPage: book.totalPages };

    // 添加起点（初始页数为0）和所有打卡记录
    const points = [
      { date: book.checkIns[0].date, page: 0 },
      ...book.checkIns,
    ];

    return { points, maxPage: book.totalPages };
  }, [book]);

  if (chartData.points.length === 0) {
    return <div className="chart-empty">暂无打卡记录</div>;
  }

  // 计算 SVG 路径
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const width = 600;
  const height = 300;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const xScale = (index: number) => (index / (chartData.points.length - 1)) * chartWidth;
  const yScale = (page: number) => chartHeight - (page / chartData.maxPage) * chartHeight;

  const pathData = chartData.points
    .map((point, index) => {
      const x = xScale(index);
      const y = yScale(point.page);
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const areaData = `${pathData} L ${xScale(chartData.points.length - 1)} ${chartHeight} L 0 ${chartHeight} Z`;

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart-svg">
        <defs>
          <linearGradient id={`gradient-${book.id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#456985" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#456985" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        <g transform={`translate(${padding.left},${padding.top})`}>
          {/* 网格线 */}
          {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
            <g key={ratio}>
              <line
                x1="0"
                y1={yScale(ratio * chartData.maxPage)}
                x2={chartWidth}
                y2={yScale(ratio * chartData.maxPage)}
                stroke="#e3dfd7"
                strokeWidth="1"
              />
              <text
                x="-10"
                y={yScale(ratio * chartData.maxPage)}
                textAnchor="end"
                alignmentBaseline="middle"
                fontSize="12"
                fill="#5e666d"
              >
                {Math.round(ratio * chartData.maxPage)}
              </text>
            </g>
          ))}

          {/* 面积 */}
          <path d={areaData} fill={`url(#gradient-${book.id})`} />

          {/* 折线 */}
          <path d={pathData} fill="none" stroke="#456985" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* 数据点 */}
          {chartData.points.map((point, index) => (
            <circle
              key={index}
              cx={xScale(index)}
              cy={yScale(point.page)}
              r="4"
              fill="#456985"
              stroke="#fff"
              strokeWidth="2"
            >
              <title>{point.date}: {point.page} 页</title>
            </circle>
          ))}

          {/* X 轴标签 */}
          {chartData.points.map((point, index) => {
            // 只显示部分标签以避免拥挤
            const shouldShow = chartData.points.length <= 10 || index % Math.ceil(chartData.points.length / 8) === 0 || index === chartData.points.length - 1;
            if (!shouldShow) return null;

            return (
              <text
                key={index}
                x={xScale(index)}
                y={chartHeight + 20}
                textAnchor="middle"
                fontSize="11"
                fill="#5e666d"
              >
                {point.date.substring(5)}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
