import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { Book, Home, Me } from '../../../packages/contracts';
import { api, DRAFT_EVENT, errorText, query, readDraft, RequestError, updateDraft, type Draft } from './api';
import { SignIn } from './auth';
import { BookForm, CheckForm, Feedback, Sheet } from './forms';
import { HomeView } from './home';
import { AvatarUpload } from './avatar-upload';
import { ProfileView } from './profile';
import { Avatar, Icon } from './visual';
import './styles.css';

type Tab = 'home'|'stats'|'me';
type Modal = { kind:'book'; book?:Book } | { kind:'check'; bookId:string; draft:Draft|null }
  | { kind:'friend' } | { kind:'avatar' };
const tabs = [{id:'home',label:'首页'},{id:'stats',label:'统计'},{id:'me',label:'我的'}] as const;

function App() {
  const me = useQuery({ queryKey:['me'],queryFn:({signal})=>api<Me>('/me','GET',undefined,signal) });
  const authRequired = me.error instanceof RequestError && me.error.status===401;
  useEffect(()=>{
    if (!authRequired) return;
    query.removeQueries({ queryKey:['home'] });
    query.removeQueries({ queryKey:['books'] });
  },[authRequired]);
  return me.data && !authRequired ? <Workspace key={me.data.id} me={me.data}/>
      : authRequired ? <SignIn signedIn={()=>void me.refetch()}/>
        : <main className="auth-view"><div className="panel auth-card">
          <h1>阅读打卡</h1>{me.isPending ? <p role="status">正在加载…</p> : <>
            <Feedback message={errorText(me.error)}/>
            <button className="primary" onClick={()=>void me.refetch()}>重试</button></>}
        </div></main>;
}

