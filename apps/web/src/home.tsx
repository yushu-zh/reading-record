import { useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import type { Home, Profile, ProgressBook } from '../../../packages/contracts';
import { Avatar, Icon, Progress } from './visual';

const add = '__add';
type ShelfProps = {
  profile: Profile | null; label: string; books: ProgressBook[];
  home: Home; self?:boolean; unavailable?:boolean; openCreate:()=>void; openInvite:()=>void; openCheck:(id:string)=>void;
};
function Shelf({ profile,label,books,home,self,unavailable,openCreate,openInvite,openCheck }: ShelfProps) {
  const entries = self ? [...books.map(book => book.id),add] : books.map(book => book.id);
  const [selected,setSelected] = useState(entries[0]);
  const previousBooks = useRef(books);
  const addedBook = self && selected === add
    ? books.find(book => !previousBooks.current.some(previous => previous.id === book.id))
    : undefined;
  const current = addedBook?.id ?? (entries.includes(selected) ? selected : entries[0]);
  useEffect(() => { previousBooks.current = books; if (current !== selected) setSelected(current); },[current,selected,books]);
  const index = entries.indexOf(current);
  const book = books.find(item => item.id === current);
  const start = useRef<{x:number;y:number} | null>(null);
  const swipe = useRef(false);
  function move(direction:number) {
    const next = index + direction;
    if (next >= 0 && next < entries.length) setSelected(entries[next]);
  }
  function finish(event: TouchEvent) {
    if (!start.current || !event.changedTouches[0]) return;
    const dx = event.changedTouches[0].clientX-start.current.x, dy = event.changedTouches[0].clientY-start.current.y;
    if (Math.abs(dx)>38 && Math.abs(dx)>Math.abs(dy)*1.25) {
      swipe.current = true;
      move(dx<0 ? 1 : -1);
    }
    start.current = null;
  }
  function suppress(event:MouseEvent) {
    if (!swipe.current || event.detail === 0) return;
    event.stopPropagation();
    event.preventDefault();
    swipe.current = false;
  }
  const canCheck = Boolean(self && book && book.beforeToday < book.totalPages && (!book.completedOn || book.completedOn === home.date));
  return <section className={'shelf ' + (self ? 'peach' : 'sage')} aria-label={label}
    onTouchStart={event => { swipe.current = false; start.current = {x:event.touches[0].clientX,y:event.touches[0].clientY}; }}
    onPointerDownCapture={() => { swipe.current = false; }} onTouchEnd={finish} onTouchCancel={() => { start.current = null; }} onClickCapture={suppress}>
    <Avatar profile={profile}/>
    <h2><span title={profile?.nickname}>{profile?.nickname ?? label}</span></h2>
    <div className="shelf-title">
      <button className="arrow" aria-label={label + '的上一本书'} disabled={index <= 0} onClick={() => move(-1)}><Icon name="left"/></button>
      {book && <h3 title={book.title}>{book.title}</h3>}
      <button className="arrow" aria-label={label + '的下一本书'} disabled={index < 0 || index >= entries.length-1}
        onClick={() => move(1)}><Icon name="right"/></button>
    </div>
    {book ? <Progress key={book.id} book={book} weekStart={home.weekStart} onCheck={canCheck ? () => openCheck(book.id) : undefined}/> : <div className="shelf-empty">
      {self ? <button className="empty-action" onClick={openCreate}><span><Icon name="plus" size={32}/></span>新建书籍</button>
        : unavailable ? <p>好友进度暂不可用</p> : !profile ? <button className="empty-action" onClick={openInvite}><span><Icon name="plus" size={32}/></span>邀请好友</button>
          : <><span className="empty-symbol"><Icon name="book" size={32}/></span><p>好友暂无在读书籍</p></>}
    </div>}
  </section>;
}
export function HomeView({ data, friendUnavailable, openCreate,openInvite,openCheck }: {
  data:Home; friendUnavailable:boolean; openCreate:()=>void; openInvite:()=>void; openCheck:(id:string)=>void;
}) {
  const shared = { home:data,openCreate,openInvite,openCheck };
  const friend = friendUnavailable ? null : data.friend;
  return <main className="home-view">
    <div className="shelves">
      <Shelf {...shared} self profile={data.self} books={data.self.books} label="我"/>
      <Shelf key={friend?.id ?? 'unbound'} {...shared} profile={friend} unavailable={friendUnavailable} books={friend?.books ?? []} label="朋友"/>
    </div>
  </main>;
}
