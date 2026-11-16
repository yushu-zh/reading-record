import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Book, CheckInResult, Home } from '../../../packages/contracts';
import { api, errorText, offlineMessage, RequestError, updateDraft, type Draft } from './api';
import { Icon } from './visual';

export function Sheet({ title, close, children }: { title:string; close:()=>void; children:ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  },[]);
  return <dialog ref={dialog} className="sheet" aria-labelledby="sheet-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="sheet-body">
      <header><h2 id="sheet-title">{title}</h2><button className="icon-button" aria-label="关闭" onClick={close}><Icon name="close"/></button></header>
      {children}
    </div>
  </dialog>;
}
export function Feedback({ message }: { message:string }) {
  return message ? <p className="feedback" role="alert">{message}</p> : null;
}
export function BookForm({ book, done, reload }: { book?:Book; done:()=>void; reload:()=>Promise<Book | undefined> }) {
  const [title,setTitle] = useState(book?.title ?? ''), [total,setTotal] = useState(book?.totalPages.toString() ?? '');
  const [read,setRead] = useState('0');
  const [revision,setRevision] = useState(book?.revision);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [deleting,setDeleting] = useState(false);
  const request = useRef({ id:crypto.randomUUID(), input:'' });
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const totalPages = Number(total), initialPage = Number(read), input = JSON.stringify([title.trim(),totalPages,initialPage]);
    if (request.current.input !== input) request.current = { id:crypto.randomUUID(),input };
    try {
      await api(book ? '/books/'+book.id : '/books', book ? 'PATCH' : 'POST',
        book ? { title,totalPages,expectedRevision:revision } : { title,totalPages,initialPage,requestId:request.current.id });
      done();
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409 && book) {
        const fresh = await reload();
        if (fresh) setRevision(fresh.revision);
      }
      setError(errorText(failure));
    } finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !book) return;
    setBusy(true); setError('');
    try {
      await api('/books/'+book.id,'DELETE',{ expectedRevision:revision });
      done();
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409) {
        const fresh = await reload();
        if (fresh) setRevision(fresh.revision);
      }
      setError(errorText(failure));
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="form">
    <label>书名<input required maxLength={120} placeholder="输入书名" value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>总页数<input required type="number" inputMode="numeric" min="1" max="1000000" step="1"
      placeholder="输入总页数" value={total} onChange={e=>setTotal(e.target.value)}/></label>
    {!book && <label>已读页数<input required type="number" inputMode="numeric" min="0" max={total || undefined}
      step="1" value={read} onChange={e=>setRead(e.target.value)}/></label>}
    <Feedback message={error}/>
    <button className="primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存书籍'}</button>
    {book && (deleting ? <div className="confirm">
      <p>删除《{book.title}》？历史打卡会保留。</p>
      <button className="text-button" type="button" onClick={()=>setDeleting(false)}>取消</button>
      <button className="danger" type="button" disabled={busy} onClick={remove}>确认删除</button>
    </div> : <button className="danger" type="button" onClick={()=>setDeleting(true)}>删除书籍</button>)}
  </form>;
}

export function CheckForm({ snapshot, bookId, initialDraft, refresh, done }: {
  snapshot:Home; bookId:string; initialDraft:Draft|null; refresh:()=>Promise<Home|undefined>; done:()=>void;
}) {
  const [home,setHome] = useState(snapshot);
  const [selected,setSelected] = useState(initialDraft?.bookId ?? bookId);
  const [page,setPage] = useState(initialDraft?.page.toString() ?? '');
  const draft = useRef<Draft|null>(initialDraft);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [confirm,setConfirm] = useState(false);
  const books = home.self.books.filter(book => !book.completedOn || book.completedOn === home.date);
  const book = books.find(item => item.id === selected);
  function write(value:string, selection=selected) {
    const item = books.find(candidate => candidate.id === selection);
    const number = Number(value);
    if (!value || !item || !Number.isSafeInteger(number) || number < 0 || number > 1000000) {
      draft.current = null;
    } else {
      const sameDraft = draft.current?.page === number && draft.current?.bookId === selection;
      if (!sameDraft) {
        const previous = draft.current?.bookId === selection ? draft.current : null;
        draft.current = {
          bookId:selection,page:number,expectedDate:previous?.expectedDate ?? home.date,
          expectedRevision:previous?.expectedRevision ?? item.revision,requestId:crypto.randomUUID(),
        };
      }
    }
    updateDraft(home.self.id,draft.current);
  }
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    let pending = draft.current;
    if (confirm && book && pending) {
      pending = { ...pending,expectedDate:home.date,expectedRevision:book.revision,requestId:crypto.randomUUID() };
      draft.current = pending;
      updateDraft(home.self.id,pending);
      setConfirm(false);
    }
    if (!pending) return;
    if (!navigator.onLine) { setError(offlineMessage); return; }
    setBusy(true); setError('');
    try {
      const { bookId:id,...input } = pending;
      await api<CheckInResult>('/books/'+id+'/check-ins','POST',input);
      updateDraft(home.self.id,null);
      done();
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409) {
        const fresh = await refresh();
        if (fresh) { setHome(fresh); setConfirm(true); }
      }
      setError(errorText(failure));
    } finally { setBusy(false); }
  }
  const original = draft.current?.expectedDate;
  return <form className="form" onSubmit={submit}>
    <label>书籍<select value={selected} onChange={e=>{setSelected(e.target.value);setPage('');write('',e.target.value);setConfirm(false);setError('');}}>
      {!book && <option value={selected}>原书籍已不可打卡</option>}
      {books.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
    </select></label>
    <label>累计页码<input required type="number" step="1" min={confirm ? book?.beforeToday ?? 0 : 0}
      max={confirm ? book?.totalPages ?? 1000000 : 1000000} inputMode="numeric" placeholder={book?.currentPage.toString()}
      value={page} onChange={e=>{setPage(e.target.value);write(e.target.value);}}/></label>
    {book && <p className="hint">可记录 {book.beforeToday}–{book.totalPages} 页</p>}
    {original && original !== home.date && <p className="hint">草稿日期 {original} · 当前日期 {home.date}</p>}
    <Feedback message={error}/>
    <button type="submit" className="primary" disabled={busy || (!book && !draft.current) || (confirm && !book)}>
      {busy ? '正在提交…' : confirm ? `确认打卡到 ${home.date}` : '提交打卡'}
    </button>
  </form>;
}