function Workspace({me}: {me:Me}) {
  const [tab,setTab] = useState<Tab>('home'), [modal,setModal] = useState<Modal|null>(null);
  const [profileOpen,setProfileOpen] = useState(false);
  const [draft,setDraft] = useState(()=>readDraft(me.id));
  const [homeFailure,setHomeFailure] = useState('');
  const [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  const workspaceActive = useRef(true);
  const [visible,setVisible] = useState(()=>!document.hidden);
  const homeKey = ['home',me.id], booksKey = ['books',me.id];
  const home = useQuery({ queryKey:homeKey, queryFn:({signal})=>api<Home>('/home','GET',undefined,signal),
    enabled:tab==='home' && visible, refetchInterval:tab==='home' && visible ? 15000 : false });
  const books = useQuery({ queryKey:booksKey, queryFn:({signal})=>api<Book[]>('/books','GET',undefined,signal),enabled:tab==='stats' });
  const current = home.data;
  useEffect(()=>{
    workspaceActive.current = true;
    return () => { workspaceActive.current = false; };
  },[]);
  useEffect(()=>{
    function syncDraft() { setDraft(readDraft(me.id)); }
    function visibility() { setVisible(!document.hidden); }
    function online() { if (tab==='home' && !document.hidden) void home.refetch({cancelRefetch:false}); syncDraft(); }
    window.addEventListener(DRAFT_EVENT,syncDraft); window.addEventListener('online',online);
    document.addEventListener('visibilitychange',visibility);
    return ()=>{
      window.removeEventListener(DRAFT_EVENT,syncDraft); window.removeEventListener('online',online);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[home.refetch,me.id,tab]);
  useEffect(()=>{
    if (!visible || tab!=='home') void query.cancelQueries({queryKey:['home',me.id]});
  },[visible,tab,me.id]);
  useEffect(()=>{
    if (home.error instanceof RequestError && home.error.status===401 ||
        books.error instanceof RequestError && books.error.status===401) {
      void query.invalidateQueries({queryKey:['me']});
    }
  },[home.error,books.error]);
  useEffect(()=>{
    if (current && current.relationshipId !== (me.friend?.relationshipId ?? null)) {
      void query.invalidateQueries({ queryKey:['me'] });
    }
  },[current,me.friend]);
  useEffect(()=>{
    if (home.isError) {
      setHomeFailure(errorText(home.error));
      if (home.data?.friend) query.setQueryData<Home>(['home',me.id], {...home.data,friend:null});
    }
  },[home.error,home.errorUpdatedAt,home.isError,home.data,me.id]);
  useEffect(()=>{
    if (home.isSuccess && home.data && (home.data.friend || !home.data.relationshipId)) setHomeFailure('');
  },[home.isSuccess,home.data]);

  async function refreshHome() {
    if (!workspaceActive.current) return;
    await query.cancelQueries({ queryKey:homeKey });
    const result = await home.refetch();
    return result.isSuccess ? result.data : undefined;
  }
  function saved(message='') {
    if (!workspaceActive.current) return;
    setModal(null); setNotice(message);
    void query.invalidateQueries({queryKey:booksKey});
    if (tab === 'home') void refreshHome();
    else void query.invalidateQueries({queryKey:homeKey});
  }
  async function refreshFriend(bound:boolean) {
    await query.cancelQueries({queryKey:homeKey});
    query.setQueryData<Home>(homeKey,data=>data ? {...data,friend:null,relationshipId:null} : undefined);
    if (bound) {
      setTab('home');
      setModal(null);
    }
    await Promise.all([
      query.invalidateQueries({queryKey:['me']}),
      bound || tab==='home' ? refreshHome() : query.invalidateQueries({queryKey:homeKey}),
    ]);
  }
  async function avatarSaved(avatarVersion:string) {
    await Promise.all([query.cancelQueries({queryKey:homeKey}),query.cancelQueries({queryKey:['me']})]);
    if (!workspaceActive.current) return;
    query.setQueryData<Me>(['me'],data=>data?.id===me.id ? {...data,avatarVersion} : data);
    query.setQueryData<Home>(homeKey,data=>data ? {...data,self:{...data.self,avatarVersion}} : data);
    setModal(null); setNotice('头像已更新。');
  }
  async function nicknameUpdated(nickname:string) {
    await Promise.all([query.cancelQueries({queryKey:homeKey}),query.cancelQueries({queryKey:['me']})]);
    if (!workspaceActive.current) return;
    query.setQueryData<Me>(['me'],data=>data?.id===me.id ? {...data,nickname} : data);
    query.setQueryData<Home>(homeKey,data=>data ? {...data,self:{...data.self,nickname}} : data);
  }
  async function logout() {
    setBusy(true); setNotice('');
    try {
      await api('/auth/session','DELETE');
      updateDraft(me.id,null);
      await query.cancelQueries();
      query.removeQueries({queryKey:['home']}); query.removeQueries({queryKey:['books']});
      query.resetQueries({queryKey:['me']}).catch(()=>undefined);
    } catch (failure) { setNotice(errorText(failure)); }
    finally { setBusy(false); }
  }
  const openCheck = (bookId:string) => setModal({kind:'check',bookId,draft:draft?.bookId===bookId ? draft : null});
  const shown = modal;
  return <div className="workspace">
    {tab==='home' && <>
      {current ? <HomeView data={current} friendUnavailable={Boolean(home.isError || homeFailure)}
        openCreate={()=>setModal({kind:'book'})} openInvite={()=>setModal({kind:'friend'})} openCheck={openCheck}/>
        : <main className="home-view loading"><p role="status">{home.isPending ? '正在加载阅读进度…' : errorText(home.error)}</p>
          {home.isError && <button className="text-button" onClick={()=>void refreshHome()}>重试</button>}</main>}
      {current && homeFailure && <p className="workspace-message" role="status">{homeFailure} <button className="text-button" onClick={()=>void refreshHome()}>刷新</button></p>}
      {draft && current && <button className="draft-link" onClick={()=>setModal({kind:'check',bookId:draft.bookId,draft})}>继续打卡草稿</button>}
    </>}
    {tab==='stats' && <main className="page-view">
      <header className="page-heading"><h1>书籍</h1><button className="icon-button accent" aria-label="新建书籍" onClick={()=>setModal({kind:'book'})}><Icon name="plus"/></button></header>
      {books.isError && <><Feedback message={errorText(books.error)}/><button className="text-button" onClick={()=>void books.refetch()}>重试</button></>}
      {books.isPending && <p role="status" className="muted">正在加载书籍…</p>}
      {books.data?.length===0 && <div className="panel empty-list"><Icon name="book" size={38}/><p>还没有书籍</p><button className="text-button" onClick={()=>setModal({kind:'book'})}>新建一本书</button></div>}
      <ul className="book-list">{books.data?.map(book=><li className="panel book-row" key={book.id}>
        <span className="book-icon"><Icon name="book"/></span><div><strong>{book.title}</strong>
          <p>{book.currentPage} / {book.totalPages} 页{book.completedOn ? ' · 已读完' : ''}</p></div>
        <button className="text-button" onClick={()=>setModal({kind:'book',book})}>编辑</button>
      </li>)}</ul>
    </main>}
    {tab==='me' && profileOpen && <ProfileView nickname={me.nickname} back={()=>setProfileOpen(false)} updated={nicknameUpdated}/>}
    {tab==='me' && !profileOpen && <main className="page-view">
      <header className="page-heading"><h1>我的</h1></header>
      <section className="panel person">
        <button className="avatar avatar-edit" aria-label="上传头像" onClick={()=>setModal({kind:'avatar'})}><Avatar profile={me}/></button>
        <div className="person-info"><h2>{me.nickname}</h2><p>{me.friend ? '已与 '+me.friend.nickname+' 绑定' : '尚未绑定好友'}</p></div>
        <button className="icon-button person-details" aria-label="编辑个人资料" onClick={()=>setProfileOpen(true)}><Icon name="right" size={20}/></button>
      </section>
      <ul className="panel settings" aria-label="账号与应用">
        <li className="settings-code"><p className="field-label">我的好友邀请码</p>
          <div className="code-row"><code>{me.friendCode}</code><Copy value={me.friendCode}/></div>
        </li>
        <li><button className="settings-action" onClick={()=>setModal({kind:'friend'})}>
          好友管理<Icon name="right" size={20}/>
        </button></li>
        <li><details className="settings-install">
          <summary className="settings-action">添加到主屏幕<Icon name="right" size={20}/></summary>
          <p>在 Android Chrome 中打开菜单，选择「添加到主屏幕」。在 iPhone Safari 中打开分享菜单，选择「添加到主屏幕」。</p>
        </details></li>
        <li><button className="settings-action logout" disabled={busy} onClick={()=>void logout()}>退出登录</button></li>
      </ul>
    </main>}
    {notice && <p className="workspace-message" role="status" onClick={()=>setNotice('')}>{notice}</p>}
    <nav className="tabbar" aria-label="主导航">{tabs.map(item=><button key={item.id} aria-current={tab===item.id ? 'page' : undefined}
      onClick={()=>{setTab(item.id);setProfileOpen(false);setNotice('');}}><Icon name={item.id} size={30}/><span>{item.label}</span></button>)}</nav>
    {shown?.kind==='book' && <Sheet title={shown.book ? '编辑书籍' : '新建书籍'} close={()=>setModal(null)}>
      <BookForm book={shown.book} done={()=>saved(shown.book?'书籍已更新。':'书籍已创建。')}
        reload={async()=> (await books.refetch()).data?.find(book=>book.id===shown.book?.id)}/>
    </Sheet>}
    {shown?.kind==='check' && current && <Sheet title="阅读打卡" close={()=>setModal(null)}>
      <CheckForm snapshot={current} bookId={shown.bookId} initialDraft={shown.draft} refresh={refreshHome} done={saved}/>
    </Sheet>}
    {shown?.kind==='friend' && <Sheet title="好友管理" close={()=>setModal(null)}>
      <FriendForm me={me} refresh={refreshFriend}/>
    </Sheet>}
    {shown?.kind==='avatar' && <Sheet title="上传头像" close={()=>setModal(null)}>
      <AvatarUpload done={avatarSaved}/>
    </Sheet>}
  </div>;
}
function Copy({value}: {value:string}) {
  const [label,setLabel] = useState('复制');
  return <button className="text-button copy" onClick={async()=>{
    try { await navigator.clipboard.writeText(value);setLabel('已复制'); }
    catch { setLabel('请长按复制'); }
  }}><Icon name="copy" size={16}/>{label}</button>;
}
function FriendForm({me,refresh}: {me:Me; refresh:(bound:boolean)=>Promise<void>}) {
  const [code,setCode] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false), [confirm,setConfirm] = useState(false);
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);setError('');
    try {
      const previous = me.friend;
      if (previous) await api('/friendship/'+previous.relationshipId,'DELETE');
      else await api('/friendship','POST',{code});
      setCode(''); setConfirm(false);
      await refresh(!previous);
    } catch (failure) {setError(errorText(failure));}
    finally {setBusy(false);}
  }
  return <div className="form">
    <div><p className="field-label">我的好友邀请码</p><div className="code-row"><code>{me.friendCode}</code><Copy value={me.friendCode}/></div></div>
    <form className="form" onSubmit={submit}>
      {me.friend ? <>
        <div className="friend-person"><Avatar profile={me.friend}/><strong>{me.friend.nickname}</strong></div>
        {confirm ? <><p className="hint">解除后，双方将无法查看彼此的阅读进度。</p>
          <button className="danger" disabled={busy}>确认解除</button>
          <button type="button" className="text-button" onClick={()=>setConfirm(false)}>取消</button></>
          : <button type="button" className="danger" onClick={()=>setConfirm(true)}>解除好友关系</button>}
      </> : <>
        <label>对方的好友邀请码<input autoCapitalize="none" autoComplete="off" required value={code} onChange={e=>setCode(e.target.value)}/></label>
        <button className="primary" disabled={busy}>{busy ? '正在绑定…' : '绑定好友'}</button>
      </>}
      <Feedback message={error}/>
    </form>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={query}><App/></QueryClientProvider></StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(()=>undefined);
}
