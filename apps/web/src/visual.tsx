import { useRef, useState, type ReactNode } from 'react';
import type { Profile, ProgressBook } from '../../../packages/contracts';

function PlaceholderAvatar() {
  return <span className="avatar avatar-placeholder" aria-hidden="true"><Icon name="me" size={33}/></span>;
}
function UploadedAvatar({src}: {src:string}) {
  const [failed,setFailed]=useState(false);
  if (failed) return <PlaceholderAvatar/>;
  return <img className="avatar" src={src} alt="" onError={()=>setFailed(true)}/>;
}
export function Avatar({profile}: {profile?:Profile|null}) {
  if (!profile?.avatarVersion) return <PlaceholderAvatar/>;
  const src=`/api/v1/avatars/${encodeURIComponent(profile.id)}?v=${profile.avatarVersion}`;
  return <UploadedAvatar key={src} src={src}/>;
}
export function Icon({ name, size = 24 }: { name:string; size?:number }) {
  const paths: Record<string,ReactNode> = {
    home:<><path d="M3 10.5 12 3l9 7.5v9.2a1.3 1.3 0 0 1-1.3 1.3H15v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5H4.3A1.3 1.3 0 0 1 3 19.7z"/></>,
    stats:<><rect x="3" y="8" width="6" height="12" rx="1.7"/><rect x="14" y="3" width="7" height="17" rx="1.8"/></>,
    me:<><circle cx="12" cy="6.5" r="4"/><path d="M3.5 21a8.5 7 0 0 1 17 0z"/></>,
    eye:<><path d="M2 14a10.1 10.1 0 0 1 20 0"/><circle cx="12" cy="14" r="3.4"/></>,
    'eye-off':<><path d="M3 3l18 18M11 5a10.1 10.1 0 0 1 11 9M6.2 6.8A10.1 10.1 0 0 0 2 14m6.7-1a3.4 3.4 0 0 0 4.4 4.2"/></>,
    left:<path d="m15 18-6-6 6-6" style={{"--arrow-hover-x": "2px"} as React.CSSProperties}/>,
    right:<path d="m9 18 6-6-6-6" style={{"--arrow-hover-x": "-2px"} as React.CSSProperties}/>,
    plus:<path d="M12 5v14M5 12h14"/>,
    close:<path d="m6 6 12 12M18 6 6 18"/>,
    book:<><path d="M12 6v14M12 6C9 3 6 3 3 4v14c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 2Z"/></>,
    copy:<><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const weekdayColors = ['#FFB3C1','#FFD0A8','#FFF0A6','#C8F5C2','#BDF4EC','#BDD7FF','#E0C7FF'];
export function progressGeometry(book: ProgressBook, weekStart: string) {
  const openingDay = Date.parse(weekStart + 'T00:00:00Z');
  let start = book.weekOpeningPage;
  const segments = [...book.days].sort((a,b) => a.date.localeCompare(b.date)).flatMap(day => {
    if (day.page <= start) return [];
    const color = weekdayColors[Math.round((Date.parse(day.date + 'T00:00:00Z') - openingDay) / 86400000)];
    const segment = { start, end:day.page, color };
    start = day.page;
    return [segment];
  });
  const markers = segments.map(s => ({ page:s.end, color:s.color }));
  if (book.weekOpeningPage>0 && book.weekOpeningPage<book.totalPages) {
    markers.unshift({page:book.weekOpeningPage,color:'#989b98'});
  }
  if (markers.at(-1)?.page !== book.totalPages) markers.push({ page:book.totalPages,color:'#989b98' });
  let minGap = book.totalPages;
  for (let i=1; i<markers.length; i++) minGap = Math.min(minGap,markers[i].page-markers[i-1].page);
  return { segments,markers, requiredHeight: Math.ceil(25 * book.totalPages / minGap) };
}
export function Progress({ book, weekStart, onCheck }: { book: ProgressBook; weekStart:string; onCheck?: () => void }) {
  const { segments,markers,requiredHeight } = progressGeometry(book,weekStart);
  const position = (page:number) => (page / book.totalPages * 100) + '%';
  const zoomed = requiredHeight > 310;
  const view = useRef<HTMLDivElement>(null);
  // Positions use the same containing block even when the chart is scrolled.
  return <div className="progress-group">
    {zoomed && <button className="progress-jump" type="button" onClick={() => {
      const node = view.current;
      if (node) node.scrollTop = Math.max(0, node.scrollHeight * (book.currentPage / book.totalPages) - node.clientHeight / 2);
    }}>定位进度</button>}
    <div className={'progress-viewport' + (zoomed ? ' zoomed' : '')} ref={view} tabIndex={zoomed ? 0 : undefined}>
      <div className="progress-scale" style={zoomed ? {height:requiredHeight} : undefined}
        aria-label={`已读 ${book.currentPage} / ${book.totalPages} 页`}>
        <div className="track">
          <span className="unread" style={{ top:position(book.currentPage) }} />
          {segments.map(segment => <span className="segment" key={segment.end}
            style={{ top:position(segment.start),height:position(segment.end-segment.start),backgroundColor:segment.color }} />)}
          {onCheck && <button aria-label="记录阅读页码" className="unread-action"
            style={{top:position(book.currentPage<book.totalPages ? book.currentPage : book.beforeToday)}}
            onClick={onCheck}/> }
        </div>
        {markers.map(marker => <span className="page-marker" key={marker.page}
          style={{ top:position(marker.page),'--marker':marker.color } as React.CSSProperties}>{marker.page}</span>)}
      </div>
    </div>
  </div>;
}
